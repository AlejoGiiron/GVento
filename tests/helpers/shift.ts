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
export async function closeShiftIfOpen(page: Page): Promise<void> {
  const closeBtn = page.getByRole('button', { name: 'Cerrar turno', exact: true })

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
