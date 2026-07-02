import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import {
  getCashOutMovements, getCashOutTotal, type CashOutRow,
} from '@/lib/supabase-helpers'
import type { HistoryScope } from '@/hooks/useShiftHistory'

export type { CashOutRow }

export const EXPENSES_PAGE_SIZE = 25

export interface ExpensesHistoryUIFilters {
  from: string // 'YYYY-MM-DD'
  to: string   // 'YYYY-MM-DD'
  scope: HistoryScope
  page: number
}

function dayStartISO(day: string): string {
  return new Date(`${day}T00:00:00-05:00`).toISOString()
}
function dayEndISO(day: string): string {
  return new Date(`${day}T23:59:59.999-05:00`).toISOString()
}

/**
 * Historial de gastos (egresos de caja, movimientos type='out') paginado y
 * filtrable por rango. Incluye el TOTAL del período (no solo de la página),
 * vía una consulta ligera aparte que trae solo `amount`.
 */
export function useExpensesHistory({ from, to, scope, page }: ExpensesHistoryUIFilters) {
  const { profile } = useAuth()
  const restaurantId = profile?.restaurant_id ?? null
  const userId = scope === 'mine' ? (profile?.id ?? null) : null

  const fromISO = from ? dayStartISO(from) : undefined
  const toISO = to ? dayEndISO(to) : undefined

  const query = useQuery({
    queryKey: ['expenses_history', restaurantId, from, to, scope, userId, page],
    queryFn: async () => {
      const { data, count, error } = await getCashOutMovements({
        restaurantId: restaurantId!,
        userId,
        from: fromISO,
        to: toISO,
        page,
        pageSize: EXPENSES_PAGE_SIZE,
      })
      if (error) throw error
      return {
        rows: (data ?? []) as unknown as CashOutRow[],
        count: count ?? 0,
      }
    },
    enabled: !!restaurantId && !!from && !!to,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })

  // Total del período (todas las filas filtradas, no solo la página actual).
  const totalQuery = useQuery({
    queryKey: ['expenses_total', restaurantId, from, to, scope, userId],
    queryFn: async () => {
      const { data, error } = await getCashOutTotal({
        restaurantId: restaurantId!,
        userId,
        from: fromISO,
        to: toISO,
      })
      if (error) throw error
      return (data ?? []).reduce((s, r) => s + (r.amount ?? 0), 0)
    },
    enabled: !!restaurantId && !!from && !!to,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })

  const count = query.data?.count ?? 0
  return {
    rows: query.data?.rows ?? [],
    count,
    periodTotal: totalQuery.data ?? 0,
    pageCount: Math.max(1, Math.ceil(count / EXPENSES_PAGE_SIZE)),
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
  }
}
