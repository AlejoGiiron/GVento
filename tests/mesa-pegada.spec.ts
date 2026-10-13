import { test, expect, type Page } from '@playwright/test'
import { loginAsOwner, ownerCreds } from './helpers/auth'
import { cliente, psql } from './helpers/db-local'
import { mesaFija, liberarMesa } from './helpers/lab'

// ============================================================================
// Mesas PEGADAS: "Ocupada" o "Pide cuenta" sin orden viva.
//
// Lo que pasó (Salchimelo, 2026-10-10, supabase/diag/mesas-pegadas.sql): 3 mesas
// así, sin forma de liberarlas desde la app — el panel decía "Cargando orden..."
// para siempre. Dos caminos las producen:
//   · un cobro o un "Cerrar mesa" que no alcanzó a liberar la mesa (escrituras
//     sueltas desde el navegador; lo cierra el servidor en feat/mesas-servidor);
//   · "Pide cuenta" tocado en una pantalla vieja, con la mesa ya cobrada en otro
//     equipo (Realtime no entrega nada en producción).
// Y la forma inversa: "Abrir mesa" creaba la orden ANTES de ocupar la mesa.
//
// Lo que custodia este spec:
//   1. la mesa pegada se ve como tal y se libera desde el panel;
//   2. liberar relee la base: si otro equipo la abrió, NO la libera;
//   3. "Pide cuenta" no pisa una mesa que otro equipo ya cobró;
//   4. "Abrir mesa" no crea una segunda orden en una mesa que otro ya abrió;
//   5. si falla la carga de las cuentas, NO se ofrece liberar (fail-closed);
//   6. una mesa con MÁS DE UNA cuenta viva lo avisa (MESA 12 de G-10, 2026-10-12) y
//      muestra siempre la misma: la más antigua (antes ganaba la última, sin orden fijo).
//
// "El otro equipo" se simula por detrás de la pantalla con psql: la base local
// no publica Realtime (igual que producción), así que la pantalla no se entera y
// queda vieja de forma determinista.
// ============================================================================

const MESA = 'E2E Fija Pegada'
let MESA_ID = ''
let SEDE = ''
let OWNER_ID = ''

