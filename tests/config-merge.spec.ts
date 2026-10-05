import { test, expect } from '@playwright/test'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ownerCreds, cashierCreds, loginAsOwner } from './helpers/auth'
import { cliente, psql } from './helpers/db-local'
import { CLAVES_CONFIG } from '../src/lib/restaurantConfig'

// ============================================================================
// restaurants.config se fusiona en el SERVIDOR (supabase/restaurant-config-rpc.sql).
// Antes el navegador reescribía el objeto entero con su copia y pisaba lo que no
// estaba cambiando. Base LOCAL; la config de la sede LAB se restaura al texto
// exacto en afterAll (por UUID de sede).
// ============================================================================

let owner: SupabaseClient
let cajero: SupabaseClient
let SEDE = ''
let ORIGINAL = ''
const leer = () => psql(`select coalesce(config, '{}'::jsonb)::text from public.restaurants where id = '${SEDE}';`)
const clave = (k: string) => psql(`select coalesce(config -> '${k}', 'null'::jsonb)::text from public.restaurants where id = '${SEDE}';`)
const poner = (k: string, v: unknown) =>
  psql(`update public.restaurants set config = coalesce(config, '{}'::jsonb) || jsonb_build_object('${k}', '${JSON.stringify(v)}'::jsonb) where id = '${SEDE}';`)

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  const o = await cliente(ownerCreds())
  owner = o.c; SEDE = o.sede
  cajero = (await cliente(cashierCreds())).c
  ORIGINAL = leer()
})
test.afterAll(() => {
  psql(`update public.restaurants set config = '${ORIGINAL.replace(/'/g, "''")}'::jsonb where id = '${SEDE}';`)
  expect(leer(), 'config restaurada').toBe(ORIGINAL)
})

test('CONTRATO: cada clave de CLAVES_CONFIG (TS) la acepta la RPC (allowlist del SQL)', async () => {
  const antes = leer()
  const actual = JSON.parse(antes) as Record<string, unknown>
  for (const k of CLAVES_CONFIG) {
    const r = await owner.rpc('update_restaurant_config', { p_cambios: { [k]: actual[k] ?? null } })
    expect(r.error?.message ?? 'ok', `la clave "${k}" está en el TS y el SQL la rechaza`).toBe('ok')
  }
  expect(leer(), 'reescribir cada clave con su propio valor no cambia nada').toBe(antes)
})

test('una clave fuera de la lista se rechaza y NO se guarda nada (tampoco las válidas del mismo pedido)', async () => {
  const antes = leer()
  const r = await owner.rpc('update_restaurant_config', { p_cambios: { kitchen_pin: '9999', clave_inventada: 1 } })
  expect(r.error?.message ?? '').toMatch(/Clave de configuración no permitida: clave_inventada/)
  expect(leer()).toBe(antes)
})

test('toca SOLO las claves que vienen: las demás quedan; null borra', async () => {
  poner('nequi_qr_url', 'https://x.co/qr-e2e.png')
  poner('kitchen_stations', ['Barra', 'Cocina'])
  const r = await owner.rpc('update_restaurant_config', { p_cambios: { default_delivery_time: 41, kitchen_stations: null } })
  expect(r.error, r.error?.message).toBeNull()
  expect(clave('nequi_qr_url')).toBe('"https://x.co/qr-e2e.png"')
  expect(clave('default_delivery_time')).toBe('41')
  expect(clave('kitchen_stations')).toBe('null')
})

test('sin config.acceder (cajero) → se rechaza y no cambia nada', async () => {
  const antes = leer()
  const r = await cajero.rpc('update_restaurant_config', { p_cambios: { default_delivery_time: 5 } })
  expect(r.error?.message ?? '').toMatch(/permiso para cambiar la configuración/)
  expect(leer()).toBe(antes)
})

test('EL BUG: la pantalla tiene el QR VIEJO; otro guarda uno nuevo; esta guarda "Caja" → queda el NUEVO', async ({ page }) => {
  // La copia de la pantalla tiene que TENER la clave con un valor viejo: si no la
  // tiene, ni el guardado viejo la pisa (un mutante que manda { ...copia, ...cambio }
  // sobrevivió así el 2026-10-04).
  poner('nequi_qr_url', 'https://x.co/qr-VIEJO.png')
  await loginAsOwner(page)
  await page.goto('/configuracion')
  await page.getByRole('button', { name: 'Caja', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Caja', exact: true })).toBeVisible()
  // La pantalla ya tiene su copia (QR viejo). Otro equipo sube el nuevo por detrás.
  poner('nequi_qr_url', 'https://x.co/qr-NUEVO.png')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByText('Cambios guardados').first()).toBeVisible()
  // Con el guardado viejo ({ ...copia, ...cambio }) esto volvía al VIEJO.
  expect(clave('nequi_qr_url')).toBe('"https://x.co/qr-NUEVO.png"')
  expect(clave('payment_methods')).not.toBe('null')       // y lo de "Caja" sí se guardó
})
