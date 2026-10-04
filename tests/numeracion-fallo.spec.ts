import { test, expect, type Page } from '@playwright/test'
import { loginAsOwner } from './helpers/auth'
import { openShiftIfClosed, closeShiftIfOpen } from './helpers/shift'
import { openTableAndAddItems } from './helpers/tables'
import { mesaFija, liberarMesa } from './helpers/lab'

/**
 * ⚠️  Suite para el LABORATORIO. NO correr contra producción.
 *
 * Cubre el fallo que antes era MUDO: la venta se cobra, `assignOrderNumber`
 * falla y la venta queda SIN número — invisible en el Historial (ordena por
 * número), sin ticket reimprimible y sin contar en el nº de ventas del arqueo (close_cash_shift).
 *
 * 🔴 DESDE pos-sale-lotes.sql ESTO SOLO PASA EN MESAS. El POS cobra con
 * register_pos_sale, que asigna el número en la MISMA transacción: si el número
 * falla, no queda venta (lo prueba tests/pos-sale-lotes.spec.ts). Por eso esta
 * suite, que antes cobraba en el POS, ahora cobra una MESA — el único camino
 * que todavía numera en un paso aparte del cobro.
 *
 * El fallo se fuerza interceptando la RPC `next_order_number` con
 * `page.route`, que es la única forma limpia de provocarlo desde afuera: la
 * secuencia no falla sola en un lab sano.
 *
 * Lo que se verifica:
 *   1. La venta SE COBRA igual (el fallo del número no tumba el cobro).
 *   2. El cajero VE el aviso en vez de un "¡Cobro exitoso!" que miente.
 *   3. "Reintentar" completa el número una vez que la RPC vuelve.
 *   4. El reintento NO quema un número extra cuando el que falló fue el UPDATE
 *      (la secuencia ya había entregado uno y se reusa).
 */

const PROD = 'Lab Cerveza'   // lab-seed: simple, sin extras (no abre el modal de configuración)
const MESA = 'E2E Fija Numeracion'

const RPC_NEXT = '**/rest/v1/rpc/next_order_number'
const PATCH_ORDERS = '**/rest/v1/orders?id=eq.*'

function parseVentaNumber(text: string): number {
  const m = text.match(/#(\d+)/)
  if (!m) throw new Error(`No se encontró número de venta en: "${text}"`)
  return Number(m[1])
}

/** Abre la mesa, le agrega el producto y la cobra al contado; deja el modal en el paso de éxito. */
async function cobrarMesa(page: Page) {
  await page.goto('/ventas')
  await openShiftIfClosed(page, 0)
  await mesaFija(MESA)
  await openTableAndAddItems(page, MESA)
  await page.getByRole('button').filter({ has: page.getByText(PROD, { exact: true }) }).first().click()
  await page.getByRole('button', { name: 'Agregar a la mesa' }).click()
  await expect(page.getByRole('button', { name: 'Agregar a la mesa' })).toHaveCount(0)
  await expect(page.getByTestId('table-item').first()).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: 'Cobrar' }).click()
  await page.getByTestId('pay-method-efectivo').click()
  await page.getByTestId('checkout-continue').click()
  await page.getByTestId('checkout-received').fill('200000')
  await page.getByRole('button', { name: /Confirmar cobro/ }).click()
}

test.describe.serial('Numeración (Mesas): fallo visible + reintento', () => {
  test('si falla next_order_number: la mesa se cobra y el cajero VE el aviso', async ({ page }) => {
    await loginAsOwner(page)
    await page.route(RPC_NEXT, (route) => route.abort())

    await cobrarMesa(page)

    // Y el fallo YA NO ES MUDO: el cobro llega a éxito, con el aviso.
    await expect(page.getByTestId('success-sin-numero')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Venta registrada — sin número asignado')).toBeVisible()
    await expect(page.getByTestId('retry-order-number')).toBeEnabled()

    await page.unroute(RPC_NEXT)
    await page.getByRole('button', { name: 'Listo' }).click()
  })

  test('"Reintentar" asigna el número cuando la RPC vuelve', async ({ page }) => {
    await loginAsOwner(page)
    await page.route(RPC_NEXT, (route) => route.abort())

    await cobrarMesa(page)
    await expect(page.getByTestId('success-sin-numero')).toBeVisible({ timeout: 15_000 })

    // Se restablece la RPC y el cajero reintenta.
    await page.unroute(RPC_NEXT)
    await page.getByTestId('retry-order-number').click()

    // El aviso desaparece y aparece el número.
    await expect(page.getByTestId('success-sin-numero')).toBeHidden({ timeout: 15_000 })
    const num = parseVentaNumber(await page.getByTestId('success-order-number').innerText())
    expect(num).toBeGreaterThan(0)

    await page.getByRole('button', { name: 'Listo' }).click()
  })

  test('si falla el UPDATE: el reintento REUSA el número, no quema otro', async ({ page }) => {
    await loginAsOwner(page)

    // Deja pasar next_order_number (entrega el número) pero tumba el PATCH que
    // lo GRABA. Es el modo de fallo PEOR: el contador de la sede ya avanzó.
    // Solo el PATCH de order_number: el cobro de mesa hace otros PATCH a orders
    // (delivered) que tienen que pasar para llegar al paso de éxito.
    // El helper reintenta el UPDATE 3 veces solo; todas caen acá.
    await page.route(PATCH_ORDERS, (route) =>
      route.request().method() === 'PATCH' && (route.request().postData() ?? '').includes('order_number')
        ? route.abort()
        : route.continue(),
    )

    await cobrarMesa(page)
    await expect(page.getByTestId('success-sin-numero')).toBeVisible({ timeout: 20_000 })

    await page.unroute(PATCH_ORDERS)
    await page.getByTestId('retry-order-number').click()
    await expect(page.getByTestId('success-sin-numero')).toBeHidden({ timeout: 15_000 })

    const reusado = parseVentaNumber(await page.getByTestId('success-order-number').innerText())
    await page.getByRole('button', { name: 'Listo' }).click()

    // La venta siguiente debe ser EXACTAMENTE reusado + 1. Si el reintento
    // hubiera pedido un número nuevo en vez de reusar el reservado, acá habría
    // un salto — que es justo el hueco que la asimetría de reintento evita.
    await cobrarMesa(page)
    await expect(page.getByTestId('success-order-number')).toContainText(/Venta #\d+/, { timeout: 15_000 })
    const siguiente = parseVentaNumber(await page.getByTestId('success-order-number').innerText())
    expect(siguiente).toBe(reusado + 1)

    await page.getByRole('button', { name: 'Listo' }).click()
  })

  // Cada paso TERMINA EN UNA ASERCIÓN: una limpieza que no verifica es
  // indistinguible de una que no corre (ver el historial de este archivo).
  test('limpieza: cerrar turno y liberar la mesa', async ({ page }) => {
    await loginAsOwner(page)
    await closeShiftIfOpen(page)
    await liberarMesa(MESA)
  })
})