test.describe.serial('Mesas pegadas', () => {
  test.beforeAll(async () => {
    const o = await cliente(ownerCreds())
    SEDE = o.sede; OWNER_ID = o.uid
    MESA_ID = await mesaFija(MESA)
  })

  // Cada caso desde un estado limpio: mesa libre y sin órdenes vivas.
  test.beforeEach(async ({ page }) => {
    await liberarMesa(MESA)
    page.on('dialog', (d) => d.accept())
    await loginAsOwner(page)
  })

  test.afterAll(async () => {
    await liberarMesa(MESA)
  })

  const estadoMesa = () => psql(`select status from public.tables where id = '${MESA_ID}';`)
  const ordenesVivas = () => Number(psql(
    `select count(*) from public.orders where table_id = '${MESA_ID}' and status in ('pending','preparing','ready');`))
  const ponerEstado = (estado: string) =>
    psql(`update public.tables set status = '${estado}' where id = '${MESA_ID}';`)
  const crearOrdenViva = (total = 0, haceMinutos = 0) => psql(`with x as (
      insert into public.orders (type, status, total, restaurant_id, created_by, table_id, created_at)
      values ('dine_in', 'pending', ${total}, '${SEDE}', '${OWNER_ID}', '${MESA_ID}',
              now() - interval '${haceMinutos} minutes') returning id)
    select id from x;`)
  const card = (page: Page) => page.getByRole('button', { name: new RegExp(MESA) })

  test('una mesa en "Pide cuenta" sin orden se ve pegada y se libera desde el panel', async ({ page }) => {
    ponerEstado('waiting_bill')   // la forma exacta de Salchimelo
    await page.goto('/mesas')

    await expect(card(page)).toContainText('Pide cuenta')
    await expect(card(page).getByTestId('table-sin-cuenta')).toBeVisible()
    await card(page).click()
    await expect(page.getByTestId('table-sin-cuenta-panel')).toBeVisible()
    await expect(page.getByText('Cargando orden...')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Cobrar/ })).toHaveCount(0)

    await page.getByTestId('table-release').click()
    await expect(page.getByText(`Mesa ${MESA} liberada`)).toBeVisible()
    expect(estadoMesa()).toBe('free')
    await expect(card(page)).toContainText('Libre')
  })

  test('contraste: una mesa con cuenta abierta NO se ofrece para liberar', async ({ page }) => {
    crearOrdenViva()
    ponerEstado('waiting_bill')
    await page.goto('/mesas')

    await expect(card(page)).toContainText('Pide cuenta')
    await expect(card(page).getByTestId('table-sin-cuenta')).toHaveCount(0)
    await expect(card(page).getByTestId('table-varias-cuentas')).toHaveCount(0)   // UNA cuenta: sin aviso
    await card(page).click()
    // La orden viva está vacía: el panel ofrece el flujo normal ("Cerrar mesa"), no liberar.
    await expect(page.getByText('Sin ítems — agrega productos')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Cerrar mesa' })).toBeVisible()
    await expect(page.getByTestId('table-sin-cuenta-panel')).toHaveCount(0)
    await expect(page.getByTestId('table-release')).toHaveCount(0)
    await expect(page.getByTestId('table-varias-cuentas-panel')).toHaveCount(0)
  })

  test('una mesa con DOS cuentas vivas lo avisa y muestra siempre la más antigua', async ({ page }) => {
    // Se inserta PRIMERO la más nueva: el orden físico es el contrario al de apertura,
    // así que sin el ORDER BY (o con "gana la última") se vería la de $2.000.
    crearOrdenViva(2000, 0)
    crearOrdenViva(1000, 60)
    ponerEstado('occupied')
    await page.goto('/mesas')

    await expect(card(page).getByTestId('table-varias-cuentas')).toHaveText(/2 cuentas abiertas/)
    await expect(card(page)).toContainText(/1\.000/)
    await expect(card(page)).not.toContainText(/2\.000/)

    await card(page).click()
    const aviso = page.getByTestId('table-varias-cuentas-panel')
    await expect(aviso).toContainText('Esta mesa tiene 2 cuentas abiertas')
    const filas = aviso.getByTestId('table-cuenta-viva')
    await expect(filas).toHaveCount(2)
    await expect(filas.nth(0)).toContainText(/1\.000 · la que ves/)
    await expect(filas.nth(1)).toContainText(/2\.000/)

    // Estable entre cargas: la misma, otra vez.
    await page.reload()
    await expect(card(page).getByTestId('table-varias-cuentas')).toHaveText(/2 cuentas abiertas/)
    await expect(card(page)).toContainText(/1\.000/)
    await expect(card(page)).not.toContainText(/2\.000/)
    expect(ordenesVivas()).toBe(2)   // avisar no toca nada en la base
  })

  test('liberar relee la base: si otro equipo abrió la mesa, no la libera', async ({ page }) => {
    ponerEstado('occupied')
    await page.goto('/mesas')
    await card(page).click()
    await expect(page.getByTestId('table-release')).toBeVisible()

    crearOrdenViva()   // otro equipo: la pantalla no se entera
    await page.getByTestId('table-release').click()

    await expect(page.getByText(`${MESA} tiene una cuenta abierta: no se liberó`)).toBeVisible()
    expect(estadoMesa()).toBe('occupied')
    expect(ordenesVivas()).toBe(1)
  })

  test('"Pide cuenta" en una pantalla vieja no pisa una mesa que otro equipo ya cobró', async ({ page }) => {
    const orden = crearOrdenViva()
    ponerEstado('occupied')
    await page.goto('/mesas')
    await card(page).click()
    const pideCuenta = page.getByRole('button', { name: 'Pide cuenta' })
    await expect(pideCuenta).toBeVisible()

    // Otro equipo cobra la mesa: la orden se cierra y la mesa queda libre.
    psql(`update public.orders set status = 'delivered' where id = '${orden}';`)
    ponerEstado('free')

    await pideCuenta.click()
    await expect(page.getByText('La mesa ya no está ocupada: otro equipo la cobró o la cerró')).toBeVisible()
    expect(estadoMesa()).toBe('free')   // antes del arreglo: 'waiting_bill' sin orden
  })

  test('contraste: "Pide cuenta" sobre una mesa que sigue ocupada sí la cambia', async ({ page }) => {
    crearOrdenViva()
    ponerEstado('occupied')
    await page.goto('/mesas')
    await card(page).click()
    await page.getByRole('button', { name: 'Pide cuenta' }).click()
    await expect(page.getByText('Estado actualizado a "Pide cuenta"')).toBeVisible()
    expect(estadoMesa()).toBe('waiting_bill')
  })

  test('"Abrir mesa" no crea una segunda orden si otro equipo ya la abrió', async ({ page }) => {
    await page.goto('/mesas')
    await card(page).click()
    const abrir = page.getByRole('button', { name: 'Abrir mesa' })
    await expect(abrir).toBeVisible()

    crearOrdenViva()   // otro equipo la abre
    ponerEstado('occupied')

    await abrir.click()
    await expect(page.getByText(`${MESA} ya no está libre: otro equipo la abrió`)).toBeVisible()
    expect(ordenesVivas()).toBe(1)   // antes del arreglo: 2
  })

  test('contraste: "Abrir mesa" sobre una mesa libre la ocupa con UNA orden', async ({ page }) => {
    await page.goto('/mesas')
    await card(page).click()
    await page.getByRole('button', { name: 'Abrir mesa' }).click()
    await expect(page.getByText(`Mesa ${MESA} abierta`)).toBeVisible()
    expect(estadoMesa()).toBe('occupied')
    expect(ordenesVivas()).toBe(1)
  })

  test('si falla la carga de las cuentas, NO se ofrece liberar (fail-closed)', async ({ page }) => {
    ponerEstado('occupied')
    // Solo la lectura de órdenes por mesa (getActiveOrdersForTables) falla.
    await page.route('**/rest/v1/orders?**', (route) =>
      route.request().method() === 'GET' && route.request().url().includes('table_id=in.')
        ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"falla simulada"}' })
        : route.continue())
    await page.goto('/mesas')

    await expect(page.getByText('Error cargando las cuentas de las mesas')).toBeVisible()
    await expect(card(page)).toContainText('Ocupada')
    await expect(card(page).getByTestId('table-sin-cuenta')).toHaveCount(0)
    await card(page).click()
    await expect(page.getByText('Cargando orden...')).toBeVisible()
    await expect(page.getByTestId('table-release')).toHaveCount(0)
    expect(estadoMesa()).toBe('occupied')
  })
})
