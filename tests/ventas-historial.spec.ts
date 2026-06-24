import { test, expect, type Page } from '@playwright/test'
import { loginAsOwner } from './helpers/auth'
import { openShiftIfClosed, closeShiftIfOpen } from './helpers/shift'

// ⚠️  Suite para el LABORATORIO (opción C). NO correr contra producción.
// En un Supabase de laboratorio recién sembrado, la primera venta de la sede
// es #1; aquí se valida la SECUENCIA (N, N+1) para ser robusto sin depender
// del estado previo del backend compartido.

const SUFFIX = Date.now().toString().slice(-6)
const CAT = `E2E Hist ${SUFFIX}`
const P_SIMPLE = `E2E HistProd ${SUFFIX}`   // producto sin extras
const P_BASE = `E2E HistBase ${SUFFIX}`     // producto con un extra
const E_LIBRE = `E2E HistExtra ${SUFFIX}`   // extra sin vínculo de stock

// "Venta #12" → 12
function parseVentaNumber(text: string): number {
  const m = text.match(/#(\d+)/)
  if (!m) throw new Error(`No se encontró número de venta en: "${text}"`)
  return Number(m[1])
}

// ── Helpers ───────────────────────────────────────────────────────

async function createProduct(page: Page, name: string, price: string) {
  await page.goto('/productos')
  await page.getByRole('button', { name: 'Nuevo producto' }).click()
  await page.getByPlaceholder('Ej: Mojito Cubano').fill(name)
  await page.getByPlaceholder('0').first().fill(price)
  await page.getByTestId('product-category-select').selectOption({ label: CAT })
  await page.getByRole('button', { name: 'Crear producto' }).click()
  await expect(page.getByText(name)).toBeVisible()
}

async function createExtra(page: Page, name: string, price: string) {
  await page.goto('/configuracion')
  await page.getByRole('button', { name: 'Extras', exact: true }).click()
  await page.getByTestId('extra-new').click()
  await page.getByTestId('extra-name').fill(name)
  await page.getByTestId('extra-price').fill(price)
  await page.getByTestId('extra-save').click()
  await expect(page.getByTestId('extra-row').filter({ hasText: name })).toBeVisible()
}

// Vende un producto SIN extras al contado y devuelve el número de venta asignado.
async function sellSimple(page: Page, productName: string): Promise<number> {
  await page.goto('/ventas')
  await openShiftIfClosed(page, 0)
  await page.getByPlaceholder('Buscar producto...').fill(productName)
  await page.getByTestId('product-card').first().click()

  await page.getByRole('button', { name: 'Cobrar' }).click()
  await page.getByText('Efectivo', { exact: true }).click()
  await page.getByRole('button', { name: /Continuar/ }).click()
  await page.getByTestId('checkout-received').fill('200000')
  await page.getByRole('button', { name: /Confirmar cobro/ }).click()

  await expect(page.getByText('¡Cobro exitoso!').or(page.getByText(/¡Venta #\d+ registrada!/)))
    .toBeVisible({ timeout: 15_000 })
  const num = parseVentaNumber(await page.getByTestId('success-order-number').innerText())
  await page.getByRole('button', { name: 'Nueva venta' }).click()
  return num
}

// Vende P_BASE con el extra libre (qty 1) al contado. Devuelve el número.
async function sellWithExtra(page: Page): Promise<number> {
  await page.goto('/ventas')
  await openShiftIfClosed(page, 0)
  await page.getByPlaceholder('Buscar producto...').fill(P_BASE)
  await page.getByTestId('product-card').first().click()

  await expect(page.getByTestId('item-config-modal')).toBeVisible()
  await page.getByTestId('item-config-extra').filter({ hasText: E_LIBRE })
    .getByTestId('extra-qty-inc').click()
  await page.getByTestId('item-config-confirm').click()

  await page.getByRole('button', { name: 'Cobrar' }).click()
  await page.getByText('Efectivo', { exact: true }).click()
  await page.getByRole('button', { name: /Continuar/ }).click()
  await page.getByTestId('checkout-received').fill('200000')
  await page.getByRole('button', { name: /Confirmar cobro/ }).click()

  await expect(page.getByText(/¡Venta #\d+ registrada!|¡Cobro exitoso!/)).toBeVisible({ timeout: 15_000 })
  const num = parseVentaNumber(await page.getByTestId('success-order-number').innerText())
  await page.getByRole('button', { name: 'Nueva venta' }).click()
  return num
}

// ── Suite ─────────────────────────────────────────────────────────

test.describe.serial('Numeración e historial de ventas', () => {
  let firstNum = 0
  let secondNum = 0
  let extraNum = 0

  test('setup: categoría, productos y extra', async ({ page }) => {
    await loginAsOwner(page)

    await page.goto('/productos')
    await page.getByRole('button', { name: 'Nueva categoría' }).click()
    await page.getByPlaceholder('Ej: Cocteles clásicos').fill(CAT)
    await page.getByRole('button', { name: 'Crear categoría' }).click()
    await expect(page.getByRole('button', { name: new RegExp(CAT) })).toBeVisible()

    await createProduct(page, P_SIMPLE, '10000')
    await createProduct(page, P_BASE, '12000')
    await createExtra(page, E_LIBRE, '2000')

    // Asignar el extra a P_BASE.
    await page.goto('/productos')
    await page.getByPlaceholder('Buscar producto...').fill(P_BASE)
    await page.getByTitle('Editar', { exact: true }).first().click()
    await page.getByTestId('product-extra-option').filter({ hasText: E_LIBRE }).click()
    await page.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(page.getByText(P_BASE)).toBeVisible()
  })

  test('la venta recibe número y la siguiente es consecutiva (#N, #N+1)', async ({ page }) => {
    await loginAsOwner(page)
    firstNum = await sellSimple(page, P_SIMPLE)
    secondNum = await sellSimple(page, P_SIMPLE)
    expect(secondNum).toBe(firstNum + 1)
  })

  test('el historial lista las ventas por número descendente', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/historial')

    // La primera fila (orden desc) debe ser la venta más reciente.
    const firstRow = page.getByTestId('sale-row').first()
    await expect(firstRow).toContainText(`#${secondNum}`)
  })

  test('búsqueda por número de venta', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/historial')
    await page.getByTestId('sales-search').fill(String(firstNum))

    const rows = page.getByTestId('sale-row')
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText(`#${firstNum}`)
  })

  test('el detalle muestra ítems y extras + reimpresión disponible', async ({ page }) => {
    await loginAsOwner(page)
    extraNum = await sellWithExtra(page)

    await page.goto('/historial')
    await page.getByTestId('sales-search').fill(String(extraNum))
    await page.getByTestId('sale-row').first().click()

    await expect(page.getByTestId('sale-detail-modal')).toBeVisible()
    await expect(page.getByTestId('sale-detail-item').first()).toContainText(P_BASE)
    await expect(page.getByTestId('sale-detail-extras').first()).toContainText(E_LIBRE)
    await expect(page.getByTestId('sale-reprint')).toBeEnabled()
  })

  test('limpieza: cerrar turno, desactivar extra, productos y categoría', async ({ page }) => {
    page.on('dialog', (d) => d.accept())
    await loginAsOwner(page)

    await page.goto('/ventas')
    await closeShiftIfOpen(page)

    // Desactivar extra.
    await page.goto('/configuracion')
    await page.getByRole('button', { name: 'Extras', exact: true }).click()
    const row = page.getByTestId('extra-row').filter({ hasText: E_LIBRE })
    await row.getByTitle('Desactivar').click()
    await expect(row).toContainText('Inactivo')

    // Desactivar productos.
    for (const name of [P_SIMPLE, P_BASE]) {
      await page.goto('/productos')
      await page.getByPlaceholder('Buscar producto...').fill(name)
      await page.getByTitle('Desactivar', { exact: true }).first().click()
      await page.getByRole('button', { name: 'Sí, desactivar' }).click()
      await expect(page.getByText(/Sin resultados/)).toBeVisible()
    }

    // Desactivar categoría.
    await page.getByRole('button', { name: new RegExp(CAT) }).getByTitle('Editar categoría').click()
    await page.getByRole('switch').click()
    await page.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(page.getByRole('button', { name: new RegExp(CAT) })).toHaveCount(0)
  })
})
