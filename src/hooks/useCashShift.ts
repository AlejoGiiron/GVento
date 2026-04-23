import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import { useAuth } from '@/hooks/useAuth'
import {
  getOpenShift,
  openShift as openShiftHelper,
  closeShift as closeShiftHelper,
  getShiftPayments,
  getCashMovements,
  createCashMovement,
} from '@/lib/supabase-helpers'
import type { Tables, TablesInsert } from '@/types/database.types'

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

  const { data: salesSummary = null } = useQuery({
    queryKey: ['shift_payments', currentShift?.id],
    queryFn: async () => {
      const { data, error } = await getShiftPayments(
        restaurantId!,
        currentShift!.opened_at,
        new Date().toISOString(),
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
    refetchInterval: 30_000,
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
    mutationFn: async (closingAmount: number) => {
      const { error } = await closeShiftHelper(currentShift!.id, {
        closing_amount: closingAmount,
        closed_by: profile!.id,
        closed_at: new Date().toISOString(),
      })
      if (error) throw error
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

  return {
    currentShift,
    isOpen: !!currentShift,
    isLoadingShift,
    salesSummary,
    movements,
    openShift: openShiftMutation.mutateAsync,
    closeShift: closeShiftMutation.mutateAsync,
    addMovement: addMovementMutation.mutateAsync,
    isOpeningShift: openShiftMutation.isPending,
    isClosingShift: closeShiftMutation.isPending,
    isAddingMovement: addMovementMutation.isPending,
  }
}
