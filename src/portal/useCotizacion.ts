import { useCallback, useEffect, useRef, useState } from 'react'
import { ErrorPortal, pedirCotizacion, type Cotizacion } from './api'
import { aItems, firma, type Carrito } from './carrito'
import type { Punto } from './datosCliente'

/** Espera desde el último cambio antes de cotizar (varios toques seguidos = una sola consulta). */
export const ESPERA_COTIZAR_MS = 500

/** El punto redondeado a ~10 cm: moverlo menos que eso no es un cambio de dirección. */
export const clavePunto = (p: Punto | null) => (p ? `${p.lat.toFixed(6)},${p.lng.toFixed(6)}` : '')

/** ¿Las líneas cotizadas son, una por una, las del carrito? (mismo producto y misma cantidad) */
export const lineasCoinciden = (c: Cotizacion, carrito: Carrito) =>
  c.lineas.length === carrito.length
  && c.lineas.every((l, i) => l.product_id === carrito[i].product_id && l.cantidad === carrito[i].cantidad)

/**
 * La cotización del servidor (el único que pone precios). Se pide SOLO cuando cambia el carrito o el
 * punto de entrega (decisión del 2026-10-17: cada consulta son líneas de log; ver el plan, P2 paso 6):
 * escribir el nombre, la dirección o el celular no cotiza. Una respuesta vieja que llega tarde se
 * descarta. `reintentar` vuelve a pedir la misma cotización después de un error.
 *
 * `cotizacion` es null salvo que sea la del carrito y el punto de AHORA y que sus líneas coincidan, una
 * por una, con las del carrito (R1 #14 a: la pantalla las empareja por posición). Si no coinciden, no
 * se muestran precios ni se deja pagar (falla cerrado).
 */
export function useCotizacion(slug: string, carrito: Carrito, punto: Punto | null) {
  const [resultado, setResultado] = useState<{ llave: string; cotizacion: Cotizacion } | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [intento, setIntento] = useState(0)
  const turno = useRef(0)
  const llave = `${firma(carrito)}@${clavePunto(punto)}`

  useEffect(() => {
    const mio = ++turno.current
    if (carrito.length === 0) { setResultado(null); setCargando(false); setError(null); return }
    setCargando(true)
    const t = setTimeout(() => {
      pedirCotizacion(slug, aItems(carrito), punto).then(
        (r) => {
          if (mio !== turno.current) return
          setCargando(false)
          if (!r.disponible) { setError('Este negocio dejó de recibir pedidos en línea.'); setResultado(null); return }
          setError(null); setResultado({ llave, cotizacion: r })
        },
        (e: unknown) => {
          if (mio !== turno.current) return
          setCargando(false)
          setResultado(null)
          setError(e instanceof ErrorPortal ? e.message : 'No pudimos calcular tu pedido.')
        },
      )
    }, ESPERA_COTIZAR_MS)
    return () => clearTimeout(t)
    // Solo el carrito (por su firma), el punto (los dos en `llave`) y "Reintentar" deciden cuándo cotizar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, llave, intento])

  const reintentar = useCallback(() => setIntento((n) => n + 1), [])
  const vigente = resultado !== null && resultado.llave === llave && lineasCoinciden(resultado.cotizacion, carrito)
  return { cotizacion: vigente ? resultado.cotizacion : null, cargando, error, reintentar }
}
