// ── Por qué falló el login ───────────────────────────────────────────────────
// ALLOWLIST (R2): "Credenciales incorrectas" SOLO cuando el servidor lo dice
// (code invalid_credentials). Antes TODO error caía ahí: con el servidor caído
// (medido el 2026-10-08: un 504 de la API local), el cajero leía que su clave
// estaba mal y la volvía a escribir.
//
// Cómo falla supabase-js (auth-js 2.104, lib/fetch.js):
//   · fetch fallido (sin red, conexión cortada) → AuthRetryableFetchError, status 0
//   · 502/503/504/520–524/530                  → AuthRetryableFetchError, status
//   · respuesta que no es JSON                 → AuthUnknownError
//   · el resto                                 → AuthApiError(status, code)

export type FalloLogin = 'credenciales' | 'sin-conexion' | 'otro'

export function clasificarFalloLogin(err: unknown): FalloLogin {
  const e = (err ?? {}) as { name?: string; status?: number; code?: string }
  if (e.code === 'invalid_credentials') return 'credenciales'
  if (e.name === 'AuthRetryableFetchError' || e.name === 'AuthUnknownError') return 'sin-conexion'
  if (err instanceof TypeError) return 'sin-conexion'                // fetch que tiró por su cuenta
  if (typeof e.status !== 'number' || e.status === 0 || e.status >= 500) return 'sin-conexion'
  return 'otro'
}

export const MENSAJE_FALLO_LOGIN: Record<FalloLogin, { titulo: string; detalle: string }> = {
  'credenciales': { titulo: 'Credenciales incorrectas', detalle: 'Verifica tu correo y contraseña e intenta de nuevo.' },
  'sin-conexion': { titulo: 'No hay conexión con el servidor.', detalle: 'Revisa el wifi e intenta de nuevo.' },
  'otro':         { titulo: 'No se pudo iniciar sesión', detalle: 'Intenta de nuevo en unos minutos. Si sigue pasando, contacta al administrador.' },
}
