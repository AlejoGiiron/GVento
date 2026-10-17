import { lazy, Suspense, useMemo, useRef, useState, type CSSProperties, type Ref } from 'react'
import type { Catalogo, Cotizacion, LineaCotizada } from './api'
import { Barrera } from './Barrera'
import { cambiarCantidad, MAX_CANTIDAD, type Carrito } from './carrito'
import { faltantesDatos, type DatosCliente, type Punto } from './datosCliente'
import { pesos } from './textos'

// Pantallas 2 y 2b del diseño: el pedido, a dónde va y quién lo recibe. Todos los montos son los de
// la cotización del servidor (portal_calcular); si la cotización no es la del carrito y el punto de
// ahora, se muestran puntos suspensivos, nunca un número calculado aquí.
// El mapa (MapLibre) se carga aparte: el menú no lo descarga.

const Mapa = lazy(() => import('./Mapa'))

interface Props {
  catalogo: Catalogo
  carrito: Carrito
  onCarrito: (c: Carrito) => void
  datos: DatosCliente
  onDatos: (d: DatosCliente) => void
  recordarDatos: boolean
  onRecordar: (si: boolean) => void
  cotizacion: Cotizacion | null
  cargando: boolean
  error: string | null
  onReintentar: () => void
  onVolver: () => void
}

const PROBLEMA: Record<NonNullable<LineaCotizada['problema']>, string> = {
  no_disponible: 'Ya no está disponible. Quítalo para seguir.',
  extra_no_disponible: 'Una de las adiciones ya no está disponible. Quítalo y agrégalo de nuevo.',
  // El stock exacto nunca se muestra (decisión del 2026-10-16).
  sin_stock: 'No alcanza para esa cantidad. Pide menos.',
}

