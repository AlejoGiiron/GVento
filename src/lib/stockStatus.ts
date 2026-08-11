import type { ProductWithCategory } from '@/stores/cartStore'

/**
 * Estado de inventario de un producto — REGLA ÚNICA para toda la app.
 *
 * Vivía duplicada en InventoryPage (4 estados, sin mirar el tipo de producto) y
 * en el POS (2 estados, con el corte por `simple` + `stock_tracking` incrustado
 * en el render), y ya habían divergido: el POS no conocía `min_stock`, así que
 * "stock bajo" simplemente no existía ahí. Que dos pantallas contesten distinto
 * sobre el MISMO producto es el bug, no el síntoma.
 *
 * - `untracked` — no aplica: compuesto, o simple sin seguimiento de inventario.
 *   La disponibilidad derivada de compuestos está OMITIDA a propósito (exigiría
 *   cargar recetas y calcular el mínimo por insumo; ver CLAUDE.md).
 * - `negative` — sobreventa consumada. Stock negativo está PERMITIDO: es la señal
 *   visible de que hay que reponer, no un error a bloquear.
 * - `out` — exactamente 0.
 * - `low` — en o por debajo del umbral configurado.
 * - `ok` — sin novedad.
 *
 * ⚠️ La guarda `min_stock > 0` NO es decorativa: la columna tiene `default 0`, y
 * sin ella todo producto con umbral sin configurar caería en `low` apenas su
 * stock fuera 0 — que ya es `out`, un estado distinto y peor.
 */
export type StockStatus = 'untracked' | 'negative' | 'out' | 'low' | 'ok'

export function stockStatus(p: ProductWithCategory): StockStatus {
  if (p.kind !== 'simple' || !p.stock_tracking) return 'untracked'
  const s = p.stock_qty ?? 0
  if (s < 0) return 'negative'
  if (s === 0) return 'out'
  if (p.min_stock > 0 && s <= p.min_stock) return 'low'
  return 'ok'
}

/** Estados que ameritan avisarle al cajero en el POS. */
export const STOCK_ALERTA: readonly StockStatus[] = ['negative', 'out', 'low']

export function esAlertaDeStock(s: StockStatus): boolean {
  return STOCK_ALERTA.includes(s)
}
