import { test, expect, type Page } from '@playwright/test'
import { loginAsOwner } from './helpers/auth'
import { waitPosReady } from './helpers/pos'
import { closeShiftIfOpen, openShiftIfClosed } from './helpers/shift'

/**
 * El tablero de Delivery se ordena por TURNO, no por día calendario.
 *
 * EL BUG QUE CIERRA: la consulta traía los entregados con
 * `created_at >= hoy 00:00` del reloj del navegador. En un bar que cruza la
 * medianoche, a las 12 en punto la columna "Entregados" se vaciaba sola —con el
 * local lleno— y encima la frontera no era la de Bogotá (R7).
 *
 * LA REGLA NUEVA, en dos mitades con motivos distintos:
 *   · lo NO entregado se ve siempre, sin ventana. Si el filtro fuera "los de
 *     este turno", un pedido abierto en el turno A se volvería invisible al
 *     empezar el B: el bug se mudaría de las 12 al cambio de turno.
 *   · lo entregado se ve si `delivered_at >= opened_at` del turno abierto.
 *
 * POR QUÉ NO SE PRUEBA LA MEDIANOCHE: el instante lo pone `now()` del servidor
 * (trigger de supabase/delivery-delivered-at.sql). No hay forma de adelantar ese
 * reloj desde un test, y falsearlo desde el cliente probaría justo lo contrario
 * de lo que la migración garantiza. El cambio de turno es la MISMA frontera y sí
 * se puede producir de verdad, así que es lo que se ejerce acá.
 *
 * Serial y con datos propios: cada caso deja el turno en un estado conocido.
 */

const PRODUCT = 'Lab Coctel'
const PRICE = 18000

