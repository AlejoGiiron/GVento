import { describe, it, expect } from 'vitest'
import { metodoReal, avisoYaExistia } from './metodoVenta'

describe('metodoReal: lo que dijo el servidor, no lo que pidió el reintento', () => {
  it('pagos', () => {
    expect(metodoReal({ total: 8000, metodos: ['cash'], fiado: false })).toBe('Efectivo')
    expect(metodoReal({ total: 8000, metodos: ['cash', 'nequi'], fiado: false })).toBe('Efectivo + Nequi')
  })
  it('fiado, con y sin nombre', () => {
    expect(metodoReal({ total: 8000, metodos: [], fiado: true, cliente: 'Ana' })).toBe('Fiado a Ana')
    expect(metodoReal({ total: 8000, metodos: [], fiado: true, cliente: null })).toBe('Fiado')
  })
  it('total 0, anulada, y sin pagos', () => {
    expect(metodoReal({ total: 0, metodos: [], fiado: false })).toBe('venta sin cobro (total $0)')
    expect(metodoReal({ total: 8000, metodos: [], fiado: false, anulada: true })).toBe('anulada')
    expect(metodoReal({ total: 8000, metodos: [], fiado: false })).toBe('sin pagos')
  })
  it('servidor sin la migración (sin metodos/fiado): null, no se inventa', () => {
    expect(metodoReal({ total: 8000 })).toBeNull()
  })
})

describe('avisoYaExistia', () => {
  it('con el método real', () => {
    expect(avisoYaExistia({ total: 8000, metodos: ['cash'], fiado: false }))
      .toBe('Esta venta ya quedó registrada como Efectivo. No se cobró dos veces.')
  })
  it('contraste: sin el dato, no nombra ningún método', () => {
    expect(avisoYaExistia({ total: 8000 })).toBe('Esta venta ya quedó registrada en el intento anterior. No se cobró dos veces.')
  })
})
