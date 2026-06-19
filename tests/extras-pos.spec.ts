import { test, expect, type Page } from '@playwright/test'
import { loginAsOwner } from './helpers/auth'
import { openShiftIfClosed, closeShiftIfOpen } from './helpers/shift'

// "$ 12.000" → 12000
const parseCOP = (text: string): number => Number(text.replace(/[^\d]/g, ''))

const SUFFIX = Date.now().toString().slice(-6)
const CAT = `E2E ExP ${SUFFIX}`
const P_STOCK = `E2E Insumo ${SUFFIX}`   // producto con inventario (lo descuenta el extra)
const P_BASE = `E2E ConExtras ${SUFFIX}` // producto al que se le asignan extras
const P_SIMPLE = `E2E Simple ${SUFFIX}`  // producto SIN extras
const E_FREE = `E2E ExtraLibre ${SUFFIX}`    // extra sin vínculo de stock
const E_LINKED = `E2E ExtraInsumo ${SUFFIX}` // extra vinculado a P_STOCK

// ── Helpers ───────────────────────────────────────────────────────

async function createProduct(page: Page, name: string, price: string, opts?: { stock?: string }) {
  await page.goto('/productos')
  await page.getByRole('button', { name: 'Nuevo producto' }).click()
  await page.getByPlaceholder('Ej: Mojito Cubano').fill(name)
  await page.getByPlaceholder('0').first().fill(price)
  await page.locator('select').selectOption({ label: CAT })
  if (opts?.stock) {
    await page.getByRole('switch').click() // Control de inventario
    await page.getByRole('spinbutton').fill(opts.stock)
  }
  await page.getByRole('button', { name: 'Crear producto' }).click()
  await expect(page.getByText(name)).toBeVisible()
}

async function createExtra(page: Page, name: string, price: string, linkedProduct?: string) {
  await page.goto('/configuracion')
  await page.getByRole('button', { name: 'Extras', exact: true }).click()
  await page.getByTestId('extra-new').click()
  await page.getByTestId('extra-name').fill(name)
  await page.getByTestId('extra-price').fill(price)
  if (linkedProduct) {
    await page.getByTestId('extra-link-toggle').click()
    await page.getByTestId('extra-link-product').selectOption({ label: linkedProduct })
  }
  await page.getByTestId('extra-save').click()
  await expect(page.getByTestId('extra-row').filter({ hasText: name })).toBeVisible()
}

// Lee el stock declarado de un producto abriendo su ficha.
async function readStock(page: Page, productName: string): Promise<number> {
  await page.goto('/productos')
  await page.getByPlaceholder('Buscar producto...').fill(productName)
  await page.getByTitle('Editar', { exact: true }).first().click()
  const value = await page.getByRole('spinbutton').inputValue()
  await page.getByRole('button', { name: 'Cancelar' }).click()
  return Number(value)
}

// Fija el stock declarado de un producto.
async function setStock(page: Page, productName: string, value: string) {
  await page.goto('/productos')
  await page.getByPlaceholder('Buscar producto...').fill(productName)
  await page.getByTitle('Editar', { exact: true }).first().click()
  await page.getByRole('spinbutton').fill(value)
  await page.getByRole('button', { name: 'Guardar cambios' }).click()
  await expect(page.getByText(productName)).toBeVisible()
}

