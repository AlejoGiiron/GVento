import { useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { nuevoUuid } from '@/lib/uuid'
import { useAuth } from '@/hooks/useAuth'
import type { Json } from '@/types/database.types'
import type { SalePaymentPart } from '@/lib/supabase-helpers'
import type { CierreMesa } from '@/lib/cierreMesa'

// ============================================================================
// Las escrituras de Mesas, cada una en UNA llamada al servidor
// (supabase/mesas-servidor.sql): cobrar, quitar un ítem, cerrar sin consumo y
// eliminar (o archivar) una mesa. Antes eran pasos sueltos desde el navegador
// (descuento, pago, número, entregada, mesa libre), y un corte a la mitad dejaba
// la mesa cobrada a medias (H2) o el ítem borrado sin devolver el stock (H3).
//
// CLAVES. El cobro (p_close_id) y la baja (p_baja_id) llevan una clave que se
// CONSERVA entre reintentos, igual que la tanda (useAgregarTanda): si la respuesta
// se pierde y el cajero vuelve a tocar "Cobrar", el servidor reconoce el cobro y
// devuelve la venta hecha en vez de cobrar dos veces. La huella del cobro es SOLO
// usuario + orden, a propósito: un reintento con otro método (o otro descuento)
// recibe SU venta con el método real (ya_existia), no un falso "la cobró otro".
// Si el intento anterior lo rechazó el servidor, la clave no se consumió y
// reusarla no cambia nada. Se descartan al terminar con éxito.
// ============================================================================

let cobroPendiente: { clave: string; huella: string } | null = null
let bajaPendiente: { clave: string; huella: string } | null = null

export interface CobroMesa {
  orderId: string
  /** El total que ve la pantalla: el servidor lo compara con las líneas (B1). */
  totalEsperado: number
  /** [] para fiado o total 0. */
  pagos: SalePaymentPart[]
  descuento: { amount: number; kind: 'normal' | 'vale'; reason: string | null } | null
  fiado: { customer_id: string; customer_name: string } | null
}

export interface BajaMesa {
  baja_id: string
  order_id: string
  preparado: boolean
  total: number
  ya_existia: boolean
}

export function useMesaMutations() {
  const { user } = useAuth()
  const usuario = user?.id ?? null

  const cobrar = useCallback(async (c: CobroMesa): Promise<CierreMesa> => {
    const huella = JSON.stringify({ usuario, orderId: c.orderId })
    if (cobroPendiente?.huella !== huella) cobroPendiente = { clave: nuevoUuid(), huella }
    const { data, error } = await supabase.rpc('close_table_sale', {
      p_order_id: c.orderId,
      p_close_id: cobroPendiente.clave,
      p_total_esperado: c.totalEsperado,
      p_payments: c.pagos as unknown as Json,
      p_descuento: c.descuento as unknown as Json,
      p_fiado: c.fiado as unknown as Json,
    })
    if (error) throw error
    cobroPendiente = null
    return data as unknown as CierreMesa
  }, [usuario])

  const quitarItem = useCallback(async (itemId: string, motivo: string, preparado: boolean): Promise<BajaMesa> => {
    const huella = JSON.stringify({ usuario, itemId })
    if (bajaPendiente?.huella !== huella) bajaPendiente = { clave: nuevoUuid(), huella }
    const { data, error } = await supabase.rpc('quitar_item_mesa', {
      p_item_id: itemId,
      p_baja_id: bajaPendiente.clave,
      p_motivo: motivo,
      p_preparado: preparado,
    })
    if (error) throw error
    bajaPendiente = null
    return data as unknown as BajaMesa
  }, [usuario])

  // Idempotentes en el servidor por sí mismas: no llevan clave.
  const cerrarSinConsumo = useCallback(async (orderId: string): Promise<void> => {
    const { error } = await supabase.rpc('cerrar_mesa_sin_consumo', { p_order_id: orderId })
    if (error) throw error
  }, [])

  const eliminarMesa = useCallback(async (tableId: string): Promise<'eliminada' | 'archivada'> => {
    const { data, error } = await supabase.rpc('eliminar_mesa', { p_table_id: tableId })
    if (error) throw error
    return (data as { accion: 'eliminada' | 'archivada' }).accion
  }, [])

  return { cobrar, quitarItem, cerrarSinConsumo, eliminarMesa }
}
