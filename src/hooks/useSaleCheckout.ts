import { useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { nuevoUuid } from '@/lib/uuid'
import { useAuth } from '@/hooks/useAuth'
import type { Json } from '@/types/database.types'
import type { OrderItemPayload, SalePaymentPart } from '@/lib/supabase-helpers'
import type { DiscountType, DiscountKind } from '@/stores/cartStore'

// ============================================================================
// Cobro de una venta del POS: UNA llamada, register_pos_sale
// (supabase/pos-sale-lotes.sql), que crea la orden, sus ítems (con stock), el
// pago y el número en una sola transacción. Es el ÚNICO llamador de esa RPC:
// el POS de escritorio y el móvil (/m) cobran por acá.
//
// IDEMPOTENCIA: el id de la venta lo genera el CLIENTE y se CONSERVA entre
// reintentos mientras el contenido de la venta sea el mismo. Un reenvío —del
// navegador, que Chromium hace solo tras un corte de conexión, o del cajero que
// vuelve a tocar "Confirmar" después de un error de red— llega con el mismo id y
// el servidor devuelve la venta ya hecha (ya_existia) en vez de crear otra.
//
// El id pendiente vive a nivel de MÓDULO, no en el estado del modal: si el cajero
// cierra el modal tras un error y lo vuelve a abrir con el mismo carrito, el
// reintento tiene que llevar el mismo id (la primera pudo haber entrado). Se
// descarta al cobrar con éxito o cuando cambia el contenido. El método de pago NO
// forma parte del contenido: si el primer intento entró en efectivo y el cajero
// reintenta con tarjeta, la respuesta es la venta en efectivo (ya_existia), no una
// segunda venta. La pantalla lo avisa.
// ============================================================================

export type VentaPOS = {
  type: 'takeaway' | 'delivery'
  total: number
  discount_amount: number
  discount_type: DiscountType | null
  discount_kind: DiscountKind
  discount_reason: string | null
  fiado: boolean
  customer_id: string | null
  customer_name: string | null
  items: OrderItemPayload[]
  payments: SalePaymentPart[]
}

export type VentaRegistrada = {
  order_id: string
  order_number: number
  total: number
  ya_existia: boolean
}

let pendiente: { id: string; huella: string } | null = null

export function useSaleCheckout() {
  const { user } = useAuth()
  const usuario = user?.id ?? null
  const cobrar = useCallback(async (venta: VentaPOS): Promise<VentaRegistrada> => {
    const { items, payments, ...orden } = venta
    // El USUARIO es parte de la huella: si A falla, cierra sesión y B entra en la
    // misma pestaña con el mismo carrito, B no puede recibir la venta de A
    // (ya_existia) — sería una venta cobrada por B atribuida a A.
    const huella = JSON.stringify({ usuario, orden, items })
    if (pendiente?.huella !== huella) pendiente = { id: nuevoUuid(), huella }
    const { data, error } = await supabase.rpc('register_pos_sale', {
      p_sale_id: pendiente.id,
      p_order: orden as unknown as Json,
      p_items: items as unknown as Json,
      p_payments: payments as unknown as Json,
    })
    if (error) throw error
    pendiente = null
    return data as unknown as VentaRegistrada
  }, [usuario])

  return { cobrar }
}
