import { test, expect } from '@playwright/test'
import { loginAsOwner } from './helpers/auth'

// Sufijo único por corrida → datos idempotentes y aislados.
const SUFFIX = Date.now().toString().slice(-6)
const CAT = `E2E Cat ${SUFFIX}`
const PROD = `E2E Prod ${SUFFIX}`

// Serie: cada test construye sobre el anterior (categoría → producto → ...).
// El último limpia. workers:1 garantiza el orden.
test.describe.serial('Productos', () => {
  test('crear una categoría aparece en los tabs', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/productos')

    await page.getByRole('button', { name: 'Nueva categoría' }).click()
    await page.getByPlaceholder('Ej: Cocteles clásicos').fill(CAT)
    await page.getByRole('button', { name: 'Crear categoría' }).click()

    await expect(page.getByRole('button', { name: new RegExp(CAT) })).toBeVisible()
  })

  test('crear un producto en esa categoría aparece en el grid', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/productos')

    await page.getByRole('button', { name: 'Nuevo producto' }).click()
    await page.getByPlaceholder('Ej: Mojito Cubano').fill(PROD)
    await page.getByPlaceholder('0').fill('12000')
    await page.getByTestId('product-category-select').selectOption({ label: CAT })
    await page.getByRole('button', { name: 'Crear producto' }).click()

    await expect(page.getByText(PROD)).toBeVisible()
  })

  test('editar el precio del producto se refleja', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/productos')
    await page.getByPlaceholder('Buscar producto...').fill(PROD)

    // Botón editar (título "Editar") de la card del producto.
    await page.getByTitle('Editar', { exact: true }).first().click()
    const price = page.getByPlaceholder('0')
    await price.fill('')
    await price.fill('15000')
    await page.getByRole('button', { name: 'Guardar cambios' }).click()

    await expect(page.getByText('$ 15.000')).toBeVisible()
  })

  test('la búsqueda filtra productos por nombre', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/productos')

    await page.getByPlaceholder('Buscar producto...').fill(PROD)
    await expect(page.getByText(PROD)).toBeVisible()

    await page.getByPlaceholder('Buscar producto...').fill('zzz-no-existe-zzz')
    await expect(page.getByText(/Sin resultados/)).toBeVisible()
  })

  test('desactivar producto pide confirmación', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/productos')
    await page.getByPlaceholder('Buscar producto...').fill(PROD)

    await page.getByTitle('Desactivar', { exact: true }).first().click()
    // Confirmación inline.
    await expect(page.getByRole('button', { name: 'Sí, desactivar' })).toBeVisible()
    await page.getByRole('button', { name: 'Sí, desactivar' }).click()

    // ProductsPage oculta los inactivos → con el filtro por nombre queda vacío.
    await expect(page.getByText(/Sin resultados/)).toBeVisible()
  })

  test('limpieza: desactivar la categoría creada', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/productos')

    // Abrir el editor de la categoría (lápiz dentro del tab).
    await page.getByRole('button', { name: new RegExp(CAT) }).getByTitle('Editar categoría').click()
    // Toggle "Categoría activa" → desactivar y guardar.
    await page.getByRole('switch').click()
    await page.getByRole('button', { name: 'Guardar cambios' }).click()

    await expect(page.getByRole('button', { name: new RegExp(CAT) })).toHaveCount(0)
  })
})
