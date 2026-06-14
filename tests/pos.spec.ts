import { test, expect } from '@playwright/test'
import { loginAsOwner } from './helpers/auth'
import { closeShiftIfOpen } from './helpers/shift'

// "$ 12.000" → 12000
function parseCOP(text: string): number {
  return Number(text.replace(/[^\d]/g, ''))
}

test.describe('POS — venta y carrito', () => {
  test('agregar un producto al carrito calcula el total', async ({ page }) => {
    await loginAsOwner(page)
    await expect(page.getByText('Carrito vacío')).toBeVisible()

    await page.getByTestId('product-card').first().click()

    await expect(page.getByText('Carrito vacío')).toHaveCount(0)
    const total = parseCOP(await page.getByTestId('cart-total').innerText())
    expect(total).toBeGreaterThan(0)
  })

  test('aplicar descuento porcentual cambia el total', async ({ page }) => {
    await loginAsOwner(page)
    await page.getByTestId('product-card').first().click()

    const before = parseCOP(await page.getByTestId('cart-total').innerText())
    await page.getByRole('button', { name: '10%' }).click()

    await expect(page.getByText(/Descuento/)).toBeVisible()
    const after = parseCOP(await page.getByTestId('cart-total').innerText())
    expect(after).toBeLessThan(before)
  })

  test('Cobrar exige turno abierto si no hay turno', async ({ page }) => {
    await loginAsOwner(page)

    // Estado determinista: si hay turno abierto, se cierra → siempre "sin turno".
    await closeShiftIfOpen(page)
    await expect(page.getByText('Sin turno')).toBeVisible()

    await page.getByTestId('product-card').first().click()
    await page.getByRole('button', { name: 'Cobrar' }).click()
    await expect(page.getByText('Abrir turno de caja')).toBeVisible()
  })
})
