import { test, expect } from '@playwright/test'
import { ownerCreds, cashierCreds } from './helpers/auth'
import { cliente, psql } from './helpers/db-local'
import {
  CASOS, prepararRoles, asignarRol, restaurarMozo, limpiarRoles, sondaVenta, SIN_PERMISO_VENDER,
} from './helpers/permisos'

// ============================================================================
// A — CELULAR (m-android y m-iphone): por rol,
//   · la redirección automática a /m: solo dueño, admin y cajero (hasta M2);
//   · /m (por la redirección o por URL): vende ⇔ pos.vender ⇔ el servidor lo acepta;
//   · "Versión completa" funciona para TODOS los roles, mozo incluido, y no vuelve a /m.
// ============================================================================

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  const owner = await cliente(ownerCreds())
  const abierto = (await owner.c.from('cash_shifts').select('id').eq('restaurant_id', owner.sede).is('closed_at', null).maybeSingle()).data
  if (!abierto) {
    const { error } = await owner.c.from('cash_shifts').insert({ restaurant_id: owner.sede, opened_by: owner.uid, opening_amount: 0 })
    if (error) throw error
  }
  prepararRoles()
})

test.afterAll(() => { limpiarRoles() })

for (const caso of CASOS.filter((c) => c.nombre !== 'solo mesa')) {
  test(`${caso.nombre}: ${caso.redirige ? 'va solo a /m' : 'NO se redirige'}; /m ${caso.pos ? 'vende' : 'NO vende'}; "Versión completa" lo deja en escritorio`, async ({ page }) => {
    if (caso.rolPersonalizado) asignarRol(caso.rolPersonalizado)
    try {
      const creds = caso.creds()
      await page.goto('/login')
      await page.locator('input[type="email"]').fill(creds.email)
      await page.locator('input[autocomplete="current-password"]').fill(creds.password)
      await page.getByRole('button', { name: 'Ingresar' }).click()

      // Redirección automática (rol viejo + pos.vender), transitoria hasta M2.
      if (caso.redirige) {
        await expect(page).toHaveURL(/\/m$/, { timeout: 15_000 })
      } else {
        await expect(page).toHaveURL(/\/ventas$/, { timeout: 15_000 })
        await page.waitForTimeout(1_000)   // contraste: tampoco se va a /m un rato después
        await expect(page).toHaveURL(/\/ventas$/)
        await page.goto('/m')              // el mozo (y cualquiera) entra a /m por URL
      }

      // Lo que ve /m = lo que acepta el servidor.
      const yo = await cliente(creds)
      const venta = await sondaVenta(yo.c)
      if (caso.pos) {
        await expect(page.getByTestId('m-shell')).toBeVisible()
        await expect(page.getByTestId('m-sin-permiso')).toHaveCount(0)
        await page.getByTestId('m-buscar').fill('Lab Cerveza')
        await page.getByTestId('m-productos').getByTestId('m-producto').filter({ hasText: 'Lab Cerveza' }).first().click()
        await page.getByTestId('m-carrito-abrir').click()
        await expect(page.getByTestId('m-pagar-cash')).toBeEnabled()
        expect(venta, 'el servidor acepta lo que /m ofrece').toBe('La venta no tiene ítems')
        await page.getByTestId('m-hoja-volver').click()

        // "Versión completa" desde el menú de /m.
        await page.getByTestId('m-nav-menu').click()
        await page.getByTestId('m-version-completa').click()
        await expect(page).toHaveURL(/\/ventas$/, { timeout: 15_000 })
      } else {
        await expect(page.getByTestId('m-sin-permiso')).toBeVisible()
        await expect(page.getByTestId('m-shell')).toHaveCount(0)
        expect(venta, 'el servidor rechaza lo que /m no ofrece').toBe(SIN_PERMISO_VENDER)
        await page.getByTestId('m-sin-permiso-version-completa').click()
        await expect(page).toHaveURL(/\/mesas$/, { timeout: 15_000 })
      }

      // Se queda en el escritorio: recargar no lo devuelve a /m.
      await page.reload()
      await expect(page).not.toHaveURL(/\/m(\/|$)/)
      await expect(page.getByTestId('m-shell')).toHaveCount(0)
    } finally {
      if (caso.rolPersonalizado) restaurarMozo()
    }
  })
}

