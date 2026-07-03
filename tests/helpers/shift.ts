import { type Page, expect } from '@playwright/test'

/**
 * Garantiza el estado "sin turno": si hay un turno de caja abierto, lo cierra
 * (declarando 0) para que los tests que dependen de NO tener turno corran de
 * forma determinista.
 *
 * Requiere estar logueado con una cuenta que tenga `caja.cerrar` (owner) y
 * estar en una pantalla con el header (ShiftBanner) visible, p. ej. /ventas.
 *
 * OJO: cierra el turno REAL del backend. Es intencional para fijar el estado.
 */
/**
 * Deja ASENTAR el estado del turno (useCashShift) tras la carga inicial. Ese
 * estado puede PARPADEAR (currentShift null → real) y mostrar por un instante el
 * banner equivocado. Decidir sobre ese transitorio hacía intentar abrir un turno
 * YA abierto → POST cash_shifts 409 → el modal quedaba bloqueando la UI. Esperar
 * a que la red quede inactiva evita actuar sobre el parpadeo.
 */
async function settleShift(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {})
}

export async function closeShiftIfOpen(page: Page): Promise<void> {
  const closeBtn = page.getByRole('button', { name: 'Cerrar turno', exact: true })
  const openBanner = page.getByRole('button', { name: 'Abrir turno' })

  // Esperar a que el turno cargue: uno de los dos botones accionables aparece
  // SOLO tras resolverse la query (la píldora "Sin turno" se ve también
  // mientras carga, por eso no sirve como señal).
  await expect(closeBtn.or(openBanner)).toBeVisible({ timeout: 15_000 })
  await settleShift(page)

  // Sin botón "Cerrar turno" → ya no hay turno abierto.
  if ((await closeBtn.count()) === 0) return

  await closeBtn.first().click()
  await expect(page.getByText('Cerrar turno de caja')).toBeVisible()

  // Monto declarado (input propio del modal, localizado por testid).
  await page.getByTestId('close-shift-declared').fill('0')
  await page.getByRole('button', { name: 'Confirmar cierre' }).click()

  // El header vuelve al estado "Sin turno".
  await expect(page.getByText('Sin turno')).toBeVisible({ timeout: 15_000 })
}

/**
 * Garantiza el estado "con turno abierto": si no hay turno, lo abre con el monto
 * indicado. Idempotente. Requiere `caja.abrir` (owner) y el banner visible.
 */
export async function openShiftIfClosed(page: Page, amount = 0): Promise<void> {
  const closeBtn = page.getByRole('button', { name: 'Cerrar turno', exact: true })
  const openBanner = page.getByRole('button', { name: 'Abrir turno' })

  // Esperar a que el turno cargue (uno de los dos botones accionables).
  await expect(closeBtn.or(openBanner)).toBeVisible({ timeout: 15_000 })
  await settleShift(page)

  // Si ya hay turno, el header muestra "Cerrar turno".
  if ((await closeBtn.count()) > 0) return

  // Abrir desde el banner amber "No hay turno de caja abierto".
  await openBanner.first().click()
  await expect(page.getByRole('heading', { name: 'Abrir turno de caja' })).toBeVisible()
  await page.getByTestId('open-shift-amount').fill(String(amount))
  await page.getByRole('button', { name: /Abrir turno de caja/ }).click()
  await expect(page.getByText(/Turno desde/)).toBeVisible({ timeout: 15_000 })
}
