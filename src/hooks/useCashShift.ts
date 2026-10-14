import { useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import {
  getOpenShift,
  openShift as openShiftHelper,
  closeShiftServidor,
  getClosedShiftRow,
  type DeclaradoCierre,
  type CierreServidor,
  getShiftPayments,
  getShiftVouchersTotal,
  getCashMovements,
  getAbonoMovementIds,
  getShiftMovementTotals,
  createCashMovement,
  type ClosedShiftRow,
} from '@/lib/supabase-helpers'
import type { SentryArea } from '@/lib/sentry'
import type { Tables, TablesInsert } from '@/types/database.types'

export interface ShiftSalesSummary {
  cash: number
  card: number
  transfer: number
  nequi: number
  total: number
}

export type CashMovement = Tables<'cash_movements'>

const SIN_ABONOS: ReadonlySet<string> = new Set()

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

  const { data: movements = [], isLoading: isLoadingMovements } = useQuery({
    queryKey: ['cash_movements', currentShift?.id],
    queryFn: async () => {
      const { data, error } = await getCashMovements(currentShift!.id)
      if (error) throw error
      return data ?? []
    },
    enabled: !!currentShift?.id,
  })

  // Cuáles ingresos del turno son abonos de fiado en efectivo (por el vínculo
  // debt_payments.cash_movement_id). Solo para MOSTRARLOS aparte de los ingresos
  // manuales: el esperado usa el total de ingresos y no cambia. Si la lectura falla,
  // el conjunto queda vacío y se ven como manuales, que es lo de antes.
  const idsIngresos = movements.filter((m) => m.type === 'in').map((m) => m.id)
  const { data: abonoMovementIds = SIN_ABONOS } = useQuery({
    queryKey: ['shift_abono_movs', currentShift?.id, idsIngresos.join(',')],
    queryFn: () => getAbonoMovementIds(idsIngresos),
    enabled: !!currentShift?.id && idsIngresos.length > 0,
  })

  // Vales (ruletazo) del turno — INFORMATIVO (no entra al cuadre). Para mostrar
  // en el cierre; el snapshot lo recongela en la mutación al cerrar.
  const { data: vouchersTotal = 0 } = useQuery({
    queryKey: ['shift_vouchers', currentShift?.id],
    queryFn: () => getShiftVouchersTotal(restaurantId!, currentShift!.opened_at),
    enabled: !!currentShift?.id,
    refetchInterval: 5_000,
  })

  // Abonos de fiado NO en efectivo de este turno, por método (debt_payments.shift_id, que
  // pone la función del abono: supabase/arqueo-abonos.sql). Entran al esperado de su método
  // en el arqueo; el efectivo no, porque ya es un ingreso de caja.
  const { data: abonosSummary = null } = useQuery({
    queryKey: ['shift_abonos', currentShift?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('debt_payments')
        .select('payment_method, amount')
        .eq('shift_id', currentShift!.id)
        .neq('payment_method', 'cash')
      if (error) throw error
      const suma = (m: string) => (data ?? []).filter((d) => d.payment_method === m).reduce((s, d) => s + Number(d.amount), 0)
      return { card: suma('card'), transfer: suma('transfer'), nequi: suma('nequi') }
    },
    enabled: !!currentShift?.id,
    refetchInterval: 5_000,
  })

  const invalidateShift = () =>
    queryClient.invalidateQueries({ queryKey: ['cash_shift_open', restaurantId] })

  const invalidateMovements = () =>
    queryClient.invalidateQueries({ queryKey: ['cash_movements', currentShift?.id] })

  const invalidateSales = () =>
    queryClient.invalidateQueries({ queryKey: ['shift_payments', currentShift?.id] })

  // `meta.area` alimenta el reporte central de errores de mutación (App.tsx).
  // Los modales de caja capturan con `catch {}` porque el toast lo muestra este
  // hook — sin esto, el objeto de error se perdía y "Error al cerrar el turno"
  // era todo el diagnóstico disponible.
  const openShiftMutation = useMutation({
    meta: { area: 'caja' satisfies SentryArea },
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
    meta: { area: 'caja' satisfies SentryArea },
    mutationFn: async (params: { declarado: DeclaradoCierre; comment: string }) => {
      // El servidor calcula el esperado, sales_count y vouchers_total y congela
      // el arqueo (close_cash_shift). Acá solo viaja lo DECLARADO.
      const { data: cierre, error } = await closeShiftServidor(currentShift!.id, params.declarado, params.comment)
      if (error) throw error
      const resumen = cierre as unknown as CierreServidor
      // Fila cerrada con joins (abrió/cerró) + snapshot del servidor → insumo del
      // comprobante, idéntico a la reimpresión del historial.
      const { data: fila, error: e2 } = await getClosedShiftRow(resumen.id)
      if (e2) throw e2
      // Qué parte de los ingresos son abonos en efectivo, para el comprobante. Mismo helper
      // que la reimpresión del historial. Si falla, 0: el turno YA está cerrado y el
      // comprobante solo los muestra como ingresos manuales (como antes); no es un error.
      const abonosEfectivo = await getShiftMovementTotals(resumen.id)
        .then((t) => t.abonosEfectivo, () => 0)
      return {
        fila: fila as unknown as ClosedShiftRow,
        movementsIn: resumen.movements_in, movementsOut: resumen.movements_out, abonosEfectivo,
      }
    },
    onSuccess: () => { invalidateShift(); toast.success('Turno cerrado correctamente') },
    onError: () => toast.error('Error al cerrar el turno'),
  })

  const addMovementMutation = useMutation({
    meta: { area: 'caja' satisfies SentryArea },
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
    /** `movements` vale [] mientras carga: "sin movimientos" solo es cierto con esto en false. */
    isLoadingMovements,
    salesSummary,
    abonosSummary,
    movements,
    /** Ids de los ingresos de `movements` que son abonos de fiado en efectivo. */
    abonoMovementIds,
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
