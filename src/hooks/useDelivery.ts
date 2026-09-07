import { useState, useEffect, useCallback, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import {
  getDeliveryOrders,
  getCouriers,
  getOpenShift,
  updateOrderStatus,
  assignOrderCourier,
} from '@/lib/supabase-helpers'
import { useAuth } from '@/hooks/useAuth'
import type { Tables } from '@/types/database.types'

// ─── Types ────────────────────────────────────────────────────────

export type DeliveryItem = {
  id: string
  qty: number
  unit_price: number
  notes: string | null
  products: { id: string; name: string; price: number } | null
}

export type DeliveryOrder = {
  id: string
  order_number: number | null
  customer_name: string | null
  customer_phone: string | null
  delivery_address: string | null
  delivered_at: string | null
  courier_id: string | null
  estimated_delivery_minutes: number | null
  notes: string | null
  total: number
  status: 'pending' | 'preparing' | 'ready' | 'delivered' | 'cancelled'
  created_at: string
  order_items: DeliveryItem[]
  couriers: { id: string; name: string; phone: string | null } | null
}

export type CourierRow = Tables<'couriers'>

// Columnas kanban — flujo simplificado de 3 pasos.
// Mapeo desde el enum real de la BD (pending/preparing/ready/delivered):
//   pending, preparing → "Nuevos"
//   ready              → "En camino"
//   delivered          → "Entregados"
export type DeliveryColumn = 'new' | 'in_transit' | 'delivered'

export function getDeliveryColumn(order: DeliveryOrder): DeliveryColumn {
  if (order.status === 'delivered') return 'delivered'
  if (order.status === 'ready') return 'in_transit'
  return 'new'
}

// ─── Audio alert ──────────────────────────────────────────────────

function playOrderAlert() {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(660, ctx.currentTime)
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.15)
    gain.gain.setValueAtTime(0.2, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6)
    osc.start()
    osc.stop(ctx.currentTime + 0.6)
  } catch {
    // AudioContext no disponible
  }
}

// ─── Hook ─────────────────────────────────────────────────────────

export function useDelivery() {
  const { profile } = useAuth()
  const [orders, setOrders] = useState<DeliveryOrder[]>([])
  const [couriers, setCouriers] = useState<CourierRow[]>([])
  const [loading, setLoading] = useState(true)

  const prevIdsRef = useRef<Set<string>>(new Set())
  const isFirstFetchRef = useRef(true)

  // Turno abierto: define la ventana de la columna "Entregados". MISMA queryKey
  // que useCashShift → una sola consulta compartida por React Query, y al abrir
  // o cerrar turno esa invalidación mueve también este tablero. No se usa
  // useCashShift() entero a propósito: arrastra el poll de 5 s de las ventas del
  // turno, que acá no se mira.
  const { data: openShift, isLoading: isLoadingShift } = useQuery({
    queryKey: ['cash_shift_open', profile?.restaurant_id],
    queryFn: async () => {
      const { data, error } = await getOpenShift(profile!.restaurant_id)
      if (error) throw error
      return data ?? null
    },
    enabled: !!profile?.restaurant_id,
    staleTime: 10_000,
  })
  const shiftOpenedAt = openShift?.opened_at ?? null

  // La ventana viaja por ref para que `fetchOrders` siga siendo estable: es
  // dependencia del efecto que monta el canal Realtime, y si cambiara de
  // identidad en cada apertura de turno el canal se desuscribiría y volvería a
  // suscribirse sin motivo.
  const deliveredSinceRef = useRef<string | null>(null)

  const fetchOrders = useCallback(async () => {
    if (!profile) return
    const { data, error } = await getDeliveryOrders(
      profile.restaurant_id,
      deliveredSinceRef.current,
    )
    if (error) {
      toast.error('Error al cargar órdenes de delivery')
      return
    }
    const incoming = (data ?? []) as DeliveryOrder[]

    // Detectar órdenes nuevas después de la carga inicial
    if (!isFirstFetchRef.current) {
      for (const o of incoming) {
        if (!prevIdsRef.current.has(o.id) && o.status === 'pending') {
          toast('Nuevo pedido de delivery', { icon: '🛵', duration: 5000 })
          playOrderAlert()
          break
        }
      }
    }

    prevIdsRef.current = new Set(incoming.map((o) => o.id))
    setOrders(incoming)
  }, [profile])

  const fetchCouriers = useCallback(async () => {
    if (!profile) return
    const { data } = await getCouriers(profile.restaurant_id)
    setCouriers(data ?? [])
  }, [profile])

  // La ventana se aplica ANTES de la primera consulta y en cada cambio de turno.
  // Mientras el turno se está resolviendo no se consulta: hacerlo mostraría
  // "Entregados" vacío por un instante y después lleno.
  useEffect(() => {
    if (!profile || isLoadingShift) return
    deliveredSinceRef.current = shiftOpenedAt

    const init = async () => {
      await Promise.all([fetchOrders(), fetchCouriers()])
      isFirstFetchRef.current = false
      setLoading(false)
    }
    init()

    // Canal Realtime con nombre único (patrón Math.random() del proyecto)
    const channelName = `delivery:${profile.restaurant_id}:${Math.random().toString(36).slice(2, 8)}`
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: `restaurant_id=eq.${profile.restaurant_id}`,
        },
        fetchOrders,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'couriers',
          filter: `restaurant_id=eq.${profile.restaurant_id}`,
        },
        fetchCouriers,
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          setTimeout(() => channel.subscribe(), 3000)
        }
      })

    return () => {
      // Cleanup correcto: unsubscribe antes de removeChannel.
      channel.unsubscribe()
      supabase.removeChannel(channel)
    }
  }, [profile, isLoadingShift, shiftOpenedAt, fetchOrders, fetchCouriers])

  // Órdenes agrupadas por columna kanban (3 columnas)
  const grouped: Record<DeliveryColumn, DeliveryOrder[]> = {
    new:        orders.filter((o) => getDeliveryColumn(o) === 'new'),
    in_transit: orders.filter((o) => getDeliveryColumn(o) === 'in_transit'),
    delivered:  orders.filter((o) => getDeliveryColumn(o) === 'delivered'),
  }

  const updateStatus = async (
    orderId: string,
    status: DeliveryOrder['status'],
  ): Promise<boolean> => {
    const { error } = await updateOrderStatus(orderId, status)
    if (error) {
      toast.error('Error al actualizar estado')
      return false
    }
    await fetchOrders()
    return true
  }

  const assignCourier = async (
    orderId: string,
    courierId: string | null,
    estimatedMinutes: number | null,
  ): Promise<boolean> => {
    const { error } = await assignOrderCourier(orderId, courierId, estimatedMinutes)
    if (error) {
      toast.error('Error al asignar repartidor')
      return false
    }
    await fetchOrders()
    return true
  }

  return {
    orders,
    grouped,
    couriers,
    loading,
    activeCount: grouped.new.length + grouped.in_transit.length,
    newCount: grouped.new.length,
    updateStatus,
    assignCourier,
    refetch: fetchOrders,
    refetchCouriers: fetchCouriers,
    /** null = no hay turno abierto → "Entregados" no tiene ventana que mostrar. */
    shiftOpenedAt,
  }
}
