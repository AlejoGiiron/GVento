import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  getStockMovements,
  type StockMovementRow,
  type StockMovementType,
} from '@/lib/supabase-helpers'
import { useAuth } from '@/hooks/useAuth'

export interface StockMovementsParams {
  type?: StockMovementType | null
  from?: string
  to?: string
  page: number
  pageSize: number
}

/**
 * Movimientos de stock paginados (auditoría append-only), filtrables por tipo
 * y rango de fechas. keepPreviousData evita parpadeo al paginar.
 */
export function useStockMovements({ type, from, to, page, pageSize }: StockMovementsParams) {
  const { profile } = useAuth()
  const restaurantId = profile?.restaurant_id

  return useQuery({
    queryKey: ['stock_movements', restaurantId, type ?? null, from ?? null, to ?? null, page, pageSize],
    queryFn: async () => {
      const { data, error, count } = await getStockMovements({
        restaurantId: restaurantId!, type, from, to, page, pageSize,
      })
      if (error) throw error
      return {
        rows: (data ?? []) as unknown as StockMovementRow[],
        total: count ?? 0,
      }
    },
    enabled: !!restaurantId,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  })
}
