import { defineConfig } from 'vitest/config'

// Tests unitarios acotados a src/ para no colisionar con los specs E2E
// de Playwright que viven en tests/ (esos corren con `pnpm test:e2e`).
export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    environment: 'node',
  },
})
