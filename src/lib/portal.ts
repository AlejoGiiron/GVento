// Pedidos en línea (P1): la forma de la configuración del portal y lo que se puede escribir.
// Módulo PURO (sin Supabase): lo importan el hook, la pantalla y los specs.
// La base es supabase/portal-config.sql; lo que se valida acá es para avisar antes de guardar,
// la última palabra la tienen los CHECK y las RPC del servidor.

export type ZonaTipo = 'radio' | 'poligono'
export type EnvioTipo = 'fijo' | 'distancia'
/** [lat, lng] */
export type Punto = [number, number]
export interface TramoEnvio { hasta_km: number | null; valor: number }
/** Día ISO ('1' = lunes … '7' = domingo) → franjas [abre, cierra] en "HH:MM", hora de Bogotá. */
export type Horario = Partial<Record<DiaIso, [string, string][]>>
export type DiaIso = '1' | '2' | '3' | '4' | '5' | '6' | '7'

/** Las columnas editables de portal_sedes (lo que devuelve portal_config().portal). */
export interface PortalSede {
  slug: string
  activo: boolean
  pausado: boolean
  pausado_en: string | null
  lat: number | null
  lng: number | null
  zona_tipo: ZonaTipo | null
  zona_radio_m: number | null
  zona_poligono: Punto[] | null
  envio_tipo: EnvioTipo | null
  envio_fijo: number | null
  envio_tramos: TramoEnvio[] | null
  pedido_minimo: number
  tiempo_min: number | null
  tiempo_max: number | null
  horario: Horario
  color: string | null
  /** 57 + 10 dígitos (CHECK portal_sedes_whatsapp). */
  whatsapp: string | null
  created_at: string
  updated_at: string
}

export type MotivoEstado =
  | 'sin_configurar' | 'desactivado' | 'incompleto' | 'pausado' | 'fuera_de_horario' | 'sin_turno'

export interface EstadoPortal {
  recibe: boolean
  motivo: MotivoEstado | null
  faltantes: string[]
}

export interface PortalConfigRespuesta {
  portal: PortalSede | null
  estado: EstadoPortal
}

export interface ProductoPortal {
  product_id: string
  nombre: string
  categoria: string | null
  precio_local: number
  precio_domicilio: number | null
  publicado: boolean
  agotado: boolean
}

export interface CambioProducto {
  product_id: string
  publicado: boolean
  precio_domicilio: number | null
}

/** Lo que se le puede mandar a actualizar_portal. `null` borra el valor (salvo los obligatorios). */
export type PortalCambios = Partial<Pick<PortalSede,
  | 'slug' | 'activo' | 'lat' | 'lng' | 'zona_tipo' | 'zona_radio_m' | 'zona_poligono'
  | 'envio_tipo' | 'envio_fijo' | 'envio_tramos' | 'pedido_minimo' | 'tiempo_min' | 'tiempo_max'
  | 'horario' | 'color' | 'whatsapp'>>

/**
 * 🔴 CONTRATO DE DOS LADOS (R1): las claves que actualizar_portal acepta (c_claves en
 * supabase/portal-config.sql). El compilador ata esta lista a PortalCambios (una clave en el tipo
 * y no acá, no compila) y tests/portal-config.spec.ts escribe cada una por la RPC: si falta en el
 * SQL, el test se pone rojo.
 */
export const CLAVES_PORTAL = [
  'slug', 'activo', 'lat', 'lng', 'zona_tipo', 'zona_radio_m', 'zona_poligono',
  'envio_tipo', 'envio_fijo', 'envio_tramos', 'pedido_minimo', 'tiempo_min', 'tiempo_max',
  'horario', 'color', 'whatsapp',
] as const satisfies readonly (keyof PortalCambios)[]
type ClavesFaltantes = Exclude<keyof PortalCambios, (typeof CLAVES_PORTAL)[number]>
const _todasLasClaves: [ClavesFaltantes] extends [never] ? true : ClavesFaltantes = true
void _todasLasClaves

// ── Link ──

/** El dominio del portal (P0.3). */
export const DOMINIO_PORTAL = 'pedir.gvento.online'

