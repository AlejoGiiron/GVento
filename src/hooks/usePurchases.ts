import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import {
  getPurchaseInvoices, getPurchaseInvoiceDetail, registerPurchase,
  type PurchaseInvoiceListRow, type PurchaseInvoiceDetailRow,
  type PurchaseInvoicePayload, type PurchaseItemPayload, type RegisterPurchaseResult,
} from '@/lib/supabase-helpers'
import { useAuth } from '@/hooks/useAuth'

export type { PurchaseInvoiceListRow, PurchaseInvoiceDetailRow }

export const PURCHASES_PAGE_SIZE = 25

/** Historial de compras (cabeceras), paginado por fecha desc. */
export function usePurchaseInvoices(page: number) {
  const { profile } = useAuth()
  const restaurantId = profile?.restaurant_id ?? null

  const query = useQuery({
    queryKey: ['purchase_invoices', restaurantId, page],
    queryFn: async () => {
      const { data, count, error } = await getPurchaseInvoices({
        restaurantId: restaurantId!,
        page,
        pageSize: PURCHASES_PAGE_SIZE,
      })
      if (error) throw error
      return {
        rows: (data ?? []) as unknown as PurchaseInvoiceListRow[],
        count: count ?? 0,
      }
    },
    enabled: !!restaurantId,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })

  const count = query.data?.count ?? 0
  return {
    rows: query.data?.rows ?? [],
    count,
    pageCount: Math.max(1, Math.ceil(count / PURCHASES_PAGE_SIZE)),
    isLoading: query.isLoading,
    isFetching: query.isFetching,
  }
}

/** Detalle de una factura de compra (ítems con producto). */
export function usePurchaseInvoiceDetail(invoiceId: string | null) {
  const query = useQuery({
    queryKey: ['purchase_invoice_detail', invoiceId],
    queryFn: async () => {
      const { data, error } = await getPurchaseInvoiceDetail(invoiceId!)
      if (error) throw error
      return data as unknown as PurchaseInvoiceDetailRow
    },
    enabled: !!invoiceId,
    staleTime: 60_000,
  })

  return { invoice: query.data ?? null, isLoading: query.isLoading }
}

/**
 * Registra una compra vía la RPC register_purchase (atómica). Tras el éxito
 * invalida inventario (niveles + movimientos) y el historial de compras, para
 * que el nuevo stock se refleje sin recargar.
 *
 * La compra NO toca la caja: no genera egreso automático. Si salió efectivo
 * del cajón, el cajero lo registra como egreso MANUAL (Movimientos → egreso),
 * que admite monto parcial. El método de pago de la factura es informativo.
 */
export function useRegisterPurchase() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const restaurantId = profile?.restaurant_id ?? null

  const mutation = useMutation({
    mutationFn: async (
      { invoice, items }: { invoice: PurchaseInvoicePayload; items: PurchaseItemPayload[] },
    ) => {
      const { data, error } = await registerPurchase(invoice, items)
      if (error) throw error
      return data as unknown as RegisterPurchaseResult
    },
    onSuccess: () => {
      // Inventario: niveles (products) + auditoría de movimientos.
      queryClient.invalidateQueries({ queryKey: ['products', restaurantId] })
      queryClient.invalidateQueries({ queryKey: ['stock_movements'] })
      // Historial de compras.
      queryClient.invalidateQueries({ queryKey: ['purchase_invoices', restaurantId] })

      // La compra NO toca la caja: no hay egreso automático que reflejar.
      toast.success('Compra registrada y stock actualizado.')
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Error al registrar la compra'),
  })

  return { registerPurchase: mutation.mutateAsync, isRegistering: mutation.isPending }
}
