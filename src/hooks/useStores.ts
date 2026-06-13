import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import type { Tables } from '@/types/database.types'

export type StoreRow = Tables<'restaurants'>
export type OrgUser = Pick<Tables<'profiles'>, 'id' | 'full_name' | 'email'>
export type StoreAssignment = { user_id: string; restaurant_id: string }

/**
 * Sedes (restaurants) de la organización + asignación de usuarios (user_stores).
 *
 * Nota: la lectura de profiles está acotada por RLS a la sede activa; con una
 * sola sede coincide con toda la organización. El soporte multi-sede pleno
 * requerirá ampliar el SELECT de profiles a nivel organización.
 */
export function useStores() {
  const { organizationId } = useAuth()
  const queryClient = useQueryClient()

  const { data: stores = [], isLoading } = useQuery({
    queryKey: ['org_stores', organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('restaurants')
        .select('*')
        .eq('organization_id', organizationId!)
        .order('created_at')
      if (error) throw error
      return data ?? []
    },
    enabled: !!organizationId,
    staleTime: 60_000,
  })

  const { data: orgUsers = [] } = useQuery({
    queryKey: ['org_users', organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .eq('organization_id', organizationId!)
        .order('full_name')
      if (error) throw error
      return (data ?? []) as OrgUser[]
    },
    enabled: !!organizationId,
    staleTime: 60_000,
  })

  const { data: assignments = [] } = useQuery({
    queryKey: ['org_user_stores', organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_stores')
        .select('user_id, restaurant_id')
      if (error) throw error
      return (data ?? []) as StoreAssignment[]
    },
    enabled: !!organizationId,
    staleTime: 60_000,
  })

  const invalidateStores = () =>
    queryClient.invalidateQueries({ queryKey: ['org_stores', organizationId] })
  const invalidateAssignments = () =>
    queryClient.invalidateQueries({ queryKey: ['org_user_stores', organizationId] })

  const createStoreMut = useMutation({
    mutationFn: async (data: { name: string; address?: string; phone?: string }) => {
      const { error } = await supabase.from('restaurants').insert({
        name: data.name,
        address: data.address?.trim() || null,
        phone: data.phone?.trim() || null,
        organization_id: organizationId!,
      })
      if (error) throw error
    },
    onSuccess: () => { invalidateStores(); toast.success('Sede creada') },
    onError: () => toast.error('Error al crear la sede'),
  })

  const updateStoreMut = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: { name?: string; address?: string | null; phone?: string | null } }) => {
      const { error } = await supabase.from('restaurants').update(data).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { invalidateStores(); toast.success('Sede actualizada') },
    onError: () => toast.error('Error al actualizar la sede'),
  })

  const deleteStoreMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('restaurants').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { invalidateStores(); toast.success('Sede eliminada') },
    onError: () => toast.error('Error al eliminar la sede'),
  })

  const setAssignmentMut = useMutation({
    mutationFn: async ({ userId, restaurantId, assigned }: { userId: string; restaurantId: string; assigned: boolean }) => {
      if (assigned) {
        const { error } = await supabase
          .from('user_stores')
          .insert({ user_id: userId, restaurant_id: restaurantId })
        if (error && error.code !== '23505') throw error // ignora duplicado
      } else {
        const { error } = await supabase
          .from('user_stores')
          .delete()
          .eq('user_id', userId)
          .eq('restaurant_id', restaurantId)
        if (error) throw error
      }
    },
    onSuccess: () => invalidateAssignments(),
    onError: () => toast.error('Error al actualizar el acceso'),
  })

  return {
    stores,
    orgUsers,
    assignments,
    isLoading,
    createStore: createStoreMut.mutateAsync,
    updateStore: updateStoreMut.mutateAsync,
    deleteStore: deleteStoreMut.mutateAsync,
    setAssignment: setAssignmentMut.mutateAsync,
    isMutating: createStoreMut.isPending || updateStoreMut.isPending || deleteStoreMut.isPending,
  }
}
