import { test, expect } from '@playwright/test'
import { loginAsOwner } from './helpers/auth'

const SUFFIX = Date.now().toString().slice(-6)
const TABLE = `Mesa E2E ${SUFFIX}`
const WAITER = `Valentina ${SUFFIX}`

test.describe.serial('Mesas', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/mesas')
  })

  test('ver el mapa de mesas', async ({ page }) => {
    await expect(page.getByText('Mapa del salón')).toBeVisible()
  })

  test('crear una mesa (config admin)', async ({ page }) => {
    await page.getByRole('button', { name: 'Configurar' }).click()
    await page.getByPlaceholder('Mesa 1').fill(TABLE)
    await page.getByRole('button', { name: 'Crear mesa' }).click()
    // Aparece en la lista del modal de configuración.
    await expect(page.getByText(TABLE)).toBeVisible()
  })

  test('abrir una mesa con responsable lo muestra en la card', async ({ page }) => {
    await page.getByRole('button', { name: new RegExp(TABLE) }).click()
    // Modal de apertura.
    await page.getByPlaceholder('¿Quién atiende la mesa?').fill(WAITER)
    await page.getByRole('button', { name: 'Abrir mesa' }).click()
    // La card muestra "Atiende: <responsable>".
    await expect(page.getByText(WAITER)).toBeVisible()
  })

  test('cerrar mesa sin consumo libera la mesa', async ({ page }) => {
    // Aceptar el window.confirm de cierre.
    page.on('dialog', (dialog) => dialog.accept())

    await page.getByRole('button', { name: new RegExp(TABLE) }).click()
    // Panel lateral de la mesa ocupada → "Cerrar mesa" (sin ítems).
    await page.getByRole('button', { name: 'Cerrar mesa' }).click()
    // El panel se cierra (mesa liberada).
    await expect(page.getByRole('button', { name: 'Cerrar mesa' })).toHaveCount(0)
  })

  test('limpieza: eliminar la mesa creada', async ({ page }) => {
    await page.getByRole('button', { name: 'Configurar' }).click()
    // Fila de la mesa en el listado del modal → botón eliminar (último botón de la fila).
    const row = page.locator('div').filter({ hasText: TABLE }).filter({ has: page.locator('button') }).last()
    await row.getByRole('button').last().click()
    await expect(page.getByText(TABLE)).toHaveCount(0)
  })
})
