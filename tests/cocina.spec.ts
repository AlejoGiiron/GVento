import { test, expect, type Page } from '@playwright/test'
import { loginAsOwner } from './helpers/auth'
import { openTableAndAddItems } from './helpers/tables'
import { openShiftIfClosed, closeShiftIfOpen } from './helpers/shift'

// Cocina por sede (uses_kitchen) + por producto (routes_to_kitchen).
// Requiere lab-seed.sql RE-CORRIDO: crea "Sede Lab Sin Cocina" (uses_kitchen=false,
// acceso owner.test, 1 mesa) y fija "Lab Agua" con routes_to_kitchen=false.

const SUFFIX = Date.now().toString().slice(-6)
const MESA = `Mesa Cocina ${SUFFIX}`

const NORTE = 'Sede Lab Norte'
const NO_KITCHEN = 'Sede Lab Sin Cocina'

const ROUTES = 'Lab Cerveza' // routes_to_kitchen = true  (seed)
const NO_ROUTES = 'Lab Agua' // routes_to_kitchen = false (seed)

// printComanda() llama window.print(); en headless puede abrir un diálogo que
// bloquee el test. Lo neutralizamos antes de navegar.
async function stubPrint(page: Page) {
  await page.addInitScript(() => {
    window.print = () => {}
  })
}

// Selecciona un producto del ProductPickerModal (Cerveza/Agua no tienen extras,
// así que se agregan directo sin ItemConfigModal).
//
// Busca por TEXTO en el input del picker en vez de depender de la categoría
// activa (categories[0]): el filtro por query tiene prioridad sobre la categoría
// en el picker, así que el producto aparece sin importar el orden de categorías
// ni el residuo E2E acumulado en el lab. `fill` reemplaza la búsqueda previa, así
// que llamadas consecutivas (Cerveza, luego Agua) no interfieren entre sí.
async function pickProduct(page: Page, name: string) {
  await page.getByPlaceholder('Buscar producto...').fill(name)
  await page
    .getByRole('button')
    .filter({ has: page.getByText(name, { exact: true }) })
    .first()
    .click()
}

