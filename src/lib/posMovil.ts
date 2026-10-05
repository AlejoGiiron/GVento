// ============================================================================
// POS móvil (/m): configuración, detección de celular y quién puede cobrar.
// UNA fuente para los dos lados que usan esto: la pantalla de Configuración
// (escribe restaurants.config.pos_movil) y /m (lo lee).
// ============================================================================

import type { Database } from '@/types/database.types'

/** restaurants.config.pos_movil */
export interface PosMovilConfig {
  /** Productos fijados arriba de todo, en este orden (por id, nunca por nombre). */
  fijados: string[]
  /** Más vendidos automáticos (product_performance): cuántos y de cuántos días. */
  mas_vendidos: { cantidad: number; dias: number }
}

export const POS_MOVIL_DEFAULT: PosMovilConfig = {
  fijados: [],
  mas_vendidos: { cantidad: 8, dias: 30 },
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const entero = (v: unknown, min: number, max: number, porDefecto: number): number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : porDefecto

/**
 * Lee la config guardada CAMPO POR CAMPO: lo que falta o vino mal toma el valor
 * por defecto, sin tirar el resto. Un id que no es UUID se descarta (no se
 * resuelve por nombre).
 */
export function leerPosMovil(raw: unknown): PosMovilConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const mv = (r.mas_vendidos && typeof r.mas_vendidos === 'object' ? r.mas_vendidos : {}) as Record<string, unknown>
  const fijados = Array.isArray(r.fijados)
    ? [...new Set(r.fijados.filter((x): x is string => typeof x === 'string' && UUID.test(x)))]
    : POS_MOVIL_DEFAULT.fijados
  return {
    fijados,
    mas_vendidos: {
      cantidad: entero(mv.cantidad, 0, 24, POS_MOVIL_DEFAULT.mas_vendidos.cantidad),
      dias: entero(mv.dias, 1, 90, POS_MOVIL_DEFAULT.mas_vendidos.dias),
    },
  }
}

// ── Quién cobra ─────────────────────────────────────────────────────────────
// 🔴 CONTRATO DE DOS LADOS (R1): register_pos_sale y register_sale_payment
// aceptan `get_my_role() in ('admin', 'cashier')` (supabase/pos-sale-lotes.sql,
// supabase/cobro-turno.sql). Si cambia allá, cambia acá: un rol que el servidor
// rechaza no se manda a una pantalla cuyo único fin es cobrar.
type RolLegacy = Database['public']['Enums']['user_role']
export const ROLES_QUE_COBRAN: readonly RolLegacy[] = ['admin', 'cashier']
export const puedeCobrar = (rol: RolLegacy | null | undefined): boolean =>
  !!rol && ROLES_QUE_COBRAN.includes(rol)

// ── Dispositivo ─────────────────────────────────────────────────────────────

/**
 * ¿Es un CELULAR? Pantalla táctil y lado corto < 600 px (en cualquier
 * orientación). Una tablet (Cocina, un iPad en la barra) o una laptop táctil no
 * lo son. No mira el user agent: un iPad moderno se presenta como Mac.
 */
export function esCelular(): boolean {
  if (typeof window === 'undefined') return false
  const tactil = window.matchMedia?.('(pointer: coarse)').matches ?? false
  return tactil && Math.min(window.screen.width, window.screen.height) < 600
}

/** Safari de iPhone/iPad (no Chrome ni Firefox de iOS, que no pueden "Agregar a inicio" igual). */
export function esSafariIOS(): boolean {
  const ua = navigator.userAgent
  return /iP(hone|od|ad)/.test(ua) && /WebKit/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)
}

