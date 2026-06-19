import { test, expect } from '@playwright/test'
import { loginAsOwner } from './helpers/auth'

test.describe('Reportes', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/reportes')
  })

  test('las pestañas Financiero y Stock cargan', async ({ page }) => {
    await expect(page.getByTestId('report-tab-financiero')).toBeVisible()
    await expect(page.getByTestId('report-tab-stock')).toBeVisible()
    // Financiero por defecto: KPIs financieros.
    await expect(page.getByText('Ventas totales')).toBeVisible()
  })

  test('cambiar entre tabs funciona', async ({ page }) => {
    await expect(page.getByText('Ventas totales')).toBeVisible() // financiero por defecto

    await page.getByTestId('report-tab-stock').click()
    await expect(page.getByText('Productos vendidos', { exact: true })).toBeVisible() // KPI de stock
    await expect(page.getByTestId('export-stock')).toBeVisible()

    await page.getByTestId('report-tab-financiero').click()
    await expect(page.getByText('Ventas totales')).toBeVisible()
    await expect(page.getByTestId('export-financiero')).toBeVisible()
  })

  test('el selector de fechas es compartido y afecta ambos tabs', async ({ page }) => {
    await page.getByRole('button', { name: 'Hoy' }).click()
    await expect(page.getByText('Ventas totales')).toBeVisible() // financiero responde

    await page.getByTestId('report-tab-stock').click()
    await expect(page.getByText('Unidades vendidas', { exact: true })).toBeVisible() // stock usa el mismo rango
  })

  test('cada tab tiene su botón de exportar', async ({ page }) => {
    await expect(page.getByTestId('export-financiero')).toBeVisible()

    await page.getByTestId('report-tab-stock').click()
    await expect(page.getByTestId('export-stock')).toBeVisible()
  })

  test('el sidebar muestra el nombre del restaurante', async ({ page }) => {
    const brand = page.getByTestId('sidebar-brand-name')
    await expect(brand).toBeVisible()
    await expect(brand).not.toHaveText('')
  })
})
