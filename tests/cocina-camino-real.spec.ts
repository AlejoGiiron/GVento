import { test, expect, type Page } from '@playwright/test'
import { loginAsOwner, ownerCreds } from './helpers/auth'
import { cliente, psql } from './helpers/db-local'
import { openTableAndAddItems } from './helpers/tables'
import { openShiftIfClosed, closeShiftIfOpen } from './helpers/shift'
import { agregarProductoSimple, PRODUCTO_SIMPLE } from './helpers/pos'
import { mesaFija, liberarMesa } from './helpers/lab'

// ============================================================================
// Cocina por el CAMINO REAL (R10). tests/recarga-pantallas.spec.ts creaba la línea ya
// con sent_to_kitchen = true por SQL: nunca pasó por el botón de Mesas ni por el POS, y
// por eso nadie vio que el POS no envía a cocina (Café Aroma, 2026-10-13).
//
// Lo que custodia:
//   1. Mesas → "Cocina (1)" → la comanda aparece en el KDS SIN recargar (≤ 35 s);
//      el botón dice POR QUÉ no hay nada que enviar, en vez de quedar mudo;
//   2. una venta del POS NO llega a Cocina (comportamiento actual, decidido así
//      hasta que se construya el envío desde register_pos_sale);
//   3. el KDS descarta una sede guardada de OTRA organización, usa la del perfil y
//      lo dice; una sede de la MISMA organización la respeta.
//
// Datos de lab-seed: Sede Lab Norte con cocina; "Lab Cerveza" va a cocina y
// "Lab Agua" no. Realtime no publica nada (igual que producción): lo que aparece
// solo, aparece por la recarga.
// ============================================================================

// Sin el prefijo 'E2E Fija Cocina': cocina.spec busca su mesa por esa regex.
const MESA = 'E2E KDS Camino Real'
const VA = 'Lab Cerveza'
const NO_VA = 'Lab Agua'
let SEDE = ''
let OWNER = ''

test.beforeAll(async () => {
  const o = await cliente(ownerCreds()); SEDE = o.sede; OWNER = o.uid
  expect(psql(`select uses_kitchen from public.restaurants where id = '${SEDE}';`), 'la sede usa cocina (lab-seed)').toBe('t')
  expect(psql(`select string_agg(name || '=' || case when routes_to_kitchen then 'si' else 'no' end, ',' order by name)
                from public.products where restaurant_id = '${SEDE}' and name in ('${VA}', '${NO_VA}');`)).toBe(`${NO_VA}=no,${VA}=si`)
  expect(PRODUCTO_SIMPLE, 'el POS vende el producto que SÍ va a cocina').toBe(VA)
  expect(psql(`select count(*) from pg_publication_tables where pubname = 'supabase_realtime';`),
    'Realtime publica tablas: "aparece solo" no probaría la recarga').toBe('0')
})

test.afterAll(async () => {
  await liberarMesa(MESA)
})

// printComanda() llama window.print(): en headless puede bloquear.
async function sinImprimir(page: Page) {
  await page.addInitScript(() => { window.print = () => {} })
}

async function abrirCocina(kds: Page) {
  await kds.goto('/cocina')
  await expect(kds.getByTestId('kds-actualizacion')).toHaveText(/^Se actualiza cada 30 s/, { timeout: 15_000 })
}

async function agregar(page: Page, producto: string) {
  await page.getByRole('button').filter({ has: page.getByText(producto, { exact: true }) }).first().click()
  await page.getByRole('button', { name: 'Agregar a la mesa' }).click()
  await expect(page.getByRole('button', { name: 'Agregar a la mesa' })).toHaveCount(0)
  await expect(page.getByTestId('table-item').filter({ hasText: producto })).toBeVisible({ timeout: 15_000 })
}

