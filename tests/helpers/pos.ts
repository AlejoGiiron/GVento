import { type Page, expect } from '@playwright/test'

/**
 * Espera a que el POS (/ventas) esté MONTADO y visible antes de afirmar sobre el
 * carrito. Bajo carga, una aserción de estado del carrito justo tras navegar
 * puede resolverse contra la raíz del POS aún no visible (el placeholder
 * "Carrito vacío" existe pero queda oculto durante el render) → flaky.
 *
 * `cart-total` está SIEMPRE en el footer del carrito (no depende de items), así
 * que su visibilidad confirma que la raíz del POS ya renderizó.
 */
export async function waitPosReady(page: Page): Promise<void> {
  await expect(page.getByTestId('cart-total')).toBeVisible({ timeout: 15_000 })
}
