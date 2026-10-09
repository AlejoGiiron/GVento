import { test, expect, type Page } from '@playwright/test'
import { ownerCreds, loginAsOwner } from './helpers/auth'
import { cliente, psql } from './helpers/db-local'

// ============================================================================
// Configuración → POS móvil: el editor de fijados y de "más vendidos"
// (src/components/config/SeccionPosMovil.tsx). Se guarda como UNA clave
// (pos_movil) por update_restaurant_config. Base LOCAL; la config de la sede LAB
// se restaura al texto exacto en afterAll (por UUID de sede).
// ============================================================================

let SEDE = ''
let ORIGINAL = ''
const prod = (nombre: string) => psql(`select id from public.products where restaurant_id = '${SEDE}' and name = '${nombre}';`)
const posMovil = () => psql(`select coalesce(config -> 'pos_movil', 'null'::jsonb)::text from public.restaurants where id = '${SEDE}';`)
const resto = () => psql(`select (coalesce(config, '{}'::jsonb) - 'pos_movil')::text from public.restaurants where id = '${SEDE}';`)

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  SEDE = (await cliente(ownerCreds())).sede
  ORIGINAL = psql(`select coalesce(config, '{}'::jsonb)::text from public.restaurants where id = '${SEDE}';`)
  psql(`update public.restaurants set config = coalesce(config, '{}'::jsonb) - 'pos_movil' where id = '${SEDE}';`)
})
test.afterAll(() => {
  psql(`update public.restaurants set config = '${ORIGINAL.replace(/'/g, "''")}'::jsonb where id = '${SEDE}';`)
  expect(psql(`select coalesce(config, '{}'::jsonb)::text from public.restaurants where id = '${SEDE}';`)).toBe(ORIGINAL)
})

async function abrir(page: Page) {
  await loginAsOwner(page)
  await page.goto('/configuracion')
  await page.getByRole('button', { name: 'POS móvil' }).click()
  await expect(page.getByTestId('cfg-pos-movil')).toBeVisible()
}
async function fijar(page: Page, nombre: string) {
  await page.getByTestId('cfg-fijado-buscar').fill(nombre)
  await page.getByTestId('cfg-fijado-agregar').filter({ hasText: nombre }).first().click()
}

test('fijar, ordenar y guardar: queda pos_movil por id y en orden; el resto de la config no se toca', async ({ page }) => {
  const restoAntes = resto()
  // Pasa por la RPC con SOLO la clave pos_movil, y ningún PATCH a restaurants lleva config.
  const rpc: string[][] = []
  let patchConConfig = false
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/rest/v1/rpc/update_restaurant_config')) {
      rpc.push(Object.keys((r.postDataJSON() as { p_cambios: Record<string, unknown> }).p_cambios))
    }
    if (r.method() === 'PATCH' && r.url().includes('/rest/v1/restaurants')
        && 'config' in ((r.postDataJSON() ?? {}) as Record<string, unknown>)) patchConConfig = true
  })
  await abrir(page)
  await fijar(page, 'Lab Coctel')
  await fijar(page, 'Lab Agua')
  await expect(page.getByTestId('cfg-fijado')).toHaveCount(2)
  await page.getByTestId('cfg-fijado').first().getByTestId('cfg-fijado-bajar').click()
  await expect(page.getByTestId('cfg-fijado').first()).toHaveAttribute('data-producto-id', prod('Lab Agua'))
  await page.getByTestId('cfg-mv-cantidad').fill('4')
  await page.getByTestId('cfg-mv-dias').fill('7')
  await page.getByTestId('cfg-pos-movil-guardar').click()
  await expect(page.getByText('Cambios guardados').first()).toBeVisible()

  expect(rpc).toEqual([['pos_movil']])
  expect(patchConConfig).toBe(false)
  expect(JSON.parse(posMovil())).toEqual({ fijados: [prod('Lab Agua'), prod('Lab Coctel')], mas_vendidos: { cantidad: 4, dias: 7 } })
  expect(resto(), 'guardar POS móvil tocó otras claves').toBe(restoAntes)

  // Al volver a entrar, la pantalla muestra lo guardado (no los valores por defecto).
  await page.reload()
  await page.getByRole('button', { name: 'POS móvil' }).click()
  await expect(page.getByTestId('cfg-fijado')).toHaveCount(2)
  await expect(page.getByTestId('cfg-mv-cantidad')).toHaveValue('4')
})

test('un número fuera de rango avisa y se guarda el valor por defecto, no el inválido', async ({ page }) => {
  await abrir(page)
  await page.getByTestId('cfg-mv-cantidad').fill('99')
  await expect(page.getByTestId('cfg-mv-fuera-de-rango')).toBeVisible()
  await page.getByTestId('cfg-pos-movil-guardar').click()
  await expect(page.getByText('Cambios guardados').first()).toBeVisible()
  expect((JSON.parse(posMovil()) as { mas_vendidos: { cantidad: number } }).mas_vendidos.cantidad).toBe(8)
})

test('un fijado que ya no está activo se muestra como tal y se puede quitar', async ({ page }) => {
  const fantasma = '00000000-0000-4000-8000-0000000000aa'
  psql(`update public.restaurants set config = jsonb_set(config, '{pos_movil,fijados}', '["${fantasma}"]'::jsonb) where id = '${SEDE}';`)
  await abrir(page)
  await expect(page.getByTestId('cfg-fijado')).toContainText('inactivo')
  await page.getByTestId('cfg-fijado-quitar').click()
  await expect(page.getByTestId('cfg-fijado')).toHaveCount(0)
  await page.getByTestId('cfg-pos-movil-guardar').click()
  await expect(page.getByText('Cambios guardados').first()).toBeVisible()
  expect((JSON.parse(posMovil()) as { fijados: string[] }).fijados).toEqual([])
})
