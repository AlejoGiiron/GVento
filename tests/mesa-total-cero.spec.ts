import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ownerCreds, cashierCreds, login } from './helpers/auth'
import { cliente, psql } from './helpers/db-local'

// ============================================================================
// hotfix/mesa-total-cero — el cobro, "Cerrar mesa" y la tanda de Mesas releen la
// orden ANTES de escribir (src/lib/mesaFresca.ts). La pantalla trabaja sobre una
// copia: si OTRO equipo agregó una tanda o cerró la mesa mientras tanto, escribir con
// esa copia dejaba consumo sin cobrar. Cada test arma ese "otro equipo" por la API
// (el cajero de LAB) mientras la pantalla (el dueño) tiene la copia vieja, y verifica
// en la BASE que no se escribió nada.
// "Dos equipos": uno agrega una tanda mientras el otro tiene abierto el cobro.
// Base LOCAL de Docker; mesas y órdenes por UUID, borradas al final.
// ============================================================================

const PROD = 'Lab Cerveza'   // lab-seed: simple, sin extras, 8.000
let owner: SupabaseClient
let cajero: SupabaseClient
let OWNER_ID = ''
let SEDE = ''
let P_CERVEZA = ''
const mesas: string[] = []
const ordenes: string[] = []

test.beforeAll(async () => {
  const o = await cliente(ownerCreds())
  const c = await cliente(cashierCreds())
  expect(c.sede, 'owner y cajero en la misma sede').toBe(o.sede)
  owner = o.c; cajero = c.c; OWNER_ID = o.uid; SEDE = o.sede
  P_CERVEZA = psql(`select id from public.products where restaurant_id = '${SEDE}' and name = '${PROD}';`)
  expect(P_CERVEZA, 'fixture de lab-seed').toBeTruthy()
})

test.afterAll(async () => {
  const lista = (xs: string[]) => xs.map((id) => `'${id}'`).join(',') || 'null'
  psql(`begin;
    delete from public.payments where order_id in (${lista(ordenes)});
    delete from public.orders where id in (${lista(ordenes)});
    delete from public.tables where id in (${lista(mesas)});
    commit;`)
  expect(psql(`select (select count(*) from public.orders where id in (${lista(ordenes)}))
                    + (select count(*) from public.tables where id in (${lista(mesas)}));`), 'residuos del spec').toBe('0')
})

test.beforeEach(async ({ page }) => {
  const abierto = (await owner.from('cash_shifts').select('id').eq('restaurant_id', SEDE).is('closed_at', null).maybeSingle()).data
  if (!abierto) {
    const { error } = await owner.from('cash_shifts').insert({ restaurant_id: SEDE, opened_by: OWNER_ID, opening_amount: 0 })
    if (error) throw error
  }
  await login(page, ownerCreds())
})

/** Mesa ocupada con una orden abierta; `cervezas` líneas por el camino real (tanda). */
async function mesa(cervezas: number): Promise<{ orden: string; nombre: string }> {
  const id = randomUUID()
  const orden = randomUUID()
  const nombre = `E2E MT ${id.slice(0, 6)}`
  psql(`insert into public.tables (id, name, restaurant_id, status) values ('${id}', '${nombre}', '${SEDE}', 'occupied');
        insert into public.orders (id, restaurant_id, type, status, table_id, created_by, total)
        values ('${orden}', '${SEDE}', 'dine_in', 'pending', '${id}', '${OWNER_ID}', 0);`)
  mesas.push(id); ordenes.push(orden)
  for (let i = 0; i < cervezas; i++) await otroEquipoAgrega(orden)
  return { orden, nombre }
}

/** El OTRO equipo (el cajero, por la API) agrega una cerveza a la mesa. */
async function otroEquipoAgrega(orden: string) {
  const r = await cajero.rpc('add_order_items_with_extras', {
    p_order_id: orden, p_lote: randomUUID(), p_items: [{ product_id: P_CERVEZA, qty: 1, unit_price: 8000, extras: [] }],
  })
  expect(r.error, r.error?.message).toBeNull()
}

/** estado | descuento | total | pagos | líneas | mesa */
const huella = (orden: string) => psql(`select o.status || '|' || o.discount_amount || '|' || o.total || '|' ||
    (select count(*) from public.payments where order_id = o.id) || '|' ||
    (select count(*) from public.order_items where order_id = o.id) || '|' || t.status
  from public.orders o join public.tables t on t.id = o.table_id where o.id = '${orden}';`)

/** La pantalla deja de enterarse de los cambios de otros equipos (Realtime cortado): la copia queda vieja. */
async function sinRealtime(page: Page) {
  await page.routeWebSocket(/\/realtime\/v1\/websocket/, () => { /* nunca conecta al servidor */ })
}

async function abrirPanel(page: Page, nombre: string) {
  await page.goto('/mesas')
  await page.getByRole('button', { name: new RegExp(nombre) }).click()
}

