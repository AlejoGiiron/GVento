import { useEffect, useRef, useState } from 'react'
import type { Catalogo, Cotizacion, ProductoCatalogo } from './api'
import { MAX_CANTIDAD, MAX_EXTRAS, MAX_LINEAS, MAX_NOTA, unidades, type Carrito, type LineaCarrito } from './carrito'
import { pesos, textoEstado } from './textos'

// Pantalla 1 del diseño: el menú del negocio y el botón "Ver mi pedido". Los precios que se ven son
// los del catálogo (los pone el servidor) y el total del botón es el subtotal que devuelve cotizar:
// la pantalla no suma precios. La promo del día es de P6.

interface Props {
  catalogo: Catalogo
  carrito: Carrito
  cotizacion: Cotizacion | null
  cargando: boolean
  error: string | null
  onReintentar: () => void
  onAgregar: (p: ProductoCatalogo, cantidad: number, extras: LineaCarrito['extras'], nota: string) => void
  onVerPedido: () => void
}

const iniciales = (nombre: string) => nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join('')

export function MenuPantalla({ catalogo, carrito, cotizacion, cargando, error, onReintentar, onAgregar, onVerPedido }: Props) {
  const { negocio, estado, entrega, categorias } = catalogo
  const [hoja, setHoja] = useState<ProductoCatalogo | null>(null)
  const abierto = estado.recibe
  const n = unidades(carrito)
  const lleno = carrito.length >= MAX_LINEAS

  return (
    <main style={{ paddingBottom: n > 0 ? 110 : 32 }}>
      <header style={{ background: 'var(--p-marca)', color: 'var(--p-marca-texto)', padding: '20px 16px 18px' }}>
        <div style={{ maxWidth: 560, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            {negocio.logo_url
              ? <img src={negocio.logo_url} alt="" width={56} height={56} style={{ borderRadius: 14, background: '#fff', objectFit: 'cover' }} />
              : <span aria-hidden="true" style={{ width: 56, height: 56, borderRadius: 14, background: '#fff', color: 'var(--p-marca)', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 20 }}>{iniciales(negocio.nombre)}</span>}
            <div style={{ minWidth: 0 }}>
              <h1 data-testid="pedido-negocio" style={{ margin: 0, fontSize: 22, lineHeight: 1.2 }}>{negocio.nombre}</h1>
              <p data-testid="pedido-estado" style={{ margin: '4px 0 0', fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: abierto ? '#86efac' : '#fca5a5', flex: 'none' }} />
                {textoEstado(estado)}
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 13 }}>
            {entrega.envio_desde !== null && <span style={chip}>Envío desde {pesos(entrega.envio_desde)}</span>}
            <span style={chip}>Llega en {entrega.tiempo_min}–{entrega.tiempo_max} min</span>
            {entrega.pedido_minimo > 0 && <span style={chip}>Pedido mínimo {pesos(entrega.pedido_minimo)}</span>}
            <span style={chip}>Pago en línea</span>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 560, margin: '0 auto', padding: '16px 16px 0', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {!abierto && (
          <p data-testid="pedido-cerrado" style={{ margin: 0, padding: '12px 14px', borderRadius: 12, background: 'var(--p-suave)', color: 'var(--p-texto-2)', fontSize: 14 }}>
            Ahora no estamos recibiendo pedidos. Puedes mirar el menú.
          </p>
        )}
        {lleno && (
          <p data-testid="pedido-lleno" role="status" style={{ margin: 0, padding: '12px 14px', borderRadius: 12, background: 'var(--p-suave)', color: 'var(--p-texto-2)', fontSize: 14 }}>
            Tu pedido ya tiene {MAX_LINEAS} productos distintos, el máximo por pedido. Para agregar otro, quita uno.
          </p>
        )}
        {categorias.length > 1 && (
          <nav aria-label="Categorías" style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
            {categorias.map((c) => (
              <button key={c.id} type="button" onClick={() => document.getElementById(`cat-${c.id}`)?.scrollIntoView({ behavior: 'smooth' })}
                style={{ flex: 'none', minHeight: 40, padding: '0 16px', borderRadius: 999, border: '1px solid var(--p-borde)', background: 'var(--p-panel)', color: 'var(--p-texto)', fontWeight: 600, cursor: 'pointer' }}>
                {c.nombre}
              </button>
            ))}
          </nav>
        )}
        {categorias.map((c) => (
          <section key={c.id} id={`cat-${c.id}`} style={{ display: 'flex', flexDirection: 'column', gap: 10, scrollMarginTop: 12 }}>
            <h2 style={{ margin: 0, fontSize: 17 }}>{c.nombre}</h2>
            {c.productos.map((p) => (
              <article key={p.id} data-testid={`pedido-item-${p.id}`}
                style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 12, borderRadius: 16, background: 'var(--p-panel)', border: '1px solid var(--p-borde)', opacity: p.agotado ? 0.6 : 1 }}>
                {p.imagen_url
                  ? <img src={p.imagen_url} alt="" width={72} height={72} style={{ borderRadius: 12, objectFit: 'cover', flex: 'none' }} />
                  : <span aria-hidden="true" style={{ width: 72, height: 72, borderRadius: 12, background: 'var(--p-suave)', flex: 'none' }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3 style={{ margin: 0, fontSize: 16 }}>{p.nombre}</h3>
                  {p.descripcion && <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--p-texto-2)' }}>{p.descripcion}</p>}
                  <p style={{ margin: '4px 0 0', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {pesos(p.precio)}{p.agotado && <span style={{ fontWeight: 500, color: 'var(--p-error)', fontSize: 13 }}> · Agotado hoy</span>}
                  </p>
                </div>
                <button type="button" data-testid={`pedido-agregar-${p.id}`} aria-label={`Agregar ${p.nombre}`}
                  disabled={!abierto || p.agotado || lleno}
                  onClick={() => (p.extras.length > 0 ? setHoja(p) : onAgregar(p, 1, [], ''))}
                  style={{ flex: 'none', width: 44, height: 44, borderRadius: 12, border: 0, background: 'var(--p-marca)', color: 'var(--p-marca-texto)', fontSize: 24, fontWeight: 600, cursor: 'pointer', opacity: !abierto || p.agotado || lleno ? 0.4 : 1 }}>
                  +
                </button>
              </article>
            ))}
          </section>
        ))}
        <p style={{ margin: '8px 0 0', textAlign: 'center', fontSize: 12, color: 'var(--p-texto-2)' }}>Pedidos con G-Vento</p>
      </div>

      {n > 0 && (
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, padding: '12px 16px calc(12px + env(safe-area-inset-bottom, 0px))', background: 'linear-gradient(transparent, var(--p-fondo) 30%)' }}>
          {error && !cargando && (
            <p data-testid="pedido-error" role="alert" style={{ maxWidth: 560, margin: '0 auto 8px', padding: '8px 12px', borderRadius: 12, background: 'var(--p-error-suave)', color: 'var(--p-error)', fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1 }}>{error}</span>
              <button type="button" data-testid="pedido-reintentar" onClick={onReintentar}
                style={{ minHeight: 36, padding: '0 12px', borderRadius: 10, border: '1px solid var(--p-borde)', background: 'var(--p-panel)', fontWeight: 600, cursor: 'pointer' }}>
                Reintentar
              </button>
            </p>
          )}
          <button type="button" data-testid="pedido-ver" onClick={onVerPedido}
            style={{ width: '100%', maxWidth: 560, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 12, minHeight: 56, padding: '0 16px', borderRadius: 16, border: 0, background: 'var(--p-oscuro)', color: '#fff', cursor: 'pointer' }}>
            <span data-testid="pedido-unidades" style={{ minWidth: 30, height: 30, borderRadius: 8, background: 'var(--p-ok)', color: '#052e16', display: 'grid', placeItems: 'center', fontWeight: 800 }}>{n}</span>
            <span style={{ fontWeight: 700, fontSize: 17 }}>Ver mi pedido</span>
            <span data-testid="pedido-subtotal" style={{ marginLeft: 'auto', fontWeight: 700, fontSize: 17, fontVariantNumeric: 'tabular-nums' }}>
              {cotizacion ? pesos(cotizacion.subtotal) : error && !cargando ? '—' : '…'}
            </span>
          </button>
        </div>
      )}

      {hoja && <HojaProducto producto={hoja} onCerrar={() => setHoja(null)} onAgregar={(c, e, nota) => { onAgregar(hoja, c, e, nota); setHoja(null) }} />}
    </main>
  )
}

