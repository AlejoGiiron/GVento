import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ownerCreds, cashierCreds } from './helpers/auth'

// ============================================================================
// Edge Function create-user — gates de seguridad + alta completa en UN paso.
//
// Cubre el flujo que hasta hoy tenía cobertura CERO y que produjo los perfiles
// rotos (sin organization_id, sin role_id) que motivaron el bloque de seguridad.
//
// ⚠️  REQUIERE LA FUNCION DESPLEGADA. Se elige por env:
//       E2E_CREATE_USER_FN=create-user-next   (staging: deploy con otro nombre)
//       E2E_CREATE_USER_FN=create-user        (default, producción)
//     Mismo spec para el paso 2 y el paso 3 del plan de deploy.
//
// Se invoca por fetch directo (no functions.invoke) para poder assertear el
// STATUS HTTP y el cuerpo del error sin desenvolver FunctionsHttpError.
// ============================================================================

test.describe.configure({ mode: 'serial' })

function loadEnv(path: string) {
  try {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* ignore */ }
}
loadEnv('.env'); loadEnv('.env.test')

const URL = () => process.env.VITE_GVENTO_SUPABASE_URL!
const ANON = () => process.env.VITE_GVENTO_SUPABASE_ANON_KEY!
const FN = () => process.env.E2E_CREATE_USER_FN ?? 'create-user'

const SUFFIX = Date.now().toString().slice(-6)
const NUEVO_EMAIL = `e2e-cu-${SUFFIX}@gvento.test`
const NUEVO_PASS = 'e2e-Passw0rd!'

const anon = () => createClient(URL(), ANON(), { auth: { persistSession: false } })

async function signIn(creds: { email: string; password: string }): Promise<SupabaseClient> {
  const c = anon()
  const { error } = await c.auth.signInWithPassword(creds)
  if (error) throw error
  return c
}

async function tokenDe(c: SupabaseClient): Promise<string> {
  const { data } = await c.auth.getSession()
  return data.session!.access_token
}

