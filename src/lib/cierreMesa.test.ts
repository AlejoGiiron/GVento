import { describe, it, expect } from 'vitest'
import { comoSeCobro, horaBogota, mensajeOtroCobro, type CierreMesa } from './cierreMesa'

const base: CierreMesa = {
  order_id: 'o1', order_number: 128, total: 18000, ya_existia: true, otro_cobro: true,
  metodos: ['cash'], fiado: false, cliente: null, anulada: false,
  cobrada_por: 'Ana Gómez', cobrada_at: '2026-10-09T02:40:00.000Z', mesa: 'Mesa 4',
}

describe('cierreMesa', () => {
  it('la hora sale en Bogotá, no en UTC (R7)', () => {
    // 02:40 UTC del 9 = 21:40 del 8 en Bogotá.
    expect(horaBogota('2026-10-09T02:40:00.000Z')).toBe('21:40')
  })

  it('el mensaje dice quién, a qué hora y con qué', () => {
    expect(mensajeOtroCobro(base)).toBe('Esta mesa ya la cobró Ana Gómez a las 21:40 con efectivo.')
  })

  it('varios métodos, fiado, total 0 y sin pagos', () => {
    expect(comoSeCobro({ ...base, metodos: ['cash', 'nequi'] })).toBe('con efectivo y Nequi')
    expect(comoSeCobro({ ...base, metodos: ['cash', 'card', 'nequi'] })).toBe('con efectivo, tarjeta y Nequi')
    expect(comoSeCobro({ ...base, metodos: [], fiado: true, cliente: 'Pedro' })).toBe('a fiado a nombre de Pedro')
    expect(comoSeCobro({ ...base, metodos: [], fiado: true, cliente: null })).toBe('a fiado')
    expect(comoSeCobro({ ...base, metodos: [], total: 0 })).toBe('sin cobro (total $0)')
    // Cerrada por el frontend viejo sin pago (el hueco de H2): no se inventa un método.
    expect(comoSeCobro({ ...base, metodos: [] })).toBe('sin pagos registrados')
  })

  it('cerrada antes del Paso 9 (sin quién ni cuándo): no inventa nombre ni hora', () => {
    expect(mensajeOtroCobro({ ...base, cobrada_por: null, cobrada_at: null }))
      .toBe('Esta mesa ya la cobró otro usuario con efectivo.')
  })
})
