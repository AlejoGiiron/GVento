import { test, expect } from '@playwright/test'
import { loginAsOwner } from './helpers/auth'
import { closeShiftIfOpen, openShiftIfClosed } from './helpers/shift'

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

    // La fila de totales "Descuento (10%)" confirma que el descuento se aplicó.
    await expect(page.getByText('Descuento (10%)')).toBeVisible()
    const after = parseCOP(await page.getByTestId('cart-total').innerText())
    expect(after).toBeLessThan(before)
  })

  test('Cobrar exige turno abierto si no hay turno', async ({ page }) => {
    await loginAsOwner(page)

    // Carrito con ítems primero; luego garantizar estado "sin turno" justo antes
    // de cobrar (minimiza la ventana frente al estado compartido del backend).
    await page.getByTestId('product-card').first().click()
    await closeShiftIfOpen(page)
    await expect(page.getByText('Sin turno')).toBeVisible()

    await page.getByRole('button', { name: 'Cobrar' }).click()
    await expect(page.getByRole('heading', { name: 'Abrir turno de caja' })).toBeVisible()
  })

  test('checkout: 4 métodos de pago y cálculo de vuelto en efectivo', async ({ page }) => {
    await loginAsOwner(page)
    await openShiftIfClosed(page, 0) // cobrar requiere turno abierto

    await page.getByTestId('product-card').first().click()
    await page.getByRole('button', { name: 'Cobrar' }).click()

    // Paso método: los 4 métodos visibles.
    await expect(page.getByText('Total a cobrar')).toBeVisible()
    for (const m of ['Efectivo', 'Tarjeta', 'Transferencia', 'Nequi / QR']) {
      await expect(page.getByText(m, { exact: true })).toBeVisible()
    }

    // Efectivo → continuar → ingresar recibido > total → vuelto.
    await page.getByText('Efectivo', { exact: true }).click()
    await page.getByRole('button', { name: /Continuar/ }).click()
    await page.getByTestId('checkout-received').fill('100000')
    await expect(page.getByText('Vuelto')).toBeVisible()

    // No se confirma el cobro (no crea orden). Se cierra el turno abierto para el setup.
    await page.goto('/ventas')
    await closeShiftIfOpen(page)
  })
})
