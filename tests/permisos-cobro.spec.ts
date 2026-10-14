import { test, expect, type Page } from '@playwright/test'
import { ownerCreds, type Creds } from './helpers/auth'
import { cliente, psql } from './helpers/db-local'
import { waitPosReady, agregarProductoSimple } from './helpers/pos'
import { openTableAndAddItems } from './helpers/tables'
import { mesaFija, liberarMesa } from './helpers/lab'
import {
  CASOS, prepararRoles, asignarRol, restaurarMozo, limpiarRoles,
  sondaVenta, sondaCobroMesa, SIN_PERMISO_VENDER, SIN_PERMISO_MESA,
} from './helpers/permisos'

// ============================================================================
// A — ESCRITORIO: por rol, lo que la pantalla ofrece = lo que el servidor acepta.
//   POS:   botón Cobrar habilitado ⇔ pos.vender ⇔ register_pos_sale lo deja vender.
//   Mesas: botón Cobrar habilitado ⇔ mesas.cobrar ⇔ register_sale_payment (dine_in) lo deja.
// Requiere A aplicada en la base local (preparar-local la aplica: ORDEN).
// ============================================================================

test.describe.configure({ mode: 'serial' })

const MESA = 'E2E Fija Permisos'
let ORDEN_MESA = ''

test.beforeAll(async ({ browser }) => {
  // Turno abierto (la sonda del cobro de mesa no tiene que caer en "no hay turno"
  // antes del permiso) y una mesa con consumo, armada por el dueño desde la pantalla.
  const owner = await cliente(ownerCreds())
  const abierto = (await owner.c.from('cash_shifts').select('id').eq('restaurant_id', owner.sede).is('closed_at', null).maybeSingle()).data
  if (!abierto) {
    const { error } = await owner.c.from('cash_shifts').insert({ restaurant_id: owner.sede, opened_by: owner.uid, opening_amount: 0 })
    if (error) throw error
  }
  await mesaFija(MESA)
  const page = await browser.newPage()
  await entrar(page, ownerCreds())
  await openTableAndAddItems(page, MESA)
  await page.getByRole('button').filter({ has: page.getByText('Lab Cerveza', { exact: true }) }).first().click()
  await page.getByRole('button', { name: 'Agregar a la mesa' }).click()
  await expect(page.getByTestId('table-item').first()).toBeVisible({ timeout: 15_000 })
  await page.close()
  ORDEN_MESA = psql(`select o.id from public.orders o join public.tables t on t.id = o.table_id
                      where t.name = '${MESA}' and t.restaurant_id = '${owner.sede}'
                        and o.status not in ('delivered', 'cancelled') order by o.created_at desc limit 1;`)
  expect(ORDEN_MESA).toMatch(/^[0-9a-f-]{36}$/)
  prepararRoles()
})

test.afterAll(async () => {
  limpiarRoles()
  await liberarMesa(MESA)
})

async function entrar(page: Page, creds: Creds) {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill(creds.email)
  await page.locator('input[autocomplete="current-password"]').fill(creds.password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page).toHaveURL(/\/ventas$/, { timeout: 15_000 })
}

for (const caso of CASOS) {
  test(`${caso.nombre}: POS ${caso.pos ? 'vende' : 'NO vende'}, Mesas ${caso.mesa ? 'cobra' : 'NO cobra'} — en pantalla y en el servidor`, async ({ page }) => {
    if (caso.rolPersonalizado) asignarRol(caso.rolPersonalizado)
    try {
      await entrar(page, caso.creds())
      const yo = await cliente(caso.creds())

      // ── POS ──
      await waitPosReady(page)
      await agregarProductoSimple(page)
      const cobrar = page.getByTestId('pos-cobrar')
      if (caso.pos) {
        await expect(cobrar).toBeEnabled()
        await expect(page.getByTestId('pos-sin-permiso')).toHaveCount(0)
      } else {
        await expect(cobrar).toBeDisabled()
        await expect(page.getByTestId('pos-sin-permiso')).toBeVisible()
      }
      const venta = await sondaVenta(yo.c)
      expect(venta, 'el servidor tiene que decir lo mismo que la pantalla (POS)')
        .toBe(caso.pos ? 'La venta no tiene ítems' : SIN_PERMISO_VENDER)

      // ── Mesas ──
      await page.goto('/mesas')
      await page.getByRole('button', { name: new RegExp(MESA) }).click()
      const cobrarMesa = page.getByTestId('mesa-cobrar')
      if (caso.mesa) {
        await expect(cobrarMesa).toBeEnabled()
        await expect(page.getByTestId('mesa-sin-permiso')).toHaveCount(0)
      } else {
        await expect(cobrarMesa).toBeDisabled()
        await expect(page.getByTestId('mesa-sin-permiso')).toBeVisible()
      }
      const cobro = await sondaCobroMesa(yo.c, ORDEN_MESA)
      if (caso.mesa) expect(cobro, 'con mesas.cobrar, el servidor no lo rechaza por permiso').not.toContain('permiso')
      else expect(cobro, 'el servidor tiene que decir lo mismo que la pantalla (Mesas)').toBe(SIN_PERMISO_MESA)
    } finally {
      if (caso.rolPersonalizado) restaurarMozo()
    }
  })
}
