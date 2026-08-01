import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ownerCreds, cashierCreds } from './helpers/auth'

// ============================================================================
// RBAC — escalada por auto-edición de profiles (trigger
// protect_profile_self_escalation, migración protect-profile-self-escalation.sql)
//
// ⚠️  REQUIERE la migración P1 APLICADA en LAB. Sin ella los 3 casos "DEBE
//     FALLAR" fallan (que es exactamente lo que el spec denuncia).
//
// Todo por Supabase directo con SESIÓN DE USUARIO REAL (anon key + login), NO
// service role: el trigger solo muerde con current_user = 'authenticated', que
// es lo que hace PostgREST. Desde el SQL Editor (postgres) se saltea por diseño
// y daría un falso negativo.
//
// Serial y con red de seguridad: beforeAll captura el estado de los perfiles
// tocados y afterAll lo restaura SIEMPRE con el cliente owner. Un fallo a mitad
// no puede dejar al cajero del lab desactivado ni con el rol cambiado.
// ============================================================================

test.describe.configure({ mode: 'serial' })

// ── Supabase directo (misma convención que anular-venta.spec.ts) ─────────────
function loadEnv(path: string) {
  try {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* ignore */ }
}
loadEnv('.env'); loadEnv('.env.test')

const anon = () =>
  createClient(process.env.VITE_GVENTO_SUPABASE_URL!, process.env.VITE_GVENTO_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  })

async function signIn(creds: { email: string; password: string }): Promise<SupabaseClient> {
  const c = anon()
  const { error } = await c.auth.signInWithPassword(creds)
  if (error) throw error
  return c
}

type ProfileSnap = {
  id: string
  role: string
  role_id: string | null
  organization_id: string | null
  restaurant_id: string
  full_name: string
  is_active: boolean
}

const SNAP_COLS = 'id, role, role_id, organization_id, restaurant_id, full_name, is_active'

let owner: SupabaseClient
let cajero: SupabaseClient
let ownerSnap: ProfileSnap
let cajeroSnap: ProfileSnap

/** Lee un perfil con el cliente owner (ve toda la sede por RLS). */
async function readProfile(id: string): Promise<ProfileSnap> {
  const { data, error } = await owner.from('profiles').select(SNAP_COLS).eq('id', id).single()
  if (error) throw error
  return data as ProfileSnap
}

/** Restaura un perfil a su snapshot. Idempotente. */
async function restore(snap: ProfileSnap): Promise<void> {
  await owner
    .from('profiles')
    .update({
      role: snap.role,
      role_id: snap.role_id,
      organization_id: snap.organization_id,
      restaurant_id: snap.restaurant_id,
      full_name: snap.full_name,
      is_active: snap.is_active,
    })
    .eq('id', snap.id)
}

/**
 * Un UPDATE está BLOQUEADO si devolvió error (trigger / RLS) o si no afectó
 * ninguna fila. Se usa .select() para distinguir "0 filas" de "ok": sin él,
 * PostgREST no reporta error cuando la RLS deja el UPDATE en cero filas.
 */
function bloqueado(res: { error: unknown; data: unknown[] | null }): boolean {
  return !!res.error || (res.data ?? []).length === 0
}

/**
 * Los 3 casos rojos deben ser rechazados por el TRIGGER, con su mensaje — NO
 * por la RLS dejando el UPDATE en cero filas. La distinción importa: un rechazo
 * por RLS sería verde por la razón equivocada y dejaría de medir el trigger
 * (mismo patrón que mordió en anular-venta:279). Por eso se exige `error` con
 * el texto del raise, no el `bloqueado()` laxo.
 */
function expectRechazoDelTrigger(
  res: { error: { message: string } | null; data: unknown[] | null },
  mensaje: RegExp,
): void {
  expect(
    res.error,
    'debía rechazar el TRIGGER (con mensaje); si es null, lo frenó la RLS con cero filas',
  ).not.toBeNull()
  expect(res.error!.message).toMatch(mensaje)
}

test.beforeAll(async () => {
  owner = await signIn(ownerCreds())
  cajero = await signIn(cashierCreds())

  const ownerId = (await owner.auth.getUser()).data.user!.id
  const cajeroId = (await cajero.auth.getUser()).data.user!.id
  ownerSnap = await readProfile(ownerId)
  cajeroSnap = await readProfile(cajeroId)
})

test.afterAll(async () => {
  // Red de seguridad: pase lo que pase, el lab queda como estaba.
  if (owner && cajeroSnap) await restore(cajeroSnap)
  if (owner && ownerSnap) await restore(ownerSnap)
})

// ── DEBEN FALLAR ────────────────────────────────────────────────────────────

