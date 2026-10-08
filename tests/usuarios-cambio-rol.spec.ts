import { test, expect, type Page } from '@playwright/test'
import { loginAsOwner, cashierCreds, waiterCreds } from './helpers/auth'
import { psql } from './helpers/db-local'

// ============================================================================
// Cambiar el rol desde Configuración → Usuarios escribe role_id Y role (el rol
// viejo) en la MISMA llamada. Antes escribía solo role_id: un cajero pasado a mozo
// seguía 'cashier' (entraba a /m sin fiado) y un mozo pasado a cajero seguía
// 'waiter' (tenía fiado y no podía cobrar). Contrato en src/lib/rolLegacy.ts.
//
// Se lee el resultado en la BASE, no en la pantalla: el select muestra role_id,
// que ya se escribía antes; lo que este spec mide es role.
// Red de seguridad: afterAll restaura los dos perfiles como postgres (el trigger
// de auto-escalada no muerde fuera de 'authenticated').
// ============================================================================

test.describe.configure({ mode: 'serial' })

const CAJERO = cashierCreds().email
const MOZO = waiterCreds().email

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
})

test.afterAll(() => {
  for (const [email, s] of snaps)
    psql(`update public.profiles set role = '${s.role}', role_id = '${s.role_id}' where email = '${email}'`)
})

async function abrirUsuarios(page: Page) {
  await loginAsOwner(page)
  await page.goto('/configuracion')
  await page.getByRole('button', { name: 'Usuarios' }).click()
  await expect(page.getByRole('heading', { name: 'Usuarios', exact: true })).toBeVisible()
}

async function cambiarRol(page: Page, email: string, rol: string) {
  const select = page.getByTestId(`user-role-${email}`)
  await expect(select).toBeEnabled()
  await select.selectOption({ label: rol })
  // El select es CONTROLADO por user.role_id: tras el cambio React vuelve a mostrar
  // el valor anterior hasta que la lista se recarga. Sin esperar acá, el cambio
  // siguiente elige un valor que ya parece elegido y no dispara nada.
  await expect(select.locator('option:checked')).toHaveText(rol)
}

test('cajero → mozo → cajero: el rol viejo acompaña al RBAC en cada cambio', async ({ page }) => {
  await abrirUsuarios(page)
  await cambiarRol(page, CAJERO, 'mozo')
  await expect.poll(() => estado(CAJERO), { message: 'cajero pasado a mozo: role = waiter (no entra a /m)' }).toBe('waiter|mozo')
  await cambiarRol(page, CAJERO, 'cajero')
  await expect.poll(() => estado(CAJERO)).toBe('cashier|cajero')
})

test('mozo → cajero → mozo: el rol viejo acompaña al RBAC en cada cambio', async ({ page }) => {
  await abrirUsuarios(page)
  await cambiarRol(page, MOZO, 'cajero')
  await expect.poll(() => estado(MOZO), { message: 'mozo pasado a cajero: role = cashier (entra a /m y cobra)' }).toBe('cashier|cajero')
  await cambiarRol(page, MOZO, 'mozo')
  await expect.poll(() => estado(MOZO)).toBe('waiter|mozo')
})
