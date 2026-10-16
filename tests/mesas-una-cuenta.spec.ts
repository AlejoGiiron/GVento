import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { loginAsOwner, ownerCreds } from './helpers/auth'
import { otraCreds } from './helpers/storage'
import { cliente, psql, psqlResultado, sesionRetenida } from './helpers/db-local'
import { mesaFija, liberarMesa } from './helpers/lab'

// ============================================================================
// UNA SOLA CUENTA VIVA POR MESA (supabase/mesas-una-cuenta.sql).
//
// Lo que pasó (Salchimelo, mesa 10, 2026-10-14/15): la mesa quedó con DOS cuentas
// vivas, y cada "Cerrar mesa" sobre la más antigua liberaba la mesa con la otra
// escondida; el siguiente "Abrir mesa" creaba otra. 7 cuentas en 25 horas.
// El origen probable: "Abrir mesa" en dos escrituras desde el navegador; si la
// respuesta de la orden se perdía, la pantalla desocupaba la mesa con la orden viva.
//
// Lo que custodia este spec:
//   1. la BASE rechaza una segunda cuenta viva en la misma mesa (el invariante,
//      para cualquier escritor), y deja abrir otra cuando la anterior se cerró;
//   2. abrir_mesa: abre, reconoce el reintento de la misma apertura, no abre una
//      mesa ocupada, recupera una cuenta escondida en vez de crear otra;
//   3. dos aperturas simultáneas de la misma mesa dejan UNA cuenta;
//   4. la frontera de una SECURITY DEFINER (RLS no la cuida): anon, otra sede, la clave
//      de otra mesa, una mesa archivada; y un escritor directo simultáneo (frontend viejo)
//      nunca deja dos cuentas ni sale como el 23505 crudo;
//   5. en la pantalla: con la respuesta perdida no se deshace nada y el reintento
//      devuelve la misma cuenta; una cuenta escondida se recupera.
// ============================================================================

const MESA = 'E2E Fija Una Cuenta'
let MESA_ID = ''
let SEDE = ''
let OWNER_ID = ''
let owner: SupabaseClient

const VIVAS = `('pending','preparing','ready')`
const ordenesVivas = () => Number(psql(
  `select count(*) from public.orders where table_id = '${MESA_ID}' and status in ${VIVAS};`))
const estadoMesa = () => psql(`select status from public.tables where id = '${MESA_ID}';`)
// Con CTE: un `insert … returning` suelto imprime además "INSERT 0 1" en psql -At.
const insertarOrdenViva = () => `with x as (
  insert into public.orders (type, status, total, restaurant_id, created_by, table_id)
  values ('dine_in', 'pending', 0, '${SEDE}', '${OWNER_ID}', '${MESA_ID}') returning id)
  select id from x;`

async function abrir(c: SupabaseClient, clave = randomUUID(), mesero: string | null = null) {
  const { data, error } = await c.rpc('abrir_mesa', { p_table_id: MESA_ID, p_open_id: clave, p_waiter_name: mesero })
  if (error) throw new Error(`abrir_mesa: ${error.message}`)
  return data as { resultado: string; order_id: string | null; ya_existia?: boolean; abierta_at?: string }
}

