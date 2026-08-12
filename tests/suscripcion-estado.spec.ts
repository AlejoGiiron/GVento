import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ownerCreds } from './helpers/auth'

// ============================================================================
// Estado de suscripción escrito por G-Centro — protección de escritura
// (migración supabase/organization-subscription.sql)
//
// ⚠️  REQUIERE la migración APLICADA en LAB. El primer test verifica que las
//     columnas existan, para que "no aplicaste la migración" falle ahí y no
//     convierta los casos "DEBE FALLAR" en tests vacuos.
//
// ── CUÁL DE LAS DOS CAPAS CONTESTA — MEDIDO, NO SUPUESTO ────────────────────
// Hay dos defensas sobre las columnas de suscripción:
//   (1) privilegios por columna en allowlist (authenticated solo puede escribir
//       name, logo_url, config)
//   (2) el trigger protect_organization_subscription
//
// **Contesta la (1), y el trigger NUNCA llega a dispararse.** Postgres verifica
// los privilegios de columna al ARRANCAR el executor, antes de escanear filas y
// por lo tanto antes de cualquier BEFORE ROW trigger. Medido contra LAB:
//
//   update {subscription_status}         -> 42501 permission denied for table organizations
//   update {subscription_message}        -> 42501 (idem)
//   update {name, subscription_status}   -> 42501 (idem)
//   update {name}                        -> pasa
//
// El mensaje es a nivel TABLA aunque la falla sea por columna: cuando el chequeo
// por columna no pasa, Postgres reporta el error de la relación, no de la
// columna. Por eso se assertea el CÓDIGO 42501, que es inequívoco, y no una
// subcadena del texto.
//
// 🔴 EL TRIGGER NO ES CÓDIGO MUERTO, aunque este spec no pueda ejercitarlo.
// Es la red para el día en que alguien restaure el privilegio a nivel tabla —
// y el modo de fallo más probable es una línea rutinaria de Supabase del estilo
// `grant all on all tables in schema public to authenticated`, que borraría la
// allowlist EN SILENCIO. Ahí el trigger pasa a ser la única defensa.
// No se puede ejercitar desde afuera: requiere que authenticated TENGA el
// privilegio de columna (se lo revocamos) y que current_user sea 'authenticated'
// (service_role no lo es, por diseño). Verificación manual en el SQL Editor, en
// la sección de pruebas empíricas de organization-subscription.sql.
//
// Todo por Supabase directo con SESIÓN DE USUARIO REAL (anon key + login), NO
// service role: las protecciones apuntan al cliente autenticado, que es lo que
// hace PostgREST.
//
// El adversario del caso central es el OWNER: es quien tiene `sedes.gestionar`
// y por lo tanto quien pasa la policy de UPDATE, y quien tiene motivo económico
// para ponerse en 'active'. Acá el riesgo es el titular de la cuenta, no un
// cajero curioso.
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

const anon = () =>
  createClient(process.env.VITE_GVENTO_SUPABASE_URL!, process.env.VITE_GVENTO_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  })

let owner: SupabaseClient
let orgId = ''
let orgNombre = ''
// Baseline del estado de suscripción al empezar. NO se asume 'active' + null:
// LAB es el tenant de prueba de G-Centro, así que estos valores CAMBIAN de
// forma legítima cada vez que alguien ejercita la Edge Function. Los casos de
// abajo comparan contra este snapshot en vez de contra un valor fijo — un test
// que exija "nadie escribió nunca" se rompe con el uso normal del laboratorio.
let baseStatus = ''
let baseUpdatedAt: string | null = null

// 42501 = insufficient_privilege. Se assertea el CÓDIGO y no el texto: es
// estable entre versiones y no depende del idioma del servidor. Un
// `error != null` a secas daría verde ante un error de red o una RLS que
// devuelve cero filas — el patrón de rbac-escalada.spec.ts y anular-venta:279.
const SIN_PRIVILEGIO = '42501'

test.beforeAll(async () => {
  owner = anon()
  const { error } = await owner.auth.signInWithPassword(ownerCreds())
  if (error) throw error

  // La RLS "organizations: ver la propia" solo deja ver la del propio usuario,
  // así que esto ya es la org de LAB.
  const { data, error: e2 } = await owner
    .from('organizations')
    .select('id, name, subscription_status, subscription_updated_at')
    .single()
  if (e2) throw e2
  orgId = data.id
  orgNombre = data.name
  baseStatus = data.subscription_status
  baseUpdatedAt = data.subscription_updated_at
})

test.afterAll(async () => {
  // Red de seguridad: el test de contraste reescribe `name` con su MISMO valor,
  // pero si algo quedó a medias lo restauramos igual.
  if (owner && orgId && orgNombre) {
    await owner.from('organizations').update({ name: orgNombre }).eq('id', orgId)
  }
})

