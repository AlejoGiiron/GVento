import { describe, it, expect } from 'vitest'
import { buildShiftDetail, metodoDelArqueo, type ShiftDetailRow } from './shiftDetail'
import type { ShiftReconciliation } from './shiftCalc'

// El caso que motiva este archivo NO SE PUEDE PRODUCIR DESDE LA UI: hoy no hay
// forma de cerrar un turno sin arqueo por método. Solo existe en filas viejas de
// producción, así que un E2E nunca lo alcanzaría y la rama defensiva quedaría
// sin probar. Acá las filas se construyen a mano.

const SNAPSHOT: ShiftReconciliation = {
  methods: {
    cash:     { expected: 118_000, declared: 113_000, difference: -5_000 },
    card:     { expected: 40_000, declared: 40_000, difference: 0 },
    transfer: { expected: 0, declared: 0, difference: 0 },
    nequi:    { expected: 7_000, declared: 7_000, difference: 0 },
  },
  expected_total: 165_000,
  declared_total: 160_000,
  difference_total: -5_000,
  sales_count: 12,
  vouchers_total: 3_000,
}

const fila = (over: Partial<ShiftDetailRow> = {}): ShiftDetailRow => ({
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  opened_at: '2026-09-07T14:00:00Z',
  closed_at: '2026-09-07T23:00:00Z',
  opening_amount: 130_000,
  closing_amount: 113_000,
  expected_amount: 118_000,
  difference: -5_000,
  close_reconciliation: SNAPSHOT as unknown as ShiftDetailRow['close_reconciliation'],
  close_comment: 'Faltaron 5.000',
  abrio: { full_name: 'Ana' },
  cerro: { full_name: 'Beto' },
  ...over,
})

const MOV = { in: 0, out: 12_000 }

describe('buildShiftDetail — turno CON arqueo', () => {
  it('construye el objeto del comprobante y deriva las ventas', () => {
    const v = buildShiftDetail(fila(), MOV)
    expect(v.tieneArqueo).toBe(true)
    expect(v.data).not.toBeNull()
    expect(v.ventas).not.toBeNull()
    // Efectivo = esperado − apertura − ingresos + egresos = 118k − 130k − 0 + 12k
    expect(v.ventas!.byMethod.cash).toBe(0)
    expect(v.ventas!.byMethod.nequi).toBe(7_000)
    expect(v.ventas!.total).toBe(47_000)
  })

  it('pasa el snapshot al comprobante SIN recomputarlo', () => {
    const v = buildShiftDetail(fila(), MOV)
    expect(v.data!.reconciliation).toBe(SNAPSHOT)
  })

  it('expone vales y nº de ventas del snapshot', () => {
    const v = buildShiftDetail(fila(), MOV)
    expect(v.vouchers).toBe(3_000)
    expect(v.salesCount).toBe(12)
  })
})

describe('buildShiftDetail — turno SIN arqueo (pre-migración)', () => {
  const sinArqueo = fila({ close_reconciliation: null, close_comment: null })

  it('NO llama al builder: data queda en null en vez de traer reconciliation null', () => {
    // El corazón del caso. buildCashReportData castea sin chequear; si se lo
    // llamara igual, `data.reconciliation` sería null y todo lo que lo lea
    // revienta. La rama se decide ANTES.
    const v = buildShiftDetail(sinArqueo, MOV)
    expect(v.tieneArqueo).toBe(false)
    expect(v.data).toBeNull()
    expect(v.ventas).toBeNull()
  })

  it('IGUAL devuelve el cuadre de efectivo (F1), que existe en todo turno cerrado', () => {
    // Es lo que hace que un turno viejo tenga detalle en vez de pantalla vacía.
    const v = buildShiftDetail(sinArqueo, MOV)
    expect(v.efectivo).toEqual({ esperado: 118_000, declarado: 113_000, diferencia: -5_000 })
  })

  it('vales y nº de ventas caen a 0, no a undefined', () => {
    const v = buildShiftDetail(sinArqueo, MOV)
    expect(v.vouchers).toBe(0)
    expect(v.salesCount).toBe(0)
  })

  it('una fila con columnas de F1 en null tampoco produce undefined', () => {
    const v = buildShiftDetail(
      fila({ close_reconciliation: null, closing_amount: null, expected_amount: null, difference: null }),
      MOV,
    )
    expect(v.efectivo).toEqual({ esperado: 0, declarado: 0, diferencia: 0 })
  })
})

describe('buildShiftDetail — snapshots INCOMPLETOS', () => {
  it('sin vouchers_total (snapshot anterior al vale) devuelve 0, no NaN', () => {
    const viejo = { ...SNAPSHOT } as Partial<ShiftReconciliation>
    delete viejo.vouchers_total
    const v = buildShiftDetail(
      fila({ close_reconciliation: viejo as unknown as ShiftDetailRow['close_reconciliation'] }),
      MOV,
    )
    expect(v.vouchers).toBe(0)
    expect(Number.isNaN(v.vouchers)).toBe(false)
  })

  it('a `methods` le puede faltar una clave: cuenta 0 en vez de reventar', () => {
    const parcial = {
      ...SNAPSHOT,
      methods: { cash: SNAPSHOT.methods.cash, card: SNAPSHOT.methods.card },
    }
    const v = buildShiftDetail(
      fila({ close_reconciliation: parcial as unknown as ShiftDetailRow['close_reconciliation'] }),
      MOV,
    )
    expect(v.ventas!.byMethod.nequi).toBe(0)
    expect(v.ventas!.byMethod.transfer).toBe(0)
    // Y el que SÍ está sigue valiendo lo suyo — contraste: sin esto, un
    // "devolvé 0 siempre" pasaría la aserción de arriba.
    expect(v.ventas!.byMethod.card).toBe(40_000)
  })

  it('`methods` ausente por completo no rompe la derivación', () => {
    const roto = { ...SNAPSHOT, methods: undefined }
    const v = buildShiftDetail(
      fila({ close_reconciliation: roto as unknown as ShiftDetailRow['close_reconciliation'] }),
      MOV,
    )
    expect(v.ventas!.total).toBe(12_000 - 130_000)   // solo apertura y egresos
  })
})

describe('metodoDelArqueo', () => {
  it('devuelve el método cuando está', () => {
    expect(metodoDelArqueo(SNAPSHOT, 'cash')).toEqual(SNAPSHOT.methods.cash)
  })

  it('devuelve ceros cuando falta la clave, el snapshot es null o methods no está', () => {
    const vacio = { expected: 0, declared: 0, difference: 0 }
    expect(metodoDelArqueo(null, 'cash')).toEqual(vacio)
    expect(metodoDelArqueo(undefined, 'nequi')).toEqual(vacio)
    expect(metodoDelArqueo({ ...SNAPSHOT, methods: undefined } as unknown as ShiftReconciliation, 'card'))
      .toEqual(vacio)
  })
})
