import type { LineaPedido } from './api'

// El carrito del portal: SOLO qué quiere el cliente (producto, cantidad, extras, nota). Ningún precio
// vive aquí: lo pone el servidor al cotizar (portal_calcular, R1 #14 a).

export interface LineaCarrito {
  /** Identidad de la línea: el mismo producto con los mismos extras y la misma nota se suma. */
  clave: string
  product_id: string
  cantidad: number
  extras: { extra_id: string; cantidad: number }[]
  nota: string
}

export type Carrito = LineaCarrito[]

/**
 * Los límites del servidor (portal_calcular, R1 #14 a): 1 a 50 por línea, hasta 30 líneas, nota de 140,
 * hasta 10 adiciones por línea. Copiados a mano: si cambian allá, cambian aquí.
 */
export const MAX_CANTIDAD = 50
export const MAX_LINEAS = 30
export const MAX_NOTA = 140
export const MAX_EXTRAS = 10

const claveDe = (product_id: string, extras: LineaCarrito['extras'], nota: string) =>
  [product_id, ...extras.map((e) => `${e.extra_id}x${e.cantidad}`).sort(), nota.trim()].join('|')

/** Agrega (o suma a la línea igual). Devuelve el mismo carrito si ya no cabe. */
export function agregar(c: Carrito, product_id: string, cantidad = 1, extras: LineaCarrito['extras'] = [], nota = ''): Carrito {
  const n = nota.trim().slice(0, MAX_NOTA)
  const clave = claveDe(product_id, extras, n)
  const i = c.findIndex((l) => l.clave === clave)
  if (i >= 0) {
    return c.map((l, j) => (j === i ? { ...l, cantidad: Math.min(MAX_CANTIDAD, l.cantidad + cantidad) } : l))
  }
  if (c.length >= MAX_LINEAS) return c
  return [...c, { clave, product_id, cantidad: Math.min(MAX_CANTIDAD, Math.max(1, cantidad)), extras, nota: n }]
}

/** Cambia la cantidad de una línea; 0 o menos la quita. */
export function cambiarCantidad(c: Carrito, clave: string, cantidad: number): Carrito {
  if (cantidad <= 0) return c.filter((l) => l.clave !== clave)
  return c.map((l) => (l.clave === clave ? { ...l, cantidad: Math.min(MAX_CANTIDAD, cantidad) } : l))
}

/** Lo que se le manda al servidor (la forma de portal_calcular: allowlist de claves). */
export function aItems(c: Carrito): LineaPedido[] {
  return c.map((l) => ({
    product_id: l.product_id,
    cantidad: l.cantidad,
    ...(l.extras.length ? { extras: l.extras } : {}),
    ...(l.nota ? { nota: l.nota } : {}),
  }))
}

/** Cuántas unidades lleva (para el contador del botón; no es un precio). */
export const unidades = (c: Carrito) => c.reduce((s, l) => s + l.cantidad, 0)

/** Una firma estable del carrito: si no cambia, no se vuelve a cotizar. */
export const firma = (c: Carrito) => JSON.stringify(aItems(c))
