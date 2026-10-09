import type { MetodoDeLaVenta, MetodoPago } from '@/lib/metodoVenta'

// ── El cierre de una mesa, según el SERVIDOR ─────────────────────────────────
// close_table_sale (supabase/mesas-servidor.sql) devuelve la venta (la misma forma
// que register_pos_sale: número, total, métodos REALES, fiado, cliente) más quién
// la cobró, a qué hora, y si la cerró OTRO cobro (otra clave: otro equipo, o el
// mismo cajero desde otra pestaña). Con otro_cobro la pantalla NO presenta esa
// venta como propia: dice quién la cobró, cuándo y con qué.

export interface CierreMesa extends MetodoDeLaVenta {
  order_id: string
  order_number: number | null
  ya_existia: boolean
  otro_cobro: boolean
  cobrada_por: string | null
  cobrada_at: string | null
  mesa: string | null
}

const EN_FRASE: Record<MetodoPago, string> = {
  cash: 'efectivo', card: 'tarjeta', transfer: 'transferencia', nequi: 'Nequi',
}

const HORA = new Intl.DateTimeFormat('es-CO', {
  timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hour12: false,
})

/** "21:40", en hora de Bogotá (R7). */
export function horaBogota(iso: string): string {
  return HORA.format(new Date(iso))
}

function lista(xs: string[]): string {
  return xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`
}

/** "con efectivo", "con efectivo y Nequi", "a fiado a nombre de Ana", "sin cobro (total $0)". */
export function comoSeCobro(c: CierreMesa): string {
  if (c.fiado) return c.cliente ? `a fiado a nombre de ${c.cliente}` : 'a fiado'
  const metodos = c.metodos ?? []
  if (metodos.length) return `con ${lista(metodos.map((m) => EN_FRASE[m] ?? m))}`
  return Number(c.total) === 0 ? 'sin cobro (total $0)' : 'sin pagos registrados'
}

/** "Esta mesa ya la cobró Ana a las 21:40 con efectivo." */
export function mensajeOtroCobro(c: CierreMesa): string {
  const quien = c.cobrada_por ?? 'otro usuario'
  const cuando = c.cobrada_at ? ` a las ${horaBogota(c.cobrada_at)}` : ''
  return `Esta mesa ya la cobró ${quien}${cuando} ${comoSeCobro(c)}.`
}
