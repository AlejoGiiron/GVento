import { defineConfig } from 'vitest/config'
import path from 'path'

// Tests unitarios acotados a src/ para no colisionar con los specs E2E
// de Playwright que viven en tests/ (esos corren con `pnpm test:e2e`).
export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    environment: 'node',
  },
  // El alias '@' está en vite.config.ts, pero este archivo es una config
  // APARTE (no la extiende), así que hay que repetirlo: sin esto, cualquier
  // módulo de src/ que importe con '@/...' no se puede testear —los tests
  // viejos no lo notaron porque viven en src/lib/ y usan rutas relativas.
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
