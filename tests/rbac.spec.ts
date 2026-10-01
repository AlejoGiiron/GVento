import { test, expect } from '@playwright/test'
import { loginAsOwner, loginAsCashier } from './helpers/auth'

// Items del sidebar (AppLayout NAV_GROUPS), los 11 reales.
// Los grupos arrancan expandidos por defecto → los links son visibles sin abrir nada.
const ALL_NAV = [
  'Ventas', 'Mesas', 'Delivery', 'Cocina',
  'Productos', 'Inventario', 'Compras',
  'Fiado', 'Historial',
  'Reportes', 'Configuración',
]
const CASHIER_HIDDEN = ['Productos', 'Reportes', 'Configuración']

test.describe('RBAC — gating de permisos', () => {
  test('owner ve todos los items del sidebar', async ({ page }) => {
    await loginAsOwner(page)
    for (const label of ALL_NAV) {
      await expect(page.getByRole('link', { name: label })).toBeVisible()
    }
  })

  test('owner ve los 4 grupos del sidebar', async ({ page }) => {
    await loginAsOwner(page)
    for (const id of ['operacion', 'catalogo', 'clientes', 'admin']) {
      await expect(page.getByTestId(`group-header-${id}`)).toBeVisible()
    }
  })

  test('cajero NO ve Productos, Reportes ni Configuración', async ({ page }) => {
    await loginAsCashier(page)
    // Ítems que sí debe ver
    await expect(page.getByRole('link', { name: 'Ventas' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Mesas' })).toBeVisible()
    // Señal POSITIVA de "permisos cargados": un enlace CON permiso que este rol
    // SÍ tiene (Fiado, fiado.gestionar). Mientras el rol carga, can() da false y TODO enlace con
    // permiso está ausente — las ausencias de abajo pasaban por la carga. Ventas y
    // Mesas no sirven de señal: no tienen permiso, se ven siempre (R3, 2026-09-30).
    await expect(page.getByRole('link', { name: 'Fiado' })).toBeVisible({ timeout: 15_000 })
    // Ítems ocultos por permiso
    for (const label of CASHIER_HIDDEN) {
      await expect(page.getByRole('link', { name: label })).toHaveCount(0)
    }
  })

  test('cajero: grupos completos sin permiso desaparecen; los que tienen ≥1 item se ven', async ({ page }) => {
    await loginAsCashier(page)
    // Primero lo POSITIVO (antes venía al final): con los permisos ya cargados,
    // las ausencias de abajo significan algo.
    await expect(page.getByTestId('group-header-clientes')).toBeVisible({ timeout: 15_000 })
    // Sin productos.editar ni compras.gestionar → "Catálogo e inventario" no aparece.
    await expect(page.getByTestId('group-header-catalogo')).toHaveCount(0)
    // Sin reportes.financiero ni config.acceder → "Análisis y admin" no aparece.
    await expect(page.getByTestId('group-header-admin')).toHaveCount(0)
    // Con fiado.gestionar → "Clientes y cobros" SÍ aparece, con al menos Fiado dentro.
    await expect(page.getByTestId('group-header-clientes')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Fiado' })).toBeVisible()
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
