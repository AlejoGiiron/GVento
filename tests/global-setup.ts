import { request, type FullConfig } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

// Puerto dedicado de G-Vento (debe coincidir con E2E_PORT de playwright.config.ts).
const BASE_URL = 'http://localhost:5180'

// Organización del LABORATORIO. Los tests SOLO deben correr contra esta org.
const LAB_ORG = 'LAB'

// El entorno (Supabase LOCAL) lo carga playwright.config.ts desde
// scripts/capturas/local.config, y ya verificó que la URL sea loopback. Acá no
// se lee ningún .env: esos apuntan a la nube.

/**
 * Health check #1 — la app servida es G-Vento (no otra app en el puerto).
 */
async function checkServedAppIsGvento(): Promise<void> {
  const ctx = await request.newContext()
  try {
    const res = await ctx.get(BASE_URL)
    const html = await res.text()
    if (!/G-?Vento/i.test(html)) {
      throw new Error(
        `[E2E health check] El servidor en ${BASE_URL} NO es G-Vento ` +
        `(marcador "G-Vento" no encontrado en el HTML servido). ¿Hay otra app ` +
        `(p. ej. G-Mura) ocupando el puerto? Se aborta la suite para no correr ` +
        `contra el proyecto equivocado.`,
      )
    }
    // eslint-disable-next-line no-console
    console.log('[E2E health check] OK — la app servida es G-Vento.')
  } finally {
    await ctx.dispose()
  }
}

/**
 * Health check #2 (SEGURIDAD DE DATOS) — las credenciales de prueba pertenecen
 * a la organización LAB. Evita correr la suite contra datos reales (org G-10)
 * por una config de entorno mal armada: la suite muta estado (cierra caja, crea
 * datos) y NO debe tocar producción.
 *
 * Hace login real con E2E_OWNER_EMAIL contra el mismo Supabase que usa la app
 * (VITE_GVENTO_*), consulta su organización (RLS solo deja ver la propia) y
 * aborta si no es LAB.
 */
async function checkCredentialsAreLab(): Promise<void> {
  const url = process.env.VITE_GVENTO_SUPABASE_URL
  const anonKey = process.env.VITE_GVENTO_SUPABASE_ANON_KEY
  const email = process.env.E2E_OWNER_EMAIL
  const password = process.env.E2E_OWNER_PASSWORD

  if (!url || !anonKey) {
    throw new Error(
      '[E2E health check] Faltan VITE_GVENTO_SUPABASE_URL / ' +
      'VITE_GVENTO_SUPABASE_ANON_KEY (revisa scripts/capturas/local.config). No se puede verificar la ' +
      'organización de las credenciales de prueba.',
    )
  }
  if (!email || !password) {
    throw new Error(
      '[E2E health check] Faltan E2E_OWNER_EMAIL / E2E_OWNER_PASSWORD ' +
      '(revisa scripts/capturas/local.config). No se puede verificar la organización de prueba.',
    )
  }

  const supabase = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
  if (authError) {
    throw new Error(
      `[E2E health check] No se pudo iniciar sesión con E2E_OWNER_EMAIL ` +
      `(${email}): ${authError.message}. ¿Corriste "pnpm e2e:preparar"? Revisa scripts/capturas/local.config.`,
    )
  }

  // RLS de organizations ("ver la propia") deja ver SOLO la org del usuario.
  const { data, error } = await supabase.from('organizations').select('name')
  await supabase.auth.signOut()

  if (error) {
    throw new Error(
      `[E2E health check] No se pudo consultar la organización del usuario de ` +
      `prueba: ${error.message}.`,
    )
  }

  const orgName = data?.[0]?.name ?? '(ninguna)'
  if (orgName !== LAB_ORG) {
    throw new Error(
      `PELIGRO: las credenciales de prueba no son del laboratorio ` +
      `(org actual: ${orgName}). Los tests NO deben correr contra datos reales. ` +
      `¿Corriste "pnpm e2e:preparar"? Revisa scripts/capturas/local.config.`,
    )
  }

  // eslint-disable-next-line no-console
  console.log(`[E2E health check] OK — las credenciales pertenecen a la org "${LAB_ORG}".`)
}

/**
 * Health check previo a la suite (defensa en profundidad):
 *  1. La app servida en BASE_URL es G-Vento (no otra app en el puerto).
 *  2. Las credenciales de prueba pertenecen a la organización LAB (no a datos
 *     reales). Aborta la corrida si cualquiera falla.
 */
export default async function globalSetup(_config: FullConfig): Promise<void> {
  await checkServedAppIsGvento()
  await checkCredentialsAreLab()
}
