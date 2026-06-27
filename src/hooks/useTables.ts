import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from 'react-hot-toast'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { getTables, getActiveOrdersForTables } from '@/lib/supabase-helpers'
import { useAuth } from '@/hooks/useAuth'
import { useCashShift } from '@/hooks/useCashShift'
import type { Tables } from '@/types/database.types'

export type TableRow = Tables<'tables'>

export type OrderItemExtraRow = {
  id: string
  qty: number
  unit_price: number
  extras: { id: string; name: string } | null
}

export type OrderItemRow = {
  id: string
  qty: number
  unit_price: number
  notes: string | null
  sent_to_kitchen: boolean
  products: { id: string; name: string; price: number; routes_to_kitchen: boolean } | null
  order_item_extras: OrderItemExtraRow[]
}

export type ActiveOrder = Tables<'orders'> & {
  order_items: OrderItemRow[]
}

export function useTables() {
  const { profile } = useAuth()
  const { currentShift } = useCashShift()
  const [tables, setTables] = useState<TableRow[]>([])
  const [activeOrders, setActiveOrders] = useState<Record<string, ActiveOrder>>({})
  const [loading, setLoading] = useState(true)
  const channelRef = useRef<RealtimeChannel | null>(null)

  const fetchAll = useCallback(async () => {
    if (!profile?.restaurant_id) return

    const { data: tablesData, error } = await getTables(profile.restaurant_id)
    if (error) {
      toast.error('Error cargando mesas')
      return
    }
    const rows = tablesData ?? []
    setTables(rows)

    const occupiedIds = rows
      .filter((t) => t.status === 'occupied' || t.status === 'waiting_bill')
      .map((t) => t.id)

    if (occupiedIds.length > 0) {
      const { data: ordersData } = await getActiveOrdersForTables(occupiedIds)
      const map: Record<string, ActiveOrder> = {}
      for (const order of (ordersData ?? []) as ActiveOrder[]) {
        if (order.table_id) map[order.table_id] = order
      }
      setActiveOrders(map)
    } else {
      setActiveOrders({})
    }

    setLoading(false)
  }, [profile?.restaurant_id])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  useEffect(() => {
    if (!profile?.restaurant_id) return

    // Nombre único por instancia para evitar reutilización de canal ya suscrito.
    const channelName = `tables-map-${Math.random().toString(36).slice(2)}`

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tables', filter: `restaurant_id=eq.${profile.restaurant_id}` },
        fetchAll,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${profile.restaurant_id}` },
        fetchAll,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_items' },
        fetchAll,
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setTimeout(() => fetchAll(), 5000)
        }
      })

    channelRef.current = channel

    return () => {
      channel.unsubscribe()
      supabase.removeChannel(channel)
      channelRef.current = null
    }
  }, [profile?.restaurant_id, fetchAll])

  return {
    tables,
    activeOrders,
    loading,
    currentShift,
    refetch: fetchAll,
  }
}
