import { test, expect } from '@playwright/test'
import { loginAsOwner } from './helpers/auth'

// Sufijo único por corrida → datos idempotentes y aislados.
const SUFFIX = Date.now().toString().slice(-6)
const CAT = `E2E ExtCat ${SUFFIX}`
const PROD = `E2E ExtProd ${SUFFIX}`
const EXTRA_SIMPLE = `E2E Topping ${SUFFIX}`
const EXTRA_LINKED = `E2E Adición ${SUFFIX}`

// Serie: cada test construye sobre el anterior (producto → extras → asignación
// → desactivación → limpieza). workers:1 garantiza el orden.
test.describe.serial('Extras', () => {
  test('setup: crear categoría y producto base', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/productos')

    await page.getByRole('button', { name: 'Nueva categoría' }).click()
    await page.getByPlaceholder('Ej: Cocteles clásicos').fill(CAT)
    await page.getByRole('button', { name: 'Crear categoría' }).click()
    await expect(page.getByRole('button', { name: new RegExp(CAT) })).toBeVisible()

    await page.getByRole('button', { name: 'Nuevo producto' }).click()
    await page.getByPlaceholder('Ej: Mojito Cubano').fill(PROD)
    await page.getByPlaceholder('0').fill('12000')
    await page.getByTestId('product-category-select').selectOption({ label: CAT })
    await page.getByRole('button', { name: 'Crear producto' }).click()
    await expect(page.getByText(PROD)).toBeVisible()
  })

  test('crear un extra simple (sin stock) en el catálogo', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/configuracion')
    await page.getByRole('button', { name: 'Extras', exact: true }).click()

    await page.getByTestId('extra-new').click()
    await page.getByTestId('extra-name').fill(EXTRA_SIMPLE)
    await page.getByTestId('extra-price').fill('2000')
    await page.getByTestId('extra-save').click()

    const row = page.getByTestId('extra-row').filter({ hasText: EXTRA_SIMPLE })
    await expect(row).toBeVisible()
    await expect(row).toContainText('Activo')
  })

  test('crear un extra vinculado a un producto', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/configuracion')
    await page.getByRole('button', { name: 'Extras', exact: true }).click()

    await page.getByTestId('extra-new').click()
    await page.getByTestId('extra-name').fill(EXTRA_LINKED)
    await page.getByTestId('extra-price').fill('3500')
    // Activar "descuenta inventario" y elegir el producto vinculado.
    await page.getByTestId('extra-link-toggle').click()
    await page.getByTestId('extra-link-product').selectOption({ label: PROD })
    await page.getByTestId('extra-save').click()

    const row = page.getByTestId('extra-row').filter({ hasText: EXTRA_LINKED })
    await expect(row).toBeVisible()
    // Muestra de qué producto descuenta.
    await expect(row).toContainText(PROD)
  })

  test('asignar extras a un producto y que persistan', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/productos')
    await page.getByPlaceholder('Buscar producto...').fill(PROD)

    await page.getByTitle('Editar', { exact: true }).first().click()

    // Marcar el extra simple en la ficha del producto.
    const option = page.getByTestId('product-extra-option').filter({ hasText: EXTRA_SIMPLE })
    await option.click()
    await page.getByRole('button', { name: 'Guardar cambios' }).click()

    // Reabrir y verificar que quedó seleccionado (cargado desde BD).
    await page.getByPlaceholder('Buscar producto...').fill(PROD)
    await page.getByTitle('Editar', { exact: true }).first().click()
    const reopened = page.getByTestId('product-extra-option').filter({ hasText: EXTRA_SIMPLE })
    // El fondo verde (#ecfdf5) indica selección activa.
    await expect(reopened).toHaveCSS('background-color', 'rgb(236, 253, 245)')
  })

  test('desactivar un extra lo marca como inactivo', async ({ page }) => {
    // El catálogo confirma con window.confirm antes de desactivar (no elimina).
    page.on('dialog', (dialog) => dialog.accept())
    await loginAsOwner(page)
    await page.goto('/configuracion')
    await page.getByRole('button', { name: 'Extras', exact: true }).click()

    const row = page.getByTestId('extra-row').filter({ hasText: EXTRA_SIMPLE })
    await row.getByTitle('Desactivar').click()
    await expect(row).toContainText('Inactivo')
  })

  test('limpieza: desactivar extras, producto y categoría', async ({ page }) => {
    page.on('dialog', (dialog) => dialog.accept())
    await loginAsOwner(page)

    // Desactivar el extra vinculado (el simple ya quedó inactivo).
    await page.goto('/configuracion')
    await page.getByRole('button', { name: 'Extras', exact: true }).click()
    const linkedRow = page.getByTestId('extra-row').filter({ hasText: EXTRA_LINKED })
    await linkedRow.getByTitle('Desactivar').click()
    await expect(linkedRow).toContainText('Inactivo')

    // Desactivar el producto.
    await page.goto('/productos')
    await page.getByPlaceholder('Buscar producto...').fill(PROD)
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
