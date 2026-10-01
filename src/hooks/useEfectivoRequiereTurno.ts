import { useCashShift } from '@/hooks/useCashShift'

/**
 * Recibir EFECTIVO exige turno de caja abierto (decidido 2026-09-30): sin turno,
 * la plata quedaba fuera de todo arqueo. Medido en prod: Salchimelo, 2 abonos
 * por $48.000 el 31/08 que ningún arqueo contó.
 *
 * La UI lo dice ANTES de que el cajero reciba la plata, no con un error después
 * de confirmar. El servidor igual lo rechaza (register_debt_payment /
 * register_debt_payments_batch en supabase/cobro-turno.sql): la UI no es la barrera.
 *
 * Estados, distintos a propósito: mientras el turno CARGA no se afirma "no hay
 * turno" (cargando ≠ vacío): se bloquea en silencio con un indicador.
 */
export function useEfectivoRequiereTurno(metodo: string): {
  bloquea: boolean
  estado: 'no-aplica' | 'cargando' | 'sin-turno' | 'ok'
} {
  const { currentShift, isLoadingShift } = useCashShift()
  if (metodo !== 'cash') return { bloquea: false, estado: 'no-aplica' }
  if (isLoadingShift) return { bloquea: true, estado: 'cargando' }
  if (!currentShift) return { bloquea: true, estado: 'sin-turno' }
  return { bloquea: false, estado: 'ok' }
}
