import { test, expect, type Page } from '@playwright/test'
import { loginAsOwner } from './helpers/auth'
import { openShiftIfClosed, closeShiftIfOpen } from './helpers/shift'

const SUFFIX = Date.now().toString().slice(-6)
const CAT = `E2E Inv ${SUFFIX}`
const INSUMO = `E2E Vaso ${SUFFIX}`     // producto simple con inventario
const COCTEL = `E2E Coctel ${SUFFIX}`   // producto compuesto (receta: 1 vaso)

// ── Helpers ───────────────────────────────────────────────────────

async function createSimpleTracked(page: Page, name: string, price: string) {
  await page.goto('/productos')
  await page.getByRole('button', { name: 'Nuevo producto' }).click()
  await page.getByPlaceholder('Ej: Mojito Cubano').fill(name)
  await page.getByPlaceholder('0').first().fill(price)
  await page.locator('select').first().selectOption({ label: CAT })
  // kind 'simple' es el default; activar control de inventario.
  await page.getByRole('switch').click()
  await page.getByRole('button', { name: 'Crear producto' }).click()
  await expect(page.getByText(name)).toBeVisible()
}

async function createComposite(page: Page, name: string, price: string, insumo: string, qty: number) {
  await page.goto('/productos')
  await page.getByRole('button', { name: 'Nuevo producto' }).click()
  await page.getByPlaceholder('Ej: Mojito Cubano').fill(name)
  await page.getByPlaceholder('0').first().fill(price)
  await page.locator('select').first().selectOption({ label: CAT })
  await page.getByTestId('product-kind-composite').click()
  // Agregar el insumo a la receta.
  await page.getByTestId('recipe-add-product').selectOption({ label: insumo })
  await page.getByTestId('recipe-add-qty').fill(String(qty))
  await page.getByTestId('recipe-add-confirm').click()
  await expect(page.getByTestId('recipe-row').filter({ hasText: insumo })).toBeVisible()
  await page.getByRole('button', { name: 'Crear producto' }).click()
  await expect(page.getByText(name)).toBeVisible()
}

// Lee el stock de un insumo desde la pestaña Niveles de Inventario.
async function readStock(page: Page, name: string): Promise<number> {
  await page.goto('/inventario')
  await page.getByTestId('inventory-tab-levels').click()
  await page.getByPlaceholder('Buscar insumo...').fill(name)
  const row = page.getByTestId('stock-level-row').filter({ hasText: name })
  await expect(row).toBeVisible()
  return Number(await row.getByTestId('stock-level-qty').innerText())
}

// Ajuste manual (+entrada / -salida) desde el modal de Inventario.
async function adjustStock(page: Page, name: string, sign: '+' | '-', amount: number, reason: string) {
  await page.goto('/inventario')
  await page.getByTestId('inventory-adjust-btn').click()
  await page.getByTestId('adjust-product').selectOption({ label: name })
  await page.getByTestId(sign === '+' ? 'adjust-sign-in' : 'adjust-sign-out').click()
  await page.getByTestId('adjust-amount').fill(String(amount))
  await page.getByTestId('adjust-reason').fill(reason)
  await page.getByTestId('adjust-confirm').click()
  await expect(page.getByTestId('stock-adjust-modal')).toHaveCount(0)
}

