import { type Page, expect } from '@playwright/test'

/**
 * Abre una mesa EXISTENTE y deja abierto el picker de productos ("Agregar
 * ítems"). El caller agrega luego sus productos.
 *
 * Clave: espera a que la mesa muestre "Ocupada" (fin del refetch tras "Abrir
 * mesa") ANTES de re-seleccionarla. Si se re-clickea con la mesa aún 'free'
 * (estado stale mientras el refetch viaja), handleTableClick REABRE el
 * OpenTableModal y "Agregar ítems" nunca aparece → timeout. Es esperar el
 * estado REAL, no un sleep arbitrario.
 *
 * (Un mozo real clickea segundos después, con la mesa ya ocupada — nunca dispara
 * la carrera; el test iba más rápido que cualquier humano. Helper único para no
 * re-divergir 4 copias.)
 */
export async function openTableAndAddItems(page: Page, mesaName: string): Promise<void> {
  await page.goto('/mesas')
  await page.getByRole('button', { name: new RegExp(mesaName) }).click()
  await page.getByRole('button', { name: 'Abrir mesa' }).click()
  await expect(page.getByRole('button', { name: new RegExp(mesaName) }))
    .toContainText('Ocupada', { timeout: 15_000 })
  await page.getByRole('button', { name: new RegExp(mesaName) }).click()
  await page.getByRole('button', { name: 'Agregar ítems' }).click()
}
