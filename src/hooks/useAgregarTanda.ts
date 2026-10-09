import { useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { nuevoUuid } from '@/lib/uuid'
import { useAuth } from '@/hooks/useAuth'
import type { Json } from '@/types/database.types'
import type { OrderItemPayload } from '@/lib/supabase-helpers'

// ============================================================================
// Agrega una TANDA de ítems a una orden abierta (Mesas), con CLAVE por tanda
// (p_lote de add_order_items_with_extras, supabase/pos-sale-lotes.sql).
//
// La clave se CONSERVA entre reintentos de la misma tanda: si Chromium reenvía
// el POST tras un corte, o el mozo vuelve a tocar "Agregar" después de un error
// de red con la misma selección, el servidor reconoce la tanda y no la repite.
// Vive a nivel de MÓDULO (no en el modal) para sobrevivir a cerrar y reabrir el
// selector; se descarta al confirmar con éxito o cuando cambia la orden o la
// selección.
//
// El TOTAL de la orden lo recalcula el servidor desde las líneas en la misma
// transacción (ya no se escribe desde el cliente: esa escritura absoluta pisaba
// las tandas de otro equipo).
// ============================================================================

let pendiente: { lote: string; huella: string } | null = null

export function useAgregarTanda() {
  const { user } = useAuth()
  const usuario = user?.id ?? null
  const agregar = useCallback(async (orderId: string, items: OrderItemPayload[]): Promise<void> => {
    // El usuario es parte de la huella (igual que en useSaleCheckout): otro usuario
    // en la misma pestaña no reusa la tanda pendiente del anterior.
    const huella = JSON.stringify({ usuario, orderId, items })
    if (pendiente?.huella !== huella) pendiente = { lote: nuevoUuid(), huella }
    const { error } = await supabase.rpc('add_order_items_with_extras', {
      p_order_id: orderId,
      p_items: items as unknown as Json,
      p_lote: pendiente.lote,
    })
    if (error) throw error
    pendiente = null
  }, [usuario])

  return { agregar }
}
