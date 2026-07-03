import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getProductExtras, addProductExtra, removeProductExtra } from '@/lib/supabase-helpers'

/**
 * Extras del catálogo asignados a un producto (relación product_extras).
 * `reconcile` recibe el productId explícito para soportar productos
 * recién creados (cuyo id aún no estaba disponible al montar el hook).
 */
export function useProductExtras(productId: string | null) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['product_extras', productId],
    queryFn: async () => {
      const { data, error } = await getProductExtras(productId!)
      if (error) throw error
      return data ?? []
    },
    enabled: !!productId,
  })

  const reconcile = useMutation({
    mutationFn: async ({ productId, extraIds }: { productId: string; extraIds: string[] }) => {
      const { data: current, error: readErr } = await getProductExtras(productId)
      if (readErr) throw readErr
      const currentIds = new Set((current ?? []).map(r => r.extra_id))
      const target = new Set(extraIds)
      const toAdd = extraIds.filter(id => !currentIds.has(id))
      const toRemove = [...currentIds].filter(id => !target.has(id))

      for (const id of toAdd) {
        const { error } = await addProductExtra(productId, id)
        if (error) throw error
      }
      for (const id of toRemove) {
        const { error } = await removeProductExtra(productId, id)
        if (error) throw error
      }
    },
    onSuccess: (_data, { productId }) => {
      queryClient.invalidateQueries({ queryKey: ['product_extras', productId] })
    },
    // El error se maneja de forma centralizada en ProductModal.handleSubmit
    // (mensaje accionable + reintento idempotente); aquí no se toastea para no
    // duplicar y para que el guardado no falle en silencio por pasos.
  })

  const assignedIds = useMemo(
    () => new Set((query.data ?? []).map(r => r.extra_id)),
    [query.data],
  )

  return {
    productExtras: query.data ?? [],
    assignedIds,
    isLoading: query.isLoading,
    reconcile,
  }
}
