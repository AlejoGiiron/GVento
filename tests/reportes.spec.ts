import { test, expect } from '@playwright/test'
import { loginAsOwner } from './helpers/auth'

test.describe('Reportes', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/reportes')
  })

  test('la página carga con los KPIs', async ({ page }) => {
    await expect(page.getByText('Ventas totales')).toBeVisible()
    await expect(page.getByText('Órdenes', { exact: true })).toBeVisible()
    await expect(page.getByText('Ticket promedio')).toBeVisible()
    await expect(page.getByText('Unidades vendidas')).toBeVisible()
  })

  test('cambiar rango de fechas con atajos', async ({ page }) => {
    await page.getByRole('button', { name: 'Hoy' }).click()
    await page.getByRole('button', { name: 'Esta semana' }).click()
    // La página sigue respondiendo con los KPIs tras cambiar el rango.
    await expect(page.getByText('Ventas totales')).toBeVisible()
  })

  test('las gráficas se renderizan (o estado vacío)', async ({ page }) => {
    await page.getByRole('button', { name: 'Este mes' }).click()
    const empty = page.getByText('Sin ventas en el período')
    if (await empty.isVisible()) {
      await expect(empty).toBeVisible()
    } else {
      await expect(page.locator('svg.recharts-surface').first()).toBeVisible()
    }
  })

  test('el botón Exportar Excel existe y es clickeable', async ({ page }) => {
    const btn = page.getByRole('button', { name: /Exportar Excel/ })
    await expect(btn).toBeVisible()
    // Con datos (botón habilitado) el clic dispara la descarga del .xlsx.
    if (await btn.isEnabled()) {
      const download = page.waitForEvent('download')
      await btn.click()
      expect((await download).suggestedFilename()).toContain('.xlsx')
    }
  })
})
