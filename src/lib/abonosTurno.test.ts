import { describe, it, expect } from 'vitest'
import { separarMovimientos, type ShiftReconciliation } from './shiftCalc'
import { buildShiftDetail, type ShiftDetailRow } from './shiftDetail'
import { buildCashReportData, buildCashReportHtml, deriveCashReportSales, deriveCashReportAbonos } from './printer'

// Abonos de fiado FUERA de las ventas (2026-10-13). Desde arqueo-abonos.sql el esperado de
// tarjeta/transferencia/Nequi incluye sus abonos, y el detalle y el comprobante derivaban
// "ventas" del esperado: un abono Nequi de $5.000 salía como "Nequi $5.000 · 0 vta(s)".
// Turno del caso: apertura 0; 1 venta Nequi 8.000; abono Nequi 5.000; abono efectivo 3.000
// (ingreso de caja); ingreso manual 2.000.

const SNAP: ShiftReconciliation = {
  methods: {
    cash:     { expected: 5_000, declared: 5_000, difference: 0 },
    card:     { expected: 0, declared: 0, difference: 0, abonos: 0 },
    transfer: { expected: 0, declared: 0, difference: 0, abonos: 0 },
    nequi:    { expected: 13_000, declared: 13_000, difference: 0, abonos: 5_000 },
  },
  expected_total: 18_000, declared_total: 18_000, difference_total: 0,
  sales_count: 1, vouchers_total: 0,
}
const fila = (rec: ShiftReconciliation): ShiftDetailRow => ({
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', opened_at: '2026-10-13T14:00:00Z', closed_at: '2026-10-13T23:00:00Z',
  opening_amount: 0, closing_amount: 5_000, expected_amount: 5_000, difference: 0,
  close_reconciliation: rec as unknown as ShiftDetailRow['close_reconciliation'],
  close_comment: null, abrio: null, cerro: null,
})
const MOV = { in: 5_000, out: 0, abonosEfectivo: 3_000 }

describe('separarMovimientos', () => {
  const movs = [
    { id: 'a', type: 'in', amount: 3_000 },   // abono en efectivo
    { id: 'm', type: 'in', amount: 2_000 },   // ingreso manual
    { id: 'o', type: 'out', amount: 1_000 },
  ]
  it('separa los abonos de los ingresos manuales; el total de ingresos no cambia', () => {
    expect(separarMovimientos(movs, new Set(['a'])))
      .toEqual({ ingresos: 5_000, ingresosManuales: 2_000, abonosEfectivo: 3_000, egresos: 1_000 })
  })
  it('sin vínculo conocido, todo es manual (lo de antes)', () => {
    expect(separarMovimientos(movs, new Set()))
      .toEqual({ ingresos: 5_000, ingresosManuales: 5_000, abonosEfectivo: 0, egresos: 1_000 })
  })
  it('un id de egreso en el conjunto no lo vuelve abono', () => {
    expect(separarMovimientos(movs, new Set(['o'])).abonosEfectivo).toBe(0)
  })
})

describe('ventas y abonos del snapshot', () => {
  const data = buildCashReportData(fila(SNAP), { movementsIn: MOV.in, movementsOut: MOV.out, abonosEfectivo: MOV.abonosEfectivo })
  it('las ventas NO incluyen los abonos: Nequi 8.000, total 8.000', () => {
    expect(deriveCashReportSales(data)).toEqual({ byMethod: { cash: 0, card: 0, transfer: 0, nequi: 8_000 }, total: 8_000 })
  })
  it('los abonos por método: efectivo 3.000 (ingreso de caja) y Nequi 5.000', () => {
    expect(deriveCashReportAbonos(data)).toEqual({ byMethod: { cash: 3_000, card: 0, transfer: 0, nequi: 5_000 }, total: 8_000 })
  })
  it('snapshot ANTERIOR a arqueo-abonos (sin la clave abonos): ventas = esperado, abonos 0', () => {
    const viejo: ShiftReconciliation = { ...SNAP, methods: { ...SNAP.methods, nequi: { expected: 8_000, declared: 8_000, difference: 0 } } }
    const d = buildCashReportData(fila(viejo), { movementsIn: 0, movementsOut: 0 })
    expect(deriveCashReportSales(d).byMethod.nequi).toBe(8_000)
    expect(deriveCashReportAbonos(d).total).toBe(0)
  })
})

describe('detalle del turno (buildShiftDetail)', () => {
  it('ventas, abonos y movimientos separados; el arqueo congelado no cambia', () => {
    const v = buildShiftDetail(fila(SNAP), MOV)
    expect(v.ventas?.total).toBe(8_000)
    expect(v.abonos?.byMethod).toEqual({ cash: 3_000, card: 0, transfer: 0, nequi: 5_000 })
    expect(v.movimientos).toEqual({ ingresosManuales: 2_000, abonosEfectivo: 3_000, egresos: 0 })
    expect(v.data?.reconciliation.methods.nequi.expected).toBe(13_000)
  })
  it('sin el dato de abonos en efectivo, los ingresos se ven como manuales (lo de antes)', () => {
    expect(buildShiftDetail(fila(SNAP), { in: 5_000, out: 0 }).movimientos)
      .toEqual({ ingresosManuales: 5_000, abonosEfectivo: 0, egresos: 0 })
  })
})

describe('comprobante impreso', () => {
  const html = buildCashReportHtml(buildCashReportData(fila(SNAP), { movementsIn: 5_000, movementsOut: 0, abonosEfectivo: 3_000 }))
  const linea = (etiqueta: string) => {
    const m = html.match(new RegExp(`<span>${etiqueta}</span><span[^>]*>([^<]*)</span>`))
    return m?.[1].replace(/\s+/g, ' ').trim()
  }
  it('Total ventas sin abonos, sección de abonos y los ingresos separados', () => {
    expect(linea('Total ventas')).toMatch(/^\$ 8\.000 · 1 vta\(s\)$/)
    expect(html).toContain('ABONOS DE FIADO')
    expect(linea('Total abonos')).toMatch(/^\$ 8\.000$/)
    expect(linea('Ingresos manuales')).toMatch(/^\+\$ 2\.000$/)
    expect(linea('Abonos en efectivo')).toMatch(/^\+\$ 3\.000$/)
    expect(html).not.toContain('<span>Ingresos</span>')
  })
  it('contraste: un turno sin abonos no imprime la sección', () => {
    const sin: ShiftReconciliation = { ...SNAP, methods: { ...SNAP.methods, nequi: { expected: 8_000, declared: 8_000, difference: 0, abonos: 0 } } }
    const h = buildCashReportHtml(buildCashReportData(fila(sin), { movementsIn: 0, movementsOut: 0 }))
    expect(h).not.toContain('ABONOS DE FIADO')
  })
})
