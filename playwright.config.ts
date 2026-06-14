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

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173'

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // los flujos comparten sesión/estado del backend
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // Levanta el dev server de Vite automáticamente si no está corriendo.
  webServer: {
    command: 'pnpm dev',
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