/** Vende un delivery en el POS y devuelve su número de venta. */
async function venderDelivery(page: Page): Promise<string> {
  await page.goto('/ventas')
  await waitPosReady(page)

  for (let i = 0; i < 3; i++) {
    if ((await page.getByTestId('order-type-label').textContent()) === 'Delivery') break
    await page.getByTestId('order-type-toggle').click()
  }
  await expect(page.getByTestId('order-type-label')).toHaveText('Delivery')

  await page.getByTestId('product-card').filter({ hasText: PRODUCT }).first().click()
  await expect(page.getByTestId('item-config-modal')).toBeVisible()
  await page.getByTestId('item-config-confirm').click()

  await page.getByRole('button', { name: 'Cobrar' }).click()
  await page.getByTestId('pay-method-efectivo').click()
  await page.getByTestId('checkout-continue').click()
  await page.getByTestId('checkout-received').fill(String(PRICE))
  await page.getByRole('button', { name: /Confirmar cobro/ }).click()

  const aviso = page.getByText(/Venta #\d+ registrada/)
  await expect(aviso).toBeVisible({ timeout: 15_000 })
  const texto = (await aviso.textContent()) ?? ''
  const num = texto.match(/#(\d+)/)?.[1]
  if (!num) throw new Error(`No se pudo leer el número de venta en "${texto}"`)

  await page.getByRole('button', { name: 'Nueva venta' }).click()
  return num
}

const tarjeta = (page: Page, columna: string, numero: string) =>
  page.getByTestId(`delivery-column-${columna}`)
      .getByTestId('delivery-card')
      .filter({ hasText: `Venta #${numero}` })

/** Avanza un pedido hasta "Entregados" (Nuevos → En camino → Entregados). */
async function marcarEntregado(page: Page, numero: string) {
  await tarjeta(page, 'new', numero).getByRole('button', { name: 'Marcar en camino' }).click()
  await expect(tarjeta(page, 'in_transit', numero)).toBeVisible({ timeout: 15_000 })
  await tarjeta(page, 'in_transit', numero).getByRole('button', { name: 'Marcar entregado' }).click()
  await expect(tarjeta(page, 'delivered', numero)).toBeVisible({ timeout: 15_000 })
}

test.describe.serial('Delivery — ventana por turno', () => {
  test('un pedido SIN entregar sobrevive al cierre del turno', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/ventas')
    await openShiftIfClosed(page, 50000)

    const num = await venderDelivery(page)
    await page.goto('/delivery')
    await expect(tarjeta(page, 'new', num)).toBeVisible({ timeout: 15_000 })

    // Cerrar el turno: el pedido abierto NO tiene ventana que lo pueda dejar
    // afuera. Este es el caso que hace que "lo abierto" no se filtre por turno.
    await page.goto('/ventas')
    await closeShiftIfOpen(page)

    await page.goto('/delivery')
    await expect(tarjeta(page, 'new', num)).toBeVisible({ timeout: 15_000 })

    // Y sin turno abierto, "Entregados" dice POR QUÉ está vacía en vez de
    // mentir con "Sin pedidos".
    await expect(page.getByTestId('delivery-empty-delivered'))
      .toContainText('Sin turno abierto')

    // Limpieza: entregarlo, igual que hace el caso del aviso. Sin esto el pedido
    // quedaba pendiente PARA SIEMPRE, y "sin deliveries abiertos el cierre NO
    // muestra el aviso" (al final de este mismo describe) fallaba en una base
    // limpia — medido en Docker el 2026-09-30: "Hay 1 delivery sin entregar".
    await page.goto('/ventas')
    await openShiftIfClosed(page, 50000)
    await page.goto('/delivery')
    await marcarEntregado(page, num)
  })

  test('creado en un turno y entregado en OTRO: aparece en Entregados del turno que lo entregó', async ({ page }) => {
    // EL CASO QUE JUSTIFICA LA COLUMNA delivered_at. Con la ventana puesta sobre
    // `created_at`, este pedido se caería de la pantalla justo al marcarlo
    // entregado —nació en el turno anterior— que es el momento exacto en que el
    // cajero mira para confirmar que quedó bien.
    await loginAsOwner(page)
    await page.goto('/ventas')

    // Turno A: solo se crea el pedido.
    await openShiftIfClosed(page, 50000)
    const num = await venderDelivery(page)
    await page.goto('/ventas')
    await closeShiftIfOpen(page)

    // Turno B: acá se entrega.
    await openShiftIfClosed(page, 50000)
    await page.goto('/delivery')
    await expect(tarjeta(page, 'new', num)).toBeVisible({ timeout: 15_000 })
    await marcarEntregado(page, num)

    await expect(tarjeta(page, 'delivered', num)).toBeVisible()
  })

  test('lo entregado en el turno anterior NO aparece en el siguiente', async ({ page }) => {
    // El contraste del caso de arriba, y el que reemplaza a "se vacía a
    // medianoche": la ventana existe y CORTA. Sin este caso, un filtro que
    // trajera todos los entregados de siempre también pasaría el test anterior.
    await loginAsOwner(page)
    await page.goto('/ventas')
    await openShiftIfClosed(page, 50000)

    const num = await venderDelivery(page)
    await page.goto('/delivery')
    await marcarEntregado(page, num)

    // Cerrar el turno que lo entregó y abrir uno nuevo.
    await page.goto('/ventas')
    await closeShiftIfOpen(page)
    await openShiftIfClosed(page, 50000)

    await page.goto('/delivery')
    // Primero la señal POSITIVA (el estado vacío explícito solo se pinta con los
    // datos cargados); recién después la ausencia significa algo.
    await expect(page.getByTestId('delivery-empty-delivered'))
      .toContainText('Sin pedidos')
    await expect(tarjeta(page, 'delivered', num)).toHaveCount(0)
  })

  test('el cierre de turno AVISA de los deliveries sin entregar, y no bloquea', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/ventas')
    await openShiftIfClosed(page, 50000)

    const num = await venderDelivery(page)

    await page.getByRole('button', { name: 'Cerrar turno', exact: true }).click()
    await expect(page.getByText('Cerrar turno de caja')).toBeVisible()

    const aviso = page.getByTestId('close-shift-delivery-warning')
    await expect(aviso).toBeVisible({ timeout: 15_000 })
    await expect(aviso).toContainText('sin entregar')

    // NO BLOQUEA: el cierre se confirma igual. Es la diferencia con un guard, y
    // es deliberada — el pedido puede quedar legítimamente para el turno que
    // entra, y bloquear dejaría al cajero sin salida.
    await page.getByTestId('close-shift-declared').fill('0')
    await page.getByRole('button', { name: 'Confirmar cierre' }).click()
    await expect(page.getByText('Sin turno')).toBeVisible({ timeout: 15_000 })

    // Limpieza: el pedido queda entregado para no dejar ruido a los que siguen.
    await openShiftIfClosed(page, 50000)
    await page.goto('/delivery')
    await marcarEntregado(page, num)
  })

  test('sin deliveries abiertos el cierre NO muestra el aviso', async ({ page }) => {
    // Contraste obligatorio: un banner que se mostrara SIEMPRE pasaría el caso
    // anterior sin probar nada (R10 — el discriminador es positivo y negativo
    // en la misma aserción, acá repartido en dos casos del mismo flujo).
    await loginAsOwner(page)
    await page.goto('/ventas')
    await openShiftIfClosed(page, 50000)

    // El caso anterior dejó todo entregado; verificarlo antes de afirmar la
    // ausencia evita que este test pase por un estado sucio.
    await page.goto('/delivery')
    // Señal POSITIVA: el estado vacío explícito de cada columna. "0 tarjetas"
    // también se cumplía mientras DeliveryPage mostraba "Cargando delivery..."
    // (medido 2026-09-30: pasó en verde con un pedido pendiente en la base).
    await expect(page.getByTestId('delivery-empty-new')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('delivery-empty-in_transit')).toBeVisible()

    await page.goto('/ventas')
    await page.getByRole('button', { name: 'Cerrar turno', exact: true }).click()
    await expect(page.getByText('Cerrar turno de caja')).toBeVisible()
    // El modal CONTESTÓ "ninguno" — no es que el conteo siga cargando (antes
    // useDeliveryCount arrancaba en 0 y esta ausencia pasaba por la carga).
    await expect(page.getByTestId('close-shift-delivery-check')).toHaveAttribute('data-estado', 'ninguno', { timeout: 15_000 })
    await expect(page.getByTestId('close-shift-delivery-warning')).toHaveCount(0)

    await page.getByTestId('close-shift-declared').fill('0')
    await page.getByRole('button', { name: 'Confirmar cierre' }).click()
    await expect(page.getByText('Sin turno')).toBeVisible({ timeout: 15_000 })
  })
})
