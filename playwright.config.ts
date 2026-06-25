import { defineConfig, devices } from '@playwright/test'
import { readFileSync, existsSync } from 'node:fs'

// ── Carga .env.test (sin dependencia de dotenv) ──
// Las credenciales de prueba NO se hardcodean: viven en .env.test (gitignored)
// o en variables de entorno del shell/CI. Ver .env.test.example.
const ENV_FILE = '.env.test'
if (existsSync(ENV_FILE)) {
  for (const line of readFileSync(ENV_FILE, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
}

// Puerto DEDICADO de G-Vento para E2E (no el 5173 por defecto de Vite, que puede
// estar ocupado por otra app — p. ej. G-Mura). Playwright SIEMPRE levanta su
// propio servidor de gvento aquí (reuseExistingServer:false + strictPort), así
// nunca se conecta por accidente a otra app. Ver tests/README.md.
export const E2E_PORT = 5180
const BASE_URL = `http://localhost:${E2E_PORT}`

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
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // SIEMPRE levanta el dev server de gvento en el puerto dedicado. strictPort
  // hace que falle ruidosamente si el puerto está ocupado, en vez de servir/
  // conectarse a otra cosa.
  webServer: {
    command: `pnpm dev --port ${E2E_PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
