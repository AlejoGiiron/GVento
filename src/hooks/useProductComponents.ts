import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import {
  getProductComponents,
  addProductComponent,
  updateProductComponentQty,
  removeProductComponent,
  type ProductComponentRow,
} from '@/lib/supabase-helpers'
import { useAuth } from '@/hooks/useAuth'

/** Una fila de la receta tal como la edita el modal (antes de persistir). */
export interface RecipeRow {
  component_id: string
  qty: number
}

/**
 * Receta (product_components) de un producto compuesto.
 * `reconcile` recibe el parentId explícito para soportar productos recién
 * creados (cuyo id no existía al montar el hook), igual que useProductExtras.
 */
export function useProductComponents(parentId: string | null) {
  const queryClient = useQueryClient()
  const { profile } = useAuth()

  const query = useQuery({
    queryKey: ['product_components', parentId],
    queryFn: async () => {
      const { data, error } = await getProductComponents(parentId!)
      if (error) throw error
      return (data ?? []) as unknown as ProductComponentRow[]
    },
    enabled: !!parentId,
  })

  // Sincroniza la receta en BD con la lista objetivo (add/update/remove).
  const reconcile = useMutation({
    mutationFn: async ({ parentId, rows }: { parentId: string; rows: RecipeRow[] }) => {
      if (!profile) throw new Error('Sin sesión')
      const { data: current, error: readErr } = await getProductComponents(parentId)
      if (readErr) throw readErr
      const currentRows = (current ?? []) as unknown as ProductComponentRow[]
      const currentById = new Map(currentRows.map(r => [r.component_id, r]))
      const target = new Map(rows.map(r => [r.component_id, r]))

      // Altas y cambios de cantidad.
      for (const row of rows) {
        const existing = currentById.get(row.component_id)
        if (!existing) {
          const { error } = await addProductComponent({
            parent_id: parentId,
            component_id: row.component_id,
            qty: row.qty,
            restaurant_id: profile.restaurant_id,
          })
          if (error) throw error
        } else if (existing.qty !== row.qty) {
          const { error } = await updateProductComponentQty(existing.id, row.qty)
          if (error) throw error
        }
      }
      // Bajas.
      for (const row of currentRows) {
        if (!target.has(row.component_id)) {
          const { error } = await removeProductComponent(row.id)
          if (error) throw error
        }
      }
    },
    onSuccess: (_data, { parentId }) => {
      queryClient.invalidateQueries({ queryKey: ['product_components', parentId] })
    },
    onError: () => toast.error('Error al guardar la receta'),
  })

  const components = (query.data ?? []) as ProductComponentRow[]
  const initialRows = useMemo<RecipeRow[]>(
    () => components.map(c => ({ component_id: c.component_id, qty: c.qty })),
    [components],
  )

  return {
    components,
    initialRows,
    isLoading: query.isLoading,
    reconcile,
  }
}
