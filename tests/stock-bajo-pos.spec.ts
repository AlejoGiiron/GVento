import { test, expect, type Page } from '@playwright/test'
import { loginAsOwner } from './helpers/auth'
import { saveProductAndClose } from './helpers/product'

// Stock bajo en el POS. Antes el indicador solo conocía "≤ 0" (sin stock /
// sobreventa): `min_stock` existía, se editaba en la ficha y lo usaba Inventario,
// pero el POS lo ignoraba. La regla ahora es ÚNICA (src/lib/stockStatus.ts), así
// que las dos pantallas no pueden contestar distinto sobre el mismo producto.
//
// Los 4 estados se recorren sobre el MISMO producto bajando su stock, que es lo
// que verifica las FRONTERAS (5 > 5 > 0 > negativo) y no solo un caso feliz.

const SUFFIX = Date.now().toString().slice(-6)
const CAT = `E2E Bajo ${SUFFIX}`
const PROD = `E2E Insumo Bajo ${SUFFIX}`
const MIN_STOCK = 5

async function irAlProductoEnPOS(page: Page) {
  await page.goto('/ventas')
  await page.getByPlaceholder('Buscar producto...').fill(PROD)
  return page.getByTestId('product-card').filter({ hasText: PROD }).first()
}

const badge = (card: ReturnType<Page['getByTestId']>) => card.getByTestId('pos-stock-indicator')

async function ajustar(page: Page, sign: '+' | '-', amount: number) {
  await page.goto('/inventario')
  await page.getByTestId('inventory-adjust-btn').click()
  await page.getByTestId('adjust-product').selectOption({ label: PROD })
  await page.getByTestId(sign === '+' ? 'adjust-sign-in' : 'adjust-sign-out').click()
  await page.getByTestId('adjust-amount').fill(String(amount))
  await page.getByTestId('adjust-reason').fill('E2E stock bajo')
  await page.getByTestId('adjust-confirm').click()
  await expect(page.getByTestId('stock-adjust-modal')).toHaveCount(0)
}

test.describe.serial('Stock bajo en el POS', () => {
  test('preparación: categoría + insumo con mínimo 5 y stock 20', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/productos')

    await page.getByRole('button', { name: 'Nueva categoría' }).click()
    await page.getByPlaceholder('Ej: Cocteles clásicos').fill(CAT)
    await page.getByRole('button', { name: 'Crear categoría' }).click()
    await expect(page.getByRole('button', { name: new RegExp(CAT) })).toBeVisible()

    await page.getByRole('button', { name: 'Nuevo producto' }).click()
    await page.getByPlaceholder('Ej: Mojito Cubano').fill(PROD)
    await page.getByPlaceholder('0').first().fill('4000')
    await page.getByTestId('product-category-select').selectOption({ label: CAT })
    await page.getByTestId('product-stock-tracking').click()
    await page.getByTestId('product-min-stock').fill(String(MIN_STOCK))
    await saveProductAndClose(page)
    await expect(page.getByText(PROD)).toBeVisible()

    await ajustar(page, '+', 20)
  })

  test('stock holgado (20 > mínimo 5): SIN indicador', async ({ page }) => {
    // Caso negativo. Sin él, un indicador que se mostrara SIEMPRE pasaría todos
    // los casos positivos de abajo y el test sería verde por la razón equivocada.
    await loginAsOwner(page)
    const card = await irAlProductoEnPOS(page)
    await expect(card).toBeVisible()
    await expect(badge(card)).toHaveCount(0)
  })

  test('stock EN el mínimo (5): indicador "Stock bajo" — el caso que no existía', async ({ page }) => {
    await loginAsOwner(page)
    await ajustar(page, '-', 15)   // 20 → 5, exactamente el mínimo

    const card = await irAlProductoEnPOS(page)
    const b = badge(card)
    await expect(b).toBeVisible()
    await expect(b).toHaveText(/Stock bajo/)
    // El umbral es `<=`, no `<`: en el mínimo exacto YA avisa.
    await expect(b).toHaveAttribute('data-stock-status', 'low')
  })

  test('stock en 0: "Sin stock", no "Stock bajo"', async ({ page }) => {
    await loginAsOwner(page)
    await ajustar(page, '-', 5)    // 5 → 0

    const card = await irAlProductoEnPOS(page)
    const b = badge(card)
    await expect(b).toHaveText(/Sin stock/)
    await expect(b).toHaveAttribute('data-stock-status', 'out')
  })

  test('stock negativo: "Reponer" (sobreventa), estado propio', async ({ page }) => {
    await loginAsOwner(page)
    await ajustar(page, '-', 3)    // 0 → −3

    const card = await irAlProductoEnPOS(page)
    const b = badge(card)
    await expect(b).toHaveText(/Reponer/)
    await expect(b).toHaveAttribute('data-stock-status', 'negative')
  })

  test('Inventario y POS coinciden en el estado del mismo producto', async ({ page }) => {
    // El punto de extraer la regla: dos pantallas, una sola respuesta.
    await loginAsOwner(page)
    await ajustar(page, '+', 6)    // −3 → 3, por debajo del mínimo 5 → low

    await page.goto('/inventario')
    await page.getByTestId('inventory-tab-levels').click()
    await page.getByPlaceholder('Buscar insumo...').fill(PROD)
    const row = page.getByTestId('stock-level-row').filter({ hasText: PROD })
    await expect(row.getByTestId('stock-status-badge')).toHaveText('Stock bajo')

    const card = await irAlProductoEnPOS(page)
    await expect(badge(card)).toHaveText(/Stock bajo/)
  })

  test('limpieza: desactivar producto y categoría', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/productos')
    await page.getByPlaceholder('Buscar producto...').fill(PROD)
    await page.getByTitle('Desactivar', { exact: true }).first().click()
    await page.getByRole('button', { name: 'Sí, desactivar' }).click()
    await expect(page.getByText(/Sin resultados/)).toBeVisible()

    await page.getByPlaceholder('Buscar producto...').fill('')
    const tab = page.getByRole('button', { name: new RegExp(CAT) })
    await tab.scrollIntoViewIfNeeded()
    await tab.getByTitle('Editar categoría').click()
    await page.getByRole('switch').click()
    await page.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(tab).toHaveCount(0)
  })
})
