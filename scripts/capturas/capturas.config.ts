import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'

// El puerto sale de la config raíz — NO se re-declara acá. Es un contrato
// compartido (R1): playwright.config.ts, tests/global-setup.ts y este archivo
// tienen que hablar del mismo puerto, y el health check #1 de global-setup
// tiene 5180 escrito adentro. Importarlo también dispara, como efecto de
// carga del módulo, la lectura de .env.test que hace la config raíz — que es
// de donde salen E2E_OWNER_EMAIL / E2E_OWNER_PASSWORD.
import { E2E_PORT } from '../../playwright.config'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const BASE_URL = `http://localhost:${E2E_PORT}`

// ── local.config PISA lo que haya cargado la config raíz ────────────────────
// La config raíz ya metió .env.test en process.env (las credenciales de la
// nube). Acá se sobreescriben, a propósito y sin condiciones: las capturas
// corren contra el Supabase LOCAL de Docker y contra ninguna otra cosa.
//
// Es una asignación directa, no un "si no está definido": si esto fuera
// condicional, un .env.test presente bastaría para apuntar la corrida a la base
// compartida sin que nadie se entere. Falla cerrado — si falta el archivo o le
// falta una clave, aborta acá en vez de caer de vuelta a la nube por omisión.
//
// El archivo NO se llama .env.capturas (y por lo tanto Vite no lo carga solo,
// ver el bloque webServer de abajo): `.env*` en este repo significa "no se
// versiona", y este archivo se versiona. Ver su propio encabezado.
const LOCAL_CONFIG = resolve(HERE, 'local.config')
if (!existsSync(LOCAL_CONFIG)) {
  throw new Error(
    'Falta scripts/capturas/local.config. Está versionado en el repo: si no ' +
    'existe, se borró o el checkout está incompleto. Las capturas corren contra ' +
    'el Supabase local de Docker y sin ese archivo no hay a dónde apuntar.',
  )
}
for (const line of readFileSync(LOCAL_CONFIG, 'utf-8').split('\n')) {
  const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/)
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

// ── Las claves que la corrida necesita, declaradas positivamente ────────────
// Allowlist, no "lo que falte que se resuelva solo": una clave ausente dejaría
// en pie el valor que puso .env.test (la nube) y la corrida saldría igual.
const REQUERIDAS = [
  'VITE_GVENTO_SUPABASE_URL',    // backend del bundle
  'VITE_GVENTO_SUPABASE_ANON_KEY',
  'E2E_OWNER_EMAIL',             // login del globalSetup
  'E2E_OWNER_PASSWORD',
] as const
const faltantes = REQUERIDAS.filter((k) => !process.env[k])
if (faltantes.length > 0) {
  throw new Error(
    `scripts/capturas/local.config no define: ${faltantes.join(', ')}. ` +
    'Sin esas claves la corrida se quedaría con las credenciales de .env.test ' +
    '(la base compartida). Aborta.',
  )
}

// ── GUARD: el backend de las capturas es loopback y nada más ────────────────
// QUÉ IMPIDE: que una corrida de capturas apunte a un Supabase remoto —el de
//   los clientes o cualquier otro— por un local.config editado o un merge malo.
//   Es una allowlist de hosts (127.0.0.1 / localhost / ::1), no una lista de
//   hosts prohibidos: un host nuevo que nadie previó cae del lado que aborta.
// QUÉ NO IMPIDE: que ese Supabase local tenga adentro datos que no sean del
//   laboratorio. Contra eso el que sirve es el globalSetup, que hace login real
//   y exige que las credenciales pertenezcan a la organización LAB.
// MECANISMO: se evalúa acá, al cargar la config, antes de que exista servidor.
const HOSTS_LOCALES = ['127.0.0.1', 'localhost', '::1', '[::1]']
const supabaseUrl = process.env.VITE_GVENTO_SUPABASE_URL!
let hostname: string
try {
  hostname = new URL(supabaseUrl).hostname
} catch {
  throw new Error(`VITE_GVENTO_SUPABASE_URL no es una URL válida: ${supabaseUrl}`)
}
if (!HOSTS_LOCALES.includes(hostname)) {
  throw new Error(
    `Las capturas solo corren contra un Supabase LOCAL. VITE_GVENTO_SUPABASE_URL ` +
    `apunta a "${hostname}", que no es loopback. Revisá scripts/capturas/local.config.`,
  )
}

export default defineConfig({
  testDir: HERE,

  // MISMO health check que la suite E2E, sin reescribirlo: verifica que la app
  // servida es G-Vento y que las credenciales pertenecen a la organización LAB.
  // Si apuntaran a G-10 o Salchimelo, aborta antes de la primera navegación.
  // Reusarlo en vez de copiarlo es deliberado: un guard duplicado es un guard
  // que se desactualiza en uno de los dos lados.
  globalSetup: resolve(ROOT, 'tests/global-setup.ts'),

  // Sembrar + navegar + 5 capturas en una sola corrida serial.
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },

  projects: [
    {
      name: 'capturas',
      use: {
        ...devices['Desktop Chrome'],
        // DESPUÉS del spread: 'Desktop Chrome' trae 1280×720 @1x y pisaría esto.
        viewport: { width: 1600, height: 1000 },
        deviceScaleFactor: 2,
        // Las capturas van a una landing: forzar es-CO y Bogotá evita que el
        // formato de fecha/hora cambie según la máquina que las genera.
        locale: 'es-CO',
        timezoneId: 'America/Bogota',
      },
    },
  ],

  // Igual que la suite: servidor propio en el puerto dedicado, strictPort para
  // que falle ruidoso si está ocupado en vez de capturar OTRA app.
  webServer: {
    command: `pnpm dev --port ${E2E_PORT} --strictPort`,
    url: BASE_URL,
    cwd: ROOT,
    reuseExistingServer: false,
    timeout: 60_000,
    // El bundle apunta al Supabase local porque estas dos variables se le pasan
    // EXPLÍCITAMENTE al dev server. Antes el mecanismo era `--mode capturas`,
    // que hacía que Vite leyera .env.capturas por convención de nombre; al
    // renombrar el archivo (ya no es un `.env`) esa convención dejó de aplicar,
    // así que la inyección pasó a ser explícita.
    //
    // Por qué esto le gana a .env, que tiene las credenciales de la nube:
    // loadEnv() de Vite mete primero los .env y DESPUÉS recorre process.env
    // pisando toda clave con el prefijo VITE_ (verificado en
    // node_modules/vite/dist/node/chunks — vite 5.4.21). O sea que lo de acá
    // gana, no empata.
    env: {
      VITE_GVENTO_SUPABASE_URL: supabaseUrl,
      VITE_GVENTO_SUPABASE_ANON_KEY: process.env.VITE_GVENTO_SUPABASE_ANON_KEY!,
    },
  },
})
