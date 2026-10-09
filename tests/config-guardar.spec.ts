import { test, expect, type Page, type Request } from '@playwright/test'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ownerCreds, loginAsOwner } from './helpers/auth'
import { cliente, psql } from './helpers/db-local'

// ============================================================================
// CADA pantalla que guarda restaurants.config pasa por update_restaurant_config
// (supabase/restaurant-config-rpc.sql) y lo guardado está en la base:
// Restaurante (slug), QR de Nequi, Caja, Cocina, Delivery y Notificaciones.
// El editor de POS móvil está en tests/config-pos-movil.spec.ts.
//
// Cada test verifica las tres cosas:
//   1. salió UN POST a /rpc/update_restaurant_config con EXACTAMENTE las claves de
//      esa pantalla (no el objeto entero);
//   2. NINGÚN PATCH a /restaurants llevó `config` (el camino viejo);
//   3. el valor quedó en la base (consulta directa, R4).
// Base LOCAL; la config de la sede LAB se restaura al texto exacto en afterAll
// (por UUID de sede).
// ============================================================================

let owner: SupabaseClient
let SEDE = ''
let ORIGINAL = ''
const clave = (k: string) => psql(`select coalesce(config -> '${k}', 'null'::jsonb)::text from public.restaurants where id = '${SEDE}';`)
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  const o = await cliente(ownerCreds())
  owner = o.c; SEDE = o.sede
  ORIGINAL = psql(`select coalesce(config, '{}'::jsonb)::text from public.restaurants where id = '${SEDE}';`)
})
test.afterAll(async () => {
  psql(`update public.restaurants set config = '${ORIGINAL.replace(/'/g, "''")}'::jsonb where id = '${SEDE}';`)
  expect(psql(`select coalesce(config, '{}'::jsonb)::text from public.restaurants where id = '${SEDE}';`), 'config restaurada').toBe(ORIGINAL)
})

/** Vigila la pantalla: devuelve las claves de cada POST a la RPC y si algún PATCH a restaurants llevó config. */
function vigilar(page: Page) {
  const rpc: string[][] = []
  let patchConConfig = false
  page.on('request', (r: Request) => {
    if (r.method() === 'POST' && r.url().includes('/rest/v1/rpc/update_restaurant_config')) {
      rpc.push(Object.keys((r.postDataJSON() as { p_cambios: Record<string, unknown> }).p_cambios).sort())
    }
    if (r.method() === 'PATCH' && r.url().includes('/rest/v1/restaurants')) {
      if ('config' in ((r.postDataJSON() ?? {}) as Record<string, unknown>)) patchConConfig = true
    }
  })
  return { rpc, patchConConfig: () => patchConConfig }
}

async function abrir(page: Page, seccion: string) {
  await loginAsOwner(page)
  await page.goto('/configuracion')
  await page.getByRole('button', { name: seccion, exact: true }).click()
  await expect(page.getByRole('heading', { name: seccion, exact: true })).toBeVisible()
}
async function guardar(page: Page) {
  const respuesta = page.waitForResponse((r) => r.url().includes('/rest/v1/rpc/update_restaurant_config'))
  await page.getByRole('button', { name: 'Guardar', exact: true }).click()
  expect((await respuesta).ok(), 'la RPC respondió con error').toBe(true)
}

test('Restaurante: el slug se guarda por la RPC (el nombre va por columnas, sin config)', async ({ page }) => {
  const v = vigilar(page)
  await abrir(page, 'Restaurante')
  await page.getByPlaceholder('mi-restaurante').fill('E2E Slug Guardar')
  await guardar(page)
  expect(v.rpc).toEqual([['slug']])
  expect(v.patchConConfig()).toBe(false)
  expect(clave('slug')).toBe('"e2e-slug-guardar"')
})

test('QR de Nequi: subir el archivo guarda nequi_qr_url por la RPC', async ({ page }) => {
  const v = vigilar(page)
  await abrir(page, 'Caja')
  const respuesta = page.waitForResponse((r) => r.url().includes('/rest/v1/rpc/update_restaurant_config'))
  await page.locator('input[type="file"]').setInputFiles({ name: 'qr.png', mimeType: 'image/png', buffer: PNG_1PX })
  expect((await respuesta).ok()).toBe(true)
  expect(v.rpc).toEqual([['nequi_qr_url']])
  expect(v.patchConConfig()).toBe(false)
  expect(clave('nequi_qr_url')).toMatch(new RegExp(`/restaurant-logos/${SEDE}/nequi-qr\\.png"$`))
  await owner.storage.from('restaurant-logos').remove([`${SEDE}/nequi-qr.png`])
})

test('Caja: motivos y métodos se guardan por la RPC', async ({ page }) => {
  const v = vigilar(page)
  await abrir(page, 'Caja')
  const antes = JSON.parse(clave('payment_methods')) as string[] | null
  const teniaTransferencia = (antes ?? ['cash', 'card', 'transfer', 'nequi']).includes('transfer')
  await page.getByRole('button', { name: 'Transferencia', exact: true }).click()
  await guardar(page)
  expect(v.rpc).toEqual([['cash_out_reasons', 'payment_methods']])
  expect(v.patchConConfig()).toBe(false)
  expect((JSON.parse(clave('payment_methods')) as string[]).includes('transfer')).toBe(!teniaTransferencia)
})

test('Cocina: PIN, estaciones y semáforo se guardan por la RPC', async ({ page }) => {
  const v = vigilar(page)
  await abrir(page, 'Cocina')
  await page.getByPlaceholder('Sin PIN = acceso libre').fill('4321')
  await guardar(page)
  expect(v.rpc).toEqual([['kds_timers', 'kitchen_pin', 'kitchen_stations']])
  expect(v.patchConConfig()).toBe(false)
  expect(clave('kitchen_pin')).toBe('"4321"')
})

test('Delivery: el tiempo por defecto se guarda por la RPC', async ({ page }) => {
  const v = vigilar(page)
  await abrir(page, 'Delivery')
  await page.locator('input[type="number"]').first().fill('37')
  await guardar(page)
  expect(v.rpc).toEqual([['default_delivery_time']])
  expect(v.patchConConfig()).toBe(false)
  expect(clave('default_delivery_time')).toBe('37')
})

test('Notificaciones: los sonidos se guardan por la RPC', async ({ page }) => {
  const v = vigilar(page)
  await abrir(page, 'Notificaciones')
  const antes = JSON.parse(clave('notifications')) as { kitchen_sound?: boolean } | null
  const sonabaCocina = antes?.kitchen_sound ?? true
  await page.getByText('Cocina — nueva comanda', { exact: true }).locator('xpath=../..').getByRole('button').click()
  await guardar(page)
  expect(v.rpc).toEqual([['notifications']])
  expect(v.patchConConfig()).toBe(false)
  expect((JSON.parse(clave('notifications')) as { kitchen_sound: boolean }).kitchen_sound).toBe(!sonabaCocina)
})
