import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import { adjustStock } from '@/lib/supabase-helpers'
import { useAuth } from '@/hooks/useAuth'

/**
 * Mutaciones de inventario. `adjust` llama a la RPC adjust_stock (atómica:
 * UPDATE del stock + INSERT del movimiento en una sola función SECURITY
 * DEFINER) e invalida productos + movimientos para refrescar niveles.
 */
export function useInventory() {
  const queryClient = useQueryClient()
  const { profile } = useAuth()

  const adjust = useMutation({
    mutationFn: async ({ productId, qty, reason }: { productId: string; qty: number; reason: string }) => {
      const { error } = await adjustStock(productId, qty, reason)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products', profile?.restaurant_id] })
      queryClient.invalidateQueries({ queryKey: ['stock_movements'] })
      toast.success('Stock ajustado')
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Error al ajustar stock'),
  })

  return { adjust }
}
