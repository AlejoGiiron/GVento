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

/** Efectivo disponible en caja según los movimientos hasta el momento. */
export function availableCash(
  input: Pick<ShiftBalanceInput, 'openingAmount' | 'cashSales' | 'movementsIn' | 'movementsOut'>,
): number {
  return input.openingAmount + input.cashSales + input.movementsIn - input.movementsOut
}

/** Calcula el cuadre del turno a partir de los montos del turno. */
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
