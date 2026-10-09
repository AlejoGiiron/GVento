import { test, expect, type Page } from '@playwright/test'
import { loginAsOwner, ownerCreds } from './helpers/auth'
import { psql } from './helpers/db-local'
import { waitPosReady } from './helpers/pos'
import { openShiftIfClosed } from './helpers/shift'

// El tipo de venta del POS debe volver al default ("Para llevar") tras CUALQUIER
// venta. Antes quedaba pegado: `orderType` es estado local de POSPage y `clear()`
// (del cartStore) no lo tocaba → la siguiente venta de mostrador se grababa como
// delivery y ensuciaba el desglose por canal del reporte Financiero.

const PRODUCT = 'Lab Coctel'
const PRICE = 18000

async function addProductPOS(page: Page) {
  await page.getByTestId('product-card').filter({ hasText: PRODUCT }).first().click()
  await expect(page.getByTestId('item-config-modal')).toBeVisible()
  await page.getByTestId('item-config-confirm').click()
}

// El selector de tipo cicla entre las DOS opciones del POS (takeaway/delivery);
// dine_in lo maneja Mesas por la constraint de table_id.
async function setTipo(page: Page, label: 'Para llevar' | 'Delivery') {
  for (let i = 0; i < 3; i++) {
    if ((await page.getByTestId('order-type-label').textContent()) === label) return
    await page.getByTestId('order-type-toggle').click()
  }
  throw new Error(`No se pudo seleccionar el tipo "${label}"`)
}

// La venta de DELIVERY del primer test queda en "Nuevos" del tablero de delivery. En
// una corrida siguiente sobre la misma base, delivery-turno.spec ("sin deliveries
// abiertos el cierre NO muestra el aviso") la encontraba y fallaba (medido el
// 2026-10-09). Se marca entregada al final, por su id, con aserción.
let numeroDelivery: number | null = null

test.afterAll(() => {
  if (numeroDelivery === null) return
  const ids = psql(`select o.id from public.orders o
                      join public.profiles p on p.restaurant_id = o.restaurant_id
                     where p.email = '${ownerCreds().email}' and o.type = 'delivery'
                       and o.order_number = ${numeroDelivery};`).split('\n').filter(Boolean)
  expect(ids, 'la venta de delivery del spec').toHaveLength(1)
  psql(`update public.orders set status = 'delivered' where id = '${ids[0]}';`)
  expect(psql(`select status from public.orders where id = '${ids[0]}';`)).toBe('delivered')
})

test.describe.serial('Reset del tipo de venta', () => {
  test('tras cobrar una venta de DELIVERY vuelve al tipo por defecto', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/ventas')
    await waitPosReady(page)
    await openShiftIfClosed(page, 50000)

    await setTipo(page, 'Delivery')
    await expect(page.getByTestId('order-type-label')).toHaveText('Delivery')

    await addProductPOS(page)
    await page.getByRole('button', { name: 'Cobrar' }).click()
    await page.getByTestId('pay-method-efectivo').click()
    await page.getByTestId('checkout-continue').click()
    await page.getByTestId('checkout-received').fill(String(PRICE))
    await page.getByRole('button', { name: /Confirmar cobro/ }).click()
    await expect(page.getByText(/Venta #\d+ registrada/)).toBeVisible({ timeout: 15_000 })
    numeroDelivery = Number(((await page.getByText(/Venta #\d+ registrada/).textContent()) ?? '').match(/#(\d+)/)?.[1])
    await page.getByRole('button', { name: 'Nueva venta' }).click()

    // EL ASSERT DEL BUG: el tipo volvió solo, sin recargar la página.
    await expect(page.getByTestId('order-type-label')).toHaveText('Para llevar')
  })

  test('tras cobrar una venta NORMAL el tipo sigue siendo el default', async ({ page }) => {
    // Contraste: el reset es incondicional, así que una venta que ya era del tipo
    // por defecto tiene que terminar igual. Sin este caso, un reset que rompiera
    // el tipo en otras condiciones pasaría desapercibido.
    await loginAsOwner(page)
    await page.goto('/ventas')
    await waitPosReady(page)
    await openShiftIfClosed(page, 50000)

    await setTipo(page, 'Para llevar')
    await addProductPOS(page)
    await page.getByRole('button', { name: 'Cobrar' }).click()
    await page.getByTestId('pay-method-efectivo').click()
    await page.getByTestId('checkout-continue').click()
    await page.getByTestId('checkout-received').fill(String(PRICE))
    await page.getByRole('button', { name: /Confirmar cobro/ }).click()
    await expect(page.getByText(/Venta #\d+ registrada/)).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Nueva venta' }).click()

    await expect(page.getByTestId('order-type-label')).toHaveText('Para llevar')
  })
})
