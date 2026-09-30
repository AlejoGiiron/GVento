import { test, expect, type Page } from '@playwright/test'
import { loginAsOwner } from './helpers/auth'
import { openTableAndAddItems } from './helpers/tables'
import { openShiftIfClosed } from './helpers/shift'
import { mesaFija, liberarMesa } from './helpers/lab'

// ============================================================================
// El set "qué productos tienen extras" (useProductsWithExtras) mientras CARGA o
// si FALLA. Regresión del bug que causaba el flake de pago-mixto.spec.ts:247.
//
// El bug: el hook devolvía `query.data ?? new Set()`. Mientras la query cargaba,
// "ningún producto tiene extras", y un click sobre un producto CON extras lo
// agregaba directo, sin abrir el modal de configuración. Reproducido el
// 2026-09-30 demorando `product_extras` 1,5 s: el modal no aparecía nunca.
// Con la red de un celular (POS móvil) ese sería el caso común.
//
// Contrato que custodia este spec:
//  · LENTO  → el producto con extras abre el modal (el grid no se muestra hasta
//             conocer el set).
//  · ERROR  → fail-closed: todo producto abre el modal, que decide con los
//             extras del producto. Nunca se saltea la configuración en silencio.
//  · NORMAL → contraste (R10): un producto SIN extras se agrega directo. Sin
//             esto, "abrir siempre el modal" pasaría los otros dos y rompería la
//             venta rápida de mostrador.
// ============================================================================

const MESA = 'E2E Fija Extras'
const CON_EXTRAS = 'Lab Coctel'    // lab-seed: tiene el extra "Lab Doble"
const SIN_EXTRAS = 'Lab Cerveza'   // lab-seed: simple, sin extras
const EXTRAS_API = /\/rest\/v1\/product_extras/

test.afterAll(async () => {
  await liberarMesa(MESA)
})

async function demorarExtras(page: Page, ms: number) {
  await page.route(EXTRAS_API, async (r) => {
    await new Promise((ok) => setTimeout(ok, ms))
    await r.continue()
  })
}

async function picker(page: Page) {
  await loginAsOwner(page)
  await page.goto('/ventas')
  await openShiftIfClosed(page, 0)
  await mesaFija(MESA)   // libre al empezar: cada test abre la mesa de cero
}

const productoEnPicker = (page: Page, nombre: string) =>
  page.getByRole('button').filter({ has: page.getByText(nombre, { exact: true }) }).first()

test.describe('Extras mientras carga: Mesas', () => {
  test('LENTO: el producto con extras abre el modal de configuración', async ({ page }) => {
    await picker(page)
    await demorarExtras(page, 1500)
    await openTableAndAddItems(page, MESA)
    await productoEnPicker(page, CON_EXTRAS).click()
    await expect(page.getByTestId('item-config-modal')).toBeVisible()
  })

  test('ERROR: fail-closed — cualquier producto abre el modal (el modal decide)', async ({ page }) => {
    await picker(page)
    // Error DEL SERVIDOR (500), no de red. Distinción medida (2026-09-30):
    //  · un fallo de RED lo reintenta postgrest-js (3×, 1+2+4 s) y encima React
    //    Query (3×): ~35 s de "Cargando" antes del estado de error. Aceptable:
    //    sin red tampoco se puede agregar el ítem (la RPC de alta también falla).
    //  · un 4xx/500 postgrest-js NO lo reintenta; solo React Query (~7 s). Es el
    //    caso que el fail-closed cubre: ESA query falla y el resto funciona.
    await page.route(EXTRAS_API, (r) =>
      r.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"e2e: falla forzada"}' }))
    await openTableAndAddItems(page, MESA)
    // Hasta que React Query da la query por fallida el picker muestra "Cargando".
    // Después, el producto SIN extras también pasa por el modal: el set no se
    // conoce, así que no se asume "sin extras".
    await productoEnPicker(page, SIN_EXTRAS).click({ timeout: 20_000 })
    await expect(page.getByTestId('item-config-modal')).toBeVisible()
  })

  test('NORMAL (contraste): el producto SIN extras se agrega directo, sin modal', async ({ page }) => {
    await picker(page)
    await openTableAndAddItems(page, MESA)
    const boton = productoEnPicker(page, SIN_EXTRAS)
    await boton.click()
    // Marcado en la selección (×1) y SIN modal.
    await expect(boton).toContainText('×1')
    await expect(page.getByTestId('item-config-modal')).toHaveCount(0)
  })
})

test.describe('Extras mientras carga: POS', () => {
  test('LENTO: el producto con extras abre el modal de configuración', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/ventas')
    await openShiftIfClosed(page, 0)
    // La demora se instala DESPUÉS de abrir turno y se recarga: openShiftIfClosed
    // espera red inactiva, y con la demora puesta antes, el set ya había llegado
    // al momento del click — el test pasaba contra el código con el defecto
    // (auditado por mutación el 2026-09-30: sobrevivía).
    await demorarExtras(page, 3000)
    await page.goto('/ventas')
    await page.getByPlaceholder('Buscar producto...').fill(CON_EXTRAS)
    await page.getByTestId('product-card').first().click()
    await expect(page.getByTestId('item-config-modal')).toBeVisible()
  })
})
