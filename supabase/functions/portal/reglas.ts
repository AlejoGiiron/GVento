// ============================================================
// Reglas PURAS de la Edge Function `portal` (sin Deno, sin red): las prueba
// supabase/functions/portal/reglas.test.ts con Vitest, y index.ts las usa tal cual.
// ============================================================

/**
 * ALLOWLIST de acciones, con las claves exactas que acepta cada una y su límite por IP
 * (consultas por minuto). Lo que no está aquí no existe para el portal.
 * Los límites son holgados a propósito: los operadores móviles comparten una IP pública
 * entre muchos clientes (CGNAT), así que varios clientes reales pueden llegar con la misma.
 */
export const ACCIONES = {
  catalogo: { claves: ['accion', 'slug'], porMinuto: 120, rpc: 'portal_catalogo' },
  cotizar: { claves: ['accion', 'slug', 'items', 'lat', 'lng'], porMinuto: 60, rpc: 'portal_cotizar' },
} as const
export type Accion = keyof typeof ACCIONES

/**
 * Límite GLOBAL para todas las consultas que llegan sin IP, de cualquier acción (un solo balde,
 * `global:sin-ip`): no se dejan pasar sin límite.
 */
export const SIN_IP_POR_MINUTO = 600
export const MAX_CUERPO_BYTES = 16 * 1024

/**
 * El SQLSTATE PROPIO de portal_calcular para la forma inválida (PostgREST lo devuelve como 400).
 * Es el ÚNICO error cuyo mensaje llega a la pantalla (allowlist): un 22023 genérico de Postgres no.
 */
export const ERROR_DE_FORMA = 'PT400'

/**
 * La IP del cliente. Medido en prod el 2026-10-15 por Alejandro, con una función de prueba que solo
 * devolvía los encabezados (diag-encabezados, ya borrada), llamada con curl desde un PC:
 *   · cf-connecting-ip = la IP pública del PC (la misma que devolvía api.ipify.org);
 *   · x-forwarded-for = "<esa IP>,<esa IP>, <una IP de la plataforma>";
 *   · con `-H "X-Forwarded-For: 1.2.3.4" -H "X-Real-IP: 1.2.3.4"`: los dos ignorados (cf-connecting-ip
 *     y x-forwarded-for siguieron con la real; x-real-ip null);
 *   · con `-H "CF-Connecting-IP: …"` desde el cliente: Cloudflare lo rechaza (error 1000).
 * (La prueba desde un celular con datos móviles no se hizo.)
 * Regla decidida con eso: cf-connecting-ip; respaldo, el primer valor de x-forwarded-for solo si
 * cf-connecting-ip viene vacío; null = ninguna de las dos (balde global, SIN_IP_POR_MINUTO).
 */
export function ipDelCliente(h: Headers): string | null {
  const cf = h.get('cf-connecting-ip')?.trim()
  if (cf) return cf.slice(0, 100)
  const xff = h.get('x-forwarded-for')?.split(',')[0]?.trim()
  if (xff) return xff.slice(0, 100)
  return null
}

/**
 * ¿Este origen puede llamar desde un navegador? Allowlist exacta (PORTAL_ORIGENES) más, si se
 * configura, las vistas previas de Vercel del proyecto: `https://g-vento-<algo><sufijo>`.
 */
export function origenPermitido(origen: string, lista: readonly string[], sufijoPreview: string | null): boolean {
  if (lista.includes(origen)) return true
  if (!sufijoPreview) return false
  if (!origen.startsWith('https://g-vento-') || !origen.endsWith(sufijoPreview)) return false
  const medio = origen.slice('https://g-vento-'.length, origen.length - sufijoPreview.length)
  return /^[a-z0-9-]{1,80}$/.test(medio)
}

export const ORIGENES_POR_DEFECTO = ['https://pedir.gvento.online', 'https://g-vento.vercel.app'] as const

export function leerOrigenes(env: string | undefined): string[] {
  const lista = (env ?? '').split(',').map((o) => o.trim()).filter(Boolean)
  return lista.length > 0 ? lista : [...ORIGENES_POR_DEFECTO]
}

export type Cuerpo =
  | { ok: true; accion: Accion; params: Record<string, unknown> }
  | { ok: false; error: string }

const esNumeroONulo = (v: unknown) => v === null || v === undefined || (typeof v === 'number' && Number.isFinite(v))

/**
 * La forma del cuerpo (allowlist de claves por acción). Lo de adentro de `items` lo valida el
 * servidor (portal_calcular), que es el único que sabe de productos y precios: aquí solo se
 * exige que sea una lista. Devuelve los parámetros de la función de la base.
 */
export function validarCuerpo(texto: string): Cuerpo {
  let b: unknown
  try { b = JSON.parse(texto) } catch { return { ok: false, error: 'El cuerpo no es JSON.' } }
  if (typeof b !== 'object' || b === null || Array.isArray(b)) return { ok: false, error: 'El cuerpo tiene que ser un objeto.' }
  const o = b as Record<string, unknown>
  const accion = o.accion
  if (typeof accion !== 'string' || !Object.prototype.hasOwnProperty.call(ACCIONES, accion)) return { ok: false, error: 'Acción desconocida.' }
  const a = accion as Accion
  const permitidas: readonly string[] = ACCIONES[a].claves
  const ajenas = Object.keys(o).filter((k) => !permitidas.includes(k))
  if (ajenas.length > 0) return { ok: false, error: `Clave no permitida: ${ajenas.sort().join(', ')}.` }
  if (typeof o.slug !== 'string' || o.slug.length < 1 || o.slug.length > 40) return { ok: false, error: 'Falta el negocio.' }
  if (a === 'catalogo') return { ok: true, accion: a, params: { p_slug: o.slug } }

  if (!Array.isArray(o.items)) return { ok: false, error: 'Faltan los productos.' }
  if (!esNumeroONulo(o.lat) || !esNumeroONulo(o.lng)) return { ok: false, error: 'La ubicación no es válida.' }
  return { ok: true, accion: a, params: { p_slug: o.slug, p_items: o.items, p_lat: o.lat ?? null, p_lng: o.lng ?? null } }
}

/** El día en Bogotá (R7): la sal del hash cambia a la medianoche de Colombia. */
export function diaBogota(fecha: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(fecha)
}

/**
 * La clave del contador: `<acción>:` + HMAC-SHA256(PORTAL_SAL, día de Bogotá + IP) en hex, o
 * `global:sin-ip` (un solo balde para todo lo que llega sin IP). La IP nunca sale de esta función:
 * la base solo ve el hash, y su CHECK portal_limites_clave rechaza cualquier otra forma.
 * Con el día dentro, el mismo cliente da otro hash cada día. Sin PORTAL_SAL no se revierte; si la
 * sal se filtrara, sí (probando las IPv4): lo acota que las filas se purgan a las 24 h.
 */
export async function claveLimite(accion: Accion, ip: string | null, sal: string, fecha: Date): Promise<string> {
  if (ip === null) return 'global:sin-ip'
  const enc = new TextEncoder()
  const llave = await crypto.subtle.importKey('raw', enc.encode(sal), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const firma = await crypto.subtle.sign('HMAC', llave, enc.encode(`${diaBogota(fecha)}|${ip}`))
  return `${accion}:${[...new Uint8Array(firma)].map((x) => x.toString(16).padStart(2, '0')).join('')}`
}

/** Segundos hasta que empieza el minuto siguiente (la ventana del contador). */
export function segundosParaReintentar(fecha: Date): number {
  return 60 - fecha.getUTCSeconds()
}
