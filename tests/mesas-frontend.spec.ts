import { test, expect, type Page, type Request } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ownerCreds, cashierCreds, waiterCreds, login } from './helpers/auth'
import { cliente, psql } from './helpers/db-local'

// ============================================================================
// Paso 10 — el frontend de Mesas sobre las RPC de supabase/mesas-servidor.sql.
// Lo que la PANTALLA hace se compara con lo que quedó en la BASE:
//   · Cobrar: UNA llamada a close_table_sale y ningún PATCH directo a orders /
//     tables (los 5 pasos sueltos de antes); el número es el de la base.
//   · Otro equipo cobró con el modal abierto: el aviso "Esta mesa ya la cobró…",
//     no un éxito propio, y la plata una sola vez.
//   · Respuesta perdida: el reintento lleva la MISMA clave y recibe su venta.
//   · La mesa cambió con el modal abierto (B1): no se cobra.
//   · Quitar ítem: motivo y "¿Se alcanzó a preparar?" obligatorios; el stock y la
//     baja, en la base. Sin pos.anular (mozo), la X deshabilitada.
//   · Cerrar sin consumo y eliminar/archivar por RPC; sin config.acceder (mozo),
//     no se ofrece eliminar.
//   · Historial: la sección "Ítems quitados de mesas". Inventario: "Merma".
// Mesas, órdenes y productos se arman por API/SQL (por UUID); la UI hace la
// operación que se prueba. Base LOCAL de Docker.
// ============================================================================

let owner: SupabaseClient
let cajero: SupabaseClient
let OWNER_ID = ''
let SEDE = ''
let NOMBRE_CAJERO = ''
let P_SIMPLE = ''   // simple, con control de stock, 5.000
const mesas: string[] = []
const ordenes: string[] = []

test.beforeAll(async () => {
  const o = await cliente(ownerCreds())
  const c = await cliente(cashierCreds())
  expect(c.sede, 'owner y cajero en la misma sede').toBe(o.sede)
  owner = o.c; cajero = c.c; OWNER_ID = o.uid; SEDE = o.sede
  NOMBRE_CAJERO = psql(`select full_name from public.profiles where id = '${c.uid}';`)
  const cat = psql(`select category_id from public.products where restaurant_id = '${SEDE}' and name = 'Lab Cerveza';`)
  P_SIMPLE = randomUUID()
  psql(`insert into public.products (id, name, price, category_id, restaurant_id, kind, stock_tracking, stock_qty)
        values ('${P_SIMPLE}', 'E2E MF Simple ${Date.now().toString(36)}', 5000, '${cat}', '${SEDE}', 'simple', true, 50);`)
})

test.afterAll(async () => {
  const lista = (xs: string[]) => xs.map((id) => `'${id}'`).join(',') || 'null'
  psql(`begin;
    delete from public.payments where order_id in (${lista(ordenes)});
    delete from public.orders where id in (${lista(ordenes)});
    delete from public.tables where id in (${lista(mesas)});
    delete from public.stock_movements where product_id = '${P_SIMPLE}';
    delete from public.products where id = '${P_SIMPLE}';
    commit;`)
  expect(psql(`select (select count(*) from public.orders where id in (${lista(ordenes)}))
                    + (select count(*) from public.tables where id in (${lista(mesas)}));`), 'residuos del spec').toBe('0')
})

// ── Ayudas ───────────────────────────────────────────────────────────────────

async function turnoAbierto() {
  const abierto = (await owner.from('cash_shifts').select('id').eq('restaurant_id', SEDE).is('closed_at', null).maybeSingle()).data
  if (abierto) return
  const { error } = await owner.from('cash_shifts').insert({ restaurant_id: SEDE, opened_by: OWNER_ID, opening_amount: 0 })
  if (error) throw error
}

