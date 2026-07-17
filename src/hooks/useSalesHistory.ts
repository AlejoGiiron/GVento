import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import { useAuth } from '@/hooks/useAuth'
import {
  getSalesHistory, getSaleDetail, getCancelledSales, registerSaleVoid,
  type SalesHistoryRow, type SaleDetailRow, type SaleVoidResult,
} from '@/lib/supabase-helpers'
import type { Enums } from '@/types/database.types'

export type { SalesHistoryRow, SaleDetailRow }

// Fila de la sección "Anuladas": historial + quién anuló (para la auditoría).
export type CancelledSaleRow = SalesHistoryRow & { canceller: { full_name: string | null } | null }

export const SALES_PAGE_SIZE = 25

export interface SalesHistoryUIFilters {
  from: string                            // 'YYYY-MM-DD'
  to: string                              // 'YYYY-MM-DD'
  method: Enums<'payment_method'> | null
  search: string                          // texto del buscador (número de venta)
  page: number                            // 0-based
}

// 'YYYY-MM-DD' (Bogotá) → límites ISO del día en UTC. Bogotá = UTC-5 fijo
// (sin horario de verano), por eso se desplaza +5h al inicio/fin del día.
function dayStartISO(day: string): string {
  return new Date(`${day}T00:00:00-05:00`).toISOString()
}
function dayEndISO(day: string): string {
  return new Date(`${day}T23:59:59.999-05:00`).toISOString()
}

/**
 * Historial de ventas COMPLETADAS (las que tienen order_number), paginado y
 * filtrable por rango de fechas, método de pago y número de venta.
 */
export function useSalesHistory({ from, to, method, search, page }: SalesHistoryUIFilters) {
  const { profile } = useAuth()
  const restaurantId = profile?.restaurant_id ?? null

  // El buscador solo filtra por número exacto si se escribió un número válido.
  const trimmed = search.trim()
  const orderNumber = /^\d+$/.test(trimmed) ? parseInt(trimmed, 10) : null

  const query = useQuery({
    queryKey: ['sales_history', restaurantId, from, to, method, orderNumber, page],
    queryFn: async () => {
      const { data, count, error } = await getSalesHistory({
        restaurantId: restaurantId!,
        from: from ? dayStartISO(from) : undefined,
        to: to ? dayEndISO(to) : undefined,
        method,
        orderNumber,
        page,
        pageSize: SALES_PAGE_SIZE,
      })
      if (error) throw error
      return {
        rows: (data ?? []) as unknown as SalesHistoryRow[],
        count: count ?? 0,
      }
    },
    enabled: !!restaurantId && !!from && !!to,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })

  const count = query.data?.count ?? 0
  return {
    rows: query.data?.rows ?? [],
    count,
    pageCount: Math.max(1, Math.ceil(count / SALES_PAGE_SIZE)),
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
  }
}

/**
 * Ventas ANULADAS del rango, para la sección "Anuladas (N)" del historial.
 * Solo se activa cuando hay un filtro de método (`enabled`): en la vista sin
 * filtro las anuladas ya salen inline con su badge. No paginada (son pocas).
 * NO toca getSalesHistory ni su paginación.
 */
export function useCancelledSales({
  from, to, enabled,
}: { from: string; to: string; enabled: boolean }) {
  const { profile } = useAuth()
  const restaurantId = profile?.restaurant_id ?? null

  const query = useQuery({
    queryKey: ['sales_history_cancelled', restaurantId, from, to],
    queryFn: async () => {
      const { data, error } = await getCancelledSales(
        restaurantId!,
        from ? dayStartISO(from) : undefined,
        to ? dayEndISO(to) : undefined,
      )
      if (error) throw error
      return (data ?? []) as unknown as CancelledSaleRow[]
    },
    enabled: enabled && !!restaurantId && !!from && !!to,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })

  return {
    rows: query.data ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
  }
}

/** Detalle de una venta (ítems, extras, pago) para el panel y la reimpresión. */
export function useSaleDetail(orderId: string | null) {
  const query = useQuery({
    queryKey: ['sale_detail', orderId],
    queryFn: async () => {
      const { data, error } = await getSaleDetail(orderId!)
      if (error) throw error
      return data as unknown as SaleDetailRow
    },
    enabled: !!orderId,
    staleTime: 60_000,
  })

  return {
    sale: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
  }
}

/**
 * Anula una venta del turno actual vía la RPC register_sale_void (atómica).
 * Tras el éxito invalida historial + cartera + caja (ventas/vales) + inventario
 * para que la venta salga del cuadre y el stock devuelto se refleje sin recargar.
 * El detalle abierto (['sale_detail']) también se refresca para pintar el badge
 * "Anulada" en el modal sin cerrarlo. Si una guarda server-side rechaza, el
 * toast muestra el mensaje EXACTO de la RPC (p. ej. la carrera turno-cerrado).
 */
export function useVoidSale() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ orderId, reason }: { orderId: string; reason: string }) => {
      const { data, error } = await registerSaleVoid(orderId, reason)
      if (error) throw error
      return data as unknown as SaleVoidResult
    },
    onSuccess: (res) => {
      for (const key of [
        ['sales_history'], ['sales_history_cancelled'], ['sale_detail'], ['debts'],
        ['shift_payments'], ['shift_vouchers'], ['stock_movements'], ['products'],
      ]) {
        queryClient.invalidateQueries({ queryKey: key })
      }
      const parts = [`Stock devuelto: ${res.stock_returned}`]
      if (res.payments_deleted > 0) parts.push(`${res.payments_deleted} pago(s) revertido(s)`)
      toast.success(`Venta anulada · ${parts.join(' · ')}`)
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : (err as { message?: string })?.message ?? 'Error desconocido'
      toast.error(`No se pudo anular: ${msg}`)
    },
  })
}
