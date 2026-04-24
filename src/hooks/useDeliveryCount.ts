import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'

/**
 * Hook ligero para el badge del sidebar.
 * Cuenta órdenes de delivery activas (pending/preparing/ready).
 * Mantiene un canal Realtime propio para mantenerse sincronizado.
 */
export function useDeliveryCount(): number {
  const { profile } = useAuth()
  const [count, setCount] = useState(0)

  const fetchCount = useCallback(async () => {
    if (!profile) return
    const { count: c } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('restaurant_id', profile.restaurant_id)
      .eq('type', 'delivery')
      .in('status', ['pending', 'preparing', 'ready'])
    setCount(c ?? 0)
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
      supabase.removeChannel(ch)
    }
  }, [profile, fetchCount])

  return count
}
