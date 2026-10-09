// restaurants.config: su forma y las claves que se pueden escribir.
// Módulo PURO (sin Supabase): lo importan el hook y los specs.

export type PaymentMethod = 'cash' | 'card' | 'transfer' | 'nequi'

export interface RestaurantConfig {
  slug?: string | null
  cash_out_reasons?: string[]
  payment_methods?: PaymentMethod[]
  nequi_qr_url?: string | null
  kitchen_pin?: string | null
  kitchen_stations?: string[]
  kds_timers?: { green: number; amber: number }
  default_delivery_time?: number
  notifications?: {
    delivery_sound?: boolean
    kitchen_sound?: boolean
  }
  /** POS móvil (/m). Leer SIEMPRE con leerPosMovil (src/lib/posMovil.ts): trae los valores por defecto. */
  pos_movil?: unknown
}

/**
 * 🔴 CONTRATO DE DOS LADOS (R1): las claves que update_restaurant_config acepta
 * (allowlist en supabase/restaurant-config-rpc.sql). El compilador ata esta lista
 * al tipo: si se agrega una clave a RestaurantConfig y no acá, no compila; y
 * tests/config-merge.spec.ts escribe cada una por la RPC, así que si falta en el
 * SQL, el test se pone rojo.
 */
export const CLAVES_CONFIG = [
  'slug', 'cash_out_reasons', 'payment_methods', 'nequi_qr_url',
  'kitchen_pin', 'kitchen_stations', 'kds_timers', 'default_delivery_time',
  'notifications', 'pos_movil',
] as const satisfies readonly (keyof RestaurantConfig)[]
type ClavesFaltantes = Exclude<keyof RestaurantConfig, (typeof CLAVES_CONFIG)[number]>
const _todasLasClaves: [ClavesFaltantes] extends [never] ? true : ClavesFaltantes = true
void _todasLasClaves
