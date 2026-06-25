// Montos de pago rápido para el cobro en efectivo del POS.
// Función pura, sin React ni red: testeable de forma unitaria y determinista.
//
// Dada una cuenta, sugiere los montos con los que el cliente suele pagar:
// el pago justo ("Exacto") y los round-ups al próximo billete/redondeo cómodo
// (5k, 10k, 20k, 50k) por encima del total. Sustituye las denominaciones
// hardcodeadas (50k/100k/200k) que muchas veces no aplican a la cuenta real.

/** Denominaciones de redondeo en COP. Fijas en código (no configurables). */
const DENOMINATIONS = [5_000, 10_000, 20_000, 50_000] as const

/** Máximo de round-ups además del chip "Exacto" (para no saturar la UI). */
const MAX_ROUNDUPS = 4

/** Un chip de monto rápido. `exact` marca el pago justo (sin vuelto). */
export interface CashChip {
  /** Monto a rellenar en el campo de efectivo recibido. */
  amount: number
  /** true solo para el pago exacto (= total). */
  exact: boolean
}

/** Próximo múltiplo de `step` estrictamente por encima de `value`. */
function nextMultipleAbove(value: number, step: number): number {
  return (Math.floor(value / step) + 1) * step
}

/**
 * Montos de pago rápido sugeridos para una cuenta en efectivo.
 *
 * Devuelve siempre el chip "Exacto" (= total) primero, seguido de los
 * round-ups al próximo múltiplo de 5k/10k/20k/50k por encima del total,
 * deduplicados, ascendentes y acotados a {@link MAX_ROUNDUPS}.
 *
 * - "Exacto" cubre el pago justo; por eso los round-ups son estrictamente
 *   mayores que el total (un total ya redondo no se repite como round-up).
 * - Deduplica (si el próximo 10k y 20k coinciden, queda uno solo).
 * - Acota a los más cercanos útiles (ascendente = nearest first).
 */
export function cashQuickAmounts(total: number): CashChip[] {
  const exactChip: CashChip = { amount: total, exact: true }

  // Sin cuenta no hay round-ups que sugerir.
  if (total <= 0) return [exactChip]

  const roundUps = [...new Set(DENOMINATIONS.map((step) => nextMultipleAbove(total, step)))]
    .filter((amount) => amount > total) // excluir cualquiera que iguale el total
    .sort((a, b) => a - b)
    .slice(0, MAX_ROUNDUPS)

  return [exactChip, ...roundUps.map((amount) => ({ amount, exact: false }))]
}
