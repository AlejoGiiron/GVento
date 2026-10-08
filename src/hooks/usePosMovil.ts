import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useCashShift } from '@/hooks/useCashShift'
import type { Enums } from '@/types/database.types'
import { traerTodo, diaBogota } from '@/lib/posMovil'

// ============================================================================
// Datos del POS móvil (/m): más vendidos y "Mis ventas de hoy".
// ============================================================================

/** Ids de producto ordenados por unidades vendidas en los últimos `dias` días (sin cancelados). */
export function useMasVendidos(dias: number) {
  const { profile } = useAuth()
  const sede = profile?.restaurant_id
  return useQuery({
    queryKey: ['mas_vendidos', sede, dias],
    queryFn: async () => {
      const desde = diaBogota(-(dias - 1))
      const filas = await traerTodo((a, b) =>
        supabase.from('product_performance')
          .select('product_id, total_qty, day')
          .eq('restaurant_id', sede!)
          .gte('day', desde)
          .order('day').order('product_id')
          .range(a, b))
      const suma = new Map<string, number>()
      for (const f of filas) {
        if (f.product_id) suma.set(f.product_id, (suma.get(f.product_id) ?? 0) + Number(f.total_qty ?? 0))
      }
      return [...suma.entries()].sort((x, y) => y[1] - x[1]).map(([id]) => id)
    },
    enabled: !!sede,
    staleTime: 10 * 60_000,
  })
}

// ── Mis ventas de hoy ───────────────────────────────────────────────────────

export const TIPOS_POS = ['takeaway', 'delivery'] as const

export interface MiVenta {
  orderId: string
  numero: number | null
  creada: string
  cobrado: number
  metodos: Enums<'payment_method'>[]
}

export interface MisVentas {
  porMetodo: Record<Enums<'payment_method'>, number>
  total: number
  cantidad: number
  ventas: MiVenta[]
}

/**
 * Las ventas que COBRÓ el usuario logueado en el turno abierto de la sede.
 *
 * "Quién cobró" = orders.created_by, que register_pos_sale llena con auth.uid()
 * EN EL SERVIDOR (no lo manda el celular). Un reenvío de la misma venta no lo
 * reescribe: devuelve la fila hecha. `payments` no tiene autor.
 *
 * MISMA VENTANA que el arqueo (close_cash_shift, supabase/close-cash-shift.sql):
 *   · pagos de la sede con created_at >= turno.opened_at, y
 *   · ventas GRATIS (total 0, con número, no anuladas) creadas en la ventana.
 * Una anulación BORRA los pagos de la orden, así que sale sola de la suma.
 * Solo tipos de POS: en una mesa, created_by es quien la ABRIÓ, no quien cobró.
 */
export function useMisVentas() {
  const { user, profile } = useAuth()
  const { currentShift } = useCashShift()
  const sede = profile?.restaurant_id
  const uid = user?.id
  const desde = currentShift?.opened_at

  return useQuery({
    queryKey: ['mis_ventas', currentShift?.id, uid],
    queryFn: async (): Promise<MisVentas> => {
      const pagos = await traerTodo((a, b) =>
        supabase.from('payments')
          .select('order_id, amount, method, created_at, orders!inner(order_number, created_by, type)')
          .eq('restaurant_id', sede!)
          .gte('created_at', desde!)
          .eq('orders.created_by', uid!)
          .in('orders.type', [...TIPOS_POS])
          .order('created_at').order('id')
          .range(a, b))
      const gratis = await traerTodo((a, b) =>
        supabase.from('orders')
          .select('id, order_number, created_at')
          .eq('restaurant_id', sede!)
          .eq('created_by', uid!)
          .in('type', [...TIPOS_POS])
          .eq('total', 0)
          .not('order_number', 'is', null)
          .is('cancelled_at', null)
          .gte('created_at', desde!)
          .order('created_at').order('id')
          .range(a, b))

      const porMetodo: MisVentas['porMetodo'] = { cash: 0, card: 0, transfer: 0, nequi: 0 }
      const porOrden = new Map<string, MiVenta>()
      for (const p of pagos) {
        const monto = Number(p.amount)
        porMetodo[p.method] += monto
        const v = porOrden.get(p.order_id) ?? {
          orderId: p.order_id, numero: p.orders?.order_number ?? null, creada: p.created_at, cobrado: 0, metodos: [],
        }
        v.cobrado += monto
        if (!v.metodos.includes(p.method)) v.metodos.push(p.method)
        porOrden.set(p.order_id, v)
      }
      for (const o of gratis) {
        if (!porOrden.has(o.id)) {
          porOrden.set(o.id, { orderId: o.id, numero: o.order_number, creada: o.created_at, cobrado: 0, metodos: [] })
        }
      }
      const ventas = [...porOrden.values()].sort((x, y) => y.creada.localeCompare(x.creada))
      const total = porMetodo.cash + porMetodo.card + porMetodo.transfer + porMetodo.nequi
      return { porMetodo, total, cantidad: ventas.length, ventas }
    },
    enabled: !!sede && !!uid && !!desde,
    refetchInterval: 30_000,
  })
}