/** Mesa con una orden abierta y `n` líneas del producto del spec (5.000 c/u), por el camino real. */
async function mesaConConsumo(n = 1): Promise<{ mesa: string; orden: string; nombre: string }> {
  const mesa = randomUUID()
  const orden = randomUUID()
  const nombre = `E2E MF ${mesa.slice(0, 6)}`
  psql(`insert into public.tables (id, name, restaurant_id, status) values ('${mesa}', '${nombre}', '${SEDE}', 'occupied');
        insert into public.orders (id, restaurant_id, type, status, table_id, created_by, total)
        values ('${orden}', '${SEDE}', 'dine_in', 'pending', '${mesa}', '${OWNER_ID}', 0);`)
  mesas.push(mesa); ordenes.push(orden)
  for (let i = 0; i < n; i++) {
    const r = await cajero.rpc('add_order_items_with_extras', {
      p_order_id: orden, p_lote: randomUUID(), p_items: [{ product_id: P_SIMPLE, qty: 1, unit_price: 5000, extras: [] }],
    })
    expect(r.error, r.error?.message).toBeNull()
  }
  return { mesa, orden, nombre }
}

/** Mesa sin consumo (orden abierta vacía) o sin orden. */
function mesaVacia(conOrden = true): { mesa: string; orden: string; nombre: string } {
  const mesa = randomUUID()
  const orden = randomUUID()
  const nombre = `E2E MF ${mesa.slice(0, 6)}`
  psql(`insert into public.tables (id, name, restaurant_id, status) values ('${mesa}', '${nombre}', '${SEDE}', '${conOrden ? 'occupied' : 'free'}');`)
  mesas.push(mesa)
  if (conOrden) {
    psql(`insert into public.orders (id, restaurant_id, type, status, table_id, created_by, total)
          values ('${orden}', '${SEDE}', 'dine_in', 'pending', '${mesa}', '${OWNER_ID}', 0);`)
    ordenes.push(orden)
  }
  return { mesa, orden, nombre }
}

const huella = (orden: string) => psql(`select o.status || '|' || o.payment_status || '|' ||
    (select count(*) from public.payments where order_id = o.id) || '|' ||
    coalesce((select string_agg(method::text, ',' order by method) from public.payments where order_id = o.id), '-') || '|' ||
    t.status from public.orders o join public.tables t on t.id = o.table_id where o.id = '${orden}';`)

/** Las escrituras que el navegador manda a la API REST (no RPC). */
function escriturasDirectas(page: Page): string[] {
  const vistas: string[] = []
  page.on('request', (r: Request) => {
    if (['PATCH', 'POST', 'DELETE'].includes(r.method()) && /\/rest\/v1\/(orders|tables|order_items|payments)\b/.test(r.url())) {
      vistas.push(`${r.method()} ${new URL(r.url()).pathname}`)
    }
  })
  return vistas
}

function llamadasRpc(page: Page, rpc: string): string[] {
  const cuerpos: string[] = []
  page.on('request', (r: Request) => {
    if (r.method() === 'POST' && r.url().includes(`/rest/v1/rpc/${rpc}`)) cuerpos.push(r.postData() ?? '')
  })
  return cuerpos
}

async function abrirMesa(page: Page, nombre: string) {
  await page.goto('/mesas')
  await page.getByRole('button', { name: new RegExp(nombre) }).click()
  await expect(page.getByTestId('mesa-cobrar').or(page.getByRole('button', { name: 'Cerrar mesa' }))).toBeVisible({ timeout: 15_000 })
}

/** Cobro en efectivo hasta el paso del monto, sin confirmar. */
async function hastaConfirmar(page: Page, nombre: string) {
  await abrirMesa(page, nombre)
  await page.getByTestId('mesa-cobrar').click()
  await page.getByTestId('pay-method-efectivo').click()
  await page.getByTestId('checkout-continue').click()
  await page.getByTestId('checkout-received').fill('100000')
}

// ── Cobrar ───────────────────────────────────────────────────────────────────

