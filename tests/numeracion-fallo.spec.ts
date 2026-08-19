import { test, expect, type Page } from '@playwright/test'
import { loginAsOwner } from './helpers/auth'
import { openShiftIfClosed, closeShiftIfOpen } from './helpers/shift'
import { saveProductAndClose } from './helpers/product'

/**
 * ⚠️  Suite para el LABORATORIO. NO correr contra producción.
 *
 * Cubre el fallo que antes era MUDO: la venta se cobra, `assignOrderNumber`
 * falla y la venta queda SIN número — invisible en el Historial (ordena por
 * número), sin ticket reimprimible y sin contar en getShiftSalesCount.
 *
 * El fallo se fuerza interceptando la RPC `next_order_number` con
 * `page.route`, que es la única forma limpia de provocarlo desde afuera: la
 * secuencia no falla sola en un lab sano.
 *
 * Lo que se verifica:
 *   1. La venta SE COBRA igual (el fallo del número no tumba el cobro).
 *   2. El cajero VE el aviso en vez de un "¡Cobro exitoso!" que miente.
 *   3. "Reintentar" completa el número una vez que la RPC vuelve.
 *   4. El reintento NO quema un número extra cuando el que falló fue el UPDATE
 *      (la secuencia ya había entregado uno y se reusa).
 */

const SUFFIX = Date.now().toString().slice(-6)
const CAT = `E2E NumFail ${SUFFIX}`
const PROD = `E2E NumFailProd ${SUFFIX}`

const RPC_NEXT = '**/rest/v1/rpc/next_order_number'
const PATCH_ORDERS = '**/rest/v1/orders?id=eq.*'

