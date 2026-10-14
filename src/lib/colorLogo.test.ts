import { describe, expect, it } from 'vitest'
import { colorDominante } from './colorLogo'

// Píxeles RGBA para armar una imagen de prueba.
const px = (r: number, g: number, b: number, a = 255, n = 1) => Array.from({ length: n }, () => [r, g, b, a]).flat()
const img = (...partes: number[][]) => new Uint8ClampedArray(partes.flat())

describe('colorDominante (color sugerido desde el logo)', () => {
  it('toma el color con carácter que más aparece e ignora blanco, negro, grises y transparentes', () => {
    const datos = img(
      px(255, 255, 255, 255, 50),   // fondo blanco (el que más hay)
      px(10, 10, 10, 255, 30),      // texto negro
      px(128, 128, 128, 255, 20),   // gris
      px(194, 65, 12, 0, 40),       // naranja TRANSPARENTE: no cuenta
      px(194, 65, 12, 255, 15),     // naranja visible
      px(29, 78, 216, 255, 5),      // azul, menos
    )
    expect(colorDominante(datos)).toBe('#c2410c')
  })

  it('un logo sin ningún color con carácter no sugiere nada (el portal usa el verde de G-Vento)', () => {
    expect(colorDominante(img(px(255, 255, 255, 255, 10), px(0, 0, 0, 255, 10), px(120, 120, 120, 255, 10)))).toBeNull()
  })
})
