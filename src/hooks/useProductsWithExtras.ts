import { useQuery } from '@tanstack/react-query'
import { getProductsWithActiveExtras } from '@/lib/supabase-helpers'
import { useAuth } from '@/hooks/useAuth'

/**
 * Qué productos de la sede tienen al menos un extra activo. El POS y Mesas lo
 * usan para decidir si, al agregar un producto, abren el modal de configuración
 * o lo agregan directo (sin fricción).
 *
 * 🔴 FAIL-CLOSED, a propósito. Antes el hook devolvía `query.data ?? new Set()`:
 * mientras la query cargaba (o si fallaba) el set estaba VACÍO, o sea "ningún
 * producto tiene extras", y un producto con extras se agregaba SIN abrir el
 * modal — la venta salía sin configurar y nadie se enteraba. Medido
 * (2026-09-30): demorando `product_extras` 1,5 s, el click sobre "Lab Coctel"
 * en el picker de Mesas no abre el modal nunca. Era la causa del flake de
 * `pago-mixto.spec.ts:247` ("item-config-modal … element(s) not found"), y con
 * la red de un celular sería el caso común, no el raro.
 *
 * Ahora:
 *  · `isLoading` — el consumidor NO muestra los productos hasta que el set se
 *    conoce (gate, igual que con categorías/productos).
 *  · `requiereConfig(id)` — si el set NO se conoce (query deshabilitada o con
 *    error), devuelve true: se abre el modal, que consulta los extras DEL
 *    producto y decide. Un paso de más en un caso raro, nunca una venta mal
 *    configurada en silencio.
 *  · `tieneExtras(id)` — solo lo que se SABE; para mostrar "editar extras".
 */
export function useProductsWithExtras() {
  const { profile } = useAuth()
  const restaurantId = profile?.restaurant_id

  const query = useQuery({
    queryKey: ['products_with_extras', restaurantId],
    queryFn: async () => {
      const { data, error } = await getProductsWithActiveExtras(restaurantId!)
      if (error) throw error
      return new Set((data ?? []).map((r) => r.product_id))
    },
    enabled: !!restaurantId,
    staleTime: 30_000,
  })

  const ids = query.data
  return {
    isLoading: query.isLoading,
    requiereConfig: (productId: string) => !ids || ids.has(productId),
    tieneExtras: (productId: string) => !!ids && ids.has(productId),
  }
}
