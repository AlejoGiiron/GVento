import { test, expect } from '@playwright/test'
import { loginAsOwner, ownerCreds } from './helpers/auth'

// Bug: en una terminal compartida, el carrito y las ventas en espera del cajero
// que sale NO deben ser heredados por el siguiente cajero que entra.
//
// CLAVE del test: reproducir logout + login SIN reload, por la UI. `cartStore`
// es un singleton de módulo; un `page.goto('/login')` (reload) reinicia el
// módulo y limpiaría el carrito por accidente, ENMASCARANDO el bug. Por eso aquí
// se cierra sesión con el botón (navegación SPA a /login) y se vuelve a entrar
// rellenando el formulario ya montado — sin recargar la página en ningún momento.
test('carrito y ventas en espera se limpian al cerrar sesión (mismo tab, sin reload)', async ({ page }) => {
  // Login inicial (este sí hace goto /login = reload — es el arranque limpio).
  await loginAsOwner(page)

  // Cajero A: deja una venta EN ESPERA y además un carrito ACTIVO con ítems.
  await page.getByTestId('product-card').first().click()
  await page.getByTitle('Poner la venta en espera').click()
  await page.getByPlaceholder(/Señor de gorra/).fill('Venta cajero A')
  await page.getByRole('button', { name: 'Guardar en espera' }).click()

  await page.getByTestId('product-card').first().click() // carrito activo con ítems
  await expect(page.getByText('Carrito vacío')).toHaveCount(0)
  await expect(page.getByTitle('Ventas en espera')).toContainText('1')

  // Cerrar sesión POR LA UI → navegación SPA a /login, SIN recargar la página.
  await page.getByRole('button', { name: 'Cerrar sesión' }).click()
  await expect(page).toHaveURL(/\/login/)

  // Entrar de nuevo SIN reload: rellenar el formulario que ya está montado.
  const { email, password } = ownerCreds()
  await page.locator('input[autocomplete="email"]').fill(email)
  await page.locator('input[autocomplete="current-password"]').fill(password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page).toHaveURL(/\/ventas/, { timeout: 15_000 })

  // Cajero B (misma pestaña, sin reload): NO hereda nada.
  await expect(page.getByText('Carrito vacío')).toBeVisible()       // carrito vacío
  await expect(page.getByTitle('Ventas en espera')).toHaveCount(0)  // 0 ventas en espera
})
