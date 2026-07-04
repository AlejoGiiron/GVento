import { test, expect, type Page } from '@playwright/test'
import { loginAsOwner, loginAsCashier } from './helpers/auth'
import { openShiftIfClosed, closeShiftIfOpen } from './helpers/shift'

const SUFFIX = Date.now().toString().slice(-6)
const CAT = `E2E Compras ${SUFFIX}`
const INSUMO = `E2E Insumo ${SUFFIX}`         // producto simple con inventario
const PROVEEDOR = `E2E Proveedor ${SUFFIX}`

// ── Helpers ───────────────────────────────────────────────────────

async function createSimpleTracked(page: Page, name: string, price: string) {
  await page.goto('/productos')
  await page.getByRole('button', { name: 'Nuevo producto' }).click()
  await page.getByPlaceholder('Ej: Mojito Cubano').fill(name)
  await page.getByPlaceholder('0').first().fill(price)
  await page.getByTestId('product-category-select').selectOption({ label: CAT })
  // kind 'simple' es el default; activar control de inventario.
  await page.getByTestId('product-stock-tracking').click()
  await page.getByRole('button', { name: 'Crear producto' }).click()
  await expect(page.getByText(name)).toBeVisible()
}

async function createSupplier(page: Page, name: string) {
  await page.goto('/compras')
  await page.getByTestId('purchases-tab-suppliers').click()
  await page.getByTestId('new-supplier-btn').click()
  await page.getByTestId('supplier-name').fill(name)
  await page.getByTestId('supplier-save').click()
  await expect(page.getByTestId('supplier-form-modal')).toHaveCount(0)
  await expect(page.getByTestId('supplier-row').filter({ hasText: name })).toBeVisible()
}

