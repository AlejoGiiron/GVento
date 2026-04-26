import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import { useAuth } from '@/hooks/useAuth'
import { getRestaurant, updateRestaurant } from '@/lib/supabase-helpers'
import type { TablesUpdate } from '@/types/database.types'

export type PaymentMethod = 'cash' | 'card' | 'transfer' | 'nequi'

export interface RestaurantConfig {
  slug?: string | null
  cash_out_reasons?: string[]
  payment_methods?: PaymentMethod[]
  nequi_qr_url?: string | null
  kitchen_pin?: string | null
  kitchen_stations?: string[]
  kds_timers?: { green: number; amber: number }
  default_delivery_time?: number
  notifications?: {
    delivery_sound?: boolean
    kitchen_sound?: boolean
  }
}

export function useRestaurantConfig() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const restaurantId = profile?.restaurant_id

  const { data: restaurant, isLoading } = useQuery({
    queryKey: ['restaurant', restaurantId],
    queryFn: async () => {
      const { data, error } = await getRestaurant(restaurantId!)
      if (error) throw error
      return data
    },
    enabled: !!restaurantId,
    staleTime: 30_000,
  })

  const config: RestaurantConfig = (restaurant?.config as RestaurantConfig) ?? {}

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['restaurant', restaurantId] })

  const updateMutation = useMutation({
    mutationFn: async (data: TablesUpdate<'restaurants'>) => {
      const { data: updated, error } = await updateRestaurant(restaurantId!, data)
      if (error) throw error
      return updated
    },
    onSuccess: () => { invalidate(); toast.success('Cambios guardados') },
    onError: () => toast.error('Error al guardar los cambios'),
  })

  const updateConfig = (patch: Partial<RestaurantConfig>) =>
    updateMutation.mutateAsync({
      config: { ...config, ...patch } as Record<string, unknown>,
    })

  return {
    restaurant,
    config,
    isLoading,
    updateRestaurant: updateMutation.mutateAsync,
    updateConfig,
    isSaving: updateMutation.isPending,
  }
}