/** ¿Corre como app instalada (pantalla de inicio)? */
export function estaInstalada(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

/** /m y sus subrutas. OJO: '/mesas' también empieza con '/m'. */
export const esRutaMovil = (path: string): boolean => path === '/m' || path.startsWith('/m/')

// "Versión completa": preferencia POR EQUIPO. Un dueño o cajero que en el celular
// trabaja con Mesas o Reportes la elige UNA vez y queda (antes valía solo para la
// pestaña). Se vuelve a /m desde el escritorio ("Usar la versión para celular").
// Guardado: localStorage → si no anda (bloqueado, modo privado viejo), sessionStorage
// → si tampoco, memoria de la pestaña. Si todo falla, el equipo vuelve a caer en /m:
// molesta, pero no rompe nada y se puede volver a elegir.
const CLAVE_COMPLETA = 'gvento.versionCompleta'
let enMemoria = false
const almacenes = (): Storage[] => {
  const lista: Storage[] = []
  try { lista.push(localStorage) } catch { /* sin localStorage */ }
  try { lista.push(sessionStorage) } catch { /* sin sessionStorage */ }
  return lista
}
export function pidioVersionCompleta(): boolean {
  for (const a of almacenes()) {
    try { if (a.getItem(CLAVE_COMPLETA) === '1') return true } catch { /* siguiente */ }
  }
  return enMemoria
}
export function pedirVersionCompleta(si: boolean): void {
  enMemoria = si
  let guardado = false
  for (const a of almacenes()) {
    try {
      // Al GUARDAR se escribe en el primero que ande; al BORRAR, en todos (si no,
      // un '1' viejo en otro almacén seguiría ganando).
      if (si && !guardado) { a.setItem(CLAVE_COMPLETA, '1'); guardado = true }
      else if (!si) a.removeItem(CLAVE_COMPLETA)
    } catch { /* siguiente */ }
  }
}

// ── Identidad instalable de /m ──────────────────────────────────────────────
// 🔴 MISMOS VALORES que el script del <head> de index.html (que lo hace al
// cargar directo en /m). Acá se hace al ENTRAR navegando (el login lleva a /m
// sin recargar) y se deshace al salir. Idempotente.
const MANIFEST_APP = '/manifest.json'
const MANIFEST_MOVIL = '/movil/manifest.webmanifest'
export function aplicarIdentidadMovil(activa: boolean): void {
  document.querySelector('link[rel="manifest"]')?.setAttribute('href', activa ? MANIFEST_MOVIL : MANIFEST_APP)
  document.querySelectorAll('[data-movil]').forEach((el) => el.remove())
  if (!activa) return
  const icono = document.createElement('link')
  icono.rel = 'apple-touch-icon'; icono.href = '/movil/apple-touch-icon-180.png'; icono.setAttribute('data-movil', '')
  const titulo = document.createElement('meta')
  titulo.name = 'apple-mobile-web-app-title'; titulo.content = 'Vender'; titulo.setAttribute('data-movil', '')
  document.head.append(icono, titulo)
}

/** ¿Hay que mandar a /m a este usuario, en esta ruta, en este equipo? */
export function debeIrAMovil(rol: RolLegacy | null | undefined, path: string): boolean {
  return puedeCobrar(rol) && !esRutaMovil(path) && esCelular() && !pidioVersionCompleta()
}

// ── Lectura de datos (puro: se prueba sin Supabase) ──────────────────────────

const PAGINA = 1000   // = max_rows de PostgREST (supabase/config.toml)

/**
 * Trae TODAS las filas, página por página. PostgREST corta en max_rows SIN
 * avisar: una consulta que pasa de 1000 filas devuelve 1000 y un total
 * plausible y equivocado. Acá se pide hasta que una página venga incompleta.
 */
export async function traerTodo<T>(
  pagina: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const todo: T[] = []
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await pagina(desde, desde + PAGINA - 1)
    if (error) throw error
    todo.push(...(data ?? []))
    if (!data || data.length < PAGINA) return todo
  }
}

/** Fecha de Bogotá (YYYY-MM-DD) desplazada `dias` días. La columna `day` de la vista ya es fecha de Bogotá. */
export function diaBogota(dias = 0, ahora = new Date()): string {
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(ahora)
  const d = new Date(`${hoy}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}
