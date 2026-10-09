import { test, expect, type Page } from '@playwright/test'
import { ownerCreds } from './helpers/auth'

// ============================================================================
// Login: "Credenciales incorrectas" SOLO cuando el servidor dice que lo son.
// Antes todo error de inicio de sesión mostraba ese mensaje: con el servidor caído
// (medido el 2026-10-08: un 504 de la API local en plena suite), el cajero leía
// que su clave estaba mal. Clasificación en src/lib/falloLogin.ts.
// ============================================================================

const SIN_CONEXION = 'No hay conexión con el servidor.'
const REVISA_WIFI = 'Revisa el wifi e intenta de nuevo.'

async function intentar(page: Page, password = ownerCreds().password) {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill(ownerCreds().email)
  await page.locator('input[autocomplete="current-password"]').fill(password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
}

test('el servidor responde 504 → "No hay conexión con el servidor", NO "Credenciales incorrectas"', async ({ page }) => {
  await page.route('**/auth/v1/token**', (r) => r.fulfill({ status: 504, contentType: 'text/html', body: '<html><body>Gateway Timeout</body></html>' }))
  await intentar(page)
  const error = page.getByTestId('login-error')
  await expect(error).toHaveAttribute('data-tipo', 'sin-conexion')
  await expect(error).toContainText(SIN_CONEXION)
  await expect(error).toContainText(REVISA_WIFI)
  await expect(error).not.toContainText('Credenciales incorrectas')
  await expect(page).toHaveURL(/\/login$/)
})

test('se corta la red (fetch fallido) → el mismo mensaje de conexión', async ({ page }) => {
  await page.route('**/auth/v1/token**', (r) => r.abort('internetdisconnected'))
  await intentar(page)
  await expect(page.getByTestId('login-error')).toHaveAttribute('data-tipo', 'sin-conexion')
  await expect(page.getByTestId('login-error')).toContainText(SIN_CONEXION)
})

test('contraste: contraseña equivocada (el servidor real) → "Credenciales incorrectas"', async ({ page }) => {
  await intentar(page, 'clave-que-no-es-' + Date.now())
  const error = page.getByTestId('login-error')
  await expect(error).toHaveAttribute('data-tipo', 'credenciales')
  await expect(error).toContainText('Credenciales incorrectas')
  await expect(error).not.toContainText(SIN_CONEXION)
})

test('vuelve la conexión: el mismo formulario entra', async ({ page }) => {
  let caido = true
  await page.route('**/auth/v1/token**', (r) => caido ? r.fulfill({ status: 504, body: 'Gateway Timeout' }) : r.continue())
  await intentar(page)
  await expect(page.getByTestId('login-error')).toContainText(SIN_CONEXION)
  caido = false
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page).toHaveURL(/\/ventas/, { timeout: 15_000 })
})

test('el servidor NO contesta: a los 15 s, el mensaje de conexión y el botón vuelve a quedar disponible', async ({ page }) => {
  test.setTimeout(60_000)
  await page.route('**/auth/v1/token**', () => new Promise<void>(() => {}))   // nunca contesta
  await intentar(page)
  const inicio = Date.now()
  const boton = page.getByTestId('login-entrar')
  await expect(boton).toContainText('Autenticando')
  await expect(boton).toBeDisabled()
  // Contraste: a los 10 s TODAVÍA espera (el tope no corta antes de tiempo).
  await page.waitForTimeout(10_000)
  await expect(page.getByTestId('login-error')).toHaveCount(0)
  await expect(boton).toBeDisabled()

  await expect(page.getByTestId('login-error')).toHaveAttribute('data-tipo', 'sin-conexion', { timeout: 10_000 })
  const segundos = (Date.now() - inicio) / 1000
  expect(segundos, 'el mensaje sale al cumplirse el tope de 15 s').toBeGreaterThanOrEqual(14)
  expect(segundos).toBeLessThan(20)
  await expect(page.getByTestId('login-error')).toContainText(SIN_CONEXION)
  await expect(page.getByTestId('login-error')).toContainText(REVISA_WIFI)
  await expect(boton).toBeEnabled()
  await expect(boton).toContainText('Ingresar')
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})