test.describe.serial('Cocina por sede y por producto', () => {
  // Red de seguridad: pase lo que pase, la sede activa del owner vuelve a Norte
  // para no contaminar los demás specs (que asumen Norte como sede de trabajo).
  test.afterEach(async ({ page }) => {
    try {
      await page.goto('/mesas')
      const sel = page.getByTestId('store-selector')
      if (await sel.count()) await sel.selectOption({ label: NORTE })
    } catch {
      /* best-effort: sin sesión o sin selector, no hay nada que restaurar */
    }
  })

  test('ON: el contador cuenta solo lo que enruta y solo ese producto va a cocina', async ({ page }) => {
    await stubPrint(page)
    await loginAsOwner(page)

    // Cobrar (limpieza al final) exige turno abierto.
    await page.goto('/ventas')
    await openShiftIfClosed(page, 0)

    // Mesa dedicada en Norte (evita colisión con mesas seeded ocupadas).
    await page.goto('/mesas')
    await page.getByRole('button', { name: 'Configurar' }).click()
    await page.getByPlaceholder('Mesa 1').fill(MESA)
    await page.getByRole('button', { name: 'Crear mesa' }).click()
    await expect(page.getByText(MESA)).toBeVisible()

    // Abrir la mesa y abrir el picker.
    await openTableAndAddItems(page, MESA)

    // Agregar Cerveza (enruta) + Agua (NO enruta).
    await pickProduct(page, ROUTES)
    await pickProduct(page, NO_ROUTES)
    await page.getByRole('button', { name: 'Agregar a la mesa' }).click()
    await expect(page.getByRole('button', { name: 'Agregar a la mesa' })).toHaveCount(0)
    await expect(page.getByText('Sin ítems — agrega productos')).toHaveCount(0)

    // Contador: solo Cerveza enruta → "Cocina (1)", NUNCA "Cocina (2)".
    await expect(page.getByRole('button', { name: 'Cocina (1)' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Cocina (2)' })).toHaveCount(0)

    // Enviar a cocina → solo Cerveza queda marcada "En cocina"; Agua no.
    await page.getByRole('button', { name: 'Cocina (1)' }).click()
    const cervezaRow = page.getByTestId('table-item').filter({ hasText: ROUTES })
    const aguaRow = page.getByTestId('table-item').filter({ hasText: NO_ROUTES })
    await expect(cervezaRow).toContainText('En cocina')
    await expect(aguaRow).not.toContainText('En cocina')
    // Globalmente solo un ítem fue a cocina.
    await expect(page.getByText('En cocina', { exact: true })).toHaveCount(1)

    // Limpieza: cobrar la mesa (la libera), cerrar turno y eliminar la mesa.
    // Transferencia confirma directo (sin paso de monto en efectivo).
    await page.getByRole('button', { name: 'Cobrar' }).click()
    await page.getByTestId('pay-method-transferencia').click()
    await page.getByTestId('checkout-continue').click()
    await expect(page.getByText(/registrada|Cobro exitoso/)).toBeVisible({ timeout: 15_000 })

    await page.goto('/ventas')
    await closeShiftIfOpen(page)

    // Eliminar la mesa dedicada (ya libre tras el cobro).
    await page.goto('/mesas')
    await page.getByRole('button', { name: 'Configurar' }).click()
    const del = page.locator('div')
      .filter({ has: page.getByText(MESA, { exact: true }) })
      .filter({ has: page.getByTitle('Eliminar mesa') })
      .last()
      .getByTitle('Eliminar mesa')
    if (await del.count()) await del.click()
  })

  test('OFF: en una sede sin cocina, "Cocina" desaparece del sidebar y del panel de mesa', async ({ page }) => {
    // Aceptar el window.confirm de "Cerrar mesa" (limpieza del panel).
    page.on('dialog', (d) => d.accept())
    await loginAsOwner(page)
    await page.goto('/mesas')

    try {
      // Cambiar la sede activa a la dedicada SIN cocina. Esperar a que la
      // conmutación propague: el brand del sidebar pasa a la sede nueva (señal
      // de que el profile se refrescó y el restaurant recargó con uses_kitchen).
      await page.getByTestId('store-selector').selectOption({ label: NO_KITCHEN })
      await expect(page.getByTestId('sidebar-brand-name')).toHaveText(NO_KITCHEN, { timeout: 15_000 })

      // El item "Cocina" desaparece del sidebar (uses_kitchen=false).
      await expect(page.getByRole('link', { name: 'Cocina' })).toHaveCount(0, { timeout: 15_000 })

      // Asentar la recarga de TablesPage: el cambio de sede dispara
      // invalidateQueries (tables/orders). Bajo carga, tocar la mesa antes de
      // que el panel monte hacía que el check sin espera de "Abrir mesa" corriera
      // en falso. Esperar a que la red asiente hace el panel determinista.
      await page.waitForLoadState('networkidle').catch(() => {})

      // Abrir la mesa de la sede sin cocina y verificar que NO hay botón "Cocina".
      await page.getByRole('button', { name: /Mesa 1/ }).click()
      const abrir = page.getByRole('button', { name: 'Abrir mesa' })
      if (await abrir.count()) {
        await abrir.click()
        // Esperar a que Mesa 1 refleje "Ocupada" (fin del refetch) ANTES de
        // re-clickear; si no, el re-click reabre el OpenTableModal (mesa 'free'
        // stale) y "Agregar ítems" nunca aparece.
        await expect(page.getByRole('button', { name: /Mesa 1/ })).toContainText('Ocupada', { timeout: 15_000 })
        await page.getByRole('button', { name: /Mesa 1/ }).click()
      }

      // El panel cargó (Agregar ítems visible) pero el botón "Cocina" no existe.
      await expect(page.getByRole('button', { name: 'Agregar ítems' })).toBeVisible()
      await expect(page.getByRole('button', { name: /^Cocina/ })).toHaveCount(0)

      // Liberar la mesa (orden vacía → "Cerrar mesa").
      const cerrar = page.getByRole('button', { name: 'Cerrar mesa' })
      if (await cerrar.count()) await cerrar.click()
    } finally {
      // Restaurar SIEMPRE la sede activa a Norte y confirmar que vuelve "Cocina".
      await page.getByTestId('store-selector').selectOption({ label: NORTE })
      await expect(page.getByTestId('sidebar-brand-name')).toHaveText(NORTE, { timeout: 15_000 })
      await expect(page.getByRole('link', { name: 'Cocina' })).toBeVisible({ timeout: 15_000 })
    }
  })
})
