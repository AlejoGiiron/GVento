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
// Y uno propio: si en TIEMPO_MAXIMO_LOGIN_MS no hay respuesta, TiempoAgotado (sin
// conexión). supabase-js no tiene tiempo máximo: sin esto, un servidor que no contesta
// dejaba el botón en "Autenticando..." para siempre.

export type FalloLogin = 'credenciales' | 'sin-conexion' | 'otro'

export const TIEMPO_MAXIMO_LOGIN_MS = 15_000

export class TiempoAgotado extends Error {
  constructor(ms: number) {
    super(`Sin respuesta del servidor en ${ms / 1000} s`)
    this.name = 'TiempoAgotado'
  }
}

/**
 * La promesa, o TiempoAgotado si no termina en `ms`. NO cancela el pedido: si el
 * servidor contesta tarde y el login era correcto, la sesión igual se abre y la app
 * entra sola (onAuthStateChange). Es lo esperable: la clave era la correcta.
 */
export function conTiempoMaximo<T>(promesa: Promise<T>, ms: number): Promise<T> {
  let reloj: ReturnType<typeof setTimeout> | undefined
  const tope = new Promise<never>((_, rechazar) => { reloj = setTimeout(() => rechazar(new TiempoAgotado(ms)), ms) })
  return Promise.race([promesa, tope]).finally(() => clearTimeout(reloj))
}

export function clasificarFalloLogin(err: unknown): FalloLogin {
  const e = (err ?? {}) as { name?: string; status?: number; code?: string }
  if (e.code === 'invalid_credentials') return 'credenciales'
  if (e.name === 'AuthRetryableFetchError' || e.name === 'AuthUnknownError' || e.name === 'TiempoAgotado') return 'sin-conexion'
  if (err instanceof TypeError) return 'sin-conexion'                // fetch que tiró por su cuenta
  if (typeof e.status !== 'number' || e.status === 0 || e.status >= 500) return 'sin-conexion'
  return 'otro'
}

export const MENSAJE_FALLO_LOGIN: Record<FalloLogin, { titulo: string; detalle: string }> = {
  'credenciales': { titulo: 'Credenciales incorrectas', detalle: 'Verifica tu correo y contraseña e intenta de nuevo.' },
  'sin-conexion': { titulo: 'No hay conexión con el servidor.', detalle: 'Revisa el wifi e intenta de nuevo.' },
  'otro':         { titulo: 'No se pudo iniciar sesión', detalle: 'Intenta de nuevo en unos minutos. Si sigue pasando, contacta al administrador.' },
}
