import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'

export type DeliveryCountEstado = 'cargando' | 'ok' | 'error'

/**
 * Hook ligero para el badge del sidebar y el aviso del cierre de turno.
 * Cuenta órdenes de delivery activas (pending/preparing/ready).
 * Mantiene un canal Realtime propio para mantenerse sincronizado.
 *
 * 🔴 Devuelve el ESTADO además del número. Antes arrancaba en 0 y convertía el
 * error en 0 (`setCount(c ?? 0)`): mientras cargaba —o si fallaba— el cierre de
 * turno afirmaba "no hay domicilios pendientes" sin saberlo (fail-open), y un
 * test que afirmaba la ausencia del aviso pasaba por la carga, no por el dato
 * (delivery-turno.spec, medido 2026-09-30). `count` es null cuando no se sabe.
 */
export function useDeliveryCount(): { count: number | null; estado: DeliveryCountEstado } {
  const { profile } = useAuth()
  const [count, setCount] = useState<number | null>(null)
  const [estado, setEstado] = useState<DeliveryCountEstado>('cargando')

  const fetchCount = useCallback(async () => {
    if (!profile) return
    const { count: c, error } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('restaurant_id', profile.restaurant_id)
      .eq('type', 'delivery')
      .in('status', ['pending', 'preparing', 'ready'])
    if (error) { setEstado('error'); return }   // conserva el último conteo conocido, si hubo
    setCount(c ?? 0)
    setEstado('ok')
  }, [profile])

  useEffect(() => {
    if (!profile) return

    fetchCount()

    const ch = supabase
      .channel(`dlv-cnt:${profile.restaurant_id}:${Math.random().toString(36).slice(2, 6)}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: `restaurant_id=eq.${profile.restaurant_id}`,
        },
        fetchCount,
      )
      .subscribe()

    return () => {
      // Cleanup correcto: unsubscribe antes de removeChannel.
      ch.unsubscribe()
      supabase.removeChannel(ch)
    }
  }, [profile, fetchCount])

  return { count, estado }
}
