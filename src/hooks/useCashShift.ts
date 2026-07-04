import { useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import {
  getOpenShift,
  openShift as openShiftHelper,
  closeShift as closeShiftHelper,
  getShiftPayments,
  getShiftSalesCount,
  getShiftVouchersTotal,
  getCashMovements,
  createCashMovement,
  type ClosedShiftRow,
} from '@/lib/supabase-helpers'
import type { Tables, TablesInsert, Json } from '@/types/database.types'
import type { ShiftReconciliation } from '@/lib/shiftCalc'

export interface ShiftSalesSummary {
  cash: number
  card: number
  transfer: number
  nequi: number
  total: number
}

export type CashMovement = Tables<'cash_movements'>

export function useCashShift() {
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const restaurantId = profile?.restaurant_id

  const { data: currentShift = null, isLoading: isLoadingShift } = useQuery({
    queryKey: ['cash_shift_open', restaurantId],
    queryFn: async () => {
      const { data, error } = await getOpenShift(restaurantId!)
      if (error) throw error
      return data ?? null
    },
    enabled: !!restaurantId,
    staleTime: 10_000,
  })

  const { data: salesSummary = null, refetch: refetchSales } = useQuery({
    queryKey: ['shift_payments', currentShift?.id],
    queryFn: async () => {
      const { data, error } = await getShiftPayments(
        restaurantId!,
        currentShift!.opened_at,
      )
      if (error) throw error
      const p = data ?? []
      return {
        cash: p.filter(x => x.method === 'cash').reduce((s, x) => s + x.amount, 0),
        card: p.filter(x => x.method === 'card').reduce((s, x) => s + x.amount, 0),
        transfer: p.filter(x => x.method === 'transfer').reduce((s, x) => s + x.amount, 0),
        nequi: p.filter(x => x.method === 'nequi').reduce((s, x) => s + x.amount, 0),
        total: p.reduce((s, x) => s + x.amount, 0),
      } as ShiftSalesSummary
    },
    enabled: !!currentShift?.id,
    refetchInterval: 5_000,
  })

  const { data: movements = [] } = useQuery({
    queryKey: ['cash_movements', currentShift?.id],
    queryFn: async () => {
      const { data, error } = await getCashMovements(currentShift!.id)
      if (error) throw error
      return data ?? []
    },
    enabled: !!currentShift?.id,
  })

  // Vales (ruletazo) del turno — INFORMATIVO (no entra al cuadre). Para mostrar
  // en el cierre; el snapshot lo recongela en la mutación al cerrar.
  const { data: vouchersTotal = 0 } = useQuery({
    queryKey: ['shift_vouchers', currentShift?.id],
    queryFn: () => getShiftVouchersTotal(restaurantId!, currentShift!.opened_at),
    enabled: !!currentShift?.id,
    refetchInterval: 5_000,
  })

  const invalidateShift = () =>
    queryClient.invalidateQueries({ queryKey: ['cash_shift_open', restaurantId] })

  const invalidateMovements = () =>
    queryClient.invalidateQueries({ queryKey: ['cash_movements', currentShift?.id] })

  const invalidateSales = () =>
    queryClient.invalidateQueries({ queryKey: ['shift_payments', currentShift?.id] })

  const openShiftMutation = useMutation({
    mutationFn: async (openingAmount: number) => {
      const { data, error } = await openShiftHelper({
        restaurant_id: restaurantId!,
        opened_by: profile!.id,
        opening_amount: openingAmount,
      })
      if (error) throw error
      return data!
    },
    onSuccess: () => { invalidateShift(); toast.success('Turno abierto') },
    onError: () => toast.error('Error al abrir el turno'),
  })

  const closeShiftMutation = useMutation({
    mutationFn: async (params: {
      closingAmount: number
      expectedAmount: number
      difference: number
      // Snapshot del arqueo SIN sales_count/vouchers_total (los completa esta
      // mutación al cerrar, único momento en que la ventana solo-opened_at es
      // correcta — recomputarlos en un turno cerrado sumaría datos posteriores).
      reconciliation: Omit<ShiftReconciliation, 'sales_count' | 'vouchers_total'>
      comment: string
    }) => {
      // Congelados al cierre: nº de ventas + total de vales (informativo).
      const salesCount = await getShiftSalesCount(restaurantId!, currentShift!.opened_at)
      const vouchers = await getShiftVouchersTotal(restaurantId!, currentShift!.opened_at)
      const reconciliation: ShiftReconciliation = {
        ...params.reconciliation,
        sales_count: salesCount,
        vouchers_total: vouchers,
      }
      const { data, error } = await closeShiftHelper(currentShift!.id, {
        closing_amount: params.closingAmount,
        expected_amount: params.expectedAmount,
        difference: params.difference,
        closed_by: profile!.id,
        closed_at: new Date().toISOString(),
        close_reconciliation: reconciliation as unknown as Json,
        close_comment: params.comment.trim() || null,
      })
      if (error) throw error
      // Fila cerrada con joins (abrió/cerró) + snapshot + closed_at real del
      // servidor → insumo del comprobante, idéntico a la reimpresión del historial.
      return data as unknown as ClosedShiftRow
    },
    onSuccess: () => { invalidateShift(); toast.success('Turno cerrado correctamente') },
    onError: () => toast.error('Error al cerrar el turno'),
  })

  const addMovementMutation = useMutation({
    mutationFn: async (
      movement: Pick<TablesInsert<'cash_movements'>, 'type' | 'amount' | 'reason'>,
    ) => {
      const { data, error } = await createCashMovement({
        ...movement,
        shift_id: currentShift!.id,
        restaurant_id: restaurantId!,
        created_by: profile!.id,
      })
      if (error) throw error
      return data!
    },
    onSuccess: (_, vars) => {
      invalidateMovements()
      invalidateSales()
      toast.success(vars.type === 'in' ? 'Ingreso registrado' : 'Egreso registrado')
    },
    onError: () => toast.error('Error al registrar movimiento'),
  })

  const channelRef = useRef<RealtimeChannel | null>(null)

  // Realtime: invalida salesSummary cuando se inserta un pago en este restaurante.
  // Nombre único por instancia para evitar que Supabase reutilice un canal ya
  // suscrito y lance "cannot add postgres_changes callbacks after subscribe".
  useEffect(() => {
    if (!restaurantId) return

    const channelName = `shift-payments-${Math.random().toString(36).slice(2)}`

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'payments', filter: `restaurant_id=eq.${restaurantId}` },
        () => queryClient.invalidateQueries({ queryKey: ['shift_payments'] }),
      )
      .subscribe()

    channelRef.current = channel

    return () => {
      channel.unsubscribe()
      supabase.removeChannel(channel)
      channelRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId])

  return {
    currentShift,
    isOpen: !!currentShift,
    isLoadingShift,
    salesSummary,
    movements,
    vouchersTotal,
    refetchSales,
    openShift: openShiftMutation.mutateAsync,
    closeShift: closeShiftMutation.mutateAsync,
    addMovement: addMovementMutation.mutateAsync,
    isOpeningShift: openShiftMutation.isPending,
    isClosingShift: closeShiftMutation.isPending,
    isAddingMovement: addMovementMutation.isPending,
  }
}
