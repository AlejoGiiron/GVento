import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import {
  getSuppliers, upsertSupplier, deleteSupplier,
  type Supplier,
} from '@/lib/supabase-helpers'
import { useAuth } from '@/hooks/useAuth'
import type { TablesInsert } from '@/types/database.types'

export type { Supplier }

/**
 * Proveedores de la sede (CRUD). Borrado = soft-deactivate (un proveedor con
 * facturas no se puede borrar: FK RESTRICT). Gateado en UI por compras.gestionar.
 */
export function useSuppliers() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const restaurantId = profile?.restaurant_id ?? null

  const query = useQuery({
    queryKey: ['suppliers', restaurantId],
    queryFn: async () => {
      const { data, error } = await getSuppliers(restaurantId!)
      if (error) throw error
      return data ?? []
    },
    enabled: !!restaurantId,
    staleTime: 60_000,
  })

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['suppliers', restaurantId] })

  const save = useMutation({
    mutationFn: async (
      input: Pick<TablesInsert<'suppliers'>, 'name' | 'contact_name' | 'phone' | 'document' | 'notes'>
        & { id?: string },
    ) => {
      const { error } = await upsertSupplier({
        ...input,
        restaurant_id: restaurantId!,
      })
      if (error) throw error
    },
    onSuccess: (_, vars) => {
      invalidate()
      toast.success(vars.id ? 'Proveedor actualizado' : 'Proveedor creado')
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Error al guardar el proveedor'),
  })

  const deactivate = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await deleteSupplier(id)
      if (error) throw error
    },
    onSuccess: () => { invalidate(); toast.success('Proveedor desactivado') },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Error al desactivar el proveedor'),
  })

  return {
    suppliers: query.data ?? [],
    isLoading: query.isLoading,
    save: save.mutateAsync,
    deactivate: deactivate.mutateAsync,
    isMutating: save.isPending || deactivate.isPending,
  }
}
