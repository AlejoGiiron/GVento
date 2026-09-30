import { test, expect, type Page } from '@playwright/test'
import { loginAsOwner } from './helpers/auth'
import { openTableAndAddItems } from './helpers/tables'
import { openShiftIfClosed } from './helpers/shift'
import { mesaFija, liberarMesa } from './helpers/lab'

// Recibo al cerrar mesa. El POS ya ofrecía "Imprimir" en la pantalla de éxito y
// Mesas NO: TablesPage solo importaba printComanda (la de cocina). Ahora usa
// printSaleTicket — la MISMA función que la reimpresión del Historial, así el
// ticket de mesa sale byte-idéntico al reimpreso desde ahí.

const PRODUCT = 'Lab Coctel'
// Mesa FIJA, reusada entre corridas (sin sufijo): no acumula residuo en LAB.
// Ver tests/helpers/lab.ts.
const MESA = 'E2E Fija Recibo'

// Stub de impresión: captura el HTML del ticket en vez de abrir el diálogo
// (headless). Mismo patrón que arqueo.spec.
async function stubPrint(page: Page) {
  await page.addInitScript(() => {
    ;(window as unknown as { __ticketPrinted: string | null }).__ticketPrinted = null
    window.print = () => {
      ;(window as unknown as { __ticketPrinted: string | null }).__ticketPrinted =
        document.getElementById('gvento-sale-ticket-content')?.innerHTML ?? null
    }
  })
}

const ticketHtml = (page: Page) =>
  page.evaluate(() => (window as unknown as { __ticketPrinted: string | null }).__ticketPrinted)

test.describe.serial('Recibo al cerrar mesa', () => {
  test.beforeEach(async ({ page }) => { await stubPrint(page) })

  test('cobrar una mesa ofrece imprimir y el ticket trae la venta completa', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/ventas')
    await openShiftIfClosed(page, 50000)

    // Mesa dedicada (evita colisión con mesas seeded ocupadas): existe y está
    // LIBRE (se crea la primera vez).
    await mesaFija(MESA)

    await openTableAndAddItems(page, MESA)
    await page.getByRole('button').filter({ has: page.getByText(PRODUCT, { exact: true }) }).first().click()
    await expect(page.getByTestId('item-config-modal')).toBeVisible()
    await page.getByTestId('item-config-confirm').click()
    await page.getByRole('button', { name: 'Agregar a la mesa' }).click()
    // El picker cierra SOLO tras commitear el alta atómica de ítems.
    await expect(page.getByRole('button', { name: 'Agregar a la mesa' })).toHaveCount(0)
    // Señal POSITIVA de que el ítem quedó en la mesa: "Sin ítems" en 0 también
    // se cumplía con el panel en "Cargando orden..." (barrido R3, 2026-09-30).
    await expect(page.getByTestId('table-item').first()).toBeVisible({ timeout: 15_000 })

    // Cobrar en efectivo.
    await page.getByRole('button', { name: 'Cobrar' }).click()
    await page.getByTestId('pay-method-efectivo').click()
    await page.getByTestId('checkout-continue').click()
    // Efectivo: el confirmar se habilita recién con el recibido >= total.
    await page.getByTestId('checkout-received').fill('20000')
    await page.getByRole('button', { name: /Confirmar cobro/ }).click()
    await expect(page.getByTestId('success-order-number')).toBeVisible({ timeout: 15_000 })

    const numero = ((await page.getByTestId('success-order-number').textContent()) ?? '')
      .replace('Venta', '').trim()

    // EL ASSERT DEL BUG: en Mesas NO existía este botón.
    const imprimir = page.getByTestId('table-print-ticket')
    await expect(imprimir).toBeVisible()

    // Contraste: antes de tocarlo NO se imprimió nada. Sin este caso negativo un
    // ticket que se imprimiera solo pasaría el test igual — y la decisión fue que
    // sea MANUAL, como el POS (auto-imprimir gasta papel si nadie lo pide).
    expect(await ticketHtml(page)).toBeNull()

    await imprimir.click()
    const html = await ticketHtml(page)
    expect(html).not.toBeNull()
    expect(html).toContain(PRODUCT)
    expect(html).toContain(numero)   // "#123" o "#ABC12345" si la numeración falló
    expect(html).toContain('Mesa')   // etiqueta del tipo dine_in
    expect(html).toContain('Efectivo')
  })

  // Corre AUNQUE el test falle (antes era un test de limpieza al final de un
  // describe.serial, que se salteaba). Libera la mesa y lo verifica.
  test.afterAll(async () => {
    await liberarMesa(MESA)
  })
})
