import { test, expect } from '@playwright/test'
import { loginAsOwner } from './helpers/auth'

const SUFFIX = Date.now().toString().slice(-6)
const ROLE = `Rol E2E ${SUFFIX}`

// Secciones visibles para owner (6 base + Sedes + Roles).
const SECTIONS = [
  'Restaurante', 'Usuarios', 'Sedes', 'Roles y permisos',
  'Caja', 'Cocina', 'Delivery', 'Notificaciones',
]

test.describe('Configuración', () => {
  test('cada sección carga sin error', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/configuracion')

    for (const label of SECTIONS) {
      await page.getByRole('button', { name: label }).click()
      // El SectionTitle (h2) de la sección debe renderizar.
      await expect(page.getByRole('heading', { name: label })).toBeVisible()
    }
  })

  test('Sedes y Roles son visibles para owner', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/configuracion')
    await expect(page.getByRole('button', { name: 'Sedes' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Roles y permisos' })).toBeVisible()
  })

  test('editar el nombre del restaurante se guarda (toast)', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/configuracion')

    const nameInput = page.getByTestId('config-restaurant-name')
    const original = await nameInput.inputValue()

    // Cambia a un valor temporal y guarda.
    await nameInput.fill(`${original} ·`)
    await page.getByRole('button', { name: 'Guardar' }).click()
    await expect(page.getByText('Cambios guardados')).toBeVisible()

    // Restaura el valor original (no dejar datos sucios).
    await nameInput.fill(original)
    await page.getByRole('button', { name: 'Guardar' }).click()
    await expect(page.getByText('Cambios guardados')).toBeVisible()
  })

  test.describe.serial('Roles custom', () => {
    test('crear un rol custom aparece en la lista', async ({ page }) => {
      await loginAsOwner(page)
      await page.goto('/configuracion')
      await page.getByRole('button', { name: 'Roles y permisos' }).click()

      await page.getByRole('button', { name: 'Crear rol' }).click()
      await page.getByPlaceholder('Ej: Supervisor').fill(ROLE)
      await page.getByRole('checkbox').first().check() // al menos un permiso
      await page.getByRole('button', { name: 'Crear rol' }).click()

      await expect(page.getByText(ROLE)).toBeVisible()
    })

    test('limpieza: eliminar el rol creado', async ({ page }) => {
      page.on('dialog', (dialog) => dialog.accept())
      await loginAsOwner(page)
      await page.goto('/configuracion')
      await page.getByRole('button', { name: 'Roles y permisos' }).click()

      const row = page.locator('div').filter({ hasText: ROLE }).filter({ has: page.locator('button') }).last()
      await row.getByTitle('Eliminar').click()
      await expect(page.getByText(ROLE)).toHaveCount(0)
    })
  })
})
