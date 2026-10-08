import { describe, it, expect, vi, afterEach } from 'vitest'
import { nuevoUuid } from './uuid'

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('nuevoUuid', () => {
  afterEach(() => vi.restoreAllMocks())

  it('con randomUUID (contexto seguro) usa el del navegador', () => {
    const spy = vi.spyOn(crypto, 'randomUUID')
    expect(nuevoUuid()).toMatch(V4)
    expect(spy).toHaveBeenCalledOnce()
  })

  it('SIN randomUUID (http por la LAN) arma un v4 válido y distinto cada vez', () => {
    const original = crypto.randomUUID
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true })
    try {
      const a = nuevoUuid()
      const b = nuevoUuid()
      expect(a).toMatch(V4)
      expect(b).toMatch(V4)
      expect(a).not.toBe(b)
    } finally {
      Object.defineProperty(crypto, 'randomUUID', { value: original, configurable: true })
    }
  })
})