const lista = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`)

export function PedidoPantalla(props: Props) {
  const { catalogo, carrito, onCarrito, datos, onDatos, recordarDatos, onRecordar, cotizacion, cargando, error, onReintentar, onVolver } = props
  const { negocio } = catalogo
  const [acepta, setAcepta] = useState(false)
  const [ubicando, setUbicando] = useState(false)
  const [avisoUbicacion, setAvisoUbicacion] = useState<string | null>(null)
  const [avisoPago, setAvisoPago] = useState(false)
  const seccionEntrega = useRef<HTMLElement>(null)
  const campoDireccion = useRef<HTMLInputElement>(null)

  const nombres = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of catalogo.categorias) for (const p of c.productos) {
      m.set(p.id, p.nombre)
      for (const e of p.extras) m.set(`${p.id}/${e.id}`, e.nombre)
    }
    return m
  }, [catalogo])

  const cambiar = (d: Partial<DatosCliente>) => onDatos({ ...datos, ...d })
  const mover = (punto: Punto) => cambiar({ punto })

  function usarMiUbicacion() {
    setAvisoUbicacion(null)
    if (!('geolocation' in navigator)) {
      setAvisoUbicacion('Este navegador no comparte la ubicación. Mueve el mapa hasta el punto de entrega.')
      return
    }
    setUbicando(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => { setUbicando(false); mover({ lat: pos.coords.latitude, lng: pos.coords.longitude }) },
      (e) => {
        setUbicando(false)
        setAvisoUbicacion(e.code === e.PERMISSION_DENIED
          ? 'No tenemos permiso para ver tu ubicación. Mueve el mapa hasta el punto de entrega.'
          : 'No pudimos encontrar tu ubicación. Mueve el mapa hasta el punto de entrega.')
      },
      // maximumAge 0: quien toca el botón quiere la posición de AHORA, no la de hace un minuto.
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    )
  }

  function cambiarDireccion() {
    seccionEntrega.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    campoDireccion.current?.focus({ preventScroll: true })
  }

  const faltan = faltantesDatos(datos, acepta)
  const motivos = cotizacion?.motivos ?? []
  const fueraDeZona = motivos.includes('fuera_de_zona')
  const listo = cotizacion !== null && cotizacion.puede_pedir && faltan.length === 0 && !error
  const textoWhatsapp = `Hola, quiero pedir a domicilio a ${datos.direccion.trim() || 'mi dirección'}, pero el portal dice que queda fuera de la zona de entrega.`

  // Por qué no se puede pagar todavía: lo del servidor primero, después lo que falta llenar.
  const razones: string[] = []
  if (error) razones.push(error)
  if (motivos.includes('cerrado')) razones.push('El negocio no está recibiendo pedidos en este momento.')
  if (motivos.includes('productos')) razones.push('Revisa los productos marcados en tu pedido.')
  if (motivos.includes('bajo_minimo') && cotizacion) razones.push(`Te faltan ${pesos(cotizacion.falta_para_minimo)} para el pedido mínimo.`)
  if (faltan.length > 0) razones.push(`Para pagar falta ${lista(faltan)}.`)

  return (
    <main style={{ paddingBottom: 200 }}>
      <header style={{ position: 'sticky', top: 0, zIndex: 5, background: 'var(--p-panel)', borderBottom: '1px solid var(--p-borde)' }}>
        <div style={{ maxWidth: 560, margin: '0 auto', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" data-testid="pedido-volver" onClick={onVolver} aria-label="Seguir pidiendo"
            style={{ width: 44, height: 44, border: 0, borderRadius: 12, background: 'transparent', fontSize: 22, cursor: 'pointer', color: 'var(--p-texto)' }}>←</button>
          <div>
            <h1 style={{ margin: 0, fontSize: 18 }}>Tu pedido</h1>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--p-texto-2)' }}>{negocio.nombre}</p>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 560, margin: '0 auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <section style={panel} aria-label="Productos">
          {carrito.length === 0 && <p style={{ margin: 0, color: 'var(--p-texto-2)' }}>Tu pedido está vacío.</p>}
          {carrito.map((l, i) => {
            const cot = cotizacion?.lineas[i]
            const nombre = nombres.get(l.product_id) ?? 'Producto'
            return (
              <div key={l.clave} data-testid={`pedido-linea-${i}`} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 0', borderTop: i ? '1px solid var(--p-borde)' : 0 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontWeight: 600 }}>{nombre}</p>
                  {l.extras.length > 0 && (
                    <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--p-texto-2)' }}>
                      + {l.extras.map((e) => nombres.get(`${l.product_id}/${e.extra_id}`) ?? 'adición').join(', ')}
                    </p>
                  )}
                  {l.nota && <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--p-texto-2)' }}>“{l.nota}”</p>}
                  {cot?.problema && <p data-testid={`pedido-linea-problema-${i}`} style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--p-error)' }}>{PROBLEMA[cot.problema]}</p>}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                    <button type="button" aria-label={l.cantidad === 1 ? `Quitar ${nombre}` : `Uno menos de ${nombre}`} data-testid={`pedido-linea-menos-${i}`}
                      onClick={() => onCarrito(cambiarCantidad(carrito, l.clave, l.cantidad - 1))} style={paso}>{l.cantidad === 1 ? '🗑' : '−'}</button>
                    <span data-testid={`pedido-linea-cantidad-${i}`} style={{ minWidth: 22, textAlign: 'center', fontWeight: 700 }}>{l.cantidad}</span>
                    <button type="button" aria-label={`Uno más de ${nombre}`} data-testid={`pedido-linea-mas-${i}`} disabled={l.cantidad >= MAX_CANTIDAD}
                      onClick={() => onCarrito(cambiarCantidad(carrito, l.clave, l.cantidad + 1))} style={paso}>+</button>
                  </div>
                </div>
                <span data-testid={`pedido-linea-total-${i}`} style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {cot ? (cot.total !== null ? pesos(cot.total) : '—') : '…'}
                </span>
              </div>
            )
          })}
        </section>

        <section ref={seccionEntrega} style={{ ...panel, display: 'flex', flexDirection: 'column', gap: 12, scrollMarginTop: 72 }} aria-label="Entrega">
          <h2 style={{ margin: 0, fontSize: 17 }}>¿A dónde lo llevamos?</h2>
          <button type="button" data-testid="pedido-mi-ubicacion" onClick={usarMiUbicacion} disabled={ubicando}
            style={{ minHeight: 48, borderRadius: 12, border: '1px solid var(--p-borde)', background: 'var(--p-suave)', color: 'var(--p-texto)', fontWeight: 600, cursor: 'pointer' }}>
            {ubicando ? 'Buscando tu ubicación…' : '📍 Usar mi ubicación actual'}
          </button>
          {avisoUbicacion && <p data-testid="pedido-aviso-ubicacion" role="status" style={{ margin: 0, fontSize: 13, color: 'var(--p-texto-2)' }}>{avisoUbicacion}</p>}
          {/* Si el paquete del mapa no carga (por ejemplo, después de un deploy), queda "Usar mi ubicación". */}
          <Barrera fallback={
            <p data-testid="pedido-mapa-fallo" style={{ margin: 0, padding: 16, borderRadius: 14, background: 'var(--p-suave)', color: 'var(--p-texto-2)', fontSize: 14 }}>
              No pudimos cargar el mapa. Usa "Usar mi ubicación actual" y escribe bien la dirección.
            </p>}>
            <Suspense fallback={<div style={{ height: 230, borderRadius: 14, background: 'var(--p-suave)' }} />}>
              <Mapa local={{ lat: negocio.lat, lng: negocio.lng }} punto={datos.punto} onMover={mover} />
            </Suspense>
          </Barrera>

          {fueraDeZona && (
            <div data-testid="pedido-fuera-de-zona" role="alert" style={{ padding: 14, borderRadius: 14, background: 'var(--p-error-suave)', border: '1px solid #fecaca', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <p style={{ margin: 0, fontWeight: 700, color: 'var(--p-error)' }}>Todavía no llegamos a esta dirección</p>
              <p style={{ margin: 0, fontSize: 14, color: 'var(--p-texto)' }}>
                El punto que marcaste queda fuera de la zona de entrega de {negocio.nombre}. Puedes cambiar la dirección
                {negocio.whatsapp ? ' o escribirle al negocio por WhatsApp.' : '.'}
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button type="button" data-testid="pedido-cambiar-direccion" onClick={cambiarDireccion}
                  style={{ minHeight: 44, padding: '0 16px', borderRadius: 12, border: '1px solid var(--p-borde)', background: 'var(--p-panel)', fontWeight: 600, cursor: 'pointer' }}>
                  Cambiar la dirección
                </button>
                {negocio.whatsapp && (
                  <a data-testid="pedido-whatsapp" href={`https://wa.me/${negocio.whatsapp}?text=${encodeURIComponent(textoWhatsapp)}`} target="_blank" rel="noopener noreferrer"
                    style={{ minHeight: 44, padding: '0 16px', borderRadius: 12, background: '#16a34a', color: '#fff', fontWeight: 600, display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>
                    Escribir por WhatsApp
                  </a>
                )}
              </div>
            </div>
          )}

          <Campo etiqueta="Dirección" testid="pedido-direccion" valor={datos.direccion} max={160} placeholder="Ej.: Cra. 24 # 9-35, San Fernando"
            onCambio={(direccion) => cambiar({ direccion })} refInput={campoDireccion} autoComplete="street-address" />
          <Campo etiqueta="Indicaciones para el domiciliario (opcional)" testid="pedido-indicaciones" valor={datos.indicaciones} max={160}
            placeholder="Ej.: casa esquinera, portón negro" onCambio={(indicaciones) => cambiar({ indicaciones })} />
        </section>

        <section style={{ ...panel, display: 'flex', flexDirection: 'column', gap: 12 }} aria-label="Quién recibe">
          <h2 style={{ margin: 0, fontSize: 17 }}>¿Quién recibe?</h2>
          <Campo etiqueta="Nombre" testid="pedido-nombre" valor={datos.nombre} max={80} onCambio={(nombre) => cambiar({ nombre })} autoComplete="name" />
          <Campo etiqueta="Celular" testid="pedido-celular" valor={datos.celular} max={20} placeholder="300 123 4567" tipo="tel"
            onCambio={(celular) => cambiar({ celular })} autoComplete="tel-national" />
          <label style={casilla}>
            <input type="checkbox" data-testid="pedido-acepta" checked={acepta} onChange={(e) => setAcepta(e.target.checked)} style={check} />
            <span>Acepto que {negocio.nombre} use mis datos solo para entregar este pedido.</span>
          </label>
          <label style={casilla}>
            <input type="checkbox" data-testid="pedido-recordar" checked={recordarDatos} onChange={(e) => onRecordar(e.target.checked)} style={check} />
            <span>Recordar mis datos en este celular</span>
          </label>
        </section>
      </div>

      <footer style={{ position: 'fixed', left: 0, right: 0, bottom: 0, background: 'var(--p-panel)', borderTop: '1px solid var(--p-borde)', padding: '12px 16px calc(12px + env(safe-area-inset-bottom, 0px))' }}>
        <div aria-live="polite" style={{ maxWidth: 560, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Fila etiqueta="Subtotal" testid="pedido-total-subtotal" valor={cotizacion ? pesos(cotizacion.subtotal) : '…'} />
          <Fila etiqueta="Envío" testid="pedido-total-envio"
            valor={!cotizacion ? '…' : cotizacion.envio !== null ? pesos(cotizacion.envio) : datos.punto ? '—' : 'Marca el punto'} />
          <Fila etiqueta="Total" testid="pedido-total" fuerte valor={cotizacion?.total != null ? pesos(cotizacion.total) : cargando ? '…' : '—'} />
          {razones.length > 0 && !cargando && (
            <p data-testid="pedido-razones" style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--p-texto-2)' }}>{razones.join(' ')}</p>
          )}
          {error && !cargando && (
            <button type="button" data-testid="pedido-reintentar" onClick={onReintentar}
              style={{ alignSelf: 'flex-start', minHeight: 40, padding: '0 14px', borderRadius: 10, border: '1px solid var(--p-borde)', background: 'var(--p-panel)', fontWeight: 600, cursor: 'pointer' }}>
              Reintentar
            </button>
          )}
          {avisoPago && (
            <p data-testid="pedido-pago-pronto" role="status" style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--p-texto)' }}>
              El pago en línea se activa muy pronto. No se te ha cobrado nada.
            </p>
          )}
          <button type="button" data-testid="pedido-pagar" disabled={!listo || cargando} onClick={() => setAvisoPago(true)}
            style={{ marginTop: 4, minHeight: 54, borderRadius: 14, border: 0, background: 'var(--p-ok)', color: '#052e16', fontWeight: 800, fontSize: 17, cursor: 'pointer', opacity: !listo || cargando ? 0.45 : 1 }}>
            {listo && cotizacion?.total != null ? `Pagar ${pesos(cotizacion.total)}` : 'Pagar'}
          </button>
        </div>
      </footer>
    </main>
  )
}