test.describe('Mesas: cobro por close_table_sale', () => {
  test.beforeEach(async ({ page }) => {
    await turnoAbierto()
    await login(page, ownerCreds())
  })

  test('cobrar: UNA llamada al servidor, ningún PATCH directo, y el número de la pantalla es el de la base', async ({ page }) => {
    const { orden, nombre } = await mesaConConsumo(2)
    const directas = escriturasDirectas(page)
    const cobros = llamadasRpc(page, 'close_table_sale')
    await hastaConfirmar(page, nombre)
    await page.getByRole('button', { name: /Confirmar cobro/ }).click()
    await expect(page.getByTestId('success-order-number')).toBeVisible()
    const numero = psql(`select order_number from public.orders where id = '${orden}';`)
    await expect(page.getByTestId('success-order-number')).toHaveText(`Venta #${numero}`)
    expect(huella(orden)).toBe('delivered|paid|1|cash|free')
    expect(psql(`select (cobrada_por = '${OWNER_ID}') || '|' || (close_id is not null) from public.orders where id = '${orden}';`)).toBe('true|true')
    expect(cobros, 'el cobro tiene que ser UNA llamada').toHaveLength(1)
    expect(JSON.parse(cobros[0])).toMatchObject({ p_order_id: orden, p_total_esperado: 10000 })
    expect(directas, 'quedó un paso suelto escribiendo directo a la base').toEqual([])
  })

  test('otro equipo la cobró con el modal abierto: "Esta mesa ya la cobró…", no un éxito propio, y un solo pago', async ({ page }) => {
    const { orden, nombre } = await mesaConConsumo(1)
    await hastaConfirmar(page, nombre)
    // El cajero la cobra desde OTRO equipo (otra clave), con tarjeta.
    const r = await cajero.rpc('close_table_sale', {
      p_order_id: orden, p_close_id: randomUUID(), p_total_esperado: 5000, p_payments: [{ method: 'card', amount: 5000 }],
    })
    expect(r.error, r.error?.message).toBeNull()
    // Realtime marca la mesa libre: el modal tiene que SEGUIR (su mesa es una copia).
    await expect(page.getByRole('button', { name: new RegExp(nombre) })).toContainText('Libre', { timeout: 15_000 })
    await page.getByRole('button', { name: /Confirmar cobro/ }).click()
    await expect(page.getByTestId('mesa-ya-cobrada')).toBeVisible()
    await expect(page.getByTestId('mesa-ya-cobrada-mensaje'))
      .toHaveText(new RegExp(`^Esta mesa ya la cobró ${NOMBRE_CAJERO} a las \\d{2}:\\d{2} con tarjeta\\.$`))
    await expect(page.getByTestId('success-order-number')).toHaveCount(0)
    expect(huella(orden), 'la mesa se cobró dos veces').toBe('delivered|paid|1|card|free')
  })

  test('respuesta perdida: el reintento lleva la MISMA clave y recibe su venta, cobrada una vez', async ({ page }) => {
    const { orden, nombre } = await mesaConConsumo(1)
    const claves: string[] = []
    let primera = true
    await page.route('**/rest/v1/rpc/close_table_sale', async (route) => {
      claves.push((route.request().postDataJSON() as { p_close_id: string }).p_close_id)
      if (!primera) { await route.continue(); return }
      primera = false
      await route.fetch()                       // el servidor cobra…
      await route.abort('connectionreset')      // …y el navegador no se entera
    })
    await hastaConfirmar(page, nombre)
    await page.getByRole('button', { name: /Confirmar cobro/ }).click()
    await expect(page.getByText(/^No se cobró:/)).toBeVisible()
    expect(huella(orden), 'el primer intento no llegó al servidor: el test no reproduce el caso').toBe('delivered|paid|1|cash|free')
    await page.getByRole('button', { name: /Confirmar cobro/ }).click()
    await expect(page.getByTestId('mesa-aviso-ya-existia')).toContainText('No se cobró dos veces')
    expect(claves).toHaveLength(2)
    expect(claves[1], 'el reintento mandó otra clave').toBe(claves[0])
    expect(huella(orden), 'la mesa se cobró dos veces').toBe('delivered|paid|1|cash|free')
  })

  test('la mesa cambió con el modal abierto (B1): no se cobra y la mesa sigue abierta', async ({ page }) => {
    const { orden, nombre } = await mesaConConsumo(1)
    await hastaConfirmar(page, nombre)
    const t = await cajero.rpc('add_order_items_with_extras', {
      p_order_id: orden, p_lote: randomUUID(), p_items: [{ product_id: P_SIMPLE, qty: 1, unit_price: 5000, extras: [] }],
    })
    expect(t.error, t.error?.message).toBeNull()
    await page.getByRole('button', { name: /Confirmar cobro/ }).click()
    await expect(page.getByText(/^No se cobró:.*no coincide/)).toBeVisible()
    expect(huella(orden)).toBe('pending|paid|0|-|occupied')
  })
})