// Los 5 estados del CHECK de organization-subscription.sql. Si se agrega uno,
// se toca acá y en la Edge Function: los tres lados van juntos.
const ESTADOS = ['active', 'expiring', 'grace', 'restricted', 'suspended']

test('las 3 columnas existen y el estado es uno del enum', async () => {
  // Canario de "aplicaste la migración". NO assertea 'active' ni updated_at
  // null: LAB es el tenant de prueba de G-Centro y esos valores cambian de
  // forma legítima. Lo que sí es invariante es que la columna exista y que su
  // contenido esté dentro del CHECK.
  const { data, error } = await owner
    .from('organizations')
    .select('subscription_status, subscription_message, subscription_updated_at')
    .eq('id', orgId)
    .single()

  expect(error).toBeNull()
  expect(ESTADOS).toContain(data!.subscription_status)
})

test('un OWNER autenticado NO puede escribir su propio subscription_status', async () => {
  // EL CASO CENTRAL. El owner pasa la policy "organizations: editar con
  // permiso" (tiene sedes.gestionar), así que sin protección esto ESCRIBE.
  const { error } = await owner
    .from('organizations')
    .update({ subscription_status: 'active' })
    .eq('id', orgId)

  expect(error).not.toBeNull()
  // Contesta la allowlist de privilegios, no el trigger (ver encabezado).
  expect(error!.code).toBe(SIN_PRIVILEGIO)

  // Y no quedó escrito: el rechazo es real, no un error cosmético. Se compara
  // contra el SNAPSHOT del beforeAll, no contra null — lo que importa es que
  // este intento no movió nada, no que nadie haya escrito nunca.
  const { data } = await owner
    .from('organizations')
    .select('subscription_status, subscription_updated_at')
    .eq('id', orgId)
    .single()
  expect(data!.subscription_status).toBe(baseStatus)
  expect(data!.subscription_updated_at).toBe(baseUpdatedAt)
})

test('tampoco puede escribir subscription_message ni subscription_updated_at', async () => {
  // Las tres se protegen juntas. Si solo se blindara `status`, el mensaje que ve
  // el usuario seguiría siendo escribible por él mismo: podría borrar el aviso
  // de mora sin tocar el estado.
  const msg = await owner
    .from('organizations')
    .update({ subscription_message: 'todo en orden' })
    .eq('id', orgId)
  expect(msg.error?.code).toBe(SIN_PRIVILEGIO)

  const fecha = await owner
    .from('organizations')
    .update({ subscription_updated_at: new Date().toISOString() })
    .eq('id', orgId)
  expect(fecha.error?.code).toBe(SIN_PRIVILEGIO)
})

test('CONTRASTE: el mismo owner SÍ puede escribir una columna permitida', async () => {
  // Sin este caso el bloque entero podría estar verde por la razón equivocada:
  // si el owner no pudiera escribir NADA de organizations (una RLS rota, una
  // sesión sin permisos, un 42501 por otro motivo), los rechazos de arriba
  // serían verdes y no probarían que la protección es ESPECÍFICA de las
  // columnas de suscripción. Es lo único que discrimina, porque el mensaje de
  // Postgres es a nivel tabla y no nombra la columna culpable.
  //
  // Se reescribe `name` con su mismo valor: ejercita el camino de UPDATE
  // completo (policy + WITH CHECK + privilegios + trigger de updated_at) sin
  // cambiar datos del lab.
  const { error } = await owner
    .from('organizations')
    .update({ name: orgNombre })
    .eq('id', orgId)

  expect(error).toBeNull()
})

test('un intento MIXTO (columna permitida + prohibida) se rechaza entero', async () => {
  // El intento realista: colar el status junto a un cambio legítimo. El chequeo
  // de privilegios mira TODAS las columnas del SET, así que cae la sentencia
  // completa y el nombre tampoco se escribe: no hay escritura parcial.
  const { error } = await owner
    .from('organizations')
    .update({ name: `${orgNombre} X`, subscription_status: 'active' })
    .eq('id', orgId)

  expect(error?.code).toBe(SIN_PRIVILEGIO)

  const { data } = await owner.from('organizations').select('name').eq('id', orgId).single()
  expect(data!.name).toBe(orgNombre)
})

test('el CHECK rechaza un estado fuera del enum', async () => {
  // Protege a la Edge Function (que escribe con service role, salteando trigger
  // y privilegios) de meter basura si alguien amplía el enum en un solo lado.
  const key = process.env.E2E_SERVICE_ROLE_KEY
  test.skip(!key, 'Requiere E2E_SERVICE_ROLE_KEY para escribir como service role')

  const svc = createClient(process.env.VITE_GVENTO_SUPABASE_URL!, key!, {
    auth: { persistSession: false },
  })
  const { error } = await svc
    .from('organizations')
    .update({ subscription_status: 'trial_extendido' })
    .eq('id', orgId)

  expect(error).not.toBeNull()
  expect(error!.message).toMatch(/subscription_status|check/i)
})
