import { test, expect } from '@playwright/test'
import { loginAsOwner } from './helpers/auth'

test.describe('Delivery — kanban', () => {
  test('muestra exactamente 3 columnas (Nuevos, En camino, Entregados)', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/delivery')

    await expect(page.getByText('Nuevos', { exact: true })).toBeVisible()
    await expect(page.getByText('En camino', { exact: true })).toBeVisible()
    await expect(page.getByText('Entregados', { exact: true })).toBeVisible()

    // Las columnas del flujo viejo de 5 ya no deben existir.
    await expect(page.getByText('Aceptados', { exact: true })).toHaveCount(0)
    await expect(page.getByText('En preparación', { exact: true })).toHaveCount(0)
  })

  test('no hay scroll horizontal de página', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/delivery')
    await expect(page.getByText('Nuevos', { exact: true })).toBeVisible()

    const noHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    )
    expect(noHorizontalScroll).toBeTruthy()
  })
})
