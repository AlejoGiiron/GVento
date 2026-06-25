import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import {
  getCustomers, upsertCustomer, deleteCustomer,
  type Customer,
} from '@/lib/supabase-helpers'
import { useAuth } from '@/hooks/useAuth'
import type { TablesInsert } from '@/types/database.types'

export type { Customer }

/**
 * Clientes ACTIVOS de la sede (CRM). Gateado en UI por fiado.gestionar.
 * Borrado = soft-deactivate (un cliente con deudas no se borra; se conserva
 * para la trazabilidad).
 */
export function useCustomers() {
  const { profile } = useAuth()
  const restaurantId = profile?.restaurant_id ?? null

  const query = useQuery({
    queryKey: ['customers', restaurantId],
    queryFn: async () => {
      const { data, error } = await getCustomers(restaurantId!)
      if (error) throw error
      return data ?? []
    },
    enabled: !!restaurantId,
    staleTime: 60_000,
  })

  return {
    customers: query.data ?? [],
    isLoading: query.isLoading,
  }
}

/** Mutaciones de clientes (crear/editar/desactivar). */
export function useCustomerMutations() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const restaurantId = profile?.restaurant_id ?? null

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['customers', restaurantId] })

  const save = useMutation({
    mutationFn: async (
      input: Pick<TablesInsert<'customers'>, 'name' | 'phone' | 'document' | 'notes'>
        & { id?: string },
    ) => {
      const { data, error } = await upsertCustomer({
        ...input,
        restaurant_id: restaurantId!,
      })
      if (error) throw error
      return data
    },
    onSuccess: (_, vars) => {
      invalidate()
      toast.success(vars.id ? 'Cliente actualizado' : 'Cliente creado')
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Error al guardar el cliente'),
  })

  const deactivate = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await deleteCustomer(id)
      if (error) throw error
    },
    onSuccess: () => { invalidate(); toast.success('Cliente desactivado') },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Error al desactivar el cliente'),
  })

  return {
    save: save.mutateAsync,
    deactivate: deactivate.mutateAsync,
    isMutating: save.isPending || deactivate.isPending,
  }
}