function parseVentaNumber(text: string): number {
  const m = text.match(/#(\d+)/)
  if (!m) throw new Error(`No se encontró número de venta en: "${text}"`)
  return Number(m[1])
}

/** Cobra el producto al contado y deja el modal en el paso de éxito. */
async function cobrar(page: Page) {
  await page.goto('/ventas')
  await openShiftIfClosed(page, 0)
  await page.getByPlaceholder('Buscar producto...').fill(PROD)
  await page.getByTestId('product-card').first().click()

  await page.getByRole('button', { name: 'Cobrar' }).click()
  await page.getByText('Efectivo', { exact: true }).click()
  await page.getByRole('button', { name: /Continuar/ }).click()
  await page.getByTestId('checkout-received').fill('200000')
  await page.getByRole('button', { name: /Confirmar cobro/ }).click()
}

test.describe.serial('Numeración: fallo visible + reintento', () => {
  test('setup: categoría y producto', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/productos')
    await page.getByRole('button', { name: 'Nueva categoría' }).click()
    await page.getByPlaceholder('Ej: Cocteles clásicos').fill(CAT)
    await page.getByRole('button', { name: 'Crear categoría' }).click()
    await expect(page.getByRole('button', { name: new RegExp(CAT) })).toBeVisible()

    await page.getByRole('button', { name: 'Nuevo producto' }).click()
    await page.getByPlaceholder('Ej: Mojito Cubano').fill(PROD)
    await page.getByPlaceholder('0').first().fill('10000')
    await page.getByTestId('product-category-select').selectOption({ label: CAT })
    await saveProductAndClose(page)
    await expect(page.getByText(PROD)).toBeVisible()
  })

  test('si falla next_order_number: la venta se cobra y el cajero VE el aviso', async ({ page }) => {
    await loginAsOwner(page)
    await page.route(RPC_NEXT, (route) => route.abort())

    await cobrar(page)

    // El cobro llega a éxito igual: el número no es condición para cobrar.
    await expect(page.getByText('¡Cobro exitoso!')).toBeVisible({ timeout: 15_000 })
    // Y el fallo YA NO ES MUDO.
    await expect(page.getByTestId('success-sin-numero')).toBeVisible()
    await expect(page.getByText('Venta registrada — sin número asignado')).toBeVisible()
    await expect(page.getByTestId('retry-order-number')).toBeEnabled()

    await page.unroute(RPC_NEXT)
    await page.getByRole('button', { name: 'Nueva venta' }).click()
  })

  test('"Reintentar" asigna el número cuando la RPC vuelve', async ({ page }) => {
    await loginAsOwner(page)
    await page.route(RPC_NEXT, (route) => route.abort())

    await cobrar(page)
    await expect(page.getByTestId('success-sin-numero')).toBeVisible({ timeout: 15_000 })

    // Se restablece la RPC y el cajero reintenta.
    await page.unroute(RPC_NEXT)
    await page.getByTestId('retry-order-number').click()

    // El aviso desaparece y aparece el número.
    await expect(page.getByTestId('success-sin-numero')).toBeHidden({ timeout: 15_000 })
    await expect(page.getByText(/¡Venta #\d+ registrada!/)).toBeVisible()
    const num = parseVentaNumber(await page.getByTestId('success-order-number').innerText())
    expect(num).toBeGreaterThan(0)

    await page.getByRole('button', { name: 'Nueva venta' }).click()
  })

  test('si falla el UPDATE: el reintento REUSA el número, no quema otro', async ({ page }) => {
    await loginAsOwner(page)

    // Deja pasar next_order_number (entrega el número) pero tumba el PATCH que
    // lo graba. Es el modo de fallo PEOR: el contador de la sede ya avanzó.
    // El helper reintenta el UPDATE 3 veces solo; todas caen acá.
    await page.route(PATCH_ORDERS, (route) =>
      route.request().method() === 'PATCH' ? route.abort() : route.continue(),
    )

    await cobrar(page)
    await expect(page.getByTestId('success-sin-numero')).toBeVisible({ timeout: 20_000 })

    await page.unroute(PATCH_ORDERS)
    await page.getByTestId('retry-order-number').click()
    await expect(page.getByTestId('success-sin-numero')).toBeHidden({ timeout: 15_000 })

    const reusado = parseVentaNumber(await page.getByTestId('success-order-number').innerText())
    await page.getByRole('button', { name: 'Nueva venta' }).click()

    // La venta siguiente debe ser EXACTAMENTE reusado + 1. Si el reintento
    // hubiera pedido un número nuevo en vez de reusar el reservado, acá habría
    // un salto — que es justo el hueco que la asimetría de reintento evita.
    await cobrar(page)
    await expect(page.getByText(/¡Venta #\d+ registrada!/)).toBeVisible({ timeout: 15_000 })
    const siguiente = parseVentaNumber(await page.getByTestId('success-order-number').innerText())
    expect(siguiente).toBe(reusado + 1)

    await page.getByRole('button', { name: 'Nueva venta' }).click()
  })

  test('limpieza: cerrar turno, desactivar producto y categoría', async ({ page }) => {
    // 🔴 ESTA LIMPIEZA NO LIMPIABA NADA, y no fallaba: fallaba en SILENCIO.
    // Eran dos defectos encadenados:
    //  1. La confirmación de "Desactivar" un producto es un MODAL DE LA APP con
    //     botón "Sí, desactivar", no un `window.confirm` nativo. El test esperaba
    //     el nativo (`page.once('dialog')`), que nunca llega ⇒ el producto seguía
    //     activo.
    //  2. La categoría se "limpiaba" con un `click({button:'right'}).catch(()=>{})`
    //     — un no-op que además se tragaba su propio error. Y aunque se hubiera
    //     hecho bien, la app RECHAZA desactivar una categoría con productos
    //     activos ("Hay 1 producto en esta categoría"), así que sin (1) tampoco
    //     habría funcionado.
    // Resultado: cada corrida dejaba una categoría `E2E NumFail ...` viva.
    // Consecuencia real (2026-08-19): con 5 acumuladas, el strip de categorías del
    // POS empujaba el carrito fuera de pantalla y tumbó 3 tests AJENOS (pos.spec y
    // venta-espera) por residuo que no era de ellos.
    // Por eso cada paso ahora TERMINA EN UNA ASERCIÓN: una limpieza que no
    // verifica es indistinguible de una que no corre.
    await loginAsOwner(page)
    await closeShiftIfOpen(page)

    await page.goto('/productos')
    await page.getByPlaceholder('Buscar producto...').fill(PROD)
    await page.getByTitle('Desactivar', { exact: true }).first().click()
    await page.getByRole('button', { name: 'Sí, desactivar' }).click()
    await expect(page.getByText(/Sin resultados/)).toBeVisible()

    const tab = page.getByRole('button', { name: new RegExp(CAT) })
    await tab.getByTitle('Editar categoría').click()
    const sw = page.getByRole('switch')
    await expect(sw).toHaveAttribute('aria-checked', 'true')
    await sw.click()
    await page.getByRole('button', { name: 'Guardar cambios' }).click()
    await expect(tab).toHaveCount(0)
  })
})