/** El mismo formato que el CHECK portal_sedes_slug_formato: 3 a 40, a-z 0-9 y guiones internos. */
export const RE_SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/

/** Lo que el usuario escribe → candidato a link: minúsculas, sin tildes, espacios a guiones. */
export function normalizarSlug(texto: string): string {
  return texto
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ñ/g, 'n')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+/, '')
    .slice(0, 40)
}

export const slugValido = (s: string) => RE_SLUG.test(s)
export const urlPortal = (slug: string) => `https://${DOMINIO_PORTAL}/${slug}`

// ── Horario ──

export const DIAS: { iso: DiaIso; nombre: string }[] = [
  { iso: '1', nombre: 'Lunes' }, { iso: '2', nombre: 'Martes' }, { iso: '3', nombre: 'Miércoles' },
  { iso: '4', nombre: 'Jueves' }, { iso: '5', nombre: 'Viernes' }, { iso: '6', nombre: 'Sábado' },
  { iso: '7', nombre: 'Domingo' },
]

const RE_HORA = /^([01]\d|2[0-3]):[0-5]\d$/
export const horaValida = (h: string) => RE_HORA.test(h)

/** "17:00" → "5:00 p. m.", "00:00" → "12:00 a. m." (como en la pantalla 4). */
export function horaLegible(h: string): string {
  const [hh, mm] = h.split(':').map(Number)
  const sufijo = hh < 12 ? 'a. m.' : 'p. m.'
  const h12 = hh % 12 === 0 ? 12 : hh % 12
  return `${h12}:${String(mm).padStart(2, '0')} ${sufijo}`
}

export function franjasLegibles(franjas: [string, string][] | undefined): string {
  if (!franjas || franjas.length === 0) return 'Cerrado'
  return franjas.map(([a, c]) => `${horaLegible(a)} – ${horaLegible(c)}`).join(', ')
}

/**
 * Agrupa días seguidos con las mismas franjas, como la pantalla 4:
 * "Miércoles a viernes · 5:00 p. m. – 11:30 p. m.", "Sábado y domingo · …".
 */
export function horarioAgrupado(h: Horario): { dias: string; horas: string }[] {
  const grupos: { desde: number; hasta: number; horas: string }[] = []
  DIAS.forEach((d, i) => {
    const horas = franjasLegibles(h[d.iso])
    const ultimo = grupos[grupos.length - 1]
    if (ultimo && ultimo.horas === horas && ultimo.hasta === i - 1) ultimo.hasta = i
    else grupos.push({ desde: i, hasta: i, horas })
  })
  return grupos.map(({ desde, hasta, horas }) => {
    const a = DIAS[desde].nombre
    const b = DIAS[hasta].nombre.toLowerCase()
    const dias = desde === hasta ? a : hasta === desde + 1 ? `${a} y ${b}` : `${a} a ${b}`
    return { dias, horas }
  })
}

/** Problema del horario que el servidor rechazaría (null = está bien). */
export function problemaHorario(h: Horario): string | null {
  for (const d of DIAS) {
    const franjas = h[d.iso] ?? []
    if (franjas.length > 3) return `${d.nombre}: hasta 3 franjas por día`
    for (const [a, c] of franjas) {
      if (!horaValida(a) || !horaValida(c)) return `${d.nombre}: escribe las horas como HH:MM`
      if (a === c) return `${d.nombre}: la hora de abrir y la de cerrar no pueden ser iguales`
    }
  }
  return null
}

export const horarioTieneFranjas = (h: Horario) => DIAS.some((d) => (h[d.iso]?.length ?? 0) > 0)

// ── Envío ──

/** Problema de los tramos que el servidor rechazaría (null = están bien). */
export function problemaTramos(t: TramoEnvio[]): string | null {
  if (t.length < 1 || t.length > 10) return 'Pon de 1 a 10 tramos'
  let previo = 0
  for (let i = 0; i < t.length; i++) {
    const { hasta_km, valor } = t[i]
    if (!Number.isFinite(valor) || valor < 0 || valor > 1_000_000) return `Tramo ${i + 1}: el valor no es válido`
    if (i < t.length - 1) {
      if (hasta_km === null || !Number.isFinite(hasta_km)) return `Tramo ${i + 1}: falta hasta cuántos km`
      if (hasta_km <= previo || hasta_km > 100) return 'Los km tienen que ir de menor a mayor (hasta 100)'
      previo = hasta_km
    } else if (hasta_km !== null) {
      return 'El último tramo es "más de X km, dentro de la zona" (sin límite)'
    }
  }
  return null
}

