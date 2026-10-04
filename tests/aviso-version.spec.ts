import { test, expect, type Page } from '@playwright/test'
import { loginAsOwner, ownerCreds } from './helpers/auth'
import { cliente, psql } from './helpers/db-local'

// ============================================================================
// Aviso de versión nueva (src/hooks/useVersionCheck.ts + VersionBanner) y la
// marca de versión por equipo (supabase/app-version.sql + useMarcarVersion).
//
// La versión de la app en el dev server es 'dev' y el dev server publica
// /version.json = {"version":"dev"} (vite.config.ts). Para simular un deploy
// nuevo, se intercepta /version.json con otra versión.
//
// El chequeo corre al cargar la página (en /login: después la app navega sin
// recargar), cada 5 min y al volver a primer plano. Por eso las rutas falsas se
// instalan ANTES del login.
// ============================================================================

const BANNER = 'version-nueva'

async function publicar(page: Page, version: string) {
  await page.unroute('**/version.json')
  await page.route('**/version.json', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version }) }))
}

test('misma versión publicada → SIN aviso, y la versión se ve en la pantalla', async ({ page }) => {
  const consultada = page.waitForResponse('**/version.json')
  await loginAsOwner(page)
  const r = await consultada
  expect(await r.json()).toEqual({ version: 'dev' })          // la consulta ocurrió y respondió la versión real
  await expect(page.getByTestId('app-version')).toHaveText('vdev')
  await expect(page.getByTestId(BANNER)).toHaveCount(0)
})

test('versión publicada DISTINTA → aviso con "Recargar", y recargar recarga la página', async ({ page }) => {
  await publicar(page, 'abc1234')
  await loginAsOwner(page)
  await expect(page.getByTestId(BANNER)).toBeVisible()
  await expect(page.getByTestId(BANNER)).toContainText('Hay una versión nueva')

  // Marca en memoria: si la página se recarga de verdad, desaparece.
  await page.evaluate(() => { (window as unknown as { __marca?: number }).__marca = 1 })
  await Promise.all([page.waitForEvent('load'), page.getByTestId('version-recargar').click()])
  expect(await page.evaluate(() => (window as unknown as { __marca?: number }).__marca)).toBeUndefined()
})

test('un deploy NUEVO se detecta al volver a primer plano, sin recargar', async ({ page }) => {
  const consultada = page.waitForResponse('**/version.json')
  await loginAsOwner(page)
  await consultada
  await expect(page.getByTestId(BANNER)).toHaveCount(0)

  await publicar(page, 'def5678')                              // "sale un release" con la pestaña abierta
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(page.getByTestId(BANNER)).toBeVisible()
})

test('version.json con error → SIN aviso (un fallo de red no es una versión nueva)', async ({ page }) => {
  await page.route('**/version.json', (r) => r.fulfill({ status: 503, body: 'no' }))
  const consultada = page.waitForResponse('**/version.json')
  await loginAsOwner(page)
  await consultada
  await expect(page.getByTestId(BANNER)).toHaveCount(0)
})

test('el equipo reporta su versión a la base; la tabla no se lee directo', async ({ page }) => {
  const { c, uid } = await cliente(ownerCreds())
  psql(`delete from public.app_versiones where user_id = '${uid}';`)
  await loginAsOwner(page)

  // La marca es asíncrona (fire-and-forget): esperar a que aparezca.
  await expect.poll(() => psql(`select version from public.app_versiones where user_id = '${uid}';`), { timeout: 10_000 })
    .toBe('dev')
  const equipo = await page.evaluate(() => window.localStorage.getItem('gvento.equipo'))
  expect(psql(`select equipo from public.app_versiones where user_id = '${uid}';`)).toBe(equipo)

  // Solo por la RPC: leer la tabla directo con un usuario de la app no se puede.
  const directo = await c.from('app_versiones').select('version')
  expect(directo.error?.code, 'un usuario de la app pudo leer app_versiones directo').toBe('42501')
})
