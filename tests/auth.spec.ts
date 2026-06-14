import { test, expect } from '@playwright/test'
import { loginAsOwner, ownerCreds } from './helpers/auth'

test.describe('Auth', () => {
  test('login con credenciales incorrectas muestra error', async ({ page }) => {
    const { email } = ownerCreds()
    await page.goto('/login')
    await page.locator('input[autocomplete="email"]').fill(email)
    await page.locator('input[autocomplete="current-password"]').fill('password-incorrecto-zzz')
    await page.getByRole('button', { name: 'Ingresar' }).click()

    await expect(page.getByText('Credenciales incorrectas')).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
  })

  test('login correcto redirige a /ventas', async ({ page }) => {
    await loginAsOwner(page)
    await expect(page).toHaveURL(/\/ventas/)
  })

  test('ruta protegida sin sesión redirige a /login', async ({ page }) => {
    await page.goto('/productos')
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 })
  })

  test('logout vuelve a /login', async ({ page }) => {
    await loginAsOwner(page)
    await page.getByRole('button', { name: 'Cerrar sesión' }).click()
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 })
  })
})