/** "Hasta 2 km", "2 a 4 km", "Más de 4 km, dentro de la zona" (como la pantalla 4). */
export function etiquetaTramo(t: TramoEnvio[], i: number): string {
  const anterior = i > 0 ? t[i - 1].hasta_km : null
  const actual = t[i].hasta_km
  const km = (n: number) => String(n).replace('.', ',')
  if (actual === null) return anterior === null ? 'Cualquier distancia dentro de la zona' : `Más de ${km(anterior)} km, dentro de la zona`
  return anterior === null ? `Hasta ${km(actual)} km` : `${km(anterior)} a ${km(actual)} km`
}

// ── Estado ──

/** El texto de la tarjeta de estado. El estado lo decide el servidor (portal_estado). */
export function textoEstado(e: EstadoPortal): { titulo: string; detalle: string; tono: 'ok' | 'pausa' | 'apagado' } {
  switch (e.motivo) {
    case null: return { titulo: 'Recibiendo pedidos', detalle: 'El portal está abierto y acepta pedidos.', tono: 'ok' }
    case 'sin_configurar': return { titulo: 'Sin configurar', detalle: 'Elige el link de tu portal para empezar.', tono: 'apagado' }
    case 'desactivado': return { titulo: 'Portal sin publicar', detalle: 'Los clientes todavía no pueden ver tu portal.', tono: 'apagado' }
    case 'incompleto': return { titulo: 'Falta configuración', detalle: `Falta: ${e.faltantes.join('; ')}.`, tono: 'apagado' }
    case 'pausado': return { titulo: 'Pedidos pausados', detalle: 'El portal muestra el menú pero no recibe pedidos.', tono: 'pausa' }
    case 'fuera_de_horario': return { titulo: 'Fuera del horario', detalle: 'El portal muestra el menú con el aviso de cerrado.', tono: 'pausa' }
    case 'sin_turno': return { titulo: 'Sin turno abierto', detalle: 'El portal recibe pedidos solo con el turno de caja abierto.', tono: 'pausa' }
  }
}

/** Verde de G-Vento: el color del portal cuando la sede no elige uno. */
export const COLOR_PORTAL_POR_DEFECTO = '#047857'
export const RE_COLOR = /^#[0-9a-f]{6}$/

// ── WhatsApp del local ──

/** El mismo formato que el CHECK portal_sedes_whatsapp: 57 + 10 dígitos. */
export const RE_WHATSAPP = /^57\d{10}$/

/**
 * Lo que se escribe (o el teléfono de la sede) → 57 + 10 dígitos, o null si no se puede.
 * "300 123 4567" → "573001234567"; "+57 300 123 4567" → "573001234567"; "601 234 5678" → "576012345678".
 */
export function normalizarWhatsapp(texto: string | null | undefined): string | null {
  const d = (texto ?? '').replace(/\D/g, '')
  if (d.length === 10) return `57${d}`
  if (d.length === 12 && d.startsWith('57')) return d
  return null
}

/** "573001234567" → "300 123 4567" (para mostrar en el campo). */
export function mostrarWhatsapp(w: string | null): string {
  if (!w || !RE_WHATSAPP.test(w)) return ''
  const n = w.slice(2)
  return `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`
}

// ── Pesos ──

const COP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0 })
export const pesos = (n: number) => COP.format(n)
/** Lo que se escribe en un campo de pesos → número (solo dígitos). '' → null. */
export function leerPesos(texto: string): number | null {
  const d = texto.replace(/\D/g, '')
  return d === '' ? null : Number(d)
}
/** Número → texto del campo: "15.000" (sin el signo, para editar cómodo). */
export const mostrarPesos = (n: number | null | undefined) =>
  n === null || n === undefined ? '' : new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(n)
