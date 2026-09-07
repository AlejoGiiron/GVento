/**
 * Reparto FIFO de UN pago entre varias ventas a fiado.
 *
 * 🔴 CONTRATO COMPARTIDO EN DOS LADOS (R1). Esta función y el loop de
 * `register_debt_payments_batch` (supabase/fiado-abono-lote.sql) calculan LO
 * MISMO con código distinto:
 *
 *    acá   → la PREVISUALIZACIÓN que ve el cajero antes de confirmar
 *    allá  → lo que efectivamente se persiste
 *
 * No hay nada en el sistema que los sincronice: si divergen, el cajero ve un
 * reparto y la BD guarda otro, sin error y sin test rojo. **El único mecanismo
 * que los mantiene iguales es el caso E2E que afirma que lo previsualizado es
 * lo que quedó en la base** (`tests/fiado-lote.spec.ts`). Ese caso no es
 * opcional; si se borra, este contrato queda sin vigilancia.
 *
 * Las reglas están duplicadas a propósito acá abajo, en el mismo orden que el
 * SQL, para que comparar los dos lados sea leerlos en paralelo:
 *
 *   1. Orden: `created_at` ascendente (la más vieja primero), desempate por id.
 *      El orden del arreglo de entrada NO se usa.
 *   2. A cada deuda se le aplica `min(restante, saldo)`.
 *   3. La última tocada puede quedar parcial; las siguientes quedan intactas.
 *   4. El monto no puede exceder la suma de saldos (sobrepago). Acá se refleja
 *      en `excede`; en el SQL es una excepción que revierte el lote.
 */

/** Lo mínimo que el reparto necesita de una deuda. Un subconjunto de `Debt`. */
export interface FifoDebt {
  id: string
  order_number: number | null
  created_at: string
  saldo: number
}

export interface FifoAllocation {
  id: string
  order_number: number | null
  /** Cuánto se le imputa a esta venta. Siempre > 0. */
  applied: number
  /** Lo que queda debiendo después de imputar. 0 = saldada. */
  saldoRestante: number
  /** true = queda en cero (payment_status pasará a 'paid'). */
  saldada: boolean
}

export interface FifoSplit {
  /** Solo las ventas que reciben algo. Las que no se tocan NO aparecen. */
  allocations: FifoAllocation[]
  /** Suma de los saldos seleccionados. */
  saldoSeleccionado: number
  /** Parte del monto que no se pudo imputar. > 0 solo si `excede`. */
  sobrante: number
  /** El monto supera la suma de saldos → la RPC lo rechazaría. */
  excede: boolean
}

/**
 * Calcula el reparto. Función PURA: no ordena el arreglo recibido en su lugar,
 * no lee relojes y no toca la red.
 *
 * `amount <= 0` devuelve un reparto vacío y no marca `excede`: es el estado
 * inicial del formulario (input en blanco), no un error que mostrarle a nadie.
 */
export function splitFifo(debts: FifoDebt[], amount: number): FifoSplit {
  const saldoSeleccionado = debts.reduce((s, d) => s + d.saldo, 0)

  if (!Number.isFinite(amount) || amount <= 0) {
    return { allocations: [], saldoSeleccionado, sobrante: 0, excede: false }
  }

  // Copia antes de ordenar: mutar el arreglo del caller reordenaría la tabla
  // que el cajero está mirando.
  const ordenadas = [...debts].sort(
    (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  )

  const allocations: FifoAllocation[] = []
  let restante = amount

  for (const d of ordenadas) {
    if (restante <= 0) break
    const applied = Math.min(restante, d.saldo)
    if (applied <= 0) continue
    const saldoRestante = d.saldo - applied
    allocations.push({
      id: d.id,
      order_number: d.order_number,
      applied,
      saldoRestante,
      saldada: saldoRestante <= 0,
    })
    restante -= applied
  }

  return {
    allocations,
    saldoSeleccionado,
    sobrante: restante,
    excede: amount > saldoSeleccionado,
  }
}
