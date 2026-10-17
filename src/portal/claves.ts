// Las claves EXACTAS de lo que devuelven portal_catalogo y portal_cotizar (R1 #14 a), atadas a los
// tipos de api.ts: si un tipo gana o pierde una clave y esta lista no, tsc no compila. El spec
// tests/portal-publico.spec.ts compara estas listas con lo que devuelve el SQL. Así los tres lados
// (SQL, tipos y pruebas) no se separan en silencio.
import type { Catalogo, Cotizacion, EstadoPublico, ExtraCatalogo, LineaCotizada, ProductoCatalogo } from './api'

const claves = <T>(r: Record<keyof T, true>) => Object.keys(r).sort()

export const CLAVES_CATALOGO = claves<Catalogo>({ disponible: true, negocio: true, estado: true, entrega: true, categorias: true })
export const CLAVES_NEGOCIO = claves<Catalogo['negocio']>({ nombre: true, logo_url: true, direccion: true, color: true, whatsapp: true, lat: true, lng: true })
export const CLAVES_ESTADO = claves<EstadoPublico>({ recibe: true, motivo: true, abre_en: true })
export const CLAVES_ENTREGA = claves<Catalogo['entrega']>({ tiempo_min: true, tiempo_max: true, pedido_minimo: true, envio_tipo: true, envio_desde: true })
export const CLAVES_CATEGORIA = claves<Catalogo['categorias'][number]>({ id: true, nombre: true, productos: true })
export const CLAVES_PRODUCTO = claves<ProductoCatalogo>({ id: true, nombre: true, descripcion: true, imagen_url: true, precio: true, agotado: true, extras: true })
export const CLAVES_EXTRA = claves<ExtraCatalogo>({ id: true, nombre: true, precio: true, agotado: true })
export const CLAVES_COTIZACION = claves<Cotizacion>({
  disponible: true, lineas: true, subtotal: true, envio: true, total: true, distancia_m: true, en_zona: true,
  pedido_minimo: true, falta_para_minimo: true, estado: true, motivos: true, puede_pedir: true,
})
export const CLAVES_LINEA = claves<LineaCotizada>({ product_id: true, cantidad: true, nombre: true, precio_unitario: true, total: true, problema: true, extras: true })
