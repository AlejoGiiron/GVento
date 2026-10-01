import { test, expect } from '@playwright/test'
import { loginAsOwner } from './helpers/auth'
import { mesaFija, liberarMesa, borrarMesaTransitoria } from './helpers/lab'

const SUFFIX = Date.now().toString().slice(-6)
// DOS mesas, a propósito (ver tests/helpers/lab.ts):
//  · ALTA: transitoria. Prueba el alta y la baja desde la UI. Nunca tiene
//    órdenes, así que borrarla es posible — y se VERIFICA que desaparezca.
//  · TABLE: fija, reusada entre corridas. Abrir con responsable y cerrar sin
//    consumo dejan una orden dine_in, y una mesa con órdenes dine_in
//    probablemente no se puede borrar (orders.table_id ON DELETE SET NULL vs
//    chk_dine_in_has_table). Antes era UNA sola mesa con sufijo: por eso LAB
//    juntaba ~25 "Mesa E2E …", 14 de ellas ocupadas.
const ALTA = `E2E Alta ${SUFFIX}`
const TABLE = 'E2E Fija Mesas'
const WAITER = `Valentina ${SUFFIX}`

test.describe.serial('Mesas', () => {
  test.beforeAll(async () => {
    await mesaFija(TABLE)
  })

  // Corren AUNQUE un test falle.
  test.afterAll(async () => {
    await liberarMesa(TABLE)
    await borrarMesaTransitoria(ALTA)
  })

  test.beforeEach(async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/mesas')
  })

  test('ver el mapa de mesas', async ({ page }) => {
    await expect(page.getByText('Mapa del salón')).toBeVisible()
  })

  test('crear una mesa (config admin)', async ({ page }) => {
    await page.getByRole('button', { name: 'Configurar' }).click()
    await page.getByPlaceholder('Mesa 1').fill(ALTA)
    await page.getByRole('button', { name: 'Crear mesa' }).click()
    // Aparece en la lista del modal de configuración.
    await expect(page.getByText(ALTA)).toBeVisible()
  })

  test('abrir una mesa con responsable lo muestra en la card', async ({ page }) => {
    await page.getByRole('button', { name: new RegExp(TABLE) }).click()
    // Modal de apertura.
    await page.getByPlaceholder('¿Quién atiende la mesa?').fill(WAITER)
    await page.getByRole('button', { name: 'Abrir mesa' }).click()
    // La card muestra "Atiende: <responsable>".
    await expect(page.getByText(WAITER)).toBeVisible()
  })

  test('cerrar mesa sin consumo libera la mesa', async ({ page }) => {
    // Aceptar el window.confirm de cierre.
    page.on('dialog', (dialog) => dialog.accept())

    await page.getByRole('button', { name: new RegExp(TABLE) }).click()
    // Panel lateral de la mesa ocupada → "Cerrar mesa" (sin ítems).
    await page.getByRole('button', { name: 'Cerrar mesa' }).click()
    // El panel se cierra (mesa liberada).
    await expect(page.getByRole('button', { name: 'Cerrar mesa' })).toHaveCount(0)
  })

  test('eliminar una mesa sin historial la quita de la lista', async ({ page }) => {
    await page.getByRole('button', { name: 'Configurar' }).click()
    await expect(page.getByText('Configuración de mesas')).toBeVisible()
    // Fila del listado con el nombre exacto → su botón "Eliminar mesa".
    const del = page.locator('div')
      .filter({ has: page.getByText(ALTA, { exact: true }) })
      .filter({ has: page.getByTitle('Eliminar mesa') })
      .last()
      .getByTitle('Eliminar mesa')
    await expect(del).toBeEnabled()
    await del.click()
    // Contraste (R10): antes estaba; ahora no. Una baja que "no falla" pero no
    // borra era indistinguible de una que borra.
    await expect(page.getByText(ALTA, { exact: true })).toHaveCount(0)
  })
})
