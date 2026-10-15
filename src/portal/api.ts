// ============================================================================
// El portal del cliente habla SOLO con la Edge Function `portal` (la única puerta pública), con
// fetch simple (solo content-type: el preflight de la función no permite más encabezados). Sin
// supabase-js y sin sesión: el cliente del portal no tiene cuenta.
//
// 🔴 CONTRATO R1 #13 a: estos tipos son el lado del navegador de la forma de portal_catalogo y
// portal_cotizar (supabase/portal-publico.sql). Si cambia una clave allá, cambia aquí en la misma
// pasada. El precio nunca se calcula aquí: se muestra el que manda el servidor.
// ============================================================================

export interface EstadoPublico {
  recibe: boolean
  motivo: 'pausado' | 'fuera_de_horario' | 'sin_turno' | null
  abre_en: string | null
}

export interface ExtraCatalogo { id: string; nombre: string; precio: number; agotado: boolean }

export interface ProductoCatalogo {
  id: string
  nombre: string
  descripcion: string | null
  imagen_url: string | null
  precio: number
  agotado: boolean
  extras: ExtraCatalogo[]
}

export interface Catalogo {
  disponible: true
  negocio: { nombre: string; logo_url: string | null; direccion: string | null; color: string | null; whatsapp: string | null; lat: number; lng: number }
  estado: EstadoPublico
  entrega: { tiempo_min: number; tiempo_max: number; pedido_minimo: number; envio_tipo: 'fijo' | 'distancia'; envio_desde: number | null }
  categorias: { id: string; nombre: string; productos: ProductoCatalogo[] }[]
}

export type RespuestaCatalogo = Catalogo | { disponible: false }

/** Lo que el navegador manda por línea: QUÉ quiere, nunca un precio (allowlist de portal_calcular). */
export interface LineaPedido {
  product_id: string
  cantidad: number
  extras?: { extra_id: string; cantidad: number }[]
  nota?: string | null
}

export interface LineaCotizada {
  product_id: string
  cantidad: number
  nombre: string | null
  precio_unitario: number | null
  total: number | null
  problema: 'no_disponible' | 'extra_no_disponible' | 'sin_stock' | null
  extras: { extra_id: string; nombre: string; cantidad: number; precio_unitario: number }[]
}

export interface Cotizacion {
  disponible: true
  lineas: LineaCotizada[]
  subtotal: number
  envio: number | null
  total: number | null
  distancia_m: number | null
  en_zona: boolean | null
  pedido_minimo: number
  falta_para_minimo: number
  estado: EstadoPublico
  motivos: ('cerrado' | 'productos' | 'sin_ubicacion' | 'fuera_de_zona' | 'bajo_minimo')[]
  puede_pedir: boolean
}

export type RespuestaCotizacion = Cotizacion | { disponible: false }

/** Un error que se le puede mostrar al cliente tal cual (los de la función ya vienen en español). */
export class ErrorPortal extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = 'ErrorPortal' }
}

const URL_FUNCION = () => `${import.meta.env.VITE_GVENTO_SUPABASE_URL}/functions/v1/portal`

async function llamar<T>(cuerpo: Record<string, unknown>): Promise<T> {
  let r: Response
  try {
    r = await fetch(URL_FUNCION(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) })
  } catch {
    throw new ErrorPortal('No hay conexión. Revisa tu internet y vuelve a intentarlo.', 0)
  }
  const datos = (await r.json().catch(() => null)) as { error?: string } | null
  if (!r.ok) throw new ErrorPortal(datos?.error ?? 'No pudimos atender tu consulta. Intenta de nuevo en un momento.', r.status)
  return datos as T
}

export const pedirCatalogo = (slug: string) => llamar<RespuestaCatalogo>({ accion: 'catalogo', slug })

export const pedirCotizacion = (slug: string, items: LineaPedido[], ubicacion: { lat: number; lng: number } | null) =>
  llamar<RespuestaCotizacion>({ accion: 'cotizar', slug, items, lat: ubicacion?.lat ?? null, lng: ubicacion?.lng ?? null })
