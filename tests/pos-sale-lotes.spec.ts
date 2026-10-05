import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ownerCreds, cashierCreds, loginAsOwner } from './helpers/auth'
import { openShiftIfClosed } from './helpers/shift'
import { waitPosReady, agregarProductoSimple } from './helpers/pos'
import { openTableAndAddItems } from './helpers/tables'
import { mesaFija, liberarMesa } from './helpers/lab'
import { cliente, psql, sesionRetenida } from './helpers/db-local'
import { abrirProxy, postDesdeElNavegador, type ModoCorte } from './helpers/proxy-reenvio'

// ============================================================================
// supabase/pos-sale-lotes.sql:
//   · register_pos_sale: la venta del POS en UNA transacción, idempotente por
//     p_sale_id, con turno, B1, permisos, pago y número.
//   · add_order_items_with_extras(…, p_lote): clave por tanda y total recalculado
//     desde las líneas, con la orden bloqueada.
// Más los cuatro modos del REENVÍO de Chromium, medidos el 2026-10-01/04
// (tests/helpers/proxy-reenvio.ts): la venta y la tanda tienen que quedar UNA vez.
// Base LOCAL de Docker. Anon key + login (R4): nada de service role.
// ============================================================================

let owner: SupabaseClient
let cajero: SupabaseClient
let OWNER_ID = ''
let SEDE = ''
let P_CERVEZA = ''   // simple, sin control de stock, 8.000
let P_COCTEL = ''    // compuesto: su receta descuenta "Lab Vaso" (con control de stock)
const ANON = () => process.env.VITE_GVENTO_SUPABASE_ANON_KEY!
const URL_API = () => process.env.VITE_GVENTO_SUPABASE_URL!

test.beforeAll(async () => {
  const o = await cliente(ownerCreds())
  const c = await cliente(cashierCreds())
  expect(c.sede, 'owner y cajero en la misma sede').toBe(o.sede)
  owner = o.c; cajero = c.c; OWNER_ID = o.uid; SEDE = o.sede
  P_CERVEZA = psql(`select id from public.products where restaurant_id = '${SEDE}' and name = 'Lab Cerveza';`)
  P_COCTEL = psql(`select id from public.products where restaurant_id = '${SEDE}' and name = 'Lab Coctel';`)
  expect(P_CERVEZA && P_COCTEL, 'fixtures de lab-seed').toBeTruthy()
})

async function turnoAbierto() {
  const abierto = (await owner.from('cash_shifts').select('id').eq('restaurant_id', SEDE).is('closed_at', null).maybeSingle()).data
  if (abierto) return
  const { error } = await owner.from('cash_shifts').insert({ restaurant_id: SEDE, opened_by: OWNER_ID, opening_amount: 0 })
  if (error) throw error
}
async function sinTurno() {
  const abierto = (await owner.from('cash_shifts').select('id').eq('restaurant_id', SEDE).is('closed_at', null).maybeSingle()).data
  if (abierto) {
    const { error } = await owner.rpc('close_cash_shift', { p_shift_id: abierto.id, p_declarado: { cash: 0 } })
    if (error) throw error
  }
}
const contador = () => psql(`select coalesce((select last_order_number from public.store_sequences where restaurant_id = '${SEDE}'), 0);`)

/** Huella de una venta: órdenes | ítems | pagos | Σ pagos | movimientos de stock | número | total | payment_status */
const huella = (id: string) => psql(`select
    (select count(*) from public.orders where id = '${id}') || '|' ||
    (select count(*) from public.order_items where order_id = '${id}') || '|' ||
    (select count(*) from public.payments where order_id = '${id}') || '|' ||
    (select coalesce(sum(amount), 0) from public.payments where order_id = '${id}') || '|' ||
    (select count(*) from public.stock_movements where reference_id = '${id}') || '|' ||
    coalesce((select order_number::text from public.orders where id = '${id}'), '-') || '|' ||
    coalesce((select total::text from public.orders where id = '${id}'), '-') || '|' ||
    coalesce((select payment_status from public.orders where id = '${id}'), '-');`)