test.describe('Cobro de mesa: relee la orden antes de escribir', () => {
  test('DOS EQUIPOS — cortesía del 100 % con el cobro abierto, y otro agrega una tanda: NO cierra en $0', async ({ page }) => {
    const { orden, nombre } = await mesa(1)
    await abrirPanel(page, nombre)
    await page.getByRole('button', { name: /^Cobrar/ }).click()
    await page.getByTestId('discount-amount').fill('8000')
    await expect(page.getByTestId('checkout-total')).toHaveText(/\$\s?0$/)
    await otroEquipoAgrega(orden)                               // el otro equipo, con el cobro abierto
    await page.getByTestId('pay-method-efectivo').click()
    await page.getByTestId('checkout-continue').click()        // total 0 → cierra directo
    await expect.soft(page.getByText(/La mesa cambió desde que abriste el cobro: ahora suma \$\s?16\.000/)).toBeVisible()
    expect(huella(orden), 'la mesa se cerró en $0 con una tanda sin cobrar').toBe('pending|0.00|16000.00|0|2|occupied')
  })

  test('DOS EQUIPOS — descuento parcial y efectivo, y otro agrega una tanda antes de confirmar: NO cobra de menos', async ({ page }) => {
    const { orden, nombre } = await mesa(1)
    await abrirPanel(page, nombre)
    await page.getByRole('button', { name: /^Cobrar/ }).click()
    await page.getByTestId('discount-amount').fill('1000')
    await page.getByTestId('pay-method-efectivo').click()
    await page.getByTestId('checkout-continue').click()
    await page.getByTestId('checkout-received').fill('50000')
    await otroEquipoAgrega(orden)
    await page.getByRole('button', { name: /Confirmar cobro/ }).click()
    await expect.soft(page.getByText(/La mesa cambió desde que abriste el cobro/)).toBeVisible()
    // Sin la guarda: el descuento pisaba el total con 7.000 y el pago cuadraba contra eso.
    expect(huella(orden), 'se cobró la mesa por menos de lo consumido').toBe('pending|0.00|16000.00|0|2|occupied')
  })

  test('total guardado en 0 con líneas (la forma de la 2b): NO cierra en $0 y pide cobrar', async ({ page }) => {
    const { orden, nombre } = await mesa(1)
    psql(`update public.orders set total = 0 where id = '${orden}';`)   // el total que dejaba el cliente viejo
    await abrirPanel(page, nombre)
    await page.getByRole('button', { name: /^Cobrar/ }).click()
    await expect(page.getByTestId('checkout-total')).toHaveText(/\$\s?0$/)
    await page.getByTestId('pay-method-efectivo').click()
    await page.getByTestId('checkout-continue').click()
    await expect.soft(page.getByText(/La mesa tiene consumo por \$\s?8\.000 sin cobrar: no se puede cerrar en \$0/)).toBeVisible()
    expect(huella(orden)).toBe('pending|0.00|0.00|0|1|occupied')
  })

  test('contraste: la mesa sin cambios se cobra como siempre', async ({ page }) => {
    const { orden, nombre } = await mesa(1)
    await abrirPanel(page, nombre)
    await page.getByRole('button', { name: /^Cobrar/ }).click()
    await page.getByTestId('pay-method-efectivo').click()
    await page.getByTestId('checkout-continue').click()
    await page.getByTestId('checkout-received').fill('8000')
    await page.getByRole('button', { name: /Confirmar cobro/ }).click()
    await expect(page.getByTestId('success-order-number')).toBeVisible()
    expect(huella(orden)).toBe('delivered|0.00|8000.00|1|1|free')
  })
})

test.describe('"Cerrar mesa" y la tanda: releen el estado', () => {
  test('DOS EQUIPOS — "Cerrar mesa" sobre una mesa vacía a la que otro le acaba de agregar: NO la cancela', async ({ page }) => {
    await sinRealtime(page)
    const { orden, nombre } = await mesa(0)
    page.on('dialog', (d) => d.accept())
    await abrirPanel(page, nombre)
    await expect(page.getByRole('button', { name: 'Cerrar mesa' })).toBeVisible()
    await otroEquipoAgrega(orden)
    await page.getByRole('button', { name: 'Cerrar mesa' }).click()
    await expect.soft(page.getByText(/La mesa ya tiene consumo \(1 ítem\): no se puede cerrar sin cobro/)).toBeVisible()
    expect(huella(orden), 'se canceló una mesa con consumo').toBe('pending|0.00|8000.00|0|1|occupied')
  })

  test('contraste: "Cerrar mesa" sobre una mesa vacía de verdad la cierra', async ({ page }) => {
    const { orden, nombre } = await mesa(0)
    page.on('dialog', (d) => d.accept())
    await abrirPanel(page, nombre)
    await page.getByRole('button', { name: 'Cerrar mesa' }).click()
    await expect(page.getByRole('button', { name: 'Cerrar mesa' })).toHaveCount(0)
    expect(huella(orden)).toBe('cancelled|0.00|0.00|0|0|free')
  })

  test('DOS EQUIPOS — el selector abierto y otro cobra la mesa: la tanda NO entra a la orden cobrada', async ({ page }) => {
    await sinRealtime(page)
    const { orden, nombre } = await mesa(1)
    await abrirPanel(page, nombre)
    await page.getByRole('button', { name: 'Agregar ítems' }).click()
    await page.getByRole('button').filter({ has: page.getByText(PROD, { exact: true }) }).first().click()
    // El otro equipo cierra la mesa (cobrada) mientras este tiene el selector abierto.
    psql(`update public.orders set status = 'delivered' where id = '${orden}';
          update public.tables t set status = 'free' from public.orders o where o.id = '${orden}' and t.id = o.table_id;`)
    await page.getByRole('button', { name: 'Agregar a la mesa' }).click()
    await expect.soft(page.getByText(/La mesa ya se cobró o se cerró: no se agregó nada/)).toBeVisible()
    expect(huella(orden), 'la tanda entró a una orden ya cobrada').toBe('delivered|0.00|8000.00|0|1|free')
  })
})
