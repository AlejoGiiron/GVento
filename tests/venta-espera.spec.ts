import { test, expect } from '@playwright/test'
import { loginAsOwner } from './helpers/auth'

// Botones desambiguados por `title`:
//   footer "Poner la venta en espera"  → poner en espera
//   header "Ventas en espera"          → abrir panel (con badge contador)
const HOLD_BTN = 'Poner la venta en espera'
const HELD_INDICATOR = 'Ventas en espera'
const LABEL_PLACEHOLDER = /Señor de gorra/

async function addAndHold(page: import('@playwright/test').Page, label: string) {
  await page.getByTestId('product-card').first().click()
  await page.getByTitle(HOLD_BTN).click()
  await page.getByPlaceholder(LABEL_PLACEHOLDER).fill(label)
  await page.getByRole('button', { name: 'Guardar en espera' }).click()
}

test.describe('Venta en espera', () => {
  test('poner en espera vacía el carrito y el contador marca 1', async ({ page }) => {
    await loginAsOwner(page)
    await page.getByTestId('product-card').first().click()
    await expect(page.getByText('Carrito vacío')).toHaveCount(0)

    await page.getByTitle(HOLD_BTN).click()
    await page.getByPlaceholder(LABEL_PLACEHOLDER).fill('Cliente test')
    await page.getByRole('button', { name: 'Guardar en espera' }).click()

    await expect(page.getByText('Carrito vacío')).toBeVisible()
    const indicator = page.getByTitle(HELD_INDICATOR)
    await expect(indicator).toBeVisible()
    await expect(indicator).toContainText('1')
  })

  test('retomar restaura el carrito', async ({ page }) => {
    await loginAsOwner(page)
    await addAndHold(page, 'Retomar test')
    await expect(page.getByText('Carrito vacío')).toBeVisible()

    await page.getByTitle(HELD_INDICATOR).click()
    await expect(page.getByText(/Ventas en espera \(1\)/)).toBeVisible()
    await page.getByRole('button', { name: 'Retomar' }).click()

    await expect(page.getByText('Carrito vacío')).toHaveCount(0)
  })

  test('dos ventas en espera simultáneas → contador marca 2', async ({ page }) => {
    await loginAsOwner(page)
    await addAndHold(page, 'Venta 1')
    await addAndHold(page, 'Venta 2')
    await expect(page.getByTitle(HELD_INDICATOR)).toContainText('2')
  })

  test('descartar una venta en espera (con confirmación) la elimina', async ({ page }) => {
    page.on('dialog', (dialog) => dialog.accept()) // window.confirm
    await loginAsOwner(page)
    await addAndHold(page, 'Para descartar')

    await page.getByTitle(HELD_INDICATOR).click()
    // Desambiguar del botón de descarte del banner amber (icono, title="Descartar"
    // sin texto): el del panel tiene texto visible "Descartar".
    await page.getByRole('button', { name: 'Descartar' }).filter({ hasText: 'Descartar' }).click()

    await expect(page.getByText('No hay ventas en espera')).toBeVisible()
  })

  test('retomar con carrito activo abre el diálogo de 3 opciones', async ({ page }) => {
    await loginAsOwner(page)
    await addAndHold(page, 'En espera A')         // 1 en espera, carrito vacío
    await page.getByTestId('product-card').first().click() // carrito activo con ítems

    await page.getByTitle(HELD_INDICATOR).click()
    await page.getByRole('button', { name: 'Retomar' }).click()

    // Diálogo de conflicto con 3 opciones.
    await expect(page.getByText('Tienes una venta activa')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Guardar la actual en espera' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Descartar la actual' })).toBeVisible()

    // Elegir "descartar la actual" → retoma la venta en espera.
    await page.getByRole('button', { name: 'Descartar la actual' }).click()
    await expect(page.getByText('Carrito vacío')).toHaveCount(0)
  })
})