// Registra una compra de UN ítem. Deja el método de pago indicado.
async function registerPurchase(
  page: Page,
  { supplier, method, product, qty, cost }:
    { supplier: string; method: string; product: string; qty: number; cost: number },
) {
  await page.goto('/compras')
  await page.getByTestId('new-invoice-btn').click()
  await expect(page.getByTestId('new-invoice-modal')).toBeVisible()
  await page.getByTestId('invoice-supplier').selectOption({ label: supplier })
  await page.getByTestId('invoice-payment-method').selectOption(method)
  await page.getByTestId('invoice-item-product').first().selectOption({ label: product })
  await page.getByTestId('invoice-item-qty').first().fill(String(qty))
  await page.getByTestId('invoice-item-cost').first().fill(String(cost))
  await page.getByTestId('invoice-submit').click()
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

// ── Suite ─────────────────────────────────────────────────────────

test.describe.serial('Compras / Proveedores', () => {
  test('setup: categoría, insumo y proveedor', async ({ page }) => {
    await loginAsOwner(page)

    await page.goto('/productos')
    await page.getByRole('button', { name: 'Nueva categoría' }).click()
    await page.getByPlaceholder('Ej: Cocteles clásicos').fill(CAT)
    await page.getByRole('button', { name: 'Crear categoría' }).click()
    await expect(page.getByRole('button', { name: new RegExp(CAT) })).toBeVisible()

    await createSimpleTracked(page, INSUMO, '1000')
    await createSupplier(page, PROVEEDOR)

    // El insumo arranca en stock 0.
    expect(await readStock(page, INSUMO)).toBe(0)
  })

  test('registrar compra sube el stock del insumo y deja movimiento de compra', async ({ page }) => {
    await loginAsOwner(page)

    // Pago por transferencia: aísla esta verificación de stock de la caja.
    await registerPurchase(page, { supplier: PROVEEDOR, method: 'transfer', product: INSUMO, qty: 10, cost: 1500 })
    await expect(page.getByTestId('new-invoice-modal')).toHaveCount(0)
    await expect(page.getByText(/Compra registrada/)).toBeVisible()

    // El stock subió 0 → 10.
    expect(await readStock(page, INSUMO)).toBe(10)

    // El ingreso de stock queda auditado como movimiento de compra (+10).
    await page.goto('/inventario')
    await page.getByTestId('inventory-tab-movements').click()
    const row = page.getByTestId('stock-movement-row').filter({ hasText: INSUMO }).first()
    await expect(row).toContainText('Compra')
    await expect(row.getByTestId('stock-movement-qty')).toContainText('+10')

    // La compra aparece en el historial.
    await page.goto('/compras')
    await expect(page.getByTestId('purchase-row').filter({ hasText: PROVEEDOR }).first()).toBeVisible()
  })

  test('compra en efectivo NO toca la caja (con turno abierto, sin egreso automático)', async ({ page }) => {
    // Regla de raíz: la compra NUNCA genera un egreso de caja automático. El
    // efectivo que sale del cajón se registra como egreso MANUAL. Se prueba con
    // turno ABIERTO (el escenario que antes creaba el egreso indebido).
    await loginAsOwner(page)
    await page.goto('/ventas')
    await openShiftIfClosed(page, 100000)

    await registerPurchase(page, { supplier: PROVEEDOR, method: 'cash', product: INSUMO, qty: 5, cost: 2000 })
    await expect(page.getByTestId('new-invoice-modal')).toHaveCount(0)
    // Toast de éxito normal; NADA de "Egreso de caja registrado".
    await expect(page.getByText(/Compra registrada y stock actualizado/)).toBeVisible()
    await expect(page.getByText(/Egreso de caja registrado/)).toHaveCount(0)

    // Y en los movimientos del turno NO aparece ningún egreso de la compra.
    await page.getByRole('button', { name: 'Movimientos' }).click()
    await expect(page.getByText(`Compra a proveedor ${PROVEEDOR}`)).toHaveCount(0)
  })

  test('compra en efectivo SIN turno: se registra sin advertencia de caja', async ({ page }) => {
    // Sin turno la compra ya no advierte nada de caja (nunca la tocó).
    await loginAsOwner(page)
    await page.goto('/ventas')
    await closeShiftIfOpen(page)

    await registerPurchase(page, { supplier: PROVEEDOR, method: 'cash', product: INSUMO, qty: 3, cost: 1000 })

    await expect(page.getByTestId('new-invoice-modal')).toHaveCount(0)
    await expect(page.getByText(/Compra registrada y stock actualizado/)).toBeVisible()
    await expect(page.getByText(/no se registró en caja/)).toHaveCount(0)
  })

  test('gating: el cajero NO ve Compras', async ({ page }) => {
    await loginAsCashier(page)
    // No está en el sidebar.
    await expect(page.getByRole('link', { name: 'Compras' })).toHaveCount(0)
    // Y por URL es redirigido a /ventas.
    await page.goto('/compras')
    await expect(page).toHaveURL(/\/ventas/, { timeout: 15_000 })
  })

  test('limpieza: cerrar turno, desactivar insumo, proveedor y categoría', async ({ page }) => {
    page.on('dialog', (d) => d.accept())
    await loginAsOwner(page)

    await page.goto('/ventas')
    await closeShiftIfOpen(page)

    // Desactivar el proveedor (soft; admite tener facturas).
    await page.goto('/compras')
    await page.getByTestId('purchases-tab-suppliers').click()
    await page.getByTestId('supplier-row').filter({ hasText: PROVEEDOR }).getByTestId('supplier-deactivate').click()
    await expect(page.getByTestId('supplier-row').filter({ hasText: PROVEEDOR })).toHaveCount(0)

    // Desactivar el insumo.
    await page.goto('/productos')
    await page.getByPlaceholder('Buscar producto...').fill(INSUMO)
    await page.getByTitle('Desactivar', { exact: true }).first().click()
    await page.getByRole('button', { name: 'Sí, desactivar' }).click()
    await expect(page.getByText(/Sin resultados/)).toBeVisible()

    // Desactivar la categoría.
    await page.getByRole('button', { name: new RegExp(CAT) }).getByTitle('Editar categoría').click()
    await page.getByRole('switch').click()
    await page.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(page.getByRole('button', { name: new RegExp(CAT) })).toHaveCount(0)
  })
})
