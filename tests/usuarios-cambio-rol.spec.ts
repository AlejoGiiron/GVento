import { test, expect, type Page } from '@playwright/test'
import { loginAsOwner, cashierCreds, waiterCreds } from './helpers/auth'
import { psql } from './helpers/db-local'

// ============================================================================
// Cambiar el rol desde Configuración → Usuarios:
//  1. escribe role_id Y role (el rol viejo) en la MISMA llamada. Antes escribía solo
//     role_id: un cajero pasado a mozo seguía 'cashier' (entraba a /m sin fiado) y un
//     mozo pasado a cajero seguía 'waiter' (tenía fiado y no podía cobrar);
//  2. la fila muestra lo que devolvió la BASE apenas se guarda. Antes mostraba el rol
//     ANTERIOR hasta que terminaba la recarga de la lista, y un segundo cambio hacia
//     ese valor no disparaba nada: se perdía sin aviso;
//  3. un rol personalizado (is_system = false) da 'waiter': falla CERRADO (R2).
// Contrato en src/lib/rolLegacy.ts.
//
// Para que (2) sea determinista, la RECARGA de la lista se retiene RECARGA_MS: los
// cambios ocurren justo en la ventana en que el código viejo mostraba el valor
// anterior. Sin retenerla, el test dependería de que la recarga fuera lenta.
// Red de seguridad: afterAll restaura los perfiles como postgres (el trigger de
// auto-escalada no muerde fuera de 'authenticated') y borra el rol personalizado.
// ============================================================================

test.describe.configure({ mode: 'serial' })

const CAJERO = cashierCreds().email
const MOZO = waiterCreds().email
const PERSONALIZADO = 'e2e-personalizado'
const RECARGA_MS = 5_000

type Snap = { role: string; role_id: string }
const snaps = new Map<string, Snap>()

/** 'rol_viejo|rol_rbac' del perfil, leído en la base. */
const estado = (email: string) =>
  psql(`select p.role || '|' || r.name from public.profiles p
          join public.roles r on r.id = p.role_id where p.email = '${email}'`)

test.beforeAll(() => {
  for (const email of [CAJERO, MOZO]) {
    const [role, role_id] = psql(`select role || '|' || role_id from public.profiles where email = '${email}'`).split('|')
    snaps.set(email, { role, role_id })
  }
  // Punto de partida coherente (si no, el test no distingue nada).
  expect(estado(CAJERO)).toBe('cashier|cajero')
  expect(estado(MOZO)).toBe('waiter|mozo')
  // Rol personalizado en la organización del cajero de prueba (por su perfil, no por nombre).
  psql(`insert into public.roles (organization_id, name, is_system, permissions)
        select organization_id, '${PERSONALIZADO}', false, '["pos.vender"]'::jsonb
          from public.profiles where email = '${CAJERO}'
        on conflict (organization_id, name) do nothing`)
})

test.afterAll(() => {
  for (const [email, s] of snaps)
    psql(`update public.profiles set role = '${s.role}', role_id = '${s.role_id}' where email = '${email}'`)
  psql(`delete from public.roles r using public.profiles p
         where p.email = '${CAJERO}' and r.organization_id = p.organization_id
           and r.name = '${PERSONALIZADO}' and not r.is_system`)
})

async function abrirUsuarios(page: Page) {
  await loginAsOwner(page)
  await page.goto('/configuracion')
  await page.getByRole('button', { name: 'Usuarios' }).click()
  await expect(page.getByRole('heading', { name: 'Usuarios', exact: true })).toBeVisible()
  await expect(page.getByTestId(`user-role-${CAJERO}`)).toBeVisible()
  // Desde acá, toda RECARGA de la lista de perfiles se retiene RECARGA_MS.
  await page.route('**/rest/v1/profiles?**', async (route) => {
    if (route.request().method() === 'GET') await new Promise((r) => setTimeout(r, RECARGA_MS))
    await route.fallback()
  })
}

/** Cambia el rol y espera a que la base CONFIRME (la respuesta del PATCH), no a la recarga. */
async function cambiarRol(page: Page, email: string, rol: string) {
  const select = page.getByTestId(`user-role-${email}`)
  const guardado = page.waitForResponse((r) => r.url().includes('/rest/v1/profiles') && r.request().method() === 'PATCH')
  await select.selectOption({ label: rol })
  expect((await guardado).ok(), 'el PATCH del perfil').toBe(true)
  // Antes de que llegue la recarga retenida: la fila ya muestra lo guardado.
  await expect(select.locator('option:checked'), 'la fila muestra lo que devolvió la base').toHaveText(rol, { timeout: 2_000 })
}

test('cajero → mozo → cajero, seguidos y sin recargar: el rol viejo acompaña al RBAC en cada cambio', async ({ page }) => {
  await abrirUsuarios(page)
  await cambiarRol(page, CAJERO, 'mozo')
  await expect.poll(() => estado(CAJERO), { message: 'cajero pasado a mozo: role = waiter (no entra a /m)' }).toBe('waiter|mozo')
  await cambiarRol(page, CAJERO, 'cajero')
  await expect.poll(() => estado(CAJERO), { message: 'el SEGUNDO cambio también se guarda' }).toBe('cashier|cajero')
})

test('mozo → cajero → mozo, seguidos y sin recargar: el rol viejo acompaña al RBAC en cada cambio', async ({ page }) => {
  await abrirUsuarios(page)
  await cambiarRol(page, MOZO, 'cajero')
  await expect.poll(() => estado(MOZO), { message: 'mozo pasado a cajero: role = cashier (entra a /m y cobra)' }).toBe('cashier|cajero')
  await cambiarRol(page, MOZO, 'mozo')
  await expect.poll(() => estado(MOZO), { message: 'el SEGUNDO cambio también se guarda' }).toBe('waiter|mozo')
})

test('rol personalizado → waiter (falla cerrado): el cajero pasado a un rol personalizado deja de cobrar', async ({ page }) => {
  await abrirUsuarios(page)
  await cambiarRol(page, CAJERO, PERSONALIZADO)
  await expect.poll(() => estado(CAJERO), { message: 'rol personalizado: role = waiter, no cashier' }).toBe(`waiter|${PERSONALIZADO}`)
  // Contraste en la misma pasada: de vuelta a cajero, cobra otra vez.
  await cambiarRol(page, CAJERO, 'cajero')
  await expect.poll(() => estado(CAJERO)).toBe('cashier|cajero')
})
