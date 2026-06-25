import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import {
  getDebts, getDebtPayments, registerDebtPayment,
  type DebtRow, type DebtPaymentRow, type RegisterDebtPaymentResult,
} from '@/lib/supabase-helpers'
import { useAuth } from '@/hooks/useAuth'

export type { DebtPaymentRow }

/** Una deuda a fiado con su saldo ya derivado. */
export interface Debt {
  id: string
  order_number: number | null
  created_at: string
  total: number
  abonado: number
  saldo: number
  payment_status: string             // 'pending' | 'partial'
  customerName: string
}

const deriveDebt = (row: DebtRow): Debt => {
  const abonado = (row.debt_payments ?? []).reduce((s, p) => s + p.amount, 0)
  return {
    id: row.id,
    order_number: row.order_number,
    created_at: row.created_at,
    total: row.total,
    abonado,
    saldo: Math.max(0, row.total - abonado),
    payment_status: row.payment_status,
    customerName: row.customers?.name ?? row.customer_name ?? 'Cliente',
  }
}

/** Cuentas por cobrar: órdenes a fiado pendientes/parciales con su saldo. */
export function useDebts() {
  const { profile } = useAuth()
  const restaurantId = profile?.restaurant_id ?? null

  const query = useQuery({
    queryKey: ['debts', restaurantId],
    queryFn: async () => {
      const { data, error } = await getDebts(restaurantId!)
      if (error) throw error
      return (data ?? []).map((r) => deriveDebt(r as unknown as DebtRow))
    },
    enabled: !!restaurantId,
    staleTime: 15_000,
  })

  return {
    debts: query.data ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
  }
}

/** Historial de abonos de una orden a fiado. */
export function useDebtPayments(orderId: string | null) {
  const query = useQuery({
    queryKey: ['debt_payments', orderId],
    queryFn: async () => {
      const { data, error } = await getDebtPayments(orderId!)
      if (error) throw error
      return (data ?? []) as unknown as DebtPaymentRow[]
    },
    enabled: !!orderId,
    staleTime: 15_000,
  })

  return { payments: query.data ?? [], isLoading: query.isLoading }
}

/**
 * Registra un abono vía la RPC register_debt_payment (atómica). Tras el éxito
 * invalida cuentas por cobrar, la orden, el historial de abonos y la caja
 * (movimientos + ventas del turno), para que el ingreso y el nuevo saldo se
 * reflejen sin recargar.
 *
 * Toasts inequívocos según el retorno: el abono SIEMPRE quedó registrado; el
 * matiz es si la deuda se saldó y si el efectivo entró a la caja.
 */
export function useRegisterDebtPayment() {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: async (
      { orderId, amount, paymentMethod }: { orderId: string; amount: number; paymentMethod: string },
    ) => {
      const { data, error } = await registerDebtPayment(orderId, amount, paymentMethod)
      if (error) throw error
      return data as unknown as RegisterDebtPaymentResult
    },
    onSuccess: (result, { paymentMethod }) => {
      queryClient.invalidateQueries({ queryKey: ['debts'] })
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      queryClient.invalidateQueries({ queryKey: ['debt_payments'] })
      queryClient.invalidateQueries({ queryKey: ['cash_movements'] })
      queryClient.invalidateQueries({ queryKey: ['shift_payments'] })

      const saldoCOP = new Intl.NumberFormat('es-CO', {
        style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0,
      }).format(result.saldo_restante)

      if (paymentMethod === 'cash' && !result.shift_open) {
        // Inequívoco: el abono SÍ quedó; lo único que NO pasó es el ingreso de
        // caja (no hay turno al cual atribuirlo).
        toast(
          'Abono registrado. El efectivo no entró a caja (sin turno abierto).',
          { icon: '⚠️', duration: 7000 },
        )
      } else if (result.new_status === 'paid') {
        const extra = result.cash_movement_created ? ' · Ingreso de caja registrado.' : ''
        toast.success(`Deuda saldada.${extra}`)
      } else {
        const extra = result.cash_movement_created ? ' · Entró a caja.' : ''
        toast.success(`Abono registrado · saldo: ${saldoCOP}${extra}`)
      }
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Error al registrar el abono'),
  })

  return { registerDebtPayment: mutation.mutateAsync, isRegistering: mutation.isPending }
}
