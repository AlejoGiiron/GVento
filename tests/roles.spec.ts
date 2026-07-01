import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { loginAsOwner } from './helpers/auth'
import { ALL_PERMISSION_KEYS } from '../src/lib/permissions'

// VITE_GVENTO_* (backend del lab) viven en .env; playwright.config solo carga
// .env.test. Cargamos .env aquí para el test del trigger vía API.
function loadEnv(path: string) {
  try {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* ignore */ }
}
loadEnv('.env')
loadEnv('.env.test')

const SYSTEM_NON_OWNER = ['admin', 'cajero', 'mozo']

async function openRoles(page: import('@playwright/test').Page) {
  await loginAsOwner(page)
  await page.goto('/configuracion')
  await page.getByRole('button', { name: 'Roles y permisos' }).click()
  await expect(page.getByRole('heading', { name: 'Roles y permisos', exact: true })).toBeVisible()
}

const roleRow = (page: import('@playwright/test').Page, name: string) =>
  page.getByTestId('role-row').filter({ hasText: name })

test.describe('Roles y permisos — editables (menos owner)', () => {
  test('el owner NO tiene botones de editar/eliminar', async ({ page }) => {
    await openRoles(page)
    const owner = roleRow(page, 'owner')
    await expect(owner.getByTestId('role-not-editable')).toBeVisible()
    await expect(owner.getByTestId('role-edit')).toHaveCount(0)
    await expect(owner.getByTestId('role-delete')).toHaveCount(0)
  })

  test('admin/cajero/mozo son editables pero NO eliminables', async ({ page }) => {
    await openRoles(page)
    for (const name of SYSTEM_NON_OWNER) {
      const row = roleRow(page, name)
      await expect(row.getByTestId('role-edit')).toBeVisible()      // editable
      await expect(row.getByTestId('role-delete')).toHaveCount(0)   // no eliminable
    }
  })

  test('el catálogo muestra los 22 permisos (incl. compras/fiado/historial)', async ({ page }) => {
    await openRoles(page)
    await page.getByRole('button', { name: 'Crear rol' }).click()
    await expect(page.getByTestId('role-modal')).toBeVisible()

    await expect(page.locator('[data-testid^="perm-"]')).toHaveCount(ALL_PERMISSION_KEYS.length)
    expect(ALL_PERMISSION_KEYS.length).toBe(22)

    // Los 3 que faltaban en el catálogo viejo ahora están.
    await expect(page.getByTestId('perm-compras.gestionar')).toBeVisible()
    await expect(page.getByTestId('perm-fiado.gestionar')).toBeVisible()
    await expect(page.getByTestId('perm-ventas.historial')).toBeVisible()
  })

  test('editar cajero: agregar un permiso, guardar y verificar (round-trip)', async ({ page }) => {
    await openRoles(page)

    // Permiso no enforçado en ningún lado → no afecta otros specs (rbac).
    const PERM = 'perm-reportes.consolidado'

    // Abrir editor del cajero y marcar el permiso.
    await roleRow(page, 'cajero').getByTestId('role-edit').click()
    await expect(page.getByTestId('role-modal')).toBeVisible()
    const cb = page.getByTestId(PERM).getByRole('checkbox')
    const wasChecked = await cb.isChecked()
    if (!wasChecked) await cb.check()
    await page.getByTestId('role-modal').getByRole('button', { name: 'Guardar' }).click()
    await expect(page.getByText('Rol actualizado').first()).toBeVisible()

    // Reabrir con datos FRESCOS (reload evita el race de caché del listado).
    await page.reload()
    await page.getByRole('button', { name: 'Roles y permisos' }).click()
    await roleRow(page, 'cajero').getByTestId('role-edit').click()
    await expect(page.getByTestId(PERM).getByRole('checkbox')).toBeChecked()

    // Revertir para dejar el lab determinista (cajero como estaba).
    if (!wasChecked) {
      await page.getByTestId(PERM).getByRole('checkbox').uncheck()
      await page.getByTestId('role-modal').getByRole('button', { name: 'Guardar' }).click()
      await expect(page.getByText('Rol actualizado').first()).toBeVisible()
    } else {
      await page.getByTestId('role-modal').getByRole('button', { name: 'Cancelar' }).click()
    }
  })

  test('editar el rol OWNER vía API falla (trigger de BD)', async () => {
    const sb = createClient(
      process.env.VITE_GVENTO_SUPABASE_URL!,
      process.env.VITE_GVENTO_SUPABASE_ANON_KEY!,
    )
    const { data: auth, error: aerr } = await sb.auth.signInWithPassword({
      email: process.env.E2E_OWNER_EMAIL!,
      password: process.env.E2E_OWNER_PASSWORD!,
    })
    expect(aerr).toBeNull()

    // El rol del propio owner ES el rol owner (con '*'). Directo, sin depender
    // del operador de contención jsonb.
    const { data: prof } = await sb
      .from('profiles').select('role_id').eq('id', auth!.user.id).single()
    expect(prof?.role_id).toBeTruthy()

    // El owner tiene roles.gestionar (vía '*'), así que la RLS deja pasar la
    // escritura hasta el trigger — que la RECHAZA. Debe volver con error.
    const { error } = await sb
      .from('roles').update({ permissions: [] }).eq('id', prof!.role_id!).select()
    expect(error).not.toBeNull()
  })
})