test('rol viejo cajero SIN pos.vender (incoherencia vieja): NO se lo manda a /m, y en /m se le dice', async ({ page }) => {
  // La redirección exige el rol viejo Y pos.vender (ProtectedRoute): a nadie se lo manda a
  // una pantalla cuyo único fin es vender si el servidor no lo deja vender. Se arma la
  // incoherencia por SQL (la app ya no la produce): rol viejo 'cashier' + rol sin pos.vender.
  const email = cashierCreds().email
  const [role, roleId] = psql(`select role || '|' || role_id from public.profiles where email = '${email}';`).split('|')
  psql(`update public.profiles p set role = 'cashier',
          role_id = (select r.id from public.roles r where r.organization_id = p.organization_id and r.name = 'e2e-sin-cobro')
         where p.email = '${email}';`)
  try {
    expect(psql(`select role || '|' || (select name from public.roles where id = role_id) from public.profiles where email = '${email}';`))
      .toBe('cashier|e2e-sin-cobro')
    await page.goto('/login')
    await page.locator('input[type="email"]').fill(email)
    await page.locator('input[autocomplete="current-password"]').fill(cashierCreds().password)
    await page.getByRole('button', { name: 'Ingresar' }).click()
    await expect(page).toHaveURL(/\/ventas$/, { timeout: 15_000 })
    await page.waitForTimeout(1_000)
    await expect(page).toHaveURL(/\/ventas$/)
    expect(await sondaVenta((await cliente(cashierCreds())).c)).toBe(SIN_PERMISO_VENDER)
    await page.goto('/m')
    await expect(page.getByTestId('m-sin-permiso')).toBeVisible()
  } finally {
    psql(`update public.profiles set role = '${role}', role_id = '${roleId}' where email = '${email}';`)
  }
})

// ── La carga del usuario FALLA (sin red, timeout, error) ──────────────────────
// serviceWorkers 'block': en WebKit, page.route no ve los pedidos de una página
// controlada por el service worker (ver "reintento" en m-pos-movil.spec.ts).
test.describe('la carga del usuario falla en /m', () => {
  test.use({ serviceWorkers: 'block' })

  async function entrarCajero(page: import('@playwright/test').Page) {
    await page.goto('/login')
    await page.locator('input[type="email"]').fill(cashierCreds().email)
    await page.locator('input[autocomplete="current-password"]').fill(cashierCreds().password)
    await page.getByRole('button', { name: 'Ingresar' }).click()
    // Sin permisos cargados no se redirige a /m (la redirección exige pos.vender): falla cerrado.
    await expect(page).toHaveURL(/\/ventas$/, { timeout: 30_000 })
  }

  test('se corta la red al cargar los PERMISOS: "No se pudo cargar tu usuario", y Reintentar lo arregla', async ({ page }) => {
    test.setTimeout(90_000)
    await page.route('**/rest/v1/roles?**', (r) => r.abort('internetdisconnected'))
    await entrarCajero(page)
    await page.goto('/m')
    await expect(page.getByTestId('m-error-usuario')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('m-error-usuario')).toContainText('No se pudo cargar tu usuario. Revisa el wifi.')
    // Ni la venta ni el "no puedes vender": los dos serían falsos.
    await expect(page.getByTestId('m-sin-permiso')).toHaveCount(0)
    await expect(page.getByTestId('m-shell')).toHaveCount(0)
    // Vuelve la red: Reintentar carga los permisos y aparece la venta.
    await page.unroute('**/rest/v1/roles?**')
    await page.getByTestId('m-reintentar').click()
    await expect(page.getByTestId('m-shell')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('m-error-usuario')).toHaveCount(0)
  })

  test('se corta la red al cargar el PERFIL: el mismo mensaje, y Reintentar lo arregla', async ({ page }) => {
    test.setTimeout(90_000)
    await page.route('**/rest/v1/profiles?**', (r) => r.abort('internetdisconnected'))
    await entrarCajero(page)
    await page.goto('/m')
    await expect(page.getByTestId('m-error-usuario')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('m-sin-permiso')).toHaveCount(0)
    await expect(page.getByTestId('m-shell')).toHaveCount(0)
    await page.unroute('**/rest/v1/profiles?**')
    await page.getByTestId('m-reintentar').click()
    await expect(page.getByTestId('m-shell')).toBeVisible({ timeout: 15_000 })
  })
})
