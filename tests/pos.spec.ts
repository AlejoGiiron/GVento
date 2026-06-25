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
    // Agregar el producto ANTES de tocar el turno (el banner que aparece/desaparece
    // al abrir turno reacomoda el layout y desestabiliza el click a la card).
    await page.getByTestId('product-card').first().click()
    await openShiftIfClosed(page, 0) // cobrar requiere turno abierto

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

  test('cobro en efectivo con chip "Exacto" → vuelto 0', async ({ page }) => {
    await loginAsOwner(page)
    await page.getByTestId('product-card').first().click()
    await openShiftIfClosed(page, 0)

    await page.getByRole('button', { name: 'Cobrar' }).click()
    await page.getByText('Efectivo', { exact: true }).click()
    await page.getByRole('button', { name: /Continuar/ }).click()

    // Pago justo: el chip "Exacto" rellena el monto = total → vuelto 0.
    await page.getByTestId('quick-amount-exact').click()
    await expect(page.getByText('Vuelto', { exact: true })).toBeVisible()
    expect(parseCOP(await page.getByTestId('checkout-change').innerText())).toBe(0)

    await page.getByRole('button', { name: /Confirmar cobro/ }).click()
    await expect(page.getByText(/registrada|Cobro exitoso/)).toBeVisible()

    // Limpieza: cerrar el turno abierto para el setup.
    await page.goto('/ventas')
    await closeShiftIfOpen(page)
  })

  test('cobro en efectivo con chip de round-up → vuelto correcto', async ({ page }) => {
    await loginAsOwner(page)
    await page.getByTestId('product-card').first().click()
    await openShiftIfClosed(page, 0)

    const total = parseCOP(await page.getByTestId('cart-total').innerText())

    await page.getByRole('button', { name: 'Cobrar' }).click()
    await page.getByText('Efectivo', { exact: true }).click()
    await page.getByRole('button', { name: /Continuar/ }).click()

    // Primer chip de round-up: monto redondo por encima del total → vuelto = monto − total.
    const chip = page.getByTestId('quick-amount-chip').first()
    const chipAmount = parseCOP(await chip.innerText())
    expect(chipAmount).toBeGreaterThan(total)
    await chip.click()

    expect(parseCOP(await page.getByTestId('checkout-change').innerText())).toBe(chipAmount - total)

    await page.getByRole('button', { name: /Confirmar cobro/ }).click()
    await expect(page.getByText(/registrada|Cobro exitoso/)).toBeVisible()

    await page.goto('/ventas')
    await closeShiftIfOpen(page)
  })
})
