import {
  buildCashReportData, deriveCashReportSales,
  type CashReportData, type CashReportShiftRow,
} from '@/lib/printer'
import type { ArqueoMethod, MethodReconciliation, ShiftReconciliation } from '@/lib/shiftCalc'

/**
 * Qué puede mostrar el detalle de un turno cerrado.
 *
 * 🔴 POR QUÉ ESTO ES UNA FUNCIÓN PURA Y NO ESTÁ ADENTRO DE LA MODAL.
 * La rama que importa —turno SIN `close_reconciliation`— no se puede producir
 * desde la UI: no hay forma de cerrar hoy un turno sin arqueo por método. Es un
 * estado que solo existe en filas viejas de producción, así que un E2E no lo
 * alcanza y quedaría sin probar justo la rama defensiva. Sacándola acá se
 * verifica con vitest contra filas construidas a mano.
 *
 * `buildCashReportData` hace `row.close_reconciliation as ShiftReconciliation`,
 * un cast SIN chequear null. Por eso la decisión de llamarlo o no se toma ACÁ,
 * antes, y nunca se le pasa una fila sin snapshot.
 */

/** Subconjunto de la fila que el detalle necesita. */
export interface ShiftDetailRow extends CashReportShiftRow {
  opening_amount: number
  closing_amount: number | null
  expected_amount: number | null
  difference: number | null
}

export interface ShiftDetailView {
  /** false ⇒ turno anterior al arqueo multi-método: se muestra solo F1. */
  tieneArqueo: boolean
  /** null cuando no hay snapshot. Nunca se construye con `reconciliation` null. */
  data: CashReportData | null
  /** Ventas por método derivadas del snapshot. null sin snapshot. */
  ventas: { byMethod: Record<ArqueoMethod, number>; total: number } | null
  /** Cuadre de efectivo (F1): existe en TODA fila cerrada, con o sin snapshot. */
  efectivo: { esperado: number; declarado: number; diferencia: number }
  /** Total de vales. 0 en snapshots anteriores al vale (la clave puede faltar). */
  vouchers: number
  /** Nº de ventas del turno. 0 si el snapshot no lo trae. */
  salesCount: number
}

const METODO_VACIO: MethodReconciliation = { expected: 0, declared: 0, difference: 0 }

/** Lee un método del snapshot tolerando que la clave no exista. */
export function metodoDelArqueo(
  rec: ShiftReconciliation | null | undefined,
  m: ArqueoMethod,
): MethodReconciliation {
  return rec?.methods?.[m] ?? METODO_VACIO
}

export function buildShiftDetail(
  row: ShiftDetailRow,
  movements: { in: number; out: number },
  ctx: { restaurantName?: string | null; restaurantAddress?: string | null } = {},
): ShiftDetailView {
  const tieneArqueo = row.close_reconciliation != null

  const data = tieneArqueo
    ? buildCashReportData(row, {
        restaurantName: ctx.restaurantName,
        restaurantAddress: ctx.restaurantAddress,
        movementsIn: movements.in,
        movementsOut: movements.out,
      })
    : null

  const rec = (data?.reconciliation ?? null) as ShiftReconciliation | null

  return {
    tieneArqueo,
    data,
    ventas: data ? deriveCashReportSales(data) : null,
    efectivo: {
      esperado: row.expected_amount ?? 0,
      declarado: row.closing_amount ?? 0,
      diferencia: row.difference ?? 0,
    },
    // `?? 0` igual que el ticket: los snapshots anteriores al vale no traen la
    // clave, y `undefined > 0` sería false pero `formatCOP(undefined)` es "NaN".
    vouchers: rec?.vouchers_total ?? 0,
    salesCount: rec?.sales_count ?? 0,
  }
}
