import { useEffect, useState } from 'react'
import { ErrorPortal, pedirCatalogo, type Catalogo } from './api'
import { slugDeRuta } from './ruta'
import { pesos, textoEstado } from './textos'

// El esqueleto del portal (P2, parte 3): resuelve el negocio de la URL, pide el catálogo a la Edge
// Function y muestra el encabezado, el estado y el menú. El carrito, la entrega y el mapa son la
// parte 4 (pantallas 1, 2 y 2b del diseño).

const COLOR_POR_DEFECTO = '#047857'

type Vista = { tipo: 'cargando' } | { tipo: 'sin_negocio' } | { tipo: 'no_disponible' }
  | { tipo: 'error'; mensaje: string } | { tipo: 'listo'; catalogo: Catalogo }

export function PortalApp() {
  const [vista, setVista] = useState<Vista>({ tipo: 'cargando' })
  const slug = slugDeRuta(window.location.pathname, window.location.host)

  useEffect(() => {
    if (!slug) { setVista({ tipo: 'sin_negocio' }); return }
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

  const caja = { maxWidth: 560, margin: '0 auto', padding: '0 16px' } as const
  if (vista.tipo !== 'listo') {
    const texto = vista.tipo === 'cargando' ? 'Cargando el menú…'
      : vista.tipo === 'sin_negocio' ? 'Este link no corresponde a ningún negocio. Revisa que esté completo.'
      : vista.tipo === 'no_disponible' ? 'Este negocio no está recibiendo pedidos en línea por ahora.'
      : vista.mensaje
    return <main style={{ ...caja, paddingTop: 48 }}><p data-testid="pedido-mensaje" style={{ fontSize: 16, color: '#334155' }}>{texto}</p></main>
  }

  const { negocio, estado, entrega, categorias } = vista.catalogo
  const color = negocio.color ?? COLOR_POR_DEFECTO
  return (
    <main>
      <header style={{ background: color, color: '#fff', padding: '20px 0' }}>
        <div style={caja}>
          <h1 data-testid="pedido-negocio" style={{ margin: 0, fontSize: 22 }}>{negocio.nombre}</h1>
          <p data-testid="pedido-estado" style={{ margin: '6px 0 0', fontSize: 14 }}>{textoEstado(estado)}</p>
          <p style={{ margin: '4px 0 0', fontSize: 13, opacity: 0.9 }}>
            Entrega en {entrega.tiempo_min}–{entrega.tiempo_max} min
            {entrega.envio_desde !== null && ` · envío desde ${pesos(entrega.envio_desde)}`}
            {entrega.pedido_minimo > 0 && ` · pedido mínimo ${pesos(entrega.pedido_minimo)}`}
          </p>
        </div>
      </header>
      <div style={{ ...caja, paddingTop: 16, paddingBottom: 32 }}>
        {categorias.map((c) => (
          <section key={c.id} style={{ marginBottom: 20 }}>
            <h2 style={{ fontSize: 17, color: '#0f172a', margin: '0 0 8px' }}>{c.nombre}</h2>
            {c.productos.map((p) => (
              <div key={p.id} data-testid={`pedido-item-${p.id}`}
                style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderTop: '1px solid #e2e8f0' }}>
                <span style={{ color: p.agotado ? '#94a3b8' : '#0f172a' }}>
                  {p.nombre}{p.agotado && ' · agotado'}
                </span>
                <span style={{ fontFamily: 'ui-monospace, monospace', color: '#0f172a' }}>{pesos(p.precio)}</span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </main>
  )
}
