import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import { useAuth } from '@/hooks/useAuth'
import {
  getRestaurantProfiles,
  updateProfile,
  createUser as createUserHelper,
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

  const createUserMutation = useMutation({
    mutationFn: async (params: {
      email: string
      password: string
      full_name: string
      role: 'admin' | 'cashier' | 'waiter'
    }) => {
      const { data, error } = await createUserHelper({ ...params, restaurant_id: restaurantId! })
      if (error) throw error
      const body = data as { error?: string } | null
      if (body?.error) throw new Error(body.error)
    },
    onSuccess: () => { invalidate(); toast.success('Usuario creado') },
    onError: (err: Error) => toast.error(err.message ?? 'Error al crear el usuario'),
  })

  return {
    users,
    isLoading,
    updateUser: (userId: string, data: TablesUpdate<'profiles'>) =>
      updateMutation.mutateAsync({ userId, data }),
    createUser: createUserMutation.mutateAsync,
    isUpdating: updateMutation.isPending,
    isCreatingUser: createUserMutation.isPending,
  }
}
