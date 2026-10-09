import { describe, it, expect } from 'vitest'
import { coincide, ordenarClientes, posiblesDuplicados, type ClienteFiado } from './clientesFiado'

const c = (id: string, name: string, phone: string | null = null): ClienteFiado => ({ id, name, phone })
const ANA = c('a', 'Ana Pérez', '300 123 4567')
const BETO = c('b', 'Beto', '3109876543')
const CARLA = c('c', 'Carla Gómez', null)
const DANI = c('d', 'Daniel', '3001112222')
const TODOS = [DANI, CARLA, BETO, ANA]

describe('coincide', () => {
  it('nombre sin mayúsculas ni tildes', () => {
    expect(coincide(ANA, 'perez')).toBe(true)
    expect(coincide(ANA, 'PÉREZ')).toBe(true)
    expect(coincide(ANA, 'gomez')).toBe(false)
  })
  it('teléfono por dígitos, desde 3', () => {
    expect(coincide(ANA, '3001234')).toBe(true)
    expect(coincide(ANA, '300 123')).toBe(true)
    expect(coincide(BETO, '3001234')).toBe(false)
    expect(coincide(ANA, '30')).toBe(false)          // 2 dígitos: no busca en el teléfono
    expect(coincide(CARLA, '300')).toBe(false)       // sin teléfono
  })
  it('vacío = todos', () => {
    expect(coincide(CARLA, '  ')).toBe(true)
  })
})

describe('ordenarClientes', () => {
  it('recientes primero (el último fiado más nuevo arriba), después el resto por nombre', () => {
    // El más reciente (b) viene DESPUÉS en la entrada: un sort que no compare fechas
    // (estable) lo dejaría detrás de d y el test lo nota.
    const ultimo = new Map([['b', '2026-10-07T22:00:00Z'], ['d', '2026-10-01T10:00:00Z']])
    expect(TODOS.findIndex((x) => x.id === 'b')).toBeGreaterThan(TODOS.findIndex((x) => x.id === 'd'))
    expect(ordenarClientes(TODOS, ultimo, '').map((x) => x.id)).toEqual(['b', 'd', 'a', 'c'])
  })
  it('sin recientes: por nombre', () => {
    expect(ordenarClientes(TODOS, new Map(), '').map((x) => x.id)).toEqual(['a', 'b', 'c', 'd'])
  })
  it('filtra y conserva el orden', () => {
    const ultimo = new Map([['d', '2026-10-07T22:00:00Z']])
    expect(ordenarClientes(TODOS, ultimo, '300').map((x) => x.id)).toEqual(['d', 'a'])
  })
  it('no muta la lista recibida', () => {
    const lista = [...TODOS]
    ordenarClientes(lista, new Map(), '')
    expect(lista).toEqual(TODOS)
  })
})

describe('posiblesDuplicados', () => {
  it('mismo nombre (sin tildes) o mismo teléfono', () => {
    expect(posiblesDuplicados(TODOS, 'ana perez', '').map((x) => x.id)).toEqual(['a'])
    expect(posiblesDuplicados(TODOS, 'Otro', '310 987 6543').map((x) => x.id)).toEqual(['b'])
  })
  it('contraste: parecido no es igual', () => {
    expect(posiblesDuplicados(TODOS, 'Ana', '')).toEqual([])
    expect(posiblesDuplicados(TODOS, '', '310')).toEqual([])
  })
})
