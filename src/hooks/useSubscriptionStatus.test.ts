import { describe, it, expect } from 'vitest'
import { resolveNotice } from './useSubscriptionStatus'

// ============================================================================
// FAIL-OPEN de la bandera de suscripción.
//
// La regla es una sola y es asimétrica: mostrar de menos es aceptable, mostrar
// donde no corresponde no lo es. Un bar sin poder operar un domingo por una
// bandera que no supimos interpretar es inaceptable; que un moroso no vea el
// aviso se resuelve con una llamada.
//
// Por eso la tabla de abajo es EXHAUSTIVA sobre las entradas raras, no sobre
// las felices: lo que hay que probar es que nada inesperado produzca un aviso.
// ============================================================================

describe('resolveNotice — fail-open', () => {
  // Todo lo que NO sea exactamente 'expiring' o 'grace' devuelve null.
  const sinAviso: Array<[string, string | null | undefined]> = [
    ['active (el estado normal)', 'active'],
    ['restricted — NO implementado en esta fase', 'restricted'],
    ['suspended — NO implementado en esta fase', 'suspended'],
    ['un estado que agregue G-Centro y no conozcamos', 'trial_extendido'],
    ['columna nula', null],
    ['lectura fallida / fila ausente', undefined],
    ['cadena vacía', ''],
    ['mayúsculas — el contrato es exacto', 'EXPIRING'],
    ['con espacios alrededor', ' grace '],
  ]

  for (const [caso, status] of sinAviso) {
    it(`no muestra nada: ${caso}`, () => {
      expect(resolveNotice(status, 'un mensaje cualquiera')).toBeNull()
    })
  }

  // CONTRASTE: sin esto, los casos de arriba pasarían aunque resolveNotice
  // devolviera null SIEMPRE — verde por la razón equivocada.
  it('los dos estados implementados SÍ producen aviso (contraste)', () => {
    expect(resolveNotice('expiring', 'x')).not.toBeNull()
    expect(resolveNotice('grace', 'x')).not.toBeNull()
  })
})

describe('resolveNotice — mensaje por defecto', () => {
  // Un mensaje vacío NO puede silenciar el banner: sería darle a G-Centro un
  // interruptor accidental para apagar el aviso.
  const vacios: Array<[string, string | null | undefined]> = [
    ['null', null],
    ['undefined', undefined],
    ['cadena vacía', ''],
    ['solo espacios', '   '],
    ['espacios y saltos de línea', ' \n\t '],
  ]

  for (const [caso, mensaje] of vacios) {
    it(`expiring con mensaje ${caso} usa el texto por defecto`, () => {
      const n = resolveNotice('expiring', mensaje)
      expect(n).not.toBeNull()
      expect(n!.mensaje.length).toBeGreaterThan(0)
      expect(n!.mensaje).toMatch(/vencer/i)
    })

    it(`grace con mensaje ${caso} usa el texto por defecto`, () => {
      const n = resolveNotice('grace', mensaje)
      expect(n).not.toBeNull()
      expect(n!.mensaje).toMatch(/venció/i)
    })
  }

  it('el mensaje de G-Centro gana sobre el default cuando trae texto', () => {
    const n = resolveNotice('expiring', 'Renovar antes del 20 de agosto.')
    expect(n!.mensaje).toBe('Renovar antes del 20 de agosto.')
  })

  it('el mensaje se recorta pero no se altera de otro modo', () => {
    expect(resolveNotice('grace', '  Pagá acá  ')!.mensaje).toBe('Pagá acá')
  })
})

describe('resolveNotice — descartabilidad', () => {
  it('expiring es descartable', () => {
    expect(resolveNotice('expiring', 'x')!.descartable).toBe(true)
  })

  // grace es PERSISTENTE por decisión de producto: es el nivel donde el aviso
  // no debe poder silenciarse, aunque nada se bloquee todavía.
  it('grace NO es descartable', () => {
    expect(resolveNotice('grace', 'x')!.descartable).toBe(false)
  })
})
