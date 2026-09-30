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

/**
 * Agrega al carrito un producto CONOCIDO, por nombre: "Lab Cerveza" (lab-seed:
 * simple, sin extras, sin tracking, 8.000).
 *
 * 🔴 Reemplaza a `getByTestId('product-card').first()`, que agregaba "lo que
 * saliera primero" y por eso dependía del ORDEN de los datos: en Docker
 * (2026-09-30) el primero era "AV Insumo" a precio 0, residuo de anular-venta,
 * y pos.spec daba total 0. Un spec no puede depender de qué dejó otro.
 */
export const PRODUCTO_SIMPLE = 'Lab Cerveza'
export async function agregarProductoSimple(page: Page): Promise<void> {
  await page.getByPlaceholder('Buscar producto...').fill(PRODUCTO_SIMPLE)
  await page.getByTestId('product-card').filter({ hasText: PRODUCTO_SIMPLE }).first().click()
}
