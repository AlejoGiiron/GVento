/**
 * El mensaje de un error, para mostrárselo al usuario.
 *
 * Los errores de Supabase (PostgrestError) NO son `instanceof Error`. El patrón
 * `err instanceof Error ? err.message : 'Error genérico'` tiraba el mensaje del
 * servidor y mostraba el genérico. Medido el 2026-09-30: un abono en efectivo
 * sin turno, rechazado con "No hay un turno de caja abierto…", se veía como
 * "Error al registrar el abono".
 */
export function mensajeDeError(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message
  const m = (err as { message?: unknown } | null)?.message
  return typeof m === 'string' && m ? m : fallback
}