const panel: CSSProperties = { background: 'var(--p-panel)', border: '1px solid var(--p-borde)', borderRadius: 16, padding: 14 }
const paso: CSSProperties = { width: 44, height: 44, borderRadius: 10, border: '1px solid var(--p-borde)', background: 'var(--p-panel)', fontSize: 16, cursor: 'pointer' }
const casilla: CSSProperties = { display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 14, minHeight: 32 }
const check: CSSProperties = { width: 20, height: 20, marginTop: 1, flex: 'none', accentColor: 'var(--p-marca)' }

function Campo({ etiqueta, testid, valor, onCambio, max, placeholder, tipo = 'text', autoComplete, refInput }: {
  etiqueta: string; testid: string; valor: string; onCambio: (v: string) => void; max: number
  placeholder?: string; tipo?: 'text' | 'tel'; autoComplete?: string; refInput?: Ref<HTMLInputElement>
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14, fontWeight: 600 }}>
      {etiqueta}
      <input ref={refInput} data-testid={testid} type={tipo} value={valor} maxLength={max} placeholder={placeholder}
        autoComplete={autoComplete} inputMode={tipo === 'tel' ? 'tel' : undefined} onChange={(e) => onCambio(e.target.value)}
        style={{ minHeight: 46, padding: '0 12px', borderRadius: 10, border: '1px solid var(--p-borde)', fontSize: 16, fontWeight: 400, color: 'var(--p-texto)', background: 'var(--p-panel)' }} />
    </label>
  )
}

function Fila({ etiqueta, valor, testid, fuerte }: { etiqueta: string; valor: string; testid: string; fuerte?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: fuerte ? 18 : 14, fontWeight: fuerte ? 800 : 500, color: fuerte ? 'var(--p-texto)' : 'var(--p-texto-2)' }}>
      <span>{etiqueta}</span>
      <span data-testid={testid} style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--p-texto)' }}>{valor}</span>
    </div>
  )
}
