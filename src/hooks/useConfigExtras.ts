import { useMemo, useState } from 'react'
import { useProductExtras } from '@/hooks/useProductExtras'
import type { CartExtra, ProductWithCategory } from '@/stores/cartStore'

/**
 * Lógica de configurar un ítem con extras, UNA para las dos pantallas que lo
 * hacen: el modal del escritorio (ItemConfigModal, POS y Mesas) y la hoja del
 * POS móvil (ExtrasMovil). Solo cambia cómo se ve.
 *
 * · Extras disponibles = los asignados al producto y ACTIVOS.
 * · La qty de cada extra es POR UNIDAD del producto (la RPC la multiplica).
 * · `initial` precarga la selección al editar un ítem que ya está en el carrito.
 */
export function useConfigExtras(product: ProductWithCategory, initial: CartExtra[] = []) {
  const { productExtras, isLoading } = useProductExtras(product.id)

  const disponibles = useMemo(
    () =>
      productExtras
        .map((r) => r.extras)
        .filter((e): e is NonNullable<typeof e> => !!e && e.is_active),
    [productExtras],
  )

  const [cantidades, setCantidades] = useState<Record<string, number>>(() => {
    const map: Record<string, number> = {}
    for (const e of initial) map[e.extra_id] = e.qty
    return map
  })

  const setCantidad = (id: string, qty: number) =>
    setCantidades((prev) => ({ ...prev, [id]: Math.max(0, qty) }))

  const extrasUnidad = disponibles.reduce((a, e) => a + Number(e.price) * (cantidades[e.id] ?? 0), 0)

  /** Los extras elegidos, listos para el carrito. */
  const elegidos = (): CartExtra[] =>
    disponibles
      .filter((e) => (cantidades[e.id] ?? 0) > 0)
      .map((e) => ({
        extra_id: e.id,
        name: e.name,
        price: Number(e.price),
        qty: cantidades[e.id],
        linked_product_id: e.linked_product_id,
      }))

  return {
    disponibles,
    isLoading,
    cantidad: (id: string) => cantidades[id] ?? 0,
    setCantidad,
    subtotalUnidad: product.price + extrasUnidad,
    elegidos,
  }
}