// ── Quitar ítem ──────────────────────────────────────────────────────────────

test.describe('Mesas: quitar un ítem', () => {
  const stock = () => Number(psql(`select stock_qty from public.products where id = '${P_SIMPLE}';`))

  test('motivo y "¿Se alcanzó a preparar?" obligatorios; No → vuelve al stock; Sí → merma', async ({ page }) => {
    await login(page, ownerCreds())
    const s0 = stock()
    const { orden, nombre } = await mesaConConsumo(2)
    expect(stock()).toBe(s0 - 2)
    await abrirMesa(page, nombre)
    await expect(page.getByTestId('table-item')).toHaveCount(2)

    await page.getByTestId('table-item-quitar').first().click()
    const confirmar = page.getByTestId('quitar-confirmar')
    await expect(confirmar).toBeDisabled()
    await page.getByTestId('quitar-motivo').fill('El cliente lo cambió')
    await expect(confirmar, 'sin elegir si se preparó no se puede quitar').toBeDisabled()
    await page.getByTestId('quitar-preparado-no').click()
    await confirmar.click()
    await expect(page.getByTestId('table-item')).toHaveCount(1)
    expect(stock(), 'no preparado: el stock vuelve').toBe(s0 - 1)

    await page.getByTestId('table-item-quitar').first().click()
    await page.getByTestId('quitar-motivo').fill('Se cayó')
    await page.getByTestId('quitar-preparado-si').click()
    await page.getByTestId('quitar-confirmar').click()
    await expect(page.getByTestId('table-item')).toHaveCount(0)
    expect(stock(), 'merma: el stock NO vuelve').toBe(s0 - 1)

    expect(psql(`select string_agg(preparado || ':' || motivo, ',' order by created_at) from public.order_item_bajas where order_id = '${orden}';`))
      .toBe('false:El cliente lo cambió,true:Se cayó')
    expect(psql(`select total from public.orders where id = '${orden}';`)).toBe('0.00')
  })

  test('sin pos.anular (mozo): la X está deshabilitada y lo dice', async ({ page }) => {
    await login(page, waiterCreds())
    const { nombre } = await mesaConConsumo(1)
    await abrirMesa(page, nombre)
    const x = page.getByTestId('table-item-quitar')
    await expect(x).toBeDisabled()
    await expect(x).toHaveAttribute('title', /exige permiso para anular/)
  })
})

// ── Cerrar sin consumo, eliminar y archivar ──────────────────────────────────

