import { describe, it, expect, vi, afterEach } from 'vitest'
import { AuthApiError, AuthRetryableFetchError, AuthUnknownError } from '@supabase/supabase-js'
import { clasificarFalloLogin, conTiempoMaximo, TiempoAgotado } from './falloLogin'

// Con las clases de error REALES de supabase-js, no con objetos inventados (R4).
describe('clasificarFalloLogin', () => {
  it('credenciales: SOLO cuando el servidor dice invalid_credentials', () => {
    expect(clasificarFalloLogin(new AuthApiError('Invalid login credentials', 400, 'invalid_credentials'))).toBe('credenciales')
  })
  it('sin conexión: fetch fallido, 502/503/504, respuesta que no es JSON, 500, TypeError', () => {
    expect(clasificarFalloLogin(new AuthRetryableFetchError('Failed to fetch', 0))).toBe('sin-conexion')
    expect(clasificarFalloLogin(new AuthRetryableFetchError('Gateway Timeout', 504))).toBe('sin-conexion')
    expect(clasificarFalloLogin(new AuthRetryableFetchError('Bad Gateway', 502))).toBe('sin-conexion')
    expect(clasificarFalloLogin(new AuthUnknownError('Unexpected token <', null))).toBe('sin-conexion')
    expect(clasificarFalloLogin(new AuthApiError('Internal error', 500, 'unexpected_failure'))).toBe('sin-conexion')
    expect(clasificarFalloLogin(new TypeError('Failed to fetch'))).toBe('sin-conexion')
  })
  it('otro: un 4xx que NO es de credenciales no culpa a la clave ni a la red', () => {
    expect(clasificarFalloLogin(new AuthApiError('Request rate limit reached', 429, 'over_request_rate_limit'))).toBe('otro')
    expect(clasificarFalloLogin(new AuthApiError('Email not confirmed', 400, 'email_not_confirmed'))).toBe('otro')
  })
})

describe('conTiempoMaximo', () => {
  afterEach(() => { vi.useRealTimers() })

  it('sin respuesta en el tope → TiempoAgotado, que se clasifica como sin conexión', async () => {
    vi.useFakeTimers()
    const nunca = new Promise<never>(() => {})
    const r = conTiempoMaximo(nunca, 15_000).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(14_999)
    let listo = false
    void r.then(() => { listo = true })
    await Promise.resolve()
    expect(listo, 'antes del tope sigue esperando').toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const e = await r
    expect(e).toBeInstanceOf(TiempoAgotado)
    expect(clasificarFalloLogin(e)).toBe('sin-conexion')
  })

  it('contraste: la respuesta a tiempo pasa tal cual, y el reloj se limpia', async () => {
    vi.useFakeTimers()
    const r = conTiempoMaximo(Promise.resolve('ok'), 15_000)
    await expect(r).resolves.toBe('ok')
    expect(vi.getTimerCount()).toBe(0)
  })
})
