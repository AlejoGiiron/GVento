import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import { getAllExtras, upsertExtra, deactivateExtra } from '@/lib/supabase-helpers'
import { useAuth } from '@/hooks/useAuth'
import type { TablesInsert } from '@/types/database.types'

/**
 * Catálogo de extras (subproductos reutilizables) de la sede activa.
 * Incluye inactivos para poder mostrarlos/reactivarlos en configuración.
 */
export function useExtras() {
  const queryClient = useQueryClient()
  const { profile } = useAuth()
  const restaurantId = profile?.restaurant_id

  const extrasQuery = useQuery({
    queryKey: ['extras', restaurantId],
    queryFn: async () => {
      const { data, error } = await getAllExtras(restaurantId!)
      if (error) throw error
      return data ?? []
    },
    enabled: !!restaurantId,
    staleTime: 30_000,
  })

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['extras', restaurantId] })

  const saveExtra = useMutation({
    mutationFn: async (data: TablesInsert<'extras'>) => {
      const { data: result, error } = await upsertExtra(data)
      if (error) throw error
      return result!
    },
    onSuccess: () => { invalidate(); toast.success('Extra guardado') },
    onError: () => toast.error('Error al guardar extra'),
  })

  // Borrado lógico: seguro aunque el extra esté en ventas (order_item_extras
  // conserva su precio snapshot; la FK RESTRICT impide el borrado físico).
  const deactivate = useMutation({
    mutationFn: async (extraId: string) => {
      const { error } = await deactivateExtra(extraId)
      if (error) throw error
    },
    onSuccess: () => { invalidate(); toast.success('Extra desactivado') },
    onError: () => toast.error('Error al desactivar extra'),
  })

  return {
    extras: extrasQuery.data ?? [],
    isLoading: extrasQuery.isLoading,
    saveExtra,
    deactivate,
  }
}
