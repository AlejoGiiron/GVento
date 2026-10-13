import { describe, it, expect } from 'vitest'
import { motivoSinCocina, SEDE_SIN_COCINA, NADA_VA_A_COCINA, TODO_ENVIADO, MESA_VACIA } from './cocinaMesa'

describe('motivoSinCocina (botón "Cocina" de Mesas)', () => {
  it('con algo para cocina no hay motivo: el botón envía', () => {
    expect(motivoSinCocina({ sedeUsaCocina: true, lineas: 2, sinEnviar: 2, paraCocina: 1 })).toBeNull()
  })
  it('sede sin cocina gana a todo lo demás (aunque haya productos que irían)', () => {
    expect(motivoSinCocina({ sedeUsaCocina: false, lineas: 2, sinEnviar: 2, paraCocina: 0 })).toBe(SEDE_SIN_COCINA)
  })
  it('líneas sin enviar, pero ninguna de un producto que va a cocina', () => {
    expect(motivoSinCocina({ sedeUsaCocina: true, lineas: 2, sinEnviar: 2, paraCocina: 0 })).toBe(NADA_VA_A_COCINA)
  })
  it('todo ya enviado', () => {
    expect(motivoSinCocina({ sedeUsaCocina: true, lineas: 2, sinEnviar: 0, paraCocina: 0 })).toBe(TODO_ENVIADO)
  })
  it('se envió lo que iba a cocina y queda algo que no va (cerveza enviada, agua no)', () => {
    expect(motivoSinCocina({ sedeUsaCocina: true, lineas: 2, sinEnviar: 1, paraCocina: 0 })).toBe(TODO_ENVIADO)
  })
  it('mesa sin productos', () => {
    expect(motivoSinCocina({ sedeUsaCocina: true, lineas: 0, sinEnviar: 0, paraCocina: 0 })).toBe(MESA_VACIA)
  })
})
