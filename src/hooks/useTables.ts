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
  const { profile, isLoading: authLoading } = useAuth()
  const { currentShift } = useCashShift()
  const [tables, setTables] = useState<TableRow[]>([])
  const [activeOrders, setActiveOrders] = useState<Record<string, ActiveOrder>>({})
  // TODAS las cuentas vivas de cada mesa, de la más antigua a la más nueva. Con más
  // de una, la pantalla lo avisa; activeOrders muestra siempre la primera.
  const [cuentasPorMesa, setCuentasPorMesa] = useState<Record<string, ActiveOrder[]>>({})
  // true solo si la ÚLTIMA carga de órdenes salió bien. Con false, una mesa
  // ocupada sin orden en el mapa NO significa "sin cuenta": puede ser que no se
  // pudo leer. La pantalla solo ofrece liberarla con esto en true (fail-closed).
  const [ordenesCargadas, setOrdenesCargadas] = useState(false)
  const [loading, setLoading] = useState(true)
  const channelRef = useRef<RealtimeChannel | null>(null)

  const fetchAll = useCallback(async () => {
    if (!profile?.restaurant_id) {
      // Sin sede activa: nada que traer. Si la sesión ya cargó, apagar el
      // loading (estado vacío, NO spinner eterno). Si la sesión aún carga,
      // mantener el spinner hasta que llegue el profile.
      if (!authLoading) setLoading(false)
      return
    }

    try {
      const { data: tablesData, error } = await getTables(profile.restaurant_id)
      if (error) {
        toast.error('Error cargando mesas', { id: 'mesas-carga' })
        return
      }
      const rows = tablesData ?? []

      const occupiedIds = rows
        .filter((t) => t.status === 'occupied' || t.status === 'waiting_bill')
        .map((t) => t.id)

      // Mesas y órdenes se publican JUNTAS (mismo render): si las mesas llegaran
      // antes, una mesa recién abierta se vería un instante "sin cuenta abierta".
      if (occupiedIds.length > 0) {
        const { data: ordersData, error: ordersErr } = await getActiveOrdersForTables(occupiedIds)
        if (ordersErr) {
          // Antes se ignoraba y quedaba {} = "ninguna mesa tiene cuenta".
          toast.error('Error cargando las cuentas de las mesas', { id: 'mesas-cuentas' })
          setTables(rows)
          setOrdenesCargadas(false)
          return
        }
        // ordersData viene ordenado (created_at, id): la PRIMERA de cada mesa es la
        // que se muestra. Antes ganaba la última, sin orden fijo.
        const porMesa: Record<string, ActiveOrder[]> = {}
        for (const order of (ordersData ?? []) as ActiveOrder[]) {
          if (order.table_id) (porMesa[order.table_id] ??= []).push(order)
        }
        const map: Record<string, ActiveOrder> = {}
        for (const [mesa, cuentas] of Object.entries(porMesa)) map[mesa] = cuentas[0]
        setTables(rows)
        setActiveOrders(map)
        setCuentasPorMesa(porMesa)
      } else {
        setTables(rows)
        setActiveOrders({})
        setCuentasPorMesa({})
      }
      setOrdenesCargadas(true)
    } finally {
      // Pase lo que pase (error de red, sede nula), la pantalla nunca debe
      // quedar colgada en "Cargando mesas…".
      setLoading(false)
    }
  }, [profile?.restaurant_id, authLoading])

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
    cuentasPorMesa,
    ordenesCargadas,
    loading,
    currentShift,
    refetch: fetchAll,
  }
}
