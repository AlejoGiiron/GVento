import { test, expect, type Page } from '@playwright/test'
import { loginAsOwner } from './helpers/auth'
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
