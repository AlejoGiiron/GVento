import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import {
  getSalesHistory, getSaleDetail,
  type SalesHistoryRow, type SaleDetailRow,
} from '@/lib/supabase-helpers'
import type { Enums } from '@/types/database.types'

export type { SalesHistoryRow, SaleDetailRow }

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
