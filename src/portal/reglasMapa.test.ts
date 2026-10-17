import { describe, expect, it } from 'vitest'
import { mapaFijaPunto, textoSobre } from './reglasMapa'

describe('portal · el mapa fija el punto solo si se ven las calles', () => {
  it('producción: con teselas sí; sin teselas o si fallaron, no (falla cerrado)', () => {
    const casos = [
      { hayTeselas: true, fallaron: false, desarrollo: false },
      { hayTeselas: false, fallaron: false, desarrollo: false },
      { hayTeselas: true, fallaron: true, desarrollo: false },
      { hayTeselas: false, fallaron: false, desarrollo: true },
      { hayTeselas: true, fallaron: true, desarrollo: true },
    ]
    expect(casos.map(mapaFijaPunto)).toEqual([true, false, false, true, false])
  })
})

describe('portal · texto sobre el color del negocio', () => {
  it('oscuros → blanco; claros → casi negro; forma inválida → blanco', () => {
    expect(['#047857', '#0f172a', '#aa3300', '#fde047', '#ffffff', '#a7f3d0', 'verde'].map(textoSobre))
      .toEqual(['#ffffff', '#ffffff', '#ffffff', '#0f172a', '#0f172a', '#0f172a', '#ffffff'])
  })
})
