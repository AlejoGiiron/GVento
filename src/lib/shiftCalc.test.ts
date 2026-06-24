import { describe, it, expect } from 'vitest'
import { calcShiftBalance, availableCash } from './shiftCalc'

describe('calcShiftBalance', () => {
  it('cuadrado: declarado coincide con el esperado', () => {
    const r = calcShiftBalance({
      openingAmount: 50_000,
      cashSales: 30_000,
      movementsIn: 0,
      movementsOut: 0,
      declared: 80_000,
    })
    expect(r.expectedCash).toBe(80_000)
    expect(r.difference).toBe(0)
    expect(r.status).toBe('exact')
    expect(r.isOverdraft).toBe(false)
  })

  it('sobrante: hay más efectivo del esperado', () => {
    const r = calcShiftBalance({
      openingAmount: 50_000,
      cashSales: 30_000,
      movementsIn: 0,
      movementsOut: 0,
      declared: 95_000,
    })
    expect(r.expectedCash).toBe(80_000)
    expect(r.difference).toBe(15_000)
    expect(r.status).toBe('over')
    expect(r.isOverdraft).toBe(false)
  })

  it('faltante: hay menos efectivo del esperado', () => {
    const r = calcShiftBalance({
      openingAmount: 50_000,
      cashSales: 30_000,
      movementsIn: 0,
      movementsOut: 0,
      declared: 70_000,
    })
    expect(r.expectedCash).toBe(80_000)
    expect(r.difference).toBe(-10_000)
    expect(r.status).toBe('short')
    expect(r.isOverdraft).toBe(false)
  })

  it('sobregiro: los egresos dejan el esperado negativo', () => {
    const r = calcShiftBalance({
      openingAmount: 50_000,
      cashSales: 20_000,
      movementsIn: 0,
      movementsOut: 100_000, // supera apertura + ventas efectivo
      declared: 0,
    })
    expect(r.expectedCash).toBe(-30_000)
    expect(r.isOverdraft).toBe(true)
    // El cuadre sigue siendo ortogonal: declarado 0 vs esperado -30k = sobrante
    expect(r.difference).toBe(30_000)
    expect(r.status).toBe('over')
  })

  it('ingresos manuales aumentan el esperado', () => {
    const r = calcShiftBalance({
      openingAmount: 50_000,
      cashSales: 0,
      movementsIn: 25_000,
      movementsOut: 5_000,
      declared: 70_000,
    })
    expect(r.expectedCash).toBe(70_000)
    expect(r.status).toBe('exact')
  })
})

describe('availableCash', () => {
  it('apertura + ventas efectivo + ingresos − egresos', () => {
    expect(
      availableCash({ openingAmount: 50_000, cashSales: 30_000, movementsIn: 10_000, movementsOut: 20_000 }),
    ).toBe(70_000)
  })

  it('puede quedar negativo (sobregiro)', () => {
    expect(
      availableCash({ openingAmount: 0, cashSales: 0, movementsIn: 0, movementsOut: 15_000 }),
    ).toBe(-15_000)
  })
})
