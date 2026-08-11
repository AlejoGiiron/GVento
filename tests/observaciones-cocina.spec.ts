import { test, expect, type Page } from '@playwright/test'
import { loginAsOwner } from './helpers/auth'
import { openTableAndAddItems } from './helpers/tables'
import { openShiftIfClosed } from './helpers/shift'

// Observaciones de cocina ("hamburguesa sin cebolla"), POR ÍTEM.
//
// La columna `order_items.notes` YA estaba cableada de punta a punta —captura en
// el POS, persistencia, comanda impresa, KDS, panel de mesa— y el único hueco era
// Mesas: PickerItem tenía el campo `note` y lo enviaba como `notes`, pero no había
// input que lo escribiera, así que siempre viajaba null.
//
// El test sigue la cadena COMPLETA hasta la comanda impresa, que es el requisito
// crítico: que llegue a la pantalla no alcanza si el cocinero trabaja con el papel.

const PRODUCT = 'Lab Coctel'
const SUFFIX = Date.now().toString().slice(-6)
const MESA = `Mesa Obs ${SUFFIX}`
const NOTA = `sin cebolla ${SUFFIX}`

// Stub de impresión: captura el HTML de la comanda en vez de abrir el diálogo.
async function stubPrint(page: Page) {
  await page.addInitScript(() => {
    ;(window as unknown as { __comandaPrinted: string | null }).__comandaPrinted = null
    window.print = () => {
      ;(window as unknown as { __comandaPrinted: string | null }).__comandaPrinted =
        document.getElementById('gvento-comanda-content')?.innerHTML ?? null
    }
  })
}

const comandaHtml = (page: Page) =>
  page.evaluate(() => (window as unknown as { __comandaPrinted: string | null }).__comandaPrinted)

test.describe.serial('Observaciones de cocina por ítem', () => {
  test.beforeEach(async ({ page }) => { await stubPrint(page) })

  test('la observación cargada en Mesas llega a la COMANDA IMPRESA y al KDS', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/ventas')
    await openShiftIfClosed(page, 50000)

    await page.goto('/mesas')
    await page.getByRole('button', { name: 'Configurar' }).click()
    await page.getByPlaceholder('Mesa 1').fill(MESA)
    await page.getByRole('button', { name: 'Crear mesa' }).click()
    await expect(page.getByText(MESA)).toBeVisible()

    await openTableAndAddItems(page, MESA)
    await page.getByRole('button').filter({ has: page.getByText(PRODUCT, { exact: true }) }).first().click()
    await expect(page.getByTestId('item-config-modal')).toBeVisible()
    await page.getByTestId('item-config-confirm').click()

    // EL HUECO QUE SE TAPÓ: en Mesas no existía este input.
    await page.getByTestId('picker-note-toggle').click()
    await page.getByTestId('picker-note-input').fill(NOTA)
    await page.getByTestId('picker-note-input').press('Enter')
    // La nota queda visible en la línea antes de confirmar (el mozo la relee).
    await expect(page.getByTestId('picker-note-chip')).toContainText(NOTA)

    await page.getByRole('button', { name: 'Agregar a la mesa' }).click()
    await expect(page.getByRole('button', { name: 'Agregar a la mesa' })).toHaveCount(0)
    await expect(page.getByText('Sin ítems — agrega productos')).toHaveCount(0)

    // 1. Persistió y se ve en el panel de la mesa.
    await expect(page.getByText(`* ${NOTA}`)).toBeVisible()

    // 2. Contraste: la comanda todavía no se imprimió.
    expect(await comandaHtml(page)).toBeNull()

    // 3. LA ASERCIÓN CRÍTICA: llega a la comanda IMPRESA, no solo a la pantalla.
    // printComanda corre DESPUÉS de marcar los ítems y actualizar la orden (async),
    // así que hay que sondear el stub en vez de leerlo justo tras el click.
    await page.getByRole('button', { name: /^Cocina \(\d+\)$/ }).click()
    await expect.poll(() => comandaHtml(page), { timeout: 15_000 }).not.toBeNull()
    const html = await comandaHtml(page)
    expect(html).toContain(PRODUCT)
    expect(html).toContain(NOTA)

    // 4. Y al KDS, que es la otra cara del mismo dato.
    await page.goto('/cocina')
    await expect(page.getByText(NOTA)).toBeVisible({ timeout: 15_000 })
  })

  test('limpieza: cobrar la mesa y eliminarla', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/mesas')
    await page.getByRole('button', { name: new RegExp(MESA) }).click()
    await page.getByRole('button', { name: 'Cobrar' }).click()
    await page.getByTestId('pay-method-efectivo').click()
    await page.getByTestId('checkout-continue').click()
    await page.getByTestId('checkout-received').fill('20000')
    await page.getByRole('button', { name: /Confirmar cobro/ }).click()
    await expect(page.getByTestId('success-order-number')).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Listo' }).click()

    await page.getByRole('button', { name: 'Configurar' }).click()
    const del = page.locator('div')
      .filter({ has: page.getByText(MESA, { exact: true }) })
      .filter({ has: page.getByTitle('Eliminar mesa') })
      .last()
      .getByTitle('Eliminar mesa')
    if (await del.count() > 0) await del.click()
  })
})
