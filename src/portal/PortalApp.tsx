import { useEffect, useState } from 'react'
import { ErrorPortal, pedirCatalogo, type Catalogo } from './api'
import { agregar, type Carrito } from './carrito'
import { DATOS_VACIOS, leerRecordados, olvidar, recordar, type DatosCliente } from './datosCliente'
import { MenuPantalla } from './MenuPantalla'
import { PedidoPantalla } from './PedidoPantalla'
import { textoSobre } from './reglasMapa'
import { esInicioDelPortal, slugDeRuta } from './ruta'
import { useCotizacion } from './useCotizacion'

// El portal del cliente (P2): resuelve el negocio de la URL, pide el catálogo a la Edge Function y
// muestra el menú (pantalla 1) y el pedido con la entrega (pantallas 2 y 2b). El pago es P3.

const COLOR_POR_DEFECTO = '#047857'

type Vista = { tipo: 'cargando' } | { tipo: 'inicio' } | { tipo: 'sin_negocio' } | { tipo: 'no_disponible' }
  | { tipo: 'error'; mensaje: string } | { tipo: 'listo'; catalogo: Catalogo }

export function PortalApp() {
  const [vista, setVista] = useState<Vista>({ tipo: 'cargando' })
  const slug = slugDeRuta(window.location.pathname, window.location.host)

  useEffect(() => {
    if (!slug) { setVista({ tipo: esInicioDelPortal(window.location.pathname) ? 'inicio' : 'sin_negocio' }); return }
    let vivo = true
    pedirCatalogo(slug).then(
      (c) => { if (vivo) setVista(c.disponible ? { tipo: 'listo', catalogo: c } : { tipo: 'no_disponible' }) },
      (e: unknown) => { if (vivo) setVista({ tipo: 'error', mensaje: e instanceof ErrorPortal ? e.message : 'No pudimos cargar el menú.' }) },
    )
    return () => { vivo = false }
  }, [slug])

  useEffect(() => {
    document.title = vista.tipo === 'listo' ? `${vista.catalogo.negocio.nombre} · Pedidos en línea` : 'Pedidos en línea'
  }, [vista])

  if (vista.tipo === 'listo' && slug) return <Tienda slug={slug} catalogo={vista.catalogo} />
  const texto = vista.tipo === 'cargando' ? 'Cargando el menú…'
    : vista.tipo === 'inicio' ? 'Para pedir, abre el link que te compartió el negocio.'
    : vista.tipo === 'no_disponible' ? 'Este negocio no está recibiendo pedidos en línea por ahora.'
    : vista.tipo === 'error' ? vista.mensaje
    : 'Este link no corresponde a ningún negocio. Revisa que esté completo.'
  return (
    <main style={{ maxWidth: 560, margin: '0 auto', padding: '48px 16px 0' }}>
      <p data-testid="pedido-mensaje" style={{ fontSize: 16, color: 'var(--p-texto-2)' }}>{texto}</p>
    </main>
  )
}

function Tienda({ slug, catalogo }: { slug: string; catalogo: Catalogo }) {
  const [carrito, setCarrito] = useState<Carrito>([])
  const [recordados] = useState(leerRecordados)
  const [datos, setDatos] = useState<DatosCliente>(recordados ?? DATOS_VACIOS)
  const [recordarDatos, setRecordarDatos] = useState(recordados !== null)
  const [enPedido, setEnPedido] = useState(false)
  // Cotiza solo cuando cambian el carrito o el punto (no al escribir nombre, dirección o celular).
  const { cotizacion, cargando, error, reintentar } = useCotizacion(slug, carrito, datos.punto)

  // El color del negocio, el texto que se lee encima (blanco o casi negro) y la barra del navegador.
  useEffect(() => {
    const color = catalogo.negocio.color ?? COLOR_POR_DEFECTO
    document.documentElement.style.setProperty('--p-marca', color)
    document.documentElement.style.setProperty('--p-marca-texto', textoSobre(color))
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color)
  }, [catalogo.negocio.color])

  // "Recordar mis datos": solo en este navegador. Al desmarcarlo se borran.
  useEffect(() => {
    if (recordarDatos) recordar(datos)
    else olvidar()
  }, [recordarDatos, datos])

  // El botón Atrás del celular vuelve al menú: no saca del portal con el pedido armado.
  useEffect(() => {
    const alVolver = () => setEnPedido(false)
    window.addEventListener('popstate', alVolver)
    return () => window.removeEventListener('popstate', alVolver)
  }, [])

  function verPedido() {
    window.history.pushState({ pedido: true }, '')
    setEnPedido(true)
    window.scrollTo(0, 0)
  }

  function volver() {
    if ((window.history.state as { pedido?: boolean } | null)?.pedido) window.history.back()
    else setEnPedido(false)
  }

  // El mapa (MapLibre, ~300 KB comprimido) se descarga cuando entra el primer producto, no al abrir el
  // menú: quien solo mira no lo paga, y quien pide ya lo tiene al llegar a la entrega.
  const hayAlgo = carrito.length > 0
  // Si la precarga falla (sin red, deploy nuevo), no pasa nada aquí: la pantalla 2 lo vuelve a pedir y,
  // si tampoco carga, muestra el aviso de la Barrera.
  useEffect(() => { if (hayAlgo) import('./Mapa').catch(() => undefined) }, [hayAlgo])

  // Si se vacía el pedido, se vuelve al menú.
  useEffect(() => {
    if (enPedido && carrito.length === 0) volver()
  }, [enPedido, carrito.length])

  if (enPedido) {
    return (
      <PedidoPantalla catalogo={catalogo} carrito={carrito} onCarrito={setCarrito} datos={datos} onDatos={setDatos}
        recordarDatos={recordarDatos} onRecordar={setRecordarDatos} cotizacion={cotizacion} cargando={cargando}
        error={error} onReintentar={reintentar} onVolver={volver} />
    )
  }
  return (
    <MenuPantalla catalogo={catalogo} carrito={carrito} cotizacion={cotizacion} cargando={cargando} error={error} onReintentar={reintentar}
      onAgregar={(p, cantidad, extras, nota) => setCarrito((c) => agregar(c, p.id, cantidad, extras, nota))}
      onVerPedido={verPedido} />
  )
}
