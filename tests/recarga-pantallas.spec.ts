import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ownerCreds, login } from './helpers/auth'
import { cliente, psql } from './helpers/db-local'

// ============================================================================
// feat/cocina-refresco — Cocina, Mesas y Delivery se recargan solas (cada 30 s en
// Cocina, 45 s en Mesas y Delivery, y al volver a la pestaña), porque Realtime no
// entrega nada: la publicación supabase_realtime está vacía en producción y aquí
// (cada test lo verifica, para no pasar por la razón equivocada).
// "Otro equipo" = filas escritas por SQL mientras la pantalla está abierta; nadie
// toca la pantalla. Mesas y órdenes por UUID, borradas al final.
// ============================================================================

let owner: SupabaseClient
let OWNER_ID = ''
let SEDE = ''
let P_CERVEZA = ''
const mesas: string[] = []
const ordenes: string[] = []

test.beforeAll(async () => {
  const o = await cliente(ownerCreds())
  owner = o.c; OWNER_ID = o.uid; SEDE = o.sede
  P_CERVEZA = psql(`select id from public.products where restaurant_id = '${SEDE}' and name = 'Lab Cerveza';`)
  expect(P_CERVEZA, 'fixture de lab-seed').toBeTruthy()
})

test.beforeEach(() => {
  expect(psql(`select count(*) from pg_publication_tables where pubname = 'supabase_realtime';`),
    'Realtime publica tablas: este spec probaría Realtime, no la recarga').toBe('0')
})

test.afterAll(() => {
  const lista = (xs: string[]) => xs.map((id) => `'${id}'`).join(',') || 'null'
  psql(`begin;
    delete from public.orders where id in (${lista(ordenes)});
    delete from public.tables where id in (${lista(mesas)});
    commit;`)
  expect(psql(`select (select count(*) from public.orders where id in (${lista(ordenes)}))
                    + (select count(*) from public.tables where id in (${lista(mesas)}));`), 'residuos del spec').toBe('0')
})

/** Otro equipo abre una mesa con una cerveza ya enviada a cocina. */
function mesaConComanda(): { mesa: string; orden: string; nombre: string } {
  const mesa = randomUUID(); const orden = randomUUID()
  const nombre = `E2E RC ${mesa.slice(0, 6)}`
  psql(`insert into public.tables (id, name, restaurant_id, status) values ('${mesa}', '${nombre}', '${SEDE}', 'occupied');
        insert into public.orders (id, restaurant_id, type, status, table_id, created_by, total)
        values ('${orden}', '${SEDE}', 'dine_in', 'pending', '${mesa}', '${OWNER_ID}', 8000);
        insert into public.order_items (order_id, product_id, qty, unit_price, sent_to_kitchen)
        values ('${orden}', '${P_CERVEZA}', 1, 8000, true);`)
  mesas.push(mesa); ordenes.push(orden)
  return { mesa, orden, nombre }
}

/** Otro equipo agrega una cerveza a la orden. */
const otraCerveza = (orden: string) =>
  psql(`insert into public.order_items (order_id, product_id, qty, unit_price) values ('${orden}', '${P_CERVEZA}', 1, 8000);
        update public.orders set total = total + 8000 where id = '${orden}';`)

/** La pestaña se oculta o vuelve (lo que hace el navegador al cambiar de pestaña). */
const pestana = (page: Page, estado: 'hidden' | 'visible') => page.evaluate((e) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => e })
  document.dispatchEvent(new Event('visibilitychange'))
}, estado)

test.describe('Cocina', () => {
  test('una comanda nueva aparece SOLA en ≤ 35 s, y el indicador no dice "En línea"', async ({ page }) => {
    test.setTimeout(90_000)
    await login(page, ownerCreds())
    await page.goto('/cocina')
    await expect(page.getByTestId('kds-actualizacion')).toHaveText(/^Se actualiza cada 30 s · \d{2}:\d{2}:\d{2}$/, { timeout: 15_000 })
    const { nombre } = mesaConComanda()
    await expect(page.getByText(nombre)).toHaveCount(0)            // contraste: todavía no está
    const t0 = Date.now()
    await expect(page.getByText(nombre).first()).toBeVisible({ timeout: 35_000 })
    console.log(`MEDICION comanda nueva en Cocina: ${Date.now() - t0} ms`)
    await expect(page.getByText('En línea')).toHaveCount(0)
  })

  test('al volver a la pestaña recarga en el acto (no espera los 30 s)', async ({ page }) => {
    await login(page, ownerCreds())
    await page.goto('/cocina')
    await expect(page.getByTestId('kds-actualizacion')).toHaveText(/Se actualiza cada 30 s/, { timeout: 15_000 })
    await pestana(page, 'hidden')                                   // oculta: no consulta
    const { nombre } = mesaConComanda()
    await pestana(page, 'visible')
    await expect(page.getByText(nombre).first()).toBeVisible({ timeout: 5_000 })
  })
})