test.describe('Mesas: cerrar sin consumo y eliminar', () => {
  test('cerrar sin consumo: UNA llamada a la RPC, la orden cancelada (fuera de Anuladas) y la mesa libre', async ({ page }) => {
    await login(page, ownerCreds())
    const { mesa, orden, nombre } = mesaVacia()
    const directas = escriturasDirectas(page)
    const llamadas = llamadasRpc(page, 'cerrar_mesa_sin_consumo')
    page.on('dialog', (d) => d.accept())
    await abrirMesa(page, nombre)
    await page.getByRole('button', { name: 'Cerrar mesa' }).click()
    await expect(page.getByRole('button', { name: 'Cerrar mesa' })).toHaveCount(0)
    expect(psql(`select o.status || '|' || (o.cancelled_at is null) || '|' || t.status
                   from public.orders o join public.tables t on t.id = o.table_id where o.id = '${orden}';`)).toBe('cancelled|true|free')
    expect(llamadas).toHaveLength(1)
    expect(directas).toEqual([])
    expect(mesa).toBeTruthy()
  })

  test('eliminar: sin ventas se borra; con ventas se archiva y sale del mapa', async ({ page }) => {
    await login(page, ownerCreds())
    const limpia = mesaVacia(false)
    const vendida = mesaVacia(true)
    // La mesa "vendida" ya tuvo una orden (cerrada): no se puede borrar, se archiva.
    expect((await owner.rpc('cerrar_mesa_sin_consumo', { p_order_id: vendida.orden })).error).toBeNull()
    page.on('dialog', (d) => d.accept())
    await page.goto('/mesas')
    await page.getByRole('button', { name: 'Configurar' }).click()
    const fila = (nombre: string) => page.locator('div')
      .filter({ has: page.getByText(nombre, { exact: true }) })
      .filter({ has: page.getByTitle('Eliminar mesa') })
      .last()
    await fila(limpia.nombre).getByTitle('Eliminar mesa').click()
    await expect(page.getByText(`Mesa ${limpia.nombre} eliminada`)).toBeVisible()
    expect(psql(`select count(*) from public.tables where id = '${limpia.mesa}';`)).toBe('0')

    await page.getByRole('button', { name: 'Configurar' }).click()
    await fila(vendida.nombre).getByTitle('Eliminar mesa').click()
    await expect(page.getByText(`Mesa ${vendida.nombre} archivada`)).toBeVisible()
    expect(psql(`select (archived_at is not null) from public.tables where id = '${vendida.mesa}';`)).toBe('true')
    await expect(page.getByRole('button', { name: new RegExp(vendida.nombre) }), 'la mesa archivada sigue en el mapa').toHaveCount(0)
  })

  test('sin config.acceder (mozo, con mesas.gestionar): ve "Configurar" pero no "Eliminar mesa"', async ({ page }) => {
    await login(page, waiterCreds())
    mesaVacia(false)
    await page.goto('/mesas')
    await page.getByRole('button', { name: 'Configurar' }).click()
    await expect(page.getByText('Configuración de mesas')).toBeVisible()
    await expect(page.getByTitle('Editar mesa').first()).toBeVisible()
    await expect(page.getByTitle('Eliminar mesa')).toHaveCount(0)
  })
})

// ── Historial e Inventario ───────────────────────────────────────────────────

test('Historial: "Ítems quitados de mesas" con quién, el motivo y el destino; Inventario: "Merma"', async ({ page }) => {
  const { orden } = await mesaConConsumo(2)
  const items = psql(`select id from public.order_items where order_id = '${orden}';`).split('\n')
  const motivo = `E2E motivo ${Date.now().toString(36)}`
  expect((await cajero.rpc('quitar_item_mesa', { p_item_id: items[0], p_baja_id: randomUUID(), p_motivo: motivo, p_preparado: true })).error).toBeNull()
  expect((await cajero.rpc('quitar_item_mesa', { p_item_id: items[1], p_baja_id: randomUUID(), p_motivo: `${motivo} B`, p_preparado: false })).error).toBeNull()

  await login(page, ownerCreds())
  await page.goto('/historial')
  await page.getByTestId('items-quitados-toggle').click()
  const merma = page.getByTestId('item-quitado-row').filter({ hasText: new RegExp(`${motivo}$`) })
  await expect(merma).toContainText(NOMBRE_CAJERO)
  await expect(merma.getByTestId('item-quitado-destino')).toHaveText('Merma')
  await expect(page.getByTestId('item-quitado-row').filter({ hasText: `${motivo} B` }).getByTestId('item-quitado-destino'))
    .toHaveText('Volvió al stock')

  await page.goto('/inventario')
  await page.getByTestId('inventory-tab-movements').click()
  await page.getByRole('button', { name: 'Mermas' }).click()
  await expect(page.getByTestId('stock-movement-row').first()).toContainText('Merma')
  await expect(page.getByTestId('stock-movement-row').first().getByTestId('stock-movement-qty')).toHaveText(/^−\d+$/)
})