// Vende un producto (sin extras) en efectivo. Deja el turno abierto.
async function sellCash(page: Page, name: string) {
  await page.goto('/ventas')
  await openShiftIfClosed(page, 0)
  await page.getByPlaceholder('Buscar producto...').fill(name)
  await page.getByTestId('product-card').first().click()
  await page.getByRole('button', { name: 'Cobrar' }).click()
  await page.getByText('Efectivo', { exact: true }).click()
  await page.getByRole('button', { name: /Continuar/ }).click()
  await page.getByTestId('checkout-received').fill('200000')
  await page.getByRole('button', { name: /Confirmar cobro/ }).click()
  await expect(page.getByText('¡Cobro exitoso!')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Nueva venta' }).click()
}

// ── Suite ─────────────────────────────────────────────────────────

test.describe.serial('Inventario por recetas', () => {
  test('setup: categoría, insumo y producto compuesto con receta', async ({ page }) => {
    await loginAsOwner(page)

    await page.goto('/productos')
    await page.getByRole('button', { name: 'Nueva categoría' }).click()
    await page.getByPlaceholder('Ej: Cocteles clásicos').fill(CAT)
    await page.getByRole('button', { name: 'Crear categoría' }).click()
    await expect(page.getByRole('button', { name: new RegExp(CAT) })).toBeVisible()

    await createSimpleTracked(page, INSUMO, '1000')
    await createComposite(page, COCTEL, '15000', INSUMO, 1)

    // El insumo aparece en Niveles con stock 0 (arranca en 0).
    expect(await readStock(page, INSUMO)).toBe(0)
  })

  test('ajuste manual suma stock y registra el movimiento', async ({ page }) => {
    await loginAsOwner(page)
    await adjustStock(page, INSUMO, '+', 20, 'compra inicial')
    expect(await readStock(page, INSUMO)).toBe(20)

    // Aparece un movimiento de ajuste con la cantidad correcta.
    await page.goto('/inventario')
    await page.getByTestId('inventory-tab-movements').click()
    const row = page.getByTestId('stock-movement-row').filter({ hasText: INSUMO }).first()
    await expect(row).toContainText('Ajuste')
    await expect(row.getByTestId('stock-movement-qty')).toContainText('+20')
  })

  test('ajuste manual de salida resta stock', async ({ page }) => {
    await loginAsOwner(page)
    await adjustStock(page, INSUMO, '-', 5, 'merma')
    expect(await readStock(page, INSUMO)).toBe(15)
  })

  test('vender un compuesto descuenta su insumo y deja movimiento de venta', async ({ page }) => {
    await loginAsOwner(page)
    const before = await readStock(page, INSUMO)
    await sellCash(page, COCTEL)
    expect(await readStock(page, INSUMO)).toBe(before - 1)

    // El descuento queda auditado como movimiento de venta del insumo.
    await page.goto('/inventario')
    await page.getByTestId('inventory-tab-movements').click()
    const row = page.getByTestId('stock-movement-row').filter({ hasText: INSUMO }).first()
    await expect(row).toContainText('Venta')
    await expect(row.getByTestId('stock-movement-qty')).toContainText('−1')
  })

  test('sobreventa: el stock del insumo queda NEGATIVO con alerta', async ({ page }) => {
    await loginAsOwner(page)

    // Dejar el insumo en 1 y vender 2 cocteles → 1 − 2 = −1.
    const current = await readStock(page, INSUMO)
    if (current > 1) await adjustStock(page, INSUMO, '-', current - 1, 'ajuste a 1 para test')
    else if (current < 1) await adjustStock(page, INSUMO, '+', 1 - current, 'ajuste a 1 para test')
    expect(await readStock(page, INSUMO)).toBe(1)

    await sellCash(page, COCTEL)
    await sellCash(page, COCTEL)
    expect(await readStock(page, INSUMO)).toBe(-1)

    // Badge de estado "Reponer" en Niveles.
    await page.goto('/inventario')
    await page.getByPlaceholder('Buscar insumo...').fill(INSUMO)
    const row = page.getByTestId('stock-level-row').filter({ hasText: INSUMO })
    await expect(row.getByTestId('stock-status-badge')).toContainText('Reponer')

    // Indicador en la card del POS (no bloquea la venta).
    await page.goto('/ventas')
    await page.getByPlaceholder('Buscar producto...').fill(INSUMO)
    await expect(page.getByTestId('pos-stock-indicator')).toContainText('Reponer')
  })

  test('limpieza: cerrar turno, desactivar productos y categoría', async ({ page }) => {
    page.on('dialog', (d) => d.accept())
    await loginAsOwner(page)

    await page.goto('/ventas')
    await closeShiftIfOpen(page)

    // Desactivar el compuesto primero (libera la receta), luego el insumo.
    for (const name of [COCTEL, INSUMO]) {
      await page.goto('/productos')
      await page.getByPlaceholder('Buscar producto...').fill(name)
      await page.getByTitle('Desactivar', { exact: true }).first().click()
      await page.getByRole('button', { name: 'Sí, desactivar' }).click()
      await expect(page.getByText(/Sin resultados/)).toBeVisible()
    }

    await page.getByRole('button', { name: new RegExp(CAT) }).getByTitle('Editar categoría').click()
    await page.getByRole('switch').click()
    await page.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(page.getByRole('button', { name: new RegExp(CAT) })).toHaveCount(0)
  })
})