test('el cajero NO puede auto-asignarse el role_id del owner de su org', async () => {
  // Materia prima de la escalada: la policy "roles: ver los de la org" deja al
  // cajero LEER el id del rol owner. Se asserta a propósito — documenta por qué
  // el trigger es necesario: el atacante no necesita conocimiento externo.
  // OJO: `permissions` es jsonb, no un array de Postgres. El filtro de
  // contención va como JSON string ('["*"]'); pasar ['*'] lo serializa como
  // array PG ({*}) y Postgres responde 22P02 'Token "*" is invalid'.
  const { data: ownerRole, error: readErr } = await cajero
    .from('roles')
    .select('id, name, permissions')
    .contains('permissions', '["*"]')
    .limit(1)
    .single()
  expect(readErr, 'el cajero debería poder leer los roles de su org (expectativa actual)').toBeNull()
  expect(ownerRole!.id).toBeTruthy()
  expect(ownerRole!.id).not.toBe(cajeroSnap.role_id)

  const res = await cajero
    .from('profiles')
    .update({ role_id: ownerRole!.id })
    .eq('id', cajeroSnap.id)
    .select(SNAP_COLS)

  expectRechazoDelTrigger(res, /No podes cambiar tu propio rol/i)

  // Lo que importa: el estado persistido no cambió.
  const after = await readProfile(cajeroSnap.id)
  expect(after.role_id).toBe(cajeroSnap.role_id)
})

test('el cajero NO puede cambiar su propio organization_id (aislamiento multi-tenant)', async () => {
  const otraOrg = crypto.randomUUID()

  const res = await cajero
    .from('profiles')
    .update({ organization_id: otraOrg })
    .eq('id', cajeroSnap.id)
    .select(SNAP_COLS)

  // DOS triggers lo rechazan y cualquiera de los dos es válido; lo que NO se
  // acepta es un bloqueo sin mensaje (RLS con cero filas). Gana el que dispare
  // primero, y los BEFORE ROW van por orden alfabético de nombre:
  // 'trg_profiles_org_consistency' < 'trg_protect_profile_self_escalation',
  // así que hoy contesta el del invariante de organización. No se fija el orden
  // a propósito: el invariante VALIDA en vez de forzar justamente para que el
  // rechazo no dependa de quién corra primero.
  expectRechazoDelTrigger(
    res,
    /No podes cambiar tu propia organizacion|no corresponde a la organizacion de su sede/i,
  )

  const after = await readProfile(cajeroSnap.id)
  expect(after.organization_id).toBe(cajeroSnap.organization_id)
})

test('un usuario desactivado NO puede auto-reactivarse', async () => {
  // El owner desactiva al cajero (fila ajena → el trigger no aplica, la policy
  // "admin edita cualquiera" sí). Esto DEBE funcionar.
  const off = await owner
    .from('profiles')
    .update({ is_active: false })
    .eq('id', cajeroSnap.id)
    .select(SNAP_COLS)
  expect(bloqueado(off), 'el owner debe poder desactivar a un empleado').toBe(false)
  expect((await readProfile(cajeroSnap.id)).is_active).toBe(false)

  // Sesión nueva del desactivado: auth.users está intacto, el login sigue
  // funcionando (por eso hacen falta el chequeo en login y el baneo, que van en
  // la pasada de app). Lo que NO debe poder es reactivarse.
  const desactivado = await signIn(cashierCreds())
  const res = await desactivado
    .from('profiles')
    .update({ is_active: true })
    .eq('id', cajeroSnap.id)
    .select(SNAP_COLS)

  // CRÍTICO con P2 ya aplicada: un desactivado pierde get_my_organization_id(),
  // así que el WITH CHECK de la policy podría fallar por su cuenta y dar cero
  // filas. Eso sería verde por la razón equivocada. Se exige el mensaje del
  // trigger: es la única prueba de que el BEFORE UPDATE disparó primero.
  expectRechazoDelTrigger(res, /No podes activar ni desactivar tu propio usuario/i)
  expect((await readProfile(cajeroSnap.id)).is_active).toBe(false)

  // Restaura ya (no espera al afterAll: los tests siguientes usan al cajero).
  await restore(cajeroSnap)
  expect((await readProfile(cajeroSnap.id)).is_active).toBe(true)
})

// ── DEBEN PASAR ─────────────────────────────────────────────────────────────

test('cambio de sede activa: update de una sola columna restaurant_id', async () => {
  // Flujo real del StoreSelector (StoreSelector.tsx:43-46). El owner del lab
  // tiene 3 sedes en user_stores (lab-seed bloque e).
  const { data: sedes } = await owner
    .from('user_stores')
    .select('restaurant_id')
    .eq('user_id', ownerSnap.id)

  const otra = (sedes ?? []).map((s) => s.restaurant_id).find((r) => r !== ownerSnap.restaurant_id)
  test.skip(!otra, 'el owner del lab necesita ≥2 sedes en user_stores para este caso')

  const res = await owner
    .from('profiles')
    .update({ restaurant_id: otra! })
    .eq('id', ownerSnap.id)
    .select(SNAP_COLS)

  expect(bloqueado(res), 'el cambio de sede activa NO debe verse afectado por el trigger').toBe(false)
  expect((await readProfile(ownerSnap.id)).restaurant_id).toBe(otra)

  // Vuelve a la sede original: el resto de la suite asume la sede por defecto.
  await restore(ownerSnap)
  expect((await readProfile(ownerSnap.id)).restaurant_id).toBe(ownerSnap.restaurant_id)
})

