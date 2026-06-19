import { request, type FullConfig } from '@playwright/test'

// Puerto dedicado de G-Vento (debe coincidir con E2E_PORT de playwright.config.ts).
const BASE_URL = 'http://localhost:5180'

/**
 * Health check previo a la suite: confirma que el servidor en BASE_URL sirve
 * G-Vento y no otra app (p. ej. G-Mura). Aunque el webServer ya usa un puerto
 * dedicado + strictPort, esto atrapa cualquier override mal configurado y aborta
 * la corrida en vez de fallar test por test contra la app equivocada.
 */
export default async function globalSetup(_config: FullConfig): Promise<void> {
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