/** Invoca la Edge Function y devuelve status + cuerpo parseado. */
async function llamar(token: string, body: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${URL()}/functions/v1/${FN()}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: ANON(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  let parsed: any = null
  try { parsed = await res.json() } catch { /* sin cuerpo */ }
  return { status: res.status, body: parsed }
}

/** ¿Existe la cuenta en auth? Se prueba iniciando sesión: no hay forma de leer
 *  auth.users con la anon key. Sirve para verificar que un alta rechazada NO
 *  dejó cuenta colgada. */
async function puedeLoguear(email: string, password: string): Promise<boolean> {
  const c = anon()
  const { error } = await c.auth.signInWithPassword({ email, password })
  return !error
}

let owner: SupabaseClient
let cajero: SupabaseClient
let OWNER_ID = ''
let SEDE = ''
let ORG = ''
let ROL_MOZO = ''
let cajeroActivoOriginal = true

test.beforeAll(async () => {
  owner = await signIn(ownerCreds())
  cajero = await signIn(cashierCreds())

  OWNER_ID = (await owner.auth.getUser()).data.user!.id
  const p = (await owner.from('profiles')
    .select('restaurant_id, organization_id').eq('id', OWNER_ID).single()).data!
  SEDE = p.restaurant_id as string
  ORG = p.organization_id as string

  // Rol RBAC que se le asignará al usuario nuevo (uno cualquiera, no-owner).
  const { data: rol } = await owner.from('roles')
    .select('id, name').eq('organization_id', ORG).eq('name', 'mozo').single()
  ROL_MOZO = rol!.id as string

  const cid = (await cajero.auth.getUser()).data.user!.id
  cajeroActivoOriginal = (await owner.from('profiles')
    .select('is_active').eq('id', cid).single()).data!.is_active
})

// ── Gates de seguridad ──────────────────────────────────────────────────────

test('cajero SIN usuarios.gestionar → 403', async () => {
  const { status, body } = await llamar(await tokenDe(cajero), {
    email: `e2e-nope-${SUFFIX}@gvento.test`,
    password: NUEVO_PASS,
    full_name: 'No Debe Existir',
    role: 'waiter',
    role_id: ROL_MOZO,
    restaurant_id: SEDE,
  })

  expect(status).toBe(403)
  expect(String(body?.error)).toMatch(/usuarios\.gestionar/i)
})

test('llamante DESACTIVADO → 403 con el mensaje de is_active', async () => {
  // Cubre el otro fix que viaja en este mismo deploy: antes, un admin
  // desactivado con sesión viva podía seguir creando usuarios (persistencia).
  // Se usa al cajero, NO al owner: desactivar al owner lo dejaría sin forma de
  // reactivarse (el trigger le prohíbe tocar su propio is_active y nadie más
  // en el lab tiene el enum 'admin' que pide la policy) → lab bloqueado.
  const cid = (await cajero.auth.getUser()).data.user!.id
  await owner.from('profiles').update({ is_active: false }).eq('id', cid)

  try {
    const desactivado = await signIn(cashierCreds())   // auth.users sigue vivo
    const { status, body } = await llamar(await tokenDe(desactivado), {
      email: `e2e-nope2-${SUFFIX}@gvento.test`,
      password: NUEVO_PASS,
      full_name: 'No Debe Existir 2',
      role: 'waiter',
      role_id: ROL_MOZO,
      restaurant_id: SEDE,
    })

    expect(status).toBe(403)
    expect(String(body?.error)).toMatch(/desactivado/i)
  } finally {
    await owner.from('profiles').update({ is_active: cajeroActivoOriginal }).eq('id', cid)
  }
})

test('role_id inexistente → 400 y NO queda cuenta colgada', async () => {
  const email = `e2e-cu-bad-${SUFFIX}@gvento.test`
  const { status, body } = await llamar(await tokenDe(owner), {
    email,
    password: NUEVO_PASS,
    full_name: 'Rol Invalido',
    role: 'waiter',
    role_id: crypto.randomUUID(),
    restaurant_id: SEDE,
  })

  expect(status).toBe(400)
  expect(String(body?.error)).toMatch(/rol .*no existe/i)

  // Lo que de verdad importa: el alta rechazada no dejó residuo.
  expect(await puedeLoguear(email, NUEVO_PASS)).toBe(false)

  // NOTA HONESTA: con la validación del rol ANTES de createUser, este caso
  // ejercita el RECHAZO TEMPRANO, no la rama de compensación (deleteUser). Esa
  // rama solo corre si falla el UPDATE del role_id con un rol válido, que no hay
  // forma limpia de forzar desde afuera. Queda como defensa en profundidad sin
  // cobertura directa; lo que sí queda cubierto es el contrato observable:
  // un alta rechazada NO deja cuenta.
})

// ── Camino feliz: el cierre del círculo Angie/Katherine ─────────────────────

test('alta completa en UN request: role_id Y organization_id correctos', async () => {
  const { status, body } = await llamar(await tokenDe(owner), {
    email: NUEVO_EMAIL,
    password: NUEVO_PASS,
    full_name: `E2E CreateUser ${SUFFIX}`,
    role: 'waiter',
    role_id: ROL_MOZO,
    restaurant_id: SEDE,
  })

  expect(status).toBe(200)
  expect(body?.success).toBe(true)
  expect(body?.user_id).toBeTruthy()

  const { data: perfil, error } = await owner
    .from('profiles')
    .select('id, email, role, role_id, organization_id, restaurant_id, is_active')
    .eq('id', body.user_id)
    .single()
  expect(error).toBeNull()

  // 1. El rol RBAC vino asignado del servidor, sin segundo paso del navegador.
  expect(perfil!.role_id, 'el usuario nace CON rol (antes lo asignaba el browser)').toBe(ROL_MOZO)

  // 2. organization_id derivado de la sede por handle_new_user. ESTE es el
  //    cierre del círculo: el caso Angie/Katherine (perfil sin organización, y
  //    por lo tanto sin permisos en la UI) ya no se puede reproducir por acá.
  expect(perfil!.organization_id, 'organization_id derivado de la sede').toBe(ORG)

  // 3. Coherencia del resto.
  expect(perfil!.restaurant_id).toBe(SEDE)
  expect(perfil!.is_active).toBe(true)
  expect(perfil!.role).toBe('waiter')

  // 4. Y el usuario puede iniciar sesión de verdad.
  expect(await puedeLoguear(NUEVO_EMAIL, NUEVO_PASS)).toBe(true)
})

// ── Limpieza ────────────────────────────────────────────────────────────────

test('limpieza: borrar el usuario de prueba', async () => {
  // Borrar de auth.users EXIGE service role: la anon key no puede, y profiles
  // no tiene policy de DELETE. Si E2E_SERVICE_ROLE_KEY está definida en
  // .env.test se usa; si no, el test avisa y NO falla — la purga queda para
  // lab-seed.sql (paso 9).
  //
  // ⚠️  OJO AL PONER ESA KEY: la BD es UNA sola. El service role de este
  //     proyecto es también el de G-10 y Salchimelo, no solo el del lab.
  const key = process.env.E2E_SERVICE_ROLE_KEY
  if (!key) {
    console.warn(
      `[create-user.spec] Sin E2E_SERVICE_ROLE_KEY: queda el usuario ${NUEVO_EMAIL}. ` +
      'Se purga al correr lab-seed.sql (paso 9).',
    )
    test.skip(true, 'sin service role: la purga la hace lab-seed')
    return
  }

  const admin = createClient(URL(), key, { auth: { persistSession: false } })
  const { data: perfil } = await owner.from('profiles')
    .select('id').eq('email', NUEVO_EMAIL).maybeSingle()
  if (perfil) {
    // profiles.id → auth.users ON DELETE CASCADE: borrar la cuenta se lleva el perfil.
    const { error } = await admin.auth.admin.deleteUser(perfil.id as string)
    expect(error).toBeNull()
  }
  expect(await puedeLoguear(NUEVO_EMAIL, NUEVO_PASS)).toBe(false)
})
