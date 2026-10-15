import { describe, expect, it } from 'vitest'
import { horaBogota, pesos, textoEstado } from './textos'

describe('portal · textos', () => {
  it('pesos colombianos sin decimales', () => {
    expect(pesos(12000).replace(/\s/g, ' ')).toMatch(/^\$ ?12\.000$/)
  })
  it('la hora de apertura en Bogotá, no en UTC (R7)', () => {
    // 2026-10-19T04:45Z = domingo 18 a las 11:45 p. m. en Bogotá (en UTC sería lunes).
    expect(horaBogota('2026-10-19T04:45:00Z')).toMatch(/^domingo/)
  })
  it('cada estado tiene su texto; uno desconocido, el genérico', () => {
    expect([
      textoEstado({ recibe: true, motivo: null, abre_en: null }),
      textoEstado({ recibe: false, motivo: 'pausado', abre_en: null }),
      textoEstado({ recibe: false, motivo: 'fuera_de_horario', abre_en: null }),
      textoEstado({ recibe: false, motivo: 'sin_turno', abre_en: null }),
      textoEstado({ recibe: false, motivo: 'otro' as never, abre_en: null }),
    ]).toEqual(['Recibiendo pedidos', 'Pausamos los pedidos por un momento', 'Cerrado por ahora',
      'Todavía no abrimos: vuelve en un rato', 'No estamos recibiendo pedidos'])
  })
})
