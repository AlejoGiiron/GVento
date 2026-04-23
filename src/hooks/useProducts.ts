import { useQuery } from '@tanstack/react-query'
import { getProducts } from '@/lib/supabase-helpers'
import { useAuth } from '@/hooks/useAuth'
import type { ProductWithCategory } from '@/stores/cartStore'

export function useProducts() {
  const { profile } = useAuth()

  return useQuery({
    queryKey: ['products', profile?.restaurant_id],
    queryFn: async () => {
      const { data, error } = await getProducts(profile!.restaurant_id)
      if (error) throw error
      return (data ?? []) as ProductWithCategory[]
    },
    enabled: !!profile?.restaurant_id,
  })
}