const CERVEZA = () => [{ product_id: P_CERVEZA, qty: 1, unit_price: 8000, extras: [] }]
const cuerpoVenta = (id: string, extra: Record<string, unknown> = {}) => ({
  p_sale_id: id,
  p_order: { type: 'takeaway', total: 8000, ...extra },
  p_items: CERVEZA(),
  p_payments: [{ method: 'cash', amount: 8000 }],
})
const vender = (c: SupabaseClient, id: string, extra?: Record<string, unknown>) => c.rpc('register_pos_sale', cuerpoVenta(id, extra))

test.describe('register_pos_sale', () => {
  test('contado: orden, ítem, pago y número en UNA llamada', async () => {
    await turnoAbierto()
    const antes = Number(contador())
    const id = randomUUID()
    const r = await vender(cajero, id)
    expect(r.error, r.error?.message).toBeNull()
    expect(r.data).toMatchObject({ order_id: id, ya_existia: false, order_number: antes + 1 })
    expect(huella(id)).toBe(`1|1|1|8000.00|0|${antes + 1}|8000.00|paid`)
  })

  test('un compuesto descuenta su receta (el mismo camino de stock de siempre)', async () => {
    await turnoAbierto()
    const id = randomUUID()
    const r = await cajero.rpc('register_pos_sale', {
      p_sale_id: id, p_order: { type: 'takeaway', total: 18000 },
      p_items: [{ product_id: P_COCTEL, qty: 1, unit_price: 18000, extras: [] }],
      p_payments: [{ method: 'card', amount: 18000 }],
    })
    expect(r.error, r.error?.message).toBeNull()
    expect(Number(psql(`select count(*) from public.stock_movements where reference_id = '${id}';`))).toBeGreaterThan(0)
  })

  test('la MISMA venta dos veces: la segunda devuelve la hecha, con éxito, y no escribe nada', async () => {
    await turnoAbierto()
    const id = randomUUID()
    const r1 = await vender(cajero, id)
    expect(r1.error, r1.error?.message).toBeNull()
    const despues1 = contador()
    const h1 = huella(id)
    const r2 = await vender(cajero, id)
    expect(r2.error, r2.error?.message).toBeNull()
    expect(r2.data).toMatchObject({ order_id: id, ya_existia: true, order_number: (r1.data as { order_number: number }).order_number })
    expect(huella(id)).toBe(h1)
    expect(contador(), 'la segunda llamada quemó un número').toBe(despues1)
  })

  test('dos llamadas SIMULTÁNEAS con el mismo id: la segunda espera y devuelve la venta hecha', async () => {
    await turnoAbierto()
    const id = randomUUID()
    const antes = Number(contador())
    const cuerpo = cuerpoVenta(id)
    const { fin } = await sesionRetenida(OWNER_ID,
      `select public.register_pos_sale('${id}', '${JSON.stringify(cuerpo.p_order)}'::jsonb, '${JSON.stringify(cuerpo.p_items)}'::jsonb, '${JSON.stringify(cuerpo.p_payments)}'::jsonb)`, 3)
    const t0 = Date.now()
    const r = await vender(cajero, id)
    const espero = Date.now() - t0
    await fin
    expect(r.error, r.error?.message).toBeNull()
    expect(espero, 'la segunda no esperó a la primera').toBeGreaterThan(1000)
    expect((r.data as { ya_existia: boolean }).ya_existia).toBe(true)
    expect(huella(id)).toBe(`1|1|1|8000.00|0|${antes + 1}|8000.00|paid`)
    expect(Number(contador())).toBe(antes + 1)
  })

  test('el reenvío llega DESPUÉS de un cierre de turno: igual ve su venta, no un error', async () => {
    await turnoAbierto()
    const id = randomUUID()
    expect((await vender(cajero, id)).error).toBeNull()
    await sinTurno()
    const r = await vender(cajero, id)
    expect(r.error, 'el reenvío de una venta hecha falló por el turno').toBeNull()
    expect((r.data as { ya_existia: boolean }).ya_existia).toBe(true)
  })

  test('sin turno: se rechaza y NO queda rastro (ni orden, ni ítems, ni stock, ni número)', async () => {
    await sinTurno()
    const antes = contador()
    const id = randomUUID()
    const r = await cajero.rpc('register_pos_sale', {
      p_sale_id: id, p_order: { type: 'takeaway', total: 18000 },
      p_items: [{ product_id: P_COCTEL, qty: 1, unit_price: 18000, extras: [] }],
      p_payments: [{ method: 'cash', amount: 18000 }],
    })
    expect(r.error?.message ?? '').toMatch(/No hay un turno de caja abierto/)
    expect(huella(id)).toBe('0|0|0|0|0|-|-|-')
    expect(contador(), 'se quemó un número').toBe(antes)
  })

  // Contado sin turno lo frena TAMBIÉN register_sale_payment (adentro), así que el
  // test de arriba no prueba el chequeo propio de register_pos_sale: el mutante sin
  // ese chequeo sobrevivía (2026-10-04). Fiado y venta gratis NO pasan por el pago:
  // ahí el único freno es el de la RPC (A del diseño).
  test('sin turno, FIADO y venta GRATIS también se rechazan (no pasan por el pago)', async () => {
    await sinTurno()
    const antes = contador()
    const cli = (await owner.from('customers').insert({ restaurant_id: SEDE, name: `E2E Fiado SinTurno ${Date.now()}` }).select('id').single()).data!.id
    const fiado = randomUUID()
    const r1 = await cajero.rpc('register_pos_sale', {
      p_sale_id: fiado, p_order: { type: 'takeaway', total: 8000, fiado: true, customer_id: cli },
      p_items: CERVEZA(), p_payments: [],
    })
    expect(r1.error?.message ?? '', 'fiado sin turno').toMatch(/No hay un turno de caja abierto/)
    const gratis = randomUUID()
    const r2 = await cajero.rpc('register_pos_sale', {
      p_sale_id: gratis, p_order: { type: 'takeaway', total: 0, discount_amount: 8000, discount_type: 'fixed', discount_kind: 'vale' },
      p_items: CERVEZA(), p_payments: [],
    })
    expect(r2.error?.message ?? '', 'venta gratis sin turno').toMatch(/No hay un turno de caja abierto/)
    expect(huella(fiado)).toBe('0|0|0|0|0|-|-|-')
    expect(huella(gratis)).toBe('0|0|0|0|0|-|-|-')
    expect(contador()).toBe(antes)
  })

  test('B1: total del carrito distinto del de las líneas → se rechaza diciendo qué no coincide, sin rastro', async () => {
    await turnoAbierto()
    const antes = contador()
    const id = randomUUID()
    const r = await cajero.rpc('register_pos_sale', { ...cuerpoVenta(id, { total: 7000 }), p_payments: [{ method: 'cash', amount: 7000 }] })
    expect(r.error?.message ?? '').toMatch(/total del carrito \(7000\) no coincide con el de las líneas \(8000/)
    expect(huella(id)).toBe('0|0|0|0|0|-|-|-')
    expect(contador()).toBe(antes)
  })

  test('descuento sin pos.descuento → se rechaza; con el permiso, pasa (contraste)', async () => {
    await turnoAbierto()
    const rol = psql(`select r.id from public.profiles p join public.roles r on r.id = p.role_id
                       where p.id = (select id from auth.users where email = '${cashierCreds().email}');`)
    const original = psql(`select permissions::text from public.roles where id = '${rol}';`)
    const conDescuento = (id: string) => cajero.rpc('register_pos_sale', {
      ...cuerpoVenta(id, { total: 7000, discount_amount: 1000, discount_type: 'fixed', discount_kind: 'normal' }),
      p_payments: [{ method: 'cash', amount: 7000 }],
    })
    try {
      psql(`update public.roles set permissions = permissions - 'pos.descuento' where id = '${rol}';`)
      const sin = randomUUID()
      const r = await conDescuento(sin)
      expect(r.error?.message ?? '').toMatch(/permiso para aplicar descuentos/)
      expect(huella(sin)).toBe('0|0|0|0|0|-|-|-')
    } finally {
      psql(`update public.roles set permissions = '${original}'::jsonb where id = '${rol}';`)
    }
    expect(psql(`select permissions::text from public.roles where id = '${rol}';`), 'el permiso quedó restaurado').toBe(original)
    const con = randomUUID()
    const r2 = await conDescuento(con)
    expect(r2.error, r2.error?.message).toBeNull()
    expect(huella(con).split('|').slice(0, 4).join('|')).toBe('1|1|1|7000.00')
  })

  test('fiado: sin pago, payment_status pending, con número', async () => {
    await turnoAbierto()
    const cli = (await owner.from('customers').insert({ restaurant_id: SEDE, name: `E2E Fiado POS ${Date.now()}` }).select('id').single()).data!.id
    const id = randomUUID()
    const r = await cajero.rpc('register_pos_sale', {
      p_sale_id: id, p_order: { type: 'takeaway', total: 8000, fiado: true, customer_id: cli, customer_name: 'E2E' },
      p_items: CERVEZA(), p_payments: [],
    })
    expect(r.error, r.error?.message).toBeNull()
    const [ordenes, , pagos, , , numero, , estado] = huella(id).split('|')
    expect([ordenes, pagos, estado]).toEqual(['1', '0', 'pending'])
    expect(numero).not.toBe('-')
  })

  test('venta gratis (vale del 100%): total 0, sin pago, con número', async () => {
    await turnoAbierto()
    const id = randomUUID()
    const r = await cajero.rpc('register_pos_sale', {
      p_sale_id: id, p_order: { type: 'takeaway', total: 0, discount_amount: 8000, discount_type: 'fixed', discount_kind: 'vale' },
      p_items: CERVEZA(), p_payments: [],
    })
    expect(r.error, r.error?.message).toBeNull()
    const [ordenes, items, pagos, , , numero, total] = huella(id).split('|')
    expect([ordenes, items, pagos, total]).toEqual(['1', '1', '0', '0.00'])
    expect(numero).not.toBe('-')
  })

  test('tipo mesa (dine_in) no es una venta de POS → se rechaza', async () => {
    await turnoAbierto()
    const r = await vender(cajero, randomUUID(), { type: 'dine_in' })
    expect(r.error?.message ?? '').toMatch(/Tipo de venta inválido/)
  })
})

// ── Tandas ──────────────────────────────────────────────────────────────────
async function ordenVacia(descuento = 0): Promise<string> {
  const { data, error } = await owner.from('orders').insert({
    restaurant_id: SEDE, type: 'takeaway', status: 'pending', created_by: OWNER_ID, total: 0,
    discount_amount: descuento, discount_type: descuento > 0 ? 'fixed' : null,
  }).select('id').single()
  if (error) throw error
  return data!.id as string
}
const tanda = (orden: string, lote: string | null, qty = 1) =>
  cajero.rpc('add_order_items_with_extras', {
    p_order_id: orden, p_items: [{ product_id: P_CERVEZA, qty, unit_price: 8000, extras: [] }],
    ...(lote ? { p_lote: lote } : {}),
  })
const lineas = (orden: string) => psql(`select count(*) || '|' || (select total from public.orders where id = '${orden}') from public.order_items where order_id = '${orden}';`)

test.describe('add_order_items_with_extras: tanda y total', () => {
  test('la MISMA tanda dos veces: la segunda no hace nada y devuelve éxito', async () => {
    const orden = await ordenVacia()
    const lote = randomUUID()
    expect((await tanda(orden, lote)).error).toBeNull()
    const r = await tanda(orden, lote)
    expect(r.error, r.error?.message).toBeNull()
    expect(lineas(orden)).toBe('1|8000.00')
  })

  test('una tanda de OTRA orden → error', async () => {
    const [a, b] = [await ordenVacia(), await ordenVacia()]
    const lote = randomUUID()
    expect((await tanda(a, lote)).error).toBeNull()
    const r = await tanda(b, lote)
    expect(r.error?.message ?? '').toMatch(/es de otra orden/)
    expect(lineas(b)).toBe('0|0.00')
  })

  test('la llamada VIEJA de 2 argumentos (el frontend actual) sigue funcionando y el total sale de las líneas', async () => {
    const orden = await ordenVacia()
    expect((await tanda(orden, null, 2)).error).toBeNull()
    expect(lineas(orden)).toBe('1|16000.00')
  })

  test('el total respeta el descuento ya aplicado a la orden', async () => {
    const orden = await ordenVacia(1000)
    expect((await tanda(orden, randomUUID())).error).toBeNull()
    expect(lineas(orden)).toBe('1|7000.00')
  })

  test('dos tandas SIMULTÁNEAS a la misma orden: la segunda espera y el total suma las dos (H1)', async () => {
    const orden = await ordenVacia()
    const { fin } = await sesionRetenida(OWNER_ID,
      `select public.add_order_items_with_extras('${orden}', '[{"product_id":"${P_CERVEZA}","qty":1,"unit_price":8000,"extras":[]}]'::jsonb, '${randomUUID()}')`, 3)
    const t0 = Date.now()
    const r = await tanda(orden, randomUUID(), 2)
    const espero = Date.now() - t0
    await fin
    expect(r.error, r.error?.message).toBeNull()
    expect(espero, 'la segunda tanda no esperó (la orden no se bloqueó)').toBeGreaterThan(1000)
    expect(lineas(orden), 'el total perdió una de las tandas').toBe('2|24000.00')
  })
})

// ── Los cuatro modos del reenvío de Chromium ────────────────────────────────
const MODOS: ModoCorte[] = ['rst', 'fin', 'colgada', 'nueva']

test.describe('reenvío del navegador', () => {
  for (const modo of MODOS) {
    test(`venta (${modo}): queda UNA venta, con un pago y un número`, async ({ page }) => {
      test.setTimeout(90_000)
      await turnoAbierto()
      const { c } = await cliente(cashierCreds())
      const token = (await c.auth.getSession()).data.session!.access_token
      const antes = Number(contador())
      const id = randomUUID()
      const proxy = await abrirProxy(URL_API(), 'rpc/register_pos_sale', modo, 19)
      try {
        const visto = await postDesdeElNavegador(page, proxy, modo, ANON(), token, 'register_pos_sale', cuerpoVenta(id))
        if (modo === 'nueva') {
          expect(visto, 'en conexión nueva el navegador no reenvía: el código ve el error').toMatch(/^ERROR/)
          expect(proxy.postsQueLlegaron()).toBe(1)
          // El cajero reintenta, con el MISMO id de venta (lo conserva useSaleCheckout).
          const r = await vender(c, id)
          expect(r.error, r.error?.message).toBeNull()
          expect((r.data as { ya_existia: boolean }).ya_existia).toBe(true)
        } else {
          expect(visto, 'el código tiene que ver éxito').toBe('HTTP 200')
          expect(proxy.postsQueLlegaron(), 'el navegador no reenvió: el test no reproduce el caso').toBe(2)
        }
      } finally {
        await proxy.cerrar()
      }
      expect(huella(id), 'la venta quedó duplicada o incompleta').toBe(`1|1|1|8000.00|0|${antes + 1}|8000.00|paid`)
      expect(Number(contador())).toBe(antes + 1)
    })
  }

  for (const modo of MODOS) {
    test(`tanda de mesa (${modo}): queda UNA tanda y el total de una`, async ({ page }) => {
      test.setTimeout(90_000)
      const { c } = await cliente(cashierCreds())
      const token = (await c.auth.getSession()).data.session!.access_token
      const orden = await ordenVacia()
      const lote = randomUUID()
      const cuerpo = { p_order_id: orden, p_items: [{ product_id: P_CERVEZA, qty: 1, unit_price: 8000, extras: [] }], p_lote: lote }
      const proxy = await abrirProxy(URL_API(), 'rpc/add_order_items_with_extras', modo, 19)
      try {
        const visto = await postDesdeElNavegador(page, proxy, modo, ANON(), token, 'add_order_items_with_extras', cuerpo)
        if (modo === 'nueva') {
          expect(visto).toMatch(/^ERROR/)
          const r = await c.rpc('add_order_items_with_extras', cuerpo)   // el mozo reintenta con el MISMO lote
          expect(r.error, r.error?.message).toBeNull()
        } else {
          expect(visto).toBe('HTTP 204')
          expect(proxy.postsQueLlegaron(), 'el navegador no reenvió: el test no reproduce el caso').toBe(2)
        }
      } finally {
        await proxy.cerrar()
      }
      expect(lineas(orden), 'la tanda quedó duplicada').toBe('1|8000.00')
    })
  }
})

// ── Frontend: el reintento del cajero/mozo lleva la MISMA clave ─────────────
// El caso 'nueva' de punta a punta: el servidor procesa, el navegador ve un
// error (route.fetch + abort), y el reintento desde la UI tiene que mandar el
// mismo id de venta / de tanda. Sin eso, la clave del servidor no sirve de nada.
test.describe('frontend: el reintento lleva la MISMA clave', () => {
  test('POS escritorio: A pierde la respuesta y cierra sesión; B entra en la MISMA pestaña (sin recargar) con el mismo carrito → B hace SU venta', async ({ page }) => {
    // En el escritorio, cerrar sesión y volver a entrar NO recarga la página: el id
    // de venta pendiente de A sigue en memoria. Sin el usuario en la huella de
    // useSaleCheckout, B lo reenviaría y recibiría la venta de A (ya_existia). En /m
    // esto ya no pasa (entrar a /m recarga la página), así que la prueba que
    // distingue ese mutante vive acá.
    await turnoAbierto()
    const ids: string[] = []
    let primera = true
    await page.route('**/rest/v1/rpc/register_pos_sale', async (route) => {
      ids.push((route.request().postDataJSON() as { p_sale_id: string }).p_sale_id)
      if (primera) { primera = false; await route.fetch(); await route.abort('connectionreset'); return }
      await route.continue()
    })
    const cobrar = async () => {
      await agregarProductoSimple(page)
      await page.getByRole('button', { name: 'Cobrar' }).click()
      await page.getByText('Efectivo', { exact: true }).click()
      await page.getByRole('button', { name: /Continuar/ }).click()
      await page.getByTestId('checkout-received').fill('20000')
      await page.getByRole('button', { name: /Confirmar cobro/ }).click()
    }
    const entrarSinRecargar = async (email: string, password: string) => {
      await page.locator('input[autocomplete="email"]').fill(email)
      await page.locator('input[autocomplete="current-password"]').fill(password)
      await page.getByRole('button', { name: 'Ingresar' }).click()
      await expect(page).toHaveURL(/\/ventas$/, { timeout: 15_000 })
      await waitPosReady(page)
    }

    await page.goto('/login')
    await entrarSinRecargar(cashierCreds().email, cashierCreds().password)
    await cobrar()
    await expect(page.getByText(/Error al procesar el cobro/)).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Cerrar sesión' }).click()
    await expect(page).toHaveURL(/\/login$/)

    await entrarSinRecargar(ownerCreds().email, ownerCreds().password)
    await cobrar()
    await expect(page.getByText(/¡Venta #\d+ registrada!/)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('success-ya-existia')).toHaveCount(0)
    expect(ids).toHaveLength(2)
    expect(ids[1], 'B reenvió el id pendiente de A').not.toBe(ids[0])
    expect(psql(`select created_by from public.orders where id = '${ids[0]}';`)).toBe(psql(`select id from auth.users where email = '${cashierCreds().email}';`))
    expect(psql(`select created_by from public.orders where id = '${ids[1]}';`)).toBe(OWNER_ID)
    await page.getByRole('button', { name: 'Nueva venta' }).click()
  })

  test('POS: se pierde la respuesta, el cajero reintenta → UNA venta y el aviso; la venta siguiente lleva otro id', async ({ page }) => {
    const ids: string[] = []
    let primera = true
    await page.route('**/rest/v1/rpc/register_pos_sale', async (route) => {
      ids.push((route.request().postDataJSON() as { p_sale_id: string }).p_sale_id)
      if (primera) { primera = false; await route.fetch(); await route.abort('connectionreset'); return }
      await route.continue()
    })
    await loginAsOwner(page)
    await page.goto('/ventas')
    await openShiftIfClosed(page, 0)
    await waitPosReady(page)

    const cobrarDesdeLaUI = async () => {
      await agregarProductoSimple(page)
      await page.getByRole('button', { name: 'Cobrar' }).click()
      await page.getByText('Efectivo', { exact: true }).click()
      await page.getByRole('button', { name: /Continuar/ }).click()
      await page.getByTestId('checkout-received').fill('20000')
      await page.getByRole('button', { name: /Confirmar cobro/ }).click()
    }
    await cobrarDesdeLaUI()
    await expect(page.getByText(/Error al procesar el cobro/)).toBeVisible({ timeout: 15_000 })
    expect(huella(ids[0]).startsWith('1|1|1|8000.00|'), 'el primer intento no llegó a la base: el test no reproduce el caso').toBe(true)

    await page.getByRole('button', { name: /Confirmar cobro/ }).click()
    await expect(page.getByTestId('success-ya-existia')).toBeVisible({ timeout: 15_000 })
    expect(ids).toHaveLength(2)
    expect(ids[1], 'el reintento mandó OTRO id: habría sido una segunda venta').toBe(ids[0])
    expect(huella(ids[0]).split('|').slice(0, 4).join('|')).toBe('1|1|1|8000.00')

    // Contraste: la venta siguiente, aunque sea IGUAL, es otra venta (otro id, sin aviso).
    await page.getByRole('button', { name: 'Nueva venta' }).click()
    await cobrarDesdeLaUI()
    await expect(page.getByText(/¡Venta #\d+ registrada!/)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('success-ya-existia')).toHaveCount(0)
    expect(ids).toHaveLength(3)
    expect(ids[2]).not.toBe(ids[0])
    await page.getByRole('button', { name: 'Nueva venta' }).click()
  })

  test('Mesas: se pierde la respuesta, el mozo reintenta → UNA tanda y el total de una', async ({ page }) => {
    const MESA = 'E2E Fija Tandas'
    const cuerpos: { p_order_id: string; p_lote: string }[] = []
    let primera = true
    await page.route('**/rest/v1/rpc/add_order_items_with_extras', async (route) => {
      cuerpos.push(route.request().postDataJSON() as { p_order_id: string; p_lote: string })
      if (primera) { primera = false; await route.fetch(); await route.abort('connectionreset'); return }
      await route.continue()
    })
    try {
      await loginAsOwner(page)
      await mesaFija(MESA)
      await openTableAndAddItems(page, MESA)
      await page.getByRole('button').filter({ has: page.getByText('Lab Cerveza', { exact: true }) }).first().click()
      await page.getByRole('button', { name: 'Agregar a la mesa' }).click()
      await expect(page.getByText(/Error al agregar ítems/)).toBeVisible({ timeout: 15_000 })
      const orden = cuerpos[0].p_order_id
      expect(lineas(orden), 'el primer intento no llegó a la base: el test no reproduce el caso').toBe('1|8000.00')

      await page.getByRole('button', { name: 'Agregar a la mesa' }).click()
      await expect(page.getByRole('button', { name: 'Agregar a la mesa' })).toHaveCount(0, { timeout: 15_000 })
      expect(cuerpos).toHaveLength(2)
      expect(cuerpos[0].p_lote, 'la tanda salió sin clave').toMatch(/^[0-9a-f-]{36}$/)
      expect(cuerpos[1].p_lote, 'el reintento mandó OTRA tanda: se habría duplicado').toBe(cuerpos[0].p_lote)
      expect(lineas(orden), 'la tanda quedó duplicada o el total no es el de las líneas').toBe('1|8000.00')
      await expect(page.getByTestId('table-item')).toHaveCount(1)
    } finally {
      await liberarMesa(MESA)
    }
  })
})
