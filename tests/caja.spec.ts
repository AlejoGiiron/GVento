import { test, expect } from '@playwright/test'
import { loginAsOwner } from './helpers/auth'
import { closeShiftIfOpen, openShiftIfClosed } from './helpers/shift'

test.describe.serial('Caja', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsOwner(page)
  })

  test('abrir turno con monto inicial muestra turno activo', async ({ page }) => {
    await closeShiftIfOpen(page)
    await openShiftIfClosed(page, 50000)

    await expect(page.getByText(/Turno desde/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Cerrar turno', exact: true })).toBeVisible()
  })

  test('registrar un movimiento de caja (ingreso)', async ({ page }) => {
    await openShiftIfClosed(page, 0)

    await page.getByRole('button', { name: 'Movimientos' }).click()
    await expect(page.getByText('Movimientos manuales', { exact: true })).toBeVisible()

    await page.getByTestId('movement-amount').fill('20000')
    await page.getByPlaceholder(/Venta externa/).fill('Ingreso de prueba E2E')
    await page.getByRole('button', { name: '+ Registrar ingreso' }).click()

    await expect(page.getByText('Ingreso de prueba E2E')).toBeVisible()
  })

  test('cerrar turno muestra resumen y diferencia', async ({ page }) => {
    await openShiftIfClosed(page, 0)
    // Dejar que el header (banner amber → ShiftBanner) deje de re-acomodarse
    // antes de clickear, para evitar inestabilidad de layout.
    await page.waitForLoadState('networkidle').catch(() => {})

    const closeBtn = page.getByRole('button', { name: 'Cerrar turno', exact: true })
    await expect(closeBtn).toBeVisible()
    await closeBtn.click()
    await expect(page.getByText('Cerrar turno de caja')).toBeVisible()
    await expect(page.getByText('Efectivo esperado', { exact: true })).toBeVisible()

    await page.getByTestId('close-shift-declared').fill('0')
    await expect(page.getByText(/Cuadre exacto|Sobrante|Faltante/)).toBeVisible()

    await page.getByRole('button', { name: 'Confirmar cierre' }).click()
    await expect(page.getByText('Sin turno')).toBeVisible()
  })

  test('idempotente: cerrar turno si quedó abierto', async ({ page }) => {
    await closeShiftIfOpen(page)
    await expect(page.getByText('Sin turno')).toBeVisible()
  })
})
