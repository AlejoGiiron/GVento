import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { getRestaurant, updateRestaurant } from '@/lib/supabase-helpers'
import type { Json, TablesUpdate } from '@/types/database.types'
import type { RestaurantConfig } from '@/lib/restaurantConfig'

export type { PaymentMethod, RestaurantConfig } from '@/lib/restaurantConfig'
export { CLAVES_CONFIG } from '@/lib/restaurantConfig'

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

  // Columnas de la sede (nombre, logo, uses_kitchen…). La config NO se escribe
  // por acá: reescribiría el objeto entero (ver updateConfig).
  const updateMutation = useMutation({
    mutationFn: async (data: Omit<TablesUpdate<'restaurants'>, 'config'>) => {
      const { data: updated, error } = await updateRestaurant(restaurantId!, data)
      if (error) throw error
      return updated
    },
    onSuccess: () => { invalidate(); toast.success('Cambios guardados') },
    onError: () => toast.error('Error al guardar los cambios'),
  })

  // Solo las claves que cambian; el SERVIDOR las fusiona con lo que haya en la
  // base en ese momento (update_restaurant_config). Antes se mandaba
  // { ...config, ...patch } con la copia de esta pantalla, y una copia vieja
  // pisaba lo que otro (u otra sección de esta misma pantalla) acababa de guardar.
  // `null` borra la clave.
  const configMutation = useMutation({
    mutationFn: async (patch: Partial<RestaurantConfig>) => {
      const { data, error } = await supabase.rpc('update_restaurant_config', { p_cambios: patch as Json })
      if (error) throw error
      return data
    },
    onSuccess: () => { invalidate(); toast.success('Cambios guardados') },
    onError: (err) => toast.error(`Error al guardar los cambios: ${(err as { message?: string }).message ?? ''}`),
  })

  return {
    restaurant,
    config,
    isLoading,
    updateRestaurant: updateMutation.mutateAsync,
    updateConfig: configMutation.mutateAsync,
    isSaving: updateMutation.isPending || configMutation.isPending,
  }
}
