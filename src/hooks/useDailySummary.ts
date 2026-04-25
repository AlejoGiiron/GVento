import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import type { DailySalesRow } from '@/hooks/useReports'

export interface DailySummary {
  date: string
  order_count: number
  total_revenue: number
  avg_ticket: number
  by_channel: DailySalesRow[]
  by_method: {
    cash: number
    card: number
    transfer: number
    nequi: number
  }
}

export function useDailySummary(date: string) {
  const { profile } = useAuth()

  return useQuery({
    queryKey: ['daily_summary', date],
    queryFn: async (): Promise<DailySummary> => {
      const { data, error } = await supabase
        .from('daily_sales_summary')
        .select('*')
        .eq('day', date)
        .order('order_type')
      if (error) throw error
      const rows = (data ?? []) as DailySalesRow[]

      const order_count   = rows.reduce((s, r) => s + r.order_count,   0)
      const total_revenue = rows.reduce((s, r) => s + r.total_revenue, 0)
      const avg_ticket    = order_count > 0 ? total_revenue / order_count : 0

      return {
        date,
        order_count,
        total_revenue,
        avg_ticket,
        by_channel: rows,
        by_method: {
          cash:     rows.reduce((s, r) => s + r.cash_total,     0),
          card:     rows.reduce((s, r) => s + r.card_total,     0),
          transfer: rows.reduce((s, r) => s + r.transfer_total, 0),
          nequi:    rows.reduce((s, r) => s + r.nequi_total,    0),
        },
      }
    },
    enabled: !!profile?.restaurant_id && !!date,
    staleTime: 5 * 60_000,
  })
}