// Vende P_BASE con `extraName` en cantidad `extraQty` por unidad. Deja el turno abierto.
async function sellBaseWithExtra(page: Page, extraName: string, extraQty: number) {
  await page.goto('/ventas')
  await openShiftIfClosed(page, 0)
  await page.getByPlaceholder('Buscar producto...').fill(P_BASE)
  await page.getByTestId('product-card').first().click()

  // Modal de configuración de extras.
  await expect(page.getByTestId('item-config-modal')).toBeVisible()
  const row = page.getByTestId('item-config-extra').filter({ hasText: extraName })
  for (let i = 0; i < extraQty; i++) await row.getByTestId('extra-qty-inc').click()
  await page.getByTestId('item-config-confirm').click()

  // Cobro en efectivo.
  await page.getByRole('button', { name: 'Cobrar' }).click()
  await page.getByText('Efectivo', { exact: true }).click()
  await page.getByRole('button', { name: /Continuar/ }).click()
  await page.getByTestId('checkout-received').fill('200000')
  await page.getByRole('button', { name: /Confirmar cobro/ }).click()
  await expect(page.getByText('¡Cobro exitoso!')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Nueva venta' }).click()
}

// ── Suite ─────────────────────────────────────────────────────────

test.describe.serial('Extras en POS', () => {
  test('setup: categoría, productos y extras', async ({ page }) => {
    await loginAsOwner(page)

    // Categoría.
    await page.goto('/productos')
    await page.getByRole('button', { name: 'Nueva categoría' }).click()
    await page.getByPlaceholder('Ej: Cocteles clásicos').fill(CAT)
    await page.getByRole('button', { name: 'Crear categoría' }).click()
    await expect(page.getByRole('button', { name: new RegExp(CAT) })).toBeVisible()

    // Productos (antes que los extras).
    await createProduct(page, P_STOCK, '5000', { stock: '50' })
    await createProduct(page, P_BASE, '10000')
    await createProduct(page, P_SIMPLE, '8000')

    // Extras: uno libre y uno vinculado al insumo con stock.
    await createExtra(page, E_FREE, '2000')
    await createExtra(page, E_LINKED, '3000', P_STOCK)

    // Asignar ambos extras a P_BASE.
    await page.goto('/productos')
    await page.getByPlaceholder('Buscar producto...').fill(P_BASE)
    await page.getByTitle('Editar', { exact: true }).first().click()
    await page.getByTestId('product-extra-option').filter({ hasText: E_FREE }).click()
    await page.getByTestId('product-extra-option').filter({ hasText: E_LINKED }).click()
    await page.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(page.getByText(P_BASE)).toBeVisible()
  })

  test('agregar producto con extra → el total incluye el extra', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/ventas')
    await page.getByPlaceholder('Buscar producto...').fill(P_BASE)
    await page.getByTestId('product-card').first().click()

    await expect(page.getByTestId('item-config-modal')).toBeVisible()
    await page.getByTestId('item-config-extra').filter({ hasText: E_FREE })
      .getByTestId('extra-qty-inc').click()
    await page.getByTestId('item-config-confirm').click()

    // 10.000 producto + 2.000 extra = 12.000
    expect(parseCOP(await page.getByTestId('cart-total').innerText())).toBe(12000)
  })

  test('extra con cantidad > 1 → el precio se multiplica', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/ventas')
    await page.getByPlaceholder('Buscar producto...').fill(P_BASE)
    await page.getByTestId('product-card').first().click()

    const inc = page.getByTestId('item-config-extra').filter({ hasText: E_FREE }).getByTestId('extra-qty-inc')
    await inc.click()
    await inc.click() // qty 2

    // Subtotal por unidad en el modal: 10.000 + 2×2.000 = 14.000
    expect(parseCOP(await page.getByTestId('item-config-subtotal').innerText())).toBe(14000)

    await page.getByTestId('item-config-confirm').click()
    expect(parseCOP(await page.getByTestId('cart-total').innerText())).toBe(14000)
  })

  test('producto sin extras → se agrega directo, sin modal', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/ventas')
    await page.getByPlaceholder('Buscar producto...').fill(P_SIMPLE)
    await page.getByTestId('product-card').first().click()

    await expect(page.getByTestId('item-config-modal')).toHaveCount(0)
    expect(parseCOP(await page.getByTestId('cart-total').innerText())).toBe(8000)
  })

  test('vender extra vinculado a stock → baja el inventario del producto vinculado', async ({ page }) => {
    await loginAsOwner(page)
    const before = await readStock(page, P_STOCK)
    await sellBaseWithExtra(page, E_LINKED, 1)
    const after = await readStock(page, P_STOCK)
    expect(after).toBe(before - 1)
  })

  test('vender extra sin vínculo → no toca el inventario', async ({ page }) => {
    await loginAsOwner(page)
    const before = await readStock(page, P_STOCK)
    await sellBaseWithExtra(page, E_FREE, 1)
    const after = await readStock(page, P_STOCK)
    expect(after).toBe(before)
  })

  test('vender por encima del stock → queda NEGATIVO con alerta de sobreventa', async ({ page }) => {
    await loginAsOwner(page)

    // Stock del insumo en 1, luego vender el extra vinculado en cantidad 3.
    await setStock(page, P_STOCK, '1')
    await sellBaseWithExtra(page, E_LINKED, 3) // 1 − 3 = −2

    // El stock queda NEGATIVO (no en 0).
    expect(await readStock(page, P_STOCK)).toBe(-2)

    // Alerta de sobreventa en el grid (ProductCard).
    await page.goto('/productos')
    await page.getByPlaceholder('Buscar producto...').fill(P_STOCK)
    await expect(page.getByTestId('oversold-alert')).toBeVisible()
    await expect(page.getByTestId('oversold-alert')).toContainText('Sobreventa: reponer')
    await expect(page.getByTestId('stock-badge')).toContainText('-2')

    // Y en el modal de edición del producto.
    await page.getByTitle('Editar', { exact: true }).first().click()
    await expect(page.getByTestId('oversold-alert')).toBeVisible()
  })

  test('limpieza: cerrar turno, desactivar extras, productos y categoría', async ({ page }) => {
    page.on('dialog', (d) => d.accept())
    await loginAsOwner(page)

    // Cerrar el turno abierto por las ventas de prueba.
    await page.goto('/ventas')
    await closeShiftIfOpen(page)

    // Desactivar extras.
    await page.goto('/configuracion')
    await page.getByRole('button', { name: 'Extras', exact: true }).click()
    for (const name of [E_FREE, E_LINKED]) {
      const row = page.getByTestId('extra-row').filter({ hasText: name })
      await row.getByTitle('Desactivar').click()
      await expect(row).toContainText('Inactivo')
    }

    // Desactivar productos.
    for (const name of [P_STOCK, P_BASE, P_SIMPLE]) {
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