test.describe.serial('Cocina por el camino real', () => {
  test('Mesas → "Cocina (1)" → aparece en el KDS SIN recargar; el botón dice por qué cuando no hay nada', async ({ page, context }) => {
    test.setTimeout(120_000)
    await sinImprimir(page)
    await mesaFija(MESA)
    await loginAsOwner(page)
    const kds = await context.newPage()
    await abrirCocina(kds)
    await expect(kds.getByText(MESA)).toHaveCount(0)

    await page.bringToFront()
    await openTableAndAddItems(page, MESA)
    await agregar(page, NO_VA)

    // Solo un producto que NO va a cocina: deshabilitado y con el motivo a la vista.
    const boton = page.getByTestId('mesa-enviar-cocina')
    await expect(boton).toBeDisabled()
    await expect(boton).toHaveText('Cocina')
    await expect(page.getByTestId('mesa-cocina-motivo')).toHaveText('No hay productos que vayan a cocina')

    await page.getByRole('button', { name: 'Agregar ítems' }).click()
    await agregar(page, VA)
    await expect(boton).toHaveText('Cocina (1)')
    await expect(boton).toBeEnabled()
    await expect(page.getByTestId('mesa-cocina-motivo')).toHaveCount(0)

    await boton.click()
    await expect(page.getByText('Comanda enviada a cocina')).toBeVisible()
    await expect(page.getByTestId('mesa-cocina-motivo')).toHaveText('Lo que va a cocina ya se envió')
    expect(psql(`select string_agg(p.name || '=' || case when i.sent_to_kitchen then 'si' else 'no' end, ',' order by p.name)
       from public.order_items i join public.products p on p.id = i.product_id
       join public.orders o on o.id = i.order_id join public.tables t on t.id = o.table_id
      where t.restaurant_id = '${SEDE}' and t.name = '${MESA}' and o.status in ('pending', 'preparing', 'ready');`))
      .toBe(`${NO_VA}=no,${VA}=si`)

    // El KDS, abierto desde ANTES y sin tocarlo, la muestra sola.
    await kds.bringToFront()
    await expect(kds.getByText(MESA).first()).toBeVisible({ timeout: 35_000 })
  })

  test('una venta del POS NO llega a Cocina (hasta que se decida otra cosa)', async ({ page, context }) => {
    test.setTimeout(90_000)
    await loginAsOwner(page)
    await agregarProductoSimple(page)          // Lab Cerveza: SÍ va a cocina
    await openShiftIfClosed(page, 0)
    await page.getByRole('button', { name: 'Cobrar' }).click()
    await page.getByText('Efectivo', { exact: true }).click()
    await page.getByRole('button', { name: /Continuar/ }).click()
    await page.getByTestId('quick-amount-chip').first().click()
    await page.getByRole('button', { name: /Confirmar cobro/ }).click()
    await expect(page.getByText(/registrada|Cobro exitoso/)).toBeVisible()

    // La venta queda viva (pending) y con su línea SIN enviar: register_pos_sale no la manda.
    expect(psql(`select o.status || '|' || bool_or(i.sent_to_kitchen)
       from public.orders o join public.order_items i on i.order_id = o.id
      where o.restaurant_id = '${SEDE}' and o.created_by = '${OWNER}' and o.type = 'takeaway'
        and o.created_at > now() - interval '2 minutes'
      group by o.id order by max(o.created_at) desc limit 1;`)).toBe('pending|false')   // bool → texto: 'false'

    // El KDS muestra exactamente las "Para llevar" que tienen algo enviado: ninguna nueva.
    const kds = await context.newPage()
    await abrirCocina(kds)
    const esperadas = Number(psql(`select count(*) from public.orders o where o.restaurant_id = '${SEDE}'
        and o.type = 'takeaway' and o.status in ('pending', 'preparing', 'ready')
        and exists (select 1 from public.order_items i where i.order_id = o.id and i.sent_to_kitchen);`))
    await expect(kds.getByText('Para llevar', { exact: true })).toHaveCount(esperadas)
    await kds.close()

    await page.goto('/ventas')
    await closeShiftIfOpen(page)
  })

  test('el KDS descarta una sede guardada de OTRA organización, usa la del perfil y lo dice', async ({ page }) => {
    const otra = psql(`select r.id from public.restaurants r join public.organizations o on o.id = r.organization_id
                        where o.name = 'LAB-OTRA' limit 1;`)
    expect(otra, 'otra-org-local.sql').toBeTruthy()
    await loginAsOwner(page)
    await abrirCocina(page)
    await page.evaluate((id) => { localStorage.setItem('kds_restaurant_id', id); sessionStorage.removeItem('kds_auth') }, otra)
    await page.reload()

    await expect(page.getByTestId('kds-aviso-sede')).toContainText('no es de tu organización')
    expect(await page.evaluate(() => localStorage.getItem('kds_restaurant_id'))).toBe(SEDE)
    await expect(page.getByText(MESA).first()).toBeVisible()      // el tablero es el de su sede
  })

  test('contraste: otra sede de la MISMA organización se respeta, sin aviso', async ({ page }) => {
    const misma = psql(`select r.id from public.restaurants r where r.name = 'Sede Lab Sin Cocina'
                         and r.organization_id = (select organization_id from public.restaurants where id = '${SEDE}');`)
    expect(misma, 'lab-seed').toBeTruthy()
    await loginAsOwner(page)
    await abrirCocina(page)
    await page.evaluate((id) => { localStorage.setItem('kds_restaurant_id', id); sessionStorage.removeItem('kds_auth') }, misma)
    await page.reload()

    await expect(page.getByTestId('kds-actualizacion')).toHaveText(/^Se actualiza cada 30 s/, { timeout: 15_000 })
    await expect(page.getByTestId('kds-aviso-sede')).toHaveCount(0)
    expect(await page.evaluate(() => localStorage.getItem('kds_restaurant_id'))).toBe(misma)
    await expect(page.getByText(MESA)).toHaveCount(0)               // mira la otra sede, a propósito
    await page.evaluate(() => localStorage.removeItem('kds_restaurant_id'))
  })
})