test.describe.serial('Una sola cuenta viva por mesa', () => {
  test.beforeAll(async () => {
    const o = await cliente(ownerCreds())
    owner = o.c; SEDE = o.sede; OWNER_ID = o.uid
    MESA_ID = await mesaFija(MESA)
  })

  // Cada caso desde un estado limpio: mesa libre y sin cuentas vivas.
  test.beforeEach(async () => { await liberarMesa(MESA) })
  test.afterAll(async () => { await liberarMesa(MESA) })

  // ── 1. El invariante, en la base ──
  test('la base rechaza una segunda cuenta viva en la misma mesa', () => {
    psql(insertarOrdenViva())
    const r = psqlResultado(insertarOrdenViva())
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain('orders_una_cuenta_viva_por_mesa')
    expect(ordenesVivas()).toBe(1)
  })

  test('contraste: con la cuenta anterior cerrada, la mesa admite una nueva', () => {
    const vieja = psql(insertarOrdenViva())
    psql(`update public.orders set status = 'cancelled' where id = '${vieja}';`)
    const r = psqlResultado(insertarOrdenViva())
    expect(r.status).toBe(0)
    expect(ordenesVivas()).toBe(1)
  })

  // ── 2. abrir_mesa ──
  test('abrir_mesa sobre una mesa libre la ocupa con UNA cuenta, a nombre de quien abre', async () => {
    const r = await abrir(owner, randomUUID(), '  Andrés  ')
    expect(r.resultado).toBe('abierta')
    expect(r.ya_existia).toBe(false)
    expect(estadoMesa()).toBe('occupied')
    expect(ordenesVivas()).toBe(1)
    expect(psql(`select created_by || '|' || waiter_name || '|' || type from public.orders where id = '${r.order_id}';`))
      .toBe(`${OWNER_ID}|Andrés|dine_in`)
  })

  test('el reintento con la MISMA clave devuelve la misma cuenta, no otra', async () => {
    const clave = randomUUID()
    const a = await abrir(owner, clave)
    const b = await abrir(owner, clave)
    expect(b.resultado).toBe('abierta')
    expect(b.ya_existia).toBe(true)
    expect(b.order_id).toBe(a.order_id)
    expect(ordenesVivas()).toBe(1)
  })

  test('una clave cuya cuenta ya se cerró no abre nada (ni devuelve la cuenta vieja)', async () => {
    const clave = randomUUID()
    const a = await abrir(owner, clave)
    await liberarMesa(MESA)   // la cuenta se cierra y la mesa queda libre
    const { error } = await owner.rpc('abrir_mesa', { p_table_id: MESA_ID, p_open_id: clave, p_waiter_name: null })
    expect(error?.message).toContain('Esa apertura ya se cerró')
    expect(psql(`select status from public.orders where id = '${a.order_id}';`)).toBe('cancelled')
    expect(estadoMesa()).toBe('free')
    expect(ordenesVivas()).toBe(0)
  })

  test('contraste: con OTRA clave, una mesa ya abierta no se abre de nuevo', async () => {
    const a = await abrir(owner)
    const b = await abrir(owner)
    expect(b.resultado).toBe('no_libre')
    expect(b.order_id).toBe(a.order_id)
    expect(ordenesVivas()).toBe(1)
  })

  test('una mesa ocupada SIN cuenta (pegada) no se abre: se libera desde el panel', async () => {
    psql(`update public.tables set status = 'occupied' where id = '${MESA_ID}';`)
    const r = await abrir(owner)
    expect(r.resultado).toBe('no_libre')
    expect(r.order_id).toBeNull()
    expect(ordenesVivas()).toBe(0)
  })

  test('una mesa LIBRE con una cuenta escondida la recupera en vez de crear otra', async () => {
    const escondida = psql(insertarOrdenViva())   // la mesa sigue 'free': el caso de la mesa 10
    const r = await abrir(owner)
    expect(r.resultado).toBe('recuperada')
    expect(r.order_id).toBe(escondida)
    expect(estadoMesa()).toBe('occupied')
    expect(ordenesVivas()).toBe(1)
  })

  // ── 3. La carrera ──
  test('dos aperturas simultáneas de la misma mesa dejan UNA cuenta', async () => {
    // La primera apertura queda retenida 3 s con la mesa bloqueada; la segunda
    // tiene que esperarla y, al seguir, ver la mesa ocupada.
    const { fin } = await sesionRetenida(OWNER_ID,
      `select public.abrir_mesa('${MESA_ID}', '${randomUUID()}', null)`, 3)
    const t0 = Date.now()
    const segunda = abrir(owner)
    await fin
    const r = await segunda
    expect(Date.now() - t0).toBeGreaterThan(1500)   // esperó el lock de la mesa
    expect(r.resultado).toBe('no_libre')
    expect(ordenesVivas()).toBe(1)
  })

  // ── 4. Sin sesión ──
  test('anon no puede abrir mesas', async () => {
    const anon = createClient(process.env.VITE_GVENTO_SUPABASE_URL!, process.env.VITE_GVENTO_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } })
    const { error } = await anon.rpc('abrir_mesa', { p_table_id: MESA_ID, p_open_id: randomUUID() })
    expect(error).not.toBeNull()
    expect(estadoMesa()).toBe('free')
    expect(ordenesVivas()).toBe(0)
  })

  test('un usuario de OTRA sede no abre una mesa de esta (ni la ve)', async () => {
    const otra = await cliente(otraCreds())
    expect(otra.sede).not.toBe(SEDE)
    const { error } = await otra.c.rpc('abrir_mesa', { p_table_id: MESA_ID, p_open_id: randomUUID(), p_waiter_name: null })
    expect(error?.message).toContain('La mesa no existe o no es de tu sede')
    expect(estadoMesa()).toBe('free')
    expect(ordenesVivas()).toBe(0)
  })

  test('la clave de una apertura no sirve para otra mesa, y una mesa archivada no se abre', async () => {
    const nombre = `E2E Transitoria Una Cuenta ${Date.now().toString(36)}`
    const otraMesa = psql(`with x as (insert into public.tables (name, restaurant_id, status)
      values ('${nombre}', '${SEDE}', 'free') returning id) select id from x;`)
    try {
      const clave = randomUUID()
      await abrir(owner, clave)   // la clave queda usada en MESA_ID
      const r1 = await owner.rpc('abrir_mesa', { p_table_id: otraMesa, p_open_id: clave, p_waiter_name: null })
      expect(r1.error?.message).toContain('La clave de apertura es de otra mesa')

      psql(`update public.tables set archived_at = now() where id = '${otraMesa}';`)
      const r2 = await owner.rpc('abrir_mesa', { p_table_id: otraMesa, p_open_id: randomUUID(), p_waiter_name: null })
      expect(r2.error?.message).toContain('La mesa está archivada')
      expect(psql(`select status || '|' || (select count(*) from public.orders where table_id = '${otraMesa}')
                     from public.tables where id = '${otraMesa}';`)).toBe('free|0')
    } finally {
      psql(`delete from public.tables where id = '${otraMesa}';`)
    }
  })

  test('un INSERT directo simultáneo (frontend viejo): abrir_mesa lo espera en la mesa y lo recupera', async () => {
    // Medido el 2026-10-16: el insert revisa la llave foránea a tables y toma KEY SHARE sobre la
    // mesa, que choca con el FOR UPDATE de abrir_mesa. abrir_mesa espera EN LA MESA (no en el
    // índice) y, cuando el otro confirma, ve su cuenta: la recupera, no crea otra.
    const { fin } = await sesionRetenida(OWNER_ID, `insert into public.orders
      (type, status, total, restaurant_id, created_by, table_id)
      values ('dine_in', 'pending', 0, '${SEDE}', '${OWNER_ID}', '${MESA_ID}')`, 3)
    const t0 = Date.now()
    const apertura = abrir(owner)
    await fin
    const r = await apertura
    expect(Date.now() - t0).toBeGreaterThan(1500)   // esperó al otro
    expect(r.resultado).toBe('recuperada')
    expect(r.order_id).toBe(psql(`select id from public.orders where table_id = '${MESA_ID}' and status in ${VIVAS};`))
    expect(estadoMesa()).toBe('occupied')
    expect(ordenesVivas()).toBe(1)
  })

  test('una cuenta que REVIVE a la vez (update directo): abrir_mesa choca en el índice y responde no_libre', async () => {
    // Un update que no cambia table_id no toca la llave foránea ni la mesa: abrir_mesa no lo ve,
    // inserta, espera en el índice y, cuando el otro confirma, choca. Es el único camino al
    // 23505 dentro de abrir_mesa, y tiene que salir como 'no_libre', no como el error crudo.
    const vieja = psql(insertarOrdenViva())
    psql(`update public.orders set status = 'cancelled' where id = '${vieja}';`)
    const { fin } = await sesionRetenida(OWNER_ID,
      `update public.orders set status = 'pending' where id = '${vieja}'`, 3)
    const t0 = Date.now()
    const apertura = abrir(owner)
    await fin
    const r = await apertura
    expect(Date.now() - t0).toBeGreaterThan(1500)   // esperó en el índice
    expect(r.resultado).toBe('no_libre')
    expect(r.order_id).toBe(vieja)
    expect(ordenesVivas()).toBe(1)
  })

  // ── 5. En la pantalla ──
  test.describe('pantalla de Mesas', () => {
    const card = (page: Page) => page.getByRole('button', { name: new RegExp(MESA) })

    test.beforeEach(async ({ page }) => { await loginAsOwner(page) })

    test('con la respuesta PERDIDA no se deshace nada, y el reintento devuelve la misma cuenta', async ({ page }) => {
      const claves: string[] = []
      let primera = true
      await page.route('**/rest/v1/rpc/abrir_mesa', async (route) => {
        claves.push((route.request().postDataJSON() as { p_open_id: string }).p_open_id)
        if (!primera) { await route.continue(); return }
        primera = false
        await route.fetch()                    // el servidor la ejecuta y confirma…
        await route.abort('connectionreset')   // …y la respuesta no llega
      })

      await page.goto('/mesas')
      await card(page).click()
      const abrirBtn = page.getByRole('button', { name: 'Abrir mesa' })
      await abrirBtn.click()
      await expect(page.getByText(/Error al abrir mesa/)).toBeVisible()
      // Antes del arreglo, aquí la pantalla desocupaba la mesa con la orden viva.
      expect(estadoMesa()).toBe('occupied')
      expect(ordenesVivas()).toBe(1)

      await abrirBtn.click()   // el cajero vuelve a tocar
      await expect(page.getByText(`Mesa ${MESA} abierta`)).toBeVisible()
      expect(claves).toHaveLength(2)
      expect(claves[1]).toBe(claves[0])   // la misma apertura, no otra
      expect(ordenesVivas()).toBe(1)
    })

    test('una cuenta escondida se recupera al abrir la mesa', async ({ page }) => {
      const escondida = psql(insertarOrdenViva())
      await page.goto('/mesas')
      await card(page).click()
      await page.getByRole('button', { name: 'Abrir mesa' }).click()
      await expect(page.getByText(`${MESA} tenía una cuenta abierta desde las`)).toBeVisible()
      expect(estadoMesa()).toBe('occupied')
      expect(psql(`select id from public.orders where table_id = '${MESA_ID}' and status in ${VIVAS};`)).toBe(escondida)
    })
  })
})
