import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import { useAuth } from '@/hooks/useAuth'
import {
  getRestaurantProfiles,
  updateProfile,
  inviteUser as inviteUserHelper,
} from '@/lib/supabase-helpers'
import type { Tables, TablesUpdate } from '@/types/database.types'

export type UserRow = Tables<'profiles'>

export function useUsers() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const restaurantId = profile?.restaurant_id

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['restaurant_users', restaurantId],
    queryFn: async () => {
      const { data, error } = await getRestaurantProfiles(restaurantId!)
      if (error) throw error
      return data ?? []
    },
    enabled: !!restaurantId,
    staleTime: 30_000,
  })

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['restaurant_users', restaurantId] })

  const updateMutation = useMutation({
    mutationFn: async ({ userId, data }: { userId: string; data: TablesUpdate<'profiles'> }) => {
      const { data: updated, error } = await updateProfile(userId, data)
      if (error) throw error
      return updated
    },
    onSuccess: () => { invalidate(); toast.success('Usuario actualizado') },
    onError: () => toast.error('Error al actualizar el usuario'),
  })

  const inviteMutation = useMutation({
    mutationFn: async (params: {
      email: string
      full_name: string
      role: 'admin' | 'cashier' | 'waiter'
    }) => {
      const { error } = await inviteUserHelper({ ...params, restaurant_id: restaurantId! })
      if (error) throw error
    },
    onSuccess: () => { invalidate(); toast.success('Invitación enviada') },
    onError: () => toast.error('Error al invitar usuario — se requiere una Edge Function configurada'),
  })

  return {
    users,
    isLoading,
    updateUser: (userId: string, data: TablesUpdate<'profiles'>) =>
      updateMutation.mutateAsync({ userId, data }),
    inviteUser: inviteMutation.mutateAsync,
    isUpdating: updateMutation.isPending,
    isInviting: inviteMutation.isPending,
  }
}
