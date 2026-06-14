import { test, expect } from '@playwright/test'
import { loginAsOwner, loginAsCashier } from './helpers/auth'

// Items del sidebar (AppLayout NAV_ITEMS).
const ALL_NAV = ['Ventas', 'Mesas', 'Cocina', 'Delivery', 'Productos', 'Reportes', 'Configuración']
const CASHIER_HIDDEN = ['Productos', 'Reportes', 'Configuración']

test.describe('RBAC — gating de permisos', () => {
  test('owner ve todos los items del sidebar', async ({ page }) => {
    await loginAsOwner(page)
    for (const label of ALL_NAV) {
      await expect(page.getByRole('link', { name: label })).toBeVisible()
    }
  })

  test('cajero NO ve Productos, Reportes ni Configuración', async ({ page }) => {
    await loginAsCashier(page)
    // Ítems que sí debe ver
    await expect(page.getByRole('link', { name: 'Ventas' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Mesas' })).toBeVisible()
    // Ítems ocultos por permiso
    for (const label of CASHIER_HIDDEN) {
      await expect(page.getByRole('link', { name: label })).toHaveCount(0)
    }
  })

  test('cajero SÍ ve Ventas, Mesas y Delivery', async ({ page }) => {
    await loginAsCashier(page)
    // Delivery es visible porque el cajero tiene delivery.gestionar.
    await expect(page.getByRole('link', { name: 'Ventas' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Mesas' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Delivery' })).toBeVisible()
  })

  test('cajero que navega a /configuracion por URL es redirigido a /ventas', async ({ page }) => {
    await loginAsCashier(page)
    await page.goto('/configuracion')
    await expect(page).toHaveURL(/\/ventas/, { timeout: 15_000 })
  })

  test('owner que entra a /configuracion ve la página', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/configuracion')
    await expect(page).toHaveURL(/\/configuracion/)
    await expect(page.getByText('Ajustes', { exact: true })).toBeVisible()
  })
})
