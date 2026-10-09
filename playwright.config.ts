import { defineConfig, devices } from '@playwright/test'
import { readFileSync, existsSync } from 'node:fs'

// ── Entorno: Supabase LOCAL en Docker, y nada más ──────────────────────────
// 🔴 La suite corre SOLO contra el stack local (2026-09-30). La nube cobra por
// ingesta de logs y cada corrida son cientos de requests: que LAB esté aislada
// por RLS no cambia que sea la misma base y el mismo medidor. .env / .env.test
// (la nube) ya NO se leen acá. Preparar el stack: `pnpm e2e:preparar`.
//
// Este archivo se evalúa también DENTRO de cada worker, así que lo que se pone
// en process.env acá es lo que ven los specs. Por eso los specs ya no tienen
// cargadores propios de .env (se sacaron las 10 copias en la misma pasada).
//
// Asignación DIRECTA, no "si no está definido": si fuera condicional, una
// variable de la nube en el shell bastaría para apuntar la corrida ahí.
const LOCAL_CONFIG = 'scripts/capturas/local.config'
if (!existsSync(LOCAL_CONFIG)) {
  throw new Error(
    `Falta ${LOCAL_CONFIG} (versionado). Sin él la suite no tiene a qué Supabase ` +
    'local apuntar, y NO cae a la nube por omisión.',
  )
}
for (const line of readFileSync(LOCAL_CONFIG, 'utf-8').split('\n')) {
  const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/)
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

// Secreto HMAC de aplicar-estado: SOLO LOCAL, en supabase/functions/.env
// (gitignored, aleatorio por máquina, lo crea `pnpm e2e:preparar`). Es el MISMO
// archivo que lee el edge runtime local, así que el test firma con lo que la
// función verifica: una sola fuente (R1). Si falta, se ABORTA: antes esos casos
// de suscripcion-estado.spec.ts hacían skip en silencio y el contrato con
// G-Centro quedaba sin custodia.
const FN_ENV = 'supabase/functions/.env'
const hmacLocal = existsSync(FN_ENV)
  ? readFileSync(FN_ENV, 'utf-8').match(/^GCENTRO_HMAC_SECRET=(\S+)/m)?.[1]
  : undefined
if (!hmacLocal) {
  throw new Error(
    `Falta GCENTRO_HMAC_SECRET en ${FN_ENV}. Corré \`pnpm e2e:preparar\`: lo crea ` +
    'y recrea el edge runtime para que lo lea.',
  )
}
process.env.E2E_GCENTRO_HMAC_SECRET = hmacLocal

// GUARD (allowlist de hosts, fail-closed): el backend es loopback o no se corre.
// QUÉ IMPIDE: que la suite apunte a un Supabase remoto por un local.config
//   editado o un merge malo. Un host que nadie previó cae del lado que aborta.
// QUÉ NO IMPIDE: que el Supabase local tenga datos que no sean del laboratorio;
//   para eso está el health check de tests/global-setup.ts (org = LAB).
const HOSTS_LOCALES = ['127.0.0.1', 'localhost', '::1', '[::1]']
const SUPABASE_URL = process.env.VITE_GVENTO_SUPABASE_URL ?? ''
let supabaseHost = ''
try { supabaseHost = new URL(SUPABASE_URL).hostname } catch { /* cae al guard */ }
if (!HOSTS_LOCALES.includes(supabaseHost)) {
  throw new Error(
    `La suite E2E solo corre contra un Supabase LOCAL. VITE_GVENTO_SUPABASE_URL ` +
    `apunta a "${SUPABASE_URL}", que no es loopback. Revisá ${LOCAL_CONFIG}.`,
  )
}

// Puerto DEDICADO de G-Vento para E2E (no el 5173 por defecto de Vite, que puede
// estar ocupado por otra app — p. ej. G-Mura). Playwright SIEMPRE levanta su
// propio servidor de gvento aquí (reuseExistingServer:false + strictPort), así
// nunca se conecta por accidente a otra app. Ver tests/README.md.
export const E2E_PORT = 5180
const BASE_URL = `http://localhost:${E2E_PORT}`

// Specs del POS móvil (tests/m-*.spec.ts); el separador puede ser / o \ (Windows).
const MOVIL = /[\\/]m-[^\\/]*\.spec\.ts$/

export default defineConfig({
  testDir: './tests',
  // Health check (defensa en profundidad): aborta si el servidor no es G-Vento.
  globalSetup: './tests/global-setup.ts',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // los flujos comparten sesión/estado del backend
  workers: 1,
  // Laboratorio determinista (org LAB aislada): SIN retries por defecto. Los
  // retries enmascaran problemas y, con describe.serial, duplican datos al
  // reintentar. Un fallo es un fallo limpio que se investiga, no se reintenta.
  // Override puntual con E2E_RETRIES=N (p. ej. backend compartido legacy).
  retries: Number(process.env.E2E_RETRIES ?? 0),
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    // Con retries:0 no hay "first retry": capturar trace en cualquier fallo.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  // POS móvil (/m): sus specs (tests/m-*.spec.ts) corren en DOS emulaciones,
  // iPhone (WebKit, el motor de Safari) y Android (Chromium). Es la red, no la
  // prueba: Wake Lock, el teclado, la barra de inicio y "Agregar a inicio" se
  // verifican en equipos reales (lista en docs/). El escritorio no los corre.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: MOVIL },
    { name: 'm-android', use: { ...devices['Pixel 7'] }, testMatch: MOVIL },
    { name: 'm-iphone', use: { ...devices['iPhone 13'] }, testMatch: MOVIL },
  ],
  // SIEMPRE levanta el dev server de gvento en el puerto dedicado. strictPort
  // hace que falle ruidosamente si el puerto está ocupado, en vez de servir/
  // conectarse a otra cosa.
  webServer: {
    command: `pnpm dev --port ${E2E_PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 60_000,
    // El bundle apunta al Supabase local porque se le pasa EXPLÍCITO: Vite carga
    // .env (la nube) por su cuenta, y lo de process.env con prefijo VITE_ le gana
    // (mismo mecanismo que scripts/capturas/capturas.config.ts).
    env: {
      VITE_GVENTO_SUPABASE_URL: SUPABASE_URL,
      VITE_GVENTO_SUPABASE_ANON_KEY: process.env.VITE_GVENTO_SUPABASE_ANON_KEY ?? '',
    },
  },
})
