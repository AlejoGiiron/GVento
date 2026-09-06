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

// ── .env.capturas PISA lo que haya cargado la config raíz ───────────────────
// La config raíz ya metió .env.test en process.env (las credenciales de la
// nube). Acá se sobreescriben, a propósito y sin condiciones: las capturas
// corren contra el Supabase LOCAL de Docker y contra ninguna otra cosa.
//
// Es una asignación directa, no un "si no está definido": si esto fuera
// condicional, un .env.test presente bastaría para apuntar la corrida a la base
// compartida sin que nadie se entere. Falla cerrado — si falta .env.capturas,
// aborta acá en vez de caer de vuelta a la nube por omisión.
const ENV_CAPTURAS = resolve(ROOT, '.env.capturas')
if (!existsSync(ENV_CAPTURAS)) {
  throw new Error(
    'Falta .env.capturas. Las capturas corren contra el Supabase local de ' +
    'Docker; sin ese archivo no hay a dónde apuntar. Corré: pnpm capturas:preparar',
  )
}
for (const line of readFileSync(ENV_CAPTURAS, 'utf-8').split('\n')) {
  const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/)
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
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
    // --mode capturas hace que Vite lea .env.capturas (que tiene prioridad
    // sobre .env), o sea que el bundle apunta al Supabase local.
    command: `pnpm dev --mode capturas --port ${E2E_PORT} --strictPort`,
    url: BASE_URL,
    cwd: ROOT,
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
