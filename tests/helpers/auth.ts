import { type Page, expect } from '@playwright/test'

export type Creds = { email: string; password: string }

function readCreds(emailVar: string, pwdVar: string): Creds {
  const email = process.env[emailVar]
  const password = process.env[pwdVar]
  if (!email || !password) {
    throw new Error(
      `Faltan credenciales de prueba: define ${emailVar} y ${pwdVar} en .env.test ` +
        `(ver .env.test.example).`,
    )
  }
  return { email, password }
}

export const ownerCreds = () => readCreds('E2E_OWNER_EMAIL', 'E2E_OWNER_PASSWORD')
export const cashierCreds = () => readCreds('E2E_CASHIER_EMAIL', 'E2E_CASHIER_PASSWORD')

/**
 * Hace login en /login con las credenciales dadas y espera la redirección
 * a /ventas (que confirma sesión válida). Selectores estables: autocomplete
 * de los inputs y el rol/nombre del botón "Ingresar".
 */
export async function login(page: Page, { email, password }: Creds): Promise<void> {
  await page.goto('/login')
  await page.locator('input[autocomplete="email"]').fill(email)
  await page.locator('input[autocomplete="current-password"]').fill(password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page).toHaveURL(/\/ventas/, { timeout: 15_000 })
}

export const loginAsOwner = (page: Page) => login(page, ownerCreds())
export const loginAsCashier = (page: Page) => login(page, cashierCreds())
