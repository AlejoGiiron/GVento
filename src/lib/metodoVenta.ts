import type { Enums } from '@/types/database.types'

// ── Cómo quedó registrada una venta del POS, según el SERVIDOR ───────────────
// register_pos_sale (supabase/pos-sale-metodo-real.sql) devuelve, además de la
// venta, sus métodos de pago REALES (de payments), si es a fiado y a quién. Lo
// usan el POS de escritorio y el móvil para decir la verdad cuando un reintento
// recibe una venta que ya había entrado (ya_existia), aunque el reintento se haya
// pedido con otro método. Sin esas claves (servidor sin la migración), no se
// inventa un método: se dice que ya quedó registrada, sin más.

export type MetodoPago = Enums<'payment_method'>

export const NOMBRE_METODO: Record<MetodoPago, string> = {
  cash: 'Efectivo', nequi: 'Nequi', card: 'Tarjeta', transfer: 'Transferencia',
}

/** Lo que devuelve register_pos_sale sobre el método (claves opcionales: servidor viejo no las trae). */
export interface MetodoDeLaVenta {
  total: number
  metodos?: MetodoPago[]
  fiado?: boolean
  cliente?: string | null
  anulada?: boolean
}

/** "Efectivo", "Efectivo + Nequi", "Fiado a Ana"… o null si el servidor no lo dijo. */
export function metodoReal(v: MetodoDeLaVenta): string | null {
  if (v.metodos === undefined || v.fiado === undefined) return null
  if (v.anulada) return 'anulada'
  if (v.fiado) return v.cliente ? `Fiado a ${v.cliente}` : 'Fiado'
  if (v.metodos.length) return v.metodos.map((m) => NOMBRE_METODO[m] ?? m).join(' + ')
  return Number(v.total) === 0 ? 'venta sin cobro (total $0)' : 'sin pagos'
}

/** El aviso cuando el reintento recibió una venta que ya había entrado. */
export function avisoYaExistia(v: MetodoDeLaVenta): string {
  const m = metodoReal(v)
  return m
    ? `Esta venta ya quedó registrada como ${m}. No se cobró dos veces.`
    : 'Esta venta ya quedó registrada en el intento anterior. No se cobró dos veces.'
}
