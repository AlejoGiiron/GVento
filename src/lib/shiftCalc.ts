// Cálculo puro del cuadre de caja al cerrar un turno.
// Sin React, sin red: testeable de forma unitaria y determinista.

/** Estado del cuadre: declarado vs. efectivo esperado. */
export type CuadreStatus = 'exact' | 'over' | 'short'

export interface ShiftBalanceInput {
  /** Monto con el que se abrió la caja. */
  openingAmount: number
  /** Ventas cobradas en efectivo durante el turno. */
  cashSales: number
  /** Ingresos manuales (movimientos 'in'). */
  movementsIn: number
  /** Egresos manuales (movimientos 'out'). */
  movementsOut: number
  /** Efectivo declarado por quien cierra la caja. */
  declared: number
}

export interface ShiftBalance {
  /** apertura + ventas efectivo + ingresos − egresos. Puede ser negativo (sobregiro). */
  expectedCash: number
  /** declared − expectedCash. Negativo = faltante, positivo = sobrante. */
  difference: number
  /** Cuadre del declarado contra el esperado. */
  status: CuadreStatus
  /**
   * Sobregiro: el efectivo esperado quedó negativo porque los egresos
   * superaron apertura + ventas en efectivo + ingresos. Es ortogonal al
   * cuadre (puede haber cuadre exacto y aun así sobregiro).
   */
  isOverdraft: boolean
}

// ─── Arqueo multi-método (snapshot que se persiste al cerrar) ──────
// Se CONGELA al cerrar: payments no tiene shift_id y su ventana es solo
// temporal, así que recomputar el esperado de un turno cerrado sumaría pagos
// posteriores. Por eso el esperado por método se snapshotea aquí.

export type ArqueoMethod = 'cash' | 'card' | 'transfer' | 'nequi'

export interface MethodReconciliation {
  /** cash = apertura + ventas efectivo + ingresos − egresos; otros = ventas + abonos del método (esperadoMetodo). */
  expected: number
  /** Declarado por el cajero (blanco = 0). */
  declared: number
  /** declared − expected. Negativo = faltante, positivo = sobrante. */
  difference: number
  /** Solo tarjeta, transferencia y Nequi (desde arqueo-abonos.sql): abonos de fiado del turno ya sumados en expected. */
  abonos?: number
}

export interface ShiftReconciliation {
  methods: Record<ArqueoMethod, MethodReconciliation>
  expected_total: number
  declared_total: number
  difference_total: number
  /** Ventas (órdenes distintas) del turno. Una venta mixta = 1 venta, N pagos. */
  sales_count: number
  /** Total de VALES (ruletazo) entregados en el turno = suma discount_amount con
   *  kind='vale' de las órdenes con pago en la ventana. INFORMATIVO: NO entra al
   *  cuadre (el vale no es dinero cobrado, es lo que se dejó de cobrar). */
  vouchers_total: number
}

/** Efectivo disponible en caja según los movimientos hasta el momento. */
export function availableCash(
  input: Pick<ShiftBalanceInput, 'openingAmount' | 'cashSales' | 'movementsIn' | 'movementsOut'>,
): number {
  return input.openingAmount + input.cashSales + input.movementsIn - input.movementsOut
}

/** Calcula el cuadre del turno a partir de los montos del turno. */
/**
 * Esperado de un método NO efectivo: sus ventas del turno + sus abonos de fiado del turno.
 * Es el mismo cálculo que congela close_cash_shift (supabase/arqueo-abonos.sql): si cambia
 * uno, cambia el otro (R1). El EFECTIVO no usa esto: un abono en efectivo ya entra como
 * ingreso de caja (movementsIn), y sumarlo acá lo contaría dos veces.
 */
export function esperadoMetodo(ventas: number, abonos: number): number {
  return ventas + abonos
}

export function calcShiftBalance(input: ShiftBalanceInput): ShiftBalance {
  const expectedCash = availableCash(input)
  const difference = input.declared - expectedCash

  const status: CuadreStatus =
    difference === 0 ? 'exact' : difference > 0 ? 'over' : 'short'

  return {
    expectedCash,
    difference,
    status,
    isOverdraft: expectedCash < 0,
  }
}
