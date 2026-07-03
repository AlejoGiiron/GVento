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

  test('registrar un movimiento de caja (ingreso, texto libre)', async ({ page }) => {
    await openShiftIfClosed(page, 0)

    await page.getByRole('button', { name: 'Movimientos' }).click()
    await expect(page.getByText('Movimientos manuales', { exact: true })).toBeVisible()

    // Ingreso seleccionado por defecto: motivo en texto libre.
    await page.getByTestId('movement-amount').fill('20000')
    await page.getByTestId('movement-reason-in').fill('Ingreso de prueba E2E')
    await page.getByTestId('movement-submit').click()

    await expect(page.getByText('Ingreso de prueba E2E')).toBeVisible()
  })

  test('registrar egreso con motivo de la lista configurable', async ({ page }) => {
    await openShiftIfClosed(page, 100000)

    await page.getByRole('button', { name: 'Movimientos' }).click()
    await expect(page.getByText('Movimientos manuales', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Egreso', exact: true }).click()

    // El motivo ahora es un SELECT poblado con config.cash_out_reasons.
    const select = page.getByTestId('movement-reason-out')
    await expect(select).toBeVisible()
    await select.selectOption({ index: 1 }) // primer motivo real (índice 0 = placeholder)
    const chosen = (await select.locator('option:checked').textContent())?.trim() ?? ''
    expect(chosen.length).toBeGreaterThan(0)

    await page.getByTestId('movement-amount').fill('15000')
    await page.getByTestId('movement-submit').click()

    // El egreso aparece en la LISTA de movimientos con el motivo elegido. Se
    // acota a movement-item: el mismo texto está también como <option> del
    // select (oculto), así que getByText(chosen).first() resolvía a ese option.
    await expect(page.getByTestId('movement-item').filter({ hasText: chosen })).toBeVisible()
  })

  test('egreso que supera el efectivo disponible advierte sobregiro y permite confirmar', async ({ page }) => {
    // Estado limpio: turno nuevo con apertura 0 → cualquier egreso grande sobregira.
    await closeShiftIfOpen(page)
    await openShiftIfClosed(page, 0)

    await page.getByRole('button', { name: 'Movimientos' }).click()
    await expect(page.getByText('Movimientos manuales', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Egreso', exact: true }).click()
    const select = page.getByTestId('movement-reason-out')
    await select.selectOption({ index: 1 })
    const chosen = (await select.locator('option:checked').textContent())?.trim() ?? ''
    await page.getByTestId('movement-amount').fill('5000000')

    // Primer click: NO registra; muestra la advertencia de sobregiro.
    await page.getByTestId('movement-submit').click()
    await expect(page.getByTestId('overdraft-warning')).toBeVisible()
    await expect(page.getByText('Este egreso supera el efectivo disponible')).toBeVisible()
    // La advertencia muestra el MONTO concreto en que queda negativa la caja.
    await expect(page.getByTestId('overdraft-amount')).toContainText('5.000.000')
    await expect(page.getByRole('button', { name: 'Registrar de todos modos' })).toBeVisible()

    // Segundo click: confirma y registra el egreso de todos modos.
    await page.getByTestId('movement-submit').click()
    await expect(page.getByTestId('overdraft-warning')).toBeHidden()
    // Acotado a la LISTA (movement-item): el motivo también existe como <option>
    // oculto del select, que getByText(chosen).first() resolvía por error.
    await expect(page.getByTestId('movement-item').filter({ hasText: chosen })).toBeVisible()
  })

  test('cerrar turno muestra esperado y diferencia', async ({ page }) => {
    // Estado limpio para que el esperado sea determinista (apertura 50k, sin ventas/movs).
    await closeShiftIfOpen(page)
    await openShiftIfClosed(page, 50000)
    await page.waitForLoadState('networkidle').catch(() => {})

    const closeBtn = page.getByRole('button', { name: 'Cerrar turno', exact: true })
    await expect(closeBtn).toBeVisible()
    await closeBtn.click()
    await expect(page.getByText('Cerrar turno de caja')).toBeVisible()
    await expect(page.getByText('Efectivo esperado', { exact: true })).toBeVisible()

    // Declarar de más → sobrante con diferencia positiva.
    await page.getByTestId('close-shift-declared').fill('60000')
    await expect(page.getByText('Sobrante', { exact: true })).toBeVisible()
    await expect(page.getByText('+ $ 10.000').or(page.getByText(/\+.*10\.000/))).toBeVisible()

    // Declarar de menos → faltante.
    await page.getByTestId('close-shift-declared').fill('40000')
    await expect(page.getByText('Faltante', { exact: true })).toBeVisible()

    // Cuadre exacto.
    await page.getByTestId('close-shift-declared').fill('50000')
    await expect(page.getByText('Cuadre exacto', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Confirmar cierre' }).click()
    await expect(page.getByText('Sin turno')).toBeVisible()
  })

  test('idempotente: cerrar turno si quedó abierto', async ({ page }) => {
    await closeShiftIfOpen(page)
    await expect(page.getByText('Sin turno')).toBeVisible()
  })
})
