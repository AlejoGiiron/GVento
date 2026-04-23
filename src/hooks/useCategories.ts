import { useQuery } from '@tanstack/react-query'
import { getCategories } from '@/lib/supabase-helpers'
import { useAuth } from '@/hooks/useAuth'

export function useCategories() {
  const { profile } = useAuth()

  return useQuery({
    queryKey: ['categories', profile?.restaurant_id],
    queryFn: async () => {
      const { data, error } = await getCategories(profile!.restaurant_id)
      if (error) throw error
      return data ?? []
    },
    enabled: !!profile?.restaurant_id,
  })
}