const chip = { padding: '6px 12px', borderRadius: 999, background: 'rgba(255,255,255,.18)' } as const

/** Elegir extras, cantidad y nota de un producto que tiene extras. El precio de cada extra es el del catálogo. */
function HojaProducto({ producto, onCerrar, onAgregar }: {
  producto: ProductoCatalogo
  onCerrar: () => void
  onAgregar: (cantidad: number, extras: LineaCarrito['extras'], nota: string) => void
}) {
  const [cantidad, setCantidad] = useState(1)
  const [elegidos, setElegidos] = useState<string[]>([])
  const [nota, setNota] = useState('')
  const hoja = useRef<HTMLDivElement>(null)
  const alCerrar = useRef(onCerrar)
  alCerrar.current = onCerrar
  // Al abrir: el foco entra a la hoja; Escape la cierra; al cerrar, el foco vuelve a donde estaba.
  useEffect(() => {
    const antes = document.activeElement as HTMLElement | null
    hoja.current?.querySelector<HTMLElement>('input, button')?.focus()
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') alCerrar.current() }
    document.addEventListener('keydown', tecla)
    return () => { document.removeEventListener('keydown', tecla); antes?.focus?.() }
  }, [])
  const tope = elegidos.length >= MAX_EXTRAS
  return (
    <div role="dialog" aria-modal="true" aria-label={producto.nombre} data-testid="pedido-hoja"
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 10 }}
      onClick={(e) => { if (e.target === e.currentTarget) onCerrar() }}>
      <div ref={hoja} style={{ width: '100%', maxWidth: 560, background: 'var(--p-panel)', borderRadius: '20px 20px 0 0', padding: '20px 16px calc(16px + env(safe-area-inset-bottom, 0px))', display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 19 }}>{producto.nombre}</h2>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" style={{ border: 0, background: 'transparent', fontSize: 22, cursor: 'pointer', color: 'var(--p-texto-2)' }}>×</button>
        </div>
        <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <legend style={{ fontWeight: 700, marginBottom: 6 }}>Adiciones{producto.extras.length > MAX_EXTRAS && ` (hasta ${MAX_EXTRAS})`}</legend>
          {producto.extras.map((e) => (
            <label key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 40, opacity: e.agotado ? 0.5 : 1 }}>
              <input type="checkbox" data-testid={`pedido-extra-${e.id}`} disabled={e.agotado || (tope && !elegidos.includes(e.id))} checked={elegidos.includes(e.id)}
                onChange={(ev) => setElegidos((x) => (ev.target.checked ? [...x, e.id] : x.filter((y) => y !== e.id)))}
                style={{ width: 20, height: 20, accentColor: 'var(--p-marca)' }} />
              <span style={{ flex: 1 }}>{e.nombre}{e.agotado && ' · agotado'}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--p-texto-2)' }}>+{pesos(e.precio)}</span>
            </label>
          ))}
        </fieldset>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontWeight: 600 }}>
          Indicaciones para la cocina (opcional)
          <input data-testid="pedido-hoja-nota" maxLength={MAX_NOTA} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej.: sin cebolla"
            style={{ minHeight: 44, padding: '0 12px', borderRadius: 10, border: '1px solid var(--p-borde)', fontSize: 15 }} />
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="button" aria-label="Uno menos" onClick={() => setCantidad((c) => Math.max(1, c - 1))} style={paso}>−</button>
          <span data-testid="pedido-hoja-cantidad" style={{ minWidth: 28, textAlign: 'center', fontWeight: 700 }}>{cantidad}</span>
          <button type="button" aria-label="Uno más" onClick={() => setCantidad((c) => Math.min(MAX_CANTIDAD, c + 1))} style={paso}>+</button>
          <button type="button" data-testid="pedido-hoja-agregar"
            onClick={() => onAgregar(cantidad, elegidos.map((id) => ({ extra_id: id, cantidad: 1 })), nota)}
            style={{ marginLeft: 'auto', minHeight: 48, padding: '0 20px', borderRadius: 12, border: 0, background: 'var(--p-marca)', color: 'var(--p-marca-texto)', fontWeight: 700, cursor: 'pointer' }}>
            Agregar
          </button>
        </div>
      </div>
    </div>
  )
}

const paso = { width: 44, height: 44, borderRadius: 12, border: '1px solid var(--p-borde)', background: 'var(--p-panel)', fontSize: 20, cursor: 'pointer' } as const