test('el usuario puede editar su propio full_name', async () => {
  const nuevo = `Cajero Lab ${Date.now().toString().slice(-6)}`

  const res = await cajero
    .from('profiles')
    .update({ full_name: nuevo })
    .eq('id', cajeroSnap.id)
    .select(SNAP_COLS)

  expect(bloqueado(res), 'editar el propio nombre debe seguir permitido').toBe(false)
  expect((await readProfile(cajeroSnap.id)).full_name).toBe(nuevo)

  await restore(cajeroSnap)
  expect((await readProfile(cajeroSnap.id)).full_name).toBe(cajeroSnap.full_name)
})

test('el admin puede asignar role_id a OTRO usuario de su sede', async () => {
  // El trigger solo evalúa new.id = auth.uid(); sobre filas ajenas ni se dispara.
  // Un fallo acá apunta al gate legacy get_my_role() = 'admin' de la policy
  // "profiles: admin edita cualquiera", NO al trigger.
  const { data: roles } = await owner
    .from('roles')
    .select('id, name, permissions')
    .eq('organization_id', ownerSnap.organization_id!)

  const otroRol = (roles ?? []).find(
    (r) => r.id !== cajeroSnap.role_id && !JSON.stringify(r.permissions).includes('"*"'),
  )
  expect(otroRol, 'el lab necesita ≥2 roles no-owner en la org').toBeTruthy()

  const res = await owner
    .from('profiles')
    .update({ role_id: otroRol!.id })
    .eq('id', cajeroSnap.id)
    .select(SNAP_COLS)

  expect(bloqueado(res), 'asignar rol a un empleado debe seguir funcionando').toBe(false)
  expect((await readProfile(cajeroSnap.id)).role_id).toBe(otroRol!.id)

  await restore(cajeroSnap)
  expect((await readProfile(cajeroSnap.id)).role_id).toBe(cajeroSnap.role_id)
})

// ── Capa de APP (UX del desactivado) ────────────────────────────────────────

test('el desactivado NO entra: la sesión se corta con mensaje', async ({ page }) => {
  // Server-side el acceso ya está cerrado (P2): get_my_restaurant_id() devuelve
  // null y la RLS no da ni una fila. Sin este chequeo el usuario entraba igual y
  // veía la app EN BLANCO, sin explicación. Esto verifica la capa de UX.
  const off = await owner
    .from('profiles')
    .update({ is_active: false })
    .eq('id', cajeroSnap.id)
    .select(SNAP_COLS)
  expect(bloqueado(off), 'el owner debe poder desactivar a un empleado').toBe(false)

  try {
    const { email, password } = cashierCreds()
    await page.goto('/login')
    await page.locator('input[autocomplete="email"]').fill(email)
    await page.locator('input[autocomplete="current-password"]').fill(password)
    await page.getByRole('button', { name: 'Ingresar' }).click()

    // El login de auth SÍ funciona (auth.users está intacto: el baneo sigue
    // pendiente). Lo que corta es AuthContext al leer el profile inactivo.
    await expect(
      page.getByText('Tu usuario está desactivado. Contactá al administrador.'),
    ).toBeVisible({ timeout: 15_000 })

    // Y no queda dentro de la app.
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 })
  } finally {
    await restore(cajeroSnap)
  }
  expect((await readProfile(cajeroSnap.id)).is_active).toBe(true)
})

test('Configuración: el toggle de is_active NO se ofrece en la fila propia', async ({ page }) => {
  // El trigger rechaza la auto-desactivación, así que ofrecer el botón solo
  // producía el toast genérico de error. Las filas ajenas lo conservan.
  const { email, password } = ownerCreds()
  await page.goto('/login')
  await page.locator('input[autocomplete="email"]').fill(email)
  await page.locator('input[autocomplete="current-password"]').fill(password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page).toHaveURL(/\/ventas/, { timeout: 15_000 })

  await page.goto('/configuracion')
  await page.getByRole('button', { name: 'Usuarios' }).click()
  await expect(page.getByRole('heading', { name: 'Usuarios', exact: true })).toBeVisible()

  // Exactamente una fila (la propia) sin toggle...
  await expect(page.getByTestId('user-toggle-self')).toHaveCount(1)
  // ...y al menos una fila ajena que sí lo tiene (cajero.test / mozo.test).
  expect(await page.getByTitle(/^(Desactivar|Activar)$/).count()).toBeGreaterThan(0)
})
