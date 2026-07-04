import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { getVouchersTotal } from '@/lib/supabase-helpers'
import type { Views } from '@/types/database.types'

// 'YYYY-MM-DD' (Bogotá) → límites ISO del día en UTC. Bogotá = UTC-5 fijo.
const dayStartISO = (day: string) => new Date(`${day}T00:00:00-05:00`).toISOString()
const dayEndISO = (day: string) => new Date(`${day}T23:59:59.999-05:00`).toISOString()

export type DailySalesRow        = Views<'daily_sales_summary'>
export type ProductPerformanceRow = Views<'product_performance'>
export type HourlySalesRow       = Views<'hourly_sales'>
export type WaiterPerformanceRow = Views<'waiter_performance'>

export interface ReportParams {
  from: string // 'YYYY-MM-DD'
  to: string   // 'YYYY-MM-DD'
}

export function useReports({ from, to }: ReportParams) {
  const { profile } = useAuth()
  const restaurantId = profile?.restaurant_id ?? null
  const enabled = !!restaurantId && !!from && !!to

  const dailySales = useQuery({
    queryKey: ['reports_daily_sales', from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('daily_sales_summary')
        .select('*')
        .gte('day', from)
        .lte('day', to)
        .order('day', { ascending: true })
      if (error) throw error
      return (data ?? []) as DailySalesRow[]
    },
    enabled,
    staleTime: 5 * 60_000,
  })

  const productPerformance = useQuery({
    queryKey: ['reports_products', from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_performance')
        .select('*')
        .gte('day', from)
        .lte('day', to)
        .order('total_revenue', { ascending: false })
      if (error) throw error
      return (data ?? []) as ProductPerformanceRow[]
    },
    enabled,
    staleTime: 5 * 60_000,
  })

  const hourlySales = useQuery({
    queryKey: ['reports_hourly', from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('hourly_sales')
        .select('*')
        .gte('day', from)
        .lte('day', to)
        .order('hour', { ascending: true })
      if (error) throw error
      return (data ?? []) as HourlySalesRow[]
    },
    enabled,
    staleTime: 5 * 60_000,
  })

  const waiterPerformance = useQuery({
    queryKey: ['reports_waiters', from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('waiter_performance')
        .select('*')
        .gte('day', from)
        .lte('day', to)
        .order('total_revenue', { ascending: false })
      if (error) throw error
      return (data ?? []) as WaiterPerformanceRow[]
    },
    enabled,
    staleTime: 5 * 60_000,
  })

  // Total regalado en vales (ruletazo) en el rango — KPI de Reportes.
  const vouchers = useQuery({
    queryKey: ['reports_vouchers', restaurantId, from, to],
    queryFn: () => getVouchersTotal(restaurantId!, dayStartISO(from), dayEndISO(to)),
    enabled,
    staleTime: 5 * 60_000,
  })

  return {
    dailySales:         dailySales.data         ?? [],
    productPerformance: productPerformance.data ?? [],
    hourlySales:        hourlySales.data        ?? [],
    waiterPerformance:  waiterPerformance.data  ?? [],
    vouchersTotal:      vouchers.data           ?? 0,
    isLoading:
      dailySales.isLoading        ||
      productPerformance.isLoading ||
      hourlySales.isLoading       ||
      waiterPerformance.isLoading,
    error:
      dailySales.error         ??
      productPerformance.error ??
      hourlySales.error        ??
      waiterPerformance.error,
  }
}
