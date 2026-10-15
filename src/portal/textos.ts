import type { EstadoPublico } from './api'

/** Pesos colombianos, sin decimales (los precios vienen del servidor). */
export const pesos = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n)

/** Día y hora en Bogotá (R7): "lunes, 10:00 a. m.". */
export const horaBogota = (iso: string) =>
  new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', weekday: 'long', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))

/** Lo que ve el cliente del estado del negocio. El estado lo decide el servidor (portal_estado). */
export function textoEstado(e: EstadoPublico): string {
  if (e.recibe) return 'Recibiendo pedidos'
  if (e.motivo === 'pausado') return 'Pausamos los pedidos por un momento'
  if (e.motivo === 'fuera_de_horario') return e.abre_en ? `Cerrado · abrimos el ${horaBogota(e.abre_en)}` : 'Cerrado por ahora'
  if (e.motivo === 'sin_turno') return 'Todavía no abrimos: vuelve en un rato'
  return 'No estamos recibiendo pedidos'
}
