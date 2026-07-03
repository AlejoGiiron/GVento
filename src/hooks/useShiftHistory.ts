import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import { getClosedShifts, type ClosedShiftRow } from '@/lib/supabase-helpers'

export type { ClosedShiftRow }

export const SHIFTS_PAGE_SIZE = 25

/** 'mine' = solo turnos del usuario actual (filtro de PRESENTACIÓN, no seguridad;
 *  la RLS ya limita a la sede). 'all' = todos los de la sede. */
export type HistoryScope = 'mine' | 'all'

export interface ShiftHistoryUIFilters {
  from: string // 'YYYY-MM-DD'
  to: string   // 'YYYY-MM-DD'
  scope: HistoryScope
  page: number
}

// 'YYYY-MM-DD' (Bogotá) → límites ISO del día en UTC. Bogotá = UTC-5 fijo.
function dayStartISO(day: string): string {
  return new Date(`${day}T00:00:00-05:00`).toISOString()
}
function dayEndISO(day: string): string {
  return new Date(`${day}T23:59:59.999-05:00`).toISOString()
}

/**
 * Historial de turnos de caja CERRADOS (con su cuadre persistido:
 * expected_amount / difference de F1), paginado y filtrable por rango de fechas.
 */
export function useShiftHistory({ from, to, scope, page }: ShiftHistoryUIFilters) {
  const { profile } = useAuth()
  const restaurantId = profile?.restaurant_id ?? null
  const userId = scope === 'mine' ? (profile?.id ?? null) : null

  const query = useQuery({
    queryKey: ['shift_history', restaurantId, from, to, scope, userId, page],
    queryFn: async () => {
      const { data, count, error } = await getClosedShifts({
        restaurantId: restaurantId!,
        userId,
        from: from ? dayStartISO(from) : undefined,
        to: to ? dayEndISO(to) : undefined,
        page,
        pageSize: SHIFTS_PAGE_SIZE,
      })
      if (error) throw error
      return {
        rows: (data ?? []) as unknown as ClosedShiftRow[],
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
    pageCount: Math.max(1, Math.ceil(count / SHIFTS_PAGE_SIZE)),
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
  }
}