test.describe('Mesas', () => {
  test('sin modal abierto, lo que agrega otro equipo llega solo (≤ 50 s)', async ({ page }) => {
    test.setTimeout(90_000)
    await login(page, ownerCreds())
    const { orden, nombre } = mesaConComanda()
    await page.goto('/mesas')
    await page.getByRole('button', { name: new RegExp(nombre) }).click()
    await expect(page.getByTestId('table-item')).toHaveCount(1)
    otraCerveza(orden)
    await expect(page.getByTestId('table-item')).toHaveCount(2, { timeout: 50_000 })
  })

  test('con el modal de cobro abierto, una recarga de fondo NO lo cierra ni lo cambia', async ({ page }) => {
    test.setTimeout(120_000)
    await login(page, ownerCreds())
    await owner.from('cash_shifts').select('id').limit(1)       // sesión de API viva
    const abierto = psql(`select count(*) from public.cash_shifts where restaurant_id = '${SEDE}' and closed_at is null;`)
    if (abierto === '0') psql(`insert into public.cash_shifts (restaurant_id, opened_by, opening_amount) values ('${SEDE}', '${OWNER_ID}', 0);`)
    const { mesa, orden, nombre } = mesaConComanda()
    await page.goto('/mesas')
    await page.getByRole('button', { name: new RegExp(nombre) }).click()
    await page.getByRole('button', { name: /^Cobrar/ }).click()
    await expect(page.getByTestId('checkout-total')).toHaveText(/8\.000/)
    // Otro equipo agrega una tanda y después cobra la mesa y la libera.
    otraCerveza(orden)
    psql(`update public.orders set status = 'delivered' where id = '${orden}';
          update public.tables set status = 'free' where id = '${mesa}';`)
    await page.waitForTimeout(50_000)                               // más que el intervalo de Mesas
    await expect(page.getByTestId('checkout-total'), 'el modal se cerró o cambió con la recarga de fondo').toHaveText(/8\.000/)
    await expect(page.getByTestId('pay-method-efectivo')).toBeVisible()
    // Contraste: al cerrar el modal, la recarga vuelve y la mesa aparece libre.
    await page.getByRole('button', { name: 'Cancelar' }).click()
    await expect(page.getByRole('button', { name: new RegExp(nombre) })).toContainText('Libre', { timeout: 50_000 })
  })
})

test.describe('Mesas: selector abierto', () => {
  test('con el selector de productos abierto, una recarga de fondo NO lo cierra', async ({ page }) => {
    test.setTimeout(90_000)
    await login(page, ownerCreds())
    const { mesa, orden, nombre } = mesaConComanda()
    await page.goto('/mesas')
    await page.getByRole('button', { name: new RegExp(nombre) }).click()
    await page.getByRole('button', { name: 'Agregar ítems' }).click()
    await page.getByRole('button').filter({ has: page.getByText('Lab Cerveza', { exact: true }) }).first().click()
    await expect(page.getByRole('button', { name: 'Agregar a la mesa' })).toBeVisible()
    // Otro equipo cobra la mesa: la orden deja de estar activa.
    psql(`update public.orders set status = 'delivered' where id = '${orden}';
          update public.tables set status = 'free' where id = '${mesa}';`)
    await page.waitForTimeout(50_000)
    await expect(page.getByRole('button', { name: 'Agregar a la mesa' }), 'la recarga de fondo cerró el selector').toBeVisible()
  })
})

test.describe('Delivery', () => {
  test('un pedido nuevo de otro equipo aparece solo (≤ 50 s)', async ({ page }) => {
    test.setTimeout(90_000)
    await login(page, ownerCreds())
    await page.goto('/delivery')
    await expect(page.getByText('Nuevos').first()).toBeVisible({ timeout: 15_000 })
    const orden = randomUUID()
    const numero = 900000 + Math.floor(Math.random() * 99999)
    psql(`insert into public.orders (id, restaurant_id, type, status, created_by, total, order_number, customer_name)
          values ('${orden}', '${SEDE}', 'delivery', 'pending', '${OWNER_ID}', 8000, ${numero}, 'E2E RC Delivery');
          insert into public.order_items (order_id, product_id, qty, unit_price) values ('${orden}', '${P_CERVEZA}', 1, 8000);`)
    ordenes.push(orden)
    await expect(page.getByText(`Venta #${numero}`)).toBeVisible({ timeout: 50_000 })
  })
})
