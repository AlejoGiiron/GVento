import { useEffect, useMemo, useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import { usePortalMutations, usePortalProductos } from '@/hooks/usePortal'
import { avisoProducto, leerPesos, mostrarPesos, pesos, sePuedePublicar, type CambioProducto, type ProductoPortal } from '@/lib/portal'

// Configuración › Productos en el portal (pantalla 5 del diseño, sin promociones: son de P6).
// Los productos y el stock son los del POS; aquí solo se elige cuáles salen en el portal y su
// precio a domicilio. Se guardan SOLO las filas que cambiaron (guardar_portal_productos).

const VERDE = '#047857'

interface Fila { publicado: boolean; precio: string }

const filaDe = (p: ProductoPortal): Fila => ({ publicado: p.publicado, precio: mostrarPesos(p.precio_domicilio) })

export function SeccionProductosPortal() {
  const { data: productos = [], isLoading, error } = usePortalProductos()
  const { guardarProductos, guardando } = usePortalMutations()
  const [filas, setFilas] = useState<Record<string, Fila>>({})
  const [busqueda, setBusqueda] = useState('')

  // Lo guardado, por contenido: un refetch igual no borra lo que se está editando.
  const guardadoTexto = JSON.stringify(productos)
  useEffect(() => {
    const lista = JSON.parse(guardadoTexto) as ProductoPortal[]
    setFilas(Object.fromEntries(lista.map((p) => [p.product_id, filaDe(p)])))
  }, [guardadoTexto])

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return q ? productos.filter((p) => p.nombre.toLowerCase().includes(q)) : productos
  }, [productos, busqueda])

  const cambios: CambioProducto[] = productos.flatMap((p) => {
    const f = filas[p.product_id]
    if (!f) return []
    const precio = leerPesos(f.precio)
    if (f.publicado === p.publicado && precio === (p.precio_domicilio ?? null)) return []
    return [{ product_id: p.product_id, publicado: f.publicado, precio_domicilio: precio }]
  })

  const cambiar = (id: string, f: Partial<Fila>) => setFilas((x) => ({ ...x, [id]: { ...x[id], ...f } }))

  if (isLoading) return <p style={{ color: '#64748b' }}>Cargando…</p>
  if (error) return <p style={{ color: '#b91c1c' }}>No se pudieron cargar los productos: {(error as { message?: string }).message}</p>

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: '0 0 24px' }}>Productos en el portal</h2>
      <section style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <p style={{ margin: 0, fontSize: 13, color: '#475569', flex: '1 1 320px', lineHeight: 1.5 }}>
            Los productos y el stock son los mismos del POS. Aquí solo eliges cuáles se ven en el portal y si tienen un precio distinto a domicilio. Vacío = el precio del local.
          </p>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid #cbd5e1', borderRadius: 10, padding: '0 12px', minHeight: 40, color: '#475569' }}>
            <Search size={16} aria-hidden="true" />
            <input type="search" placeholder="Buscar producto" value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
              data-testid="portal-productos-buscar" aria-label="Buscar producto"
              style={{ border: 0, outline: 0, fontSize: 14, width: 170 }} />
          </label>
        </div>

        {productos.length === 0 ? (
          <p style={{ margin: 0, fontSize: 14, color: '#64748b' }}>Esta sede no tiene productos activos en el POS.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 560, fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#475569', fontSize: 12 }}>
                  <th style={{ padding: '8px 6px', fontWeight: 600 }}>Producto</th>
                  <th style={{ padding: '8px 6px', fontWeight: 600 }}>Precio en el local</th>
                  <th style={{ padding: '8px 6px', fontWeight: 600 }}>Precio a domicilio</th>
                  <th style={{ padding: '8px 6px', fontWeight: 600 }}>En el portal</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((p) => {
                  const f = filas[p.product_id] ?? filaDe(p)
                  const precioDom = leerPesos(f.precio)
                  // El motivo viene de la regla única del servidor (portal_disponibilidad). Lo único que
                  // se mira aquí es el precio a domicilio que se está escribiendo (todavía no guardado),
                  // que puede resolver "sin precio"; al guardar decide el servidor.
                  const puede = sePuedePublicar(p.publicable, p.motivo, precioDom)
                  const aviso = avisoProducto(p.motivo, precioDom, f.publicado, p.agotado, p.publicable)
                  const notaTexto = aviso || (precioDom !== null && precioDom !== p.precio_local ? 'Precio distinto a domicilio' : '')
                  const notaColor = p.agotado && puede ? '#b91c1c' : !aviso && precioDom !== null ? VERDE : '#64748b'
                  return (
                    <tr key={p.product_id} data-testid={`portal-producto-${p.product_id}`} style={{ borderTop: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '10px 6px', fontWeight: 600 }}>
                        {p.nombre}
                        {p.categoria && <span style={{ display: 'block', fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>{p.categoria}</span>}
                        {notaTexto && <div style={{ fontSize: 12, color: notaColor, fontWeight: 500 }}>{notaTexto}</div>}
                      </td>
                      <td style={{ padding: '10px 6px', color: '#334155', fontFamily: 'ui-monospace, monospace' }}>{pesos(p.precio_local)}</td>
                      <td style={{ padding: '10px 6px' }}>
                        <input inputMode="numeric" placeholder="Igual" aria-label={`Precio a domicilio de ${p.nombre}`}
                          data-testid={`portal-precio-${p.product_id}`} value={f.precio}
                          onChange={(e) => cambiar(p.product_id, { precio: mostrarPesos(leerPesos(e.target.value)) })}
                          style={{ width: 110, minHeight: 40, border: '1px solid #cbd5e1', borderRadius: 8, padding: '0 10px', fontSize: 14 }} />
                      </td>
                      <td style={{ padding: '10px 6px' }}>
                        <input type="checkbox" aria-label={`Publicar ${p.nombre} en el portal`}
                          data-testid={`portal-publicado-${p.product_id}`} checked={f.publicado}
                          disabled={!puede && !f.publicado}
                          onChange={(e) => cambiar(p.product_id, { publicado: e.target.checked })}
                          style={{ width: 22, height: 22, accentColor: VERDE }} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" data-testid="portal-productos-guardar" disabled={guardando || cambios.length === 0}
            onClick={() => guardarProductos(cambios).catch(() => {})}
            style={{
              minHeight: 44, padding: '0 22px', borderRadius: 10, border: 0, fontSize: 14, fontWeight: 700,
              color: '#fff', background: cambios.length === 0 ? '#cbd5e1' : '#10b981',
              boxShadow: cambios.length === 0 ? 'none' : '0 6px 16px rgba(16,185,129,.35)',
              cursor: cambios.length === 0 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8,
            }}>
            {guardando && <Loader2 size={15} className="animate-spin" />}
            Guardar
          </button>
          <span style={{ fontSize: 13, color: '#64748b' }} data-testid="portal-productos-resumen">
            {productos.filter((p) => (filas[p.product_id] ?? filaDe(p)).publicado).length} de {productos.length} publicados
            {cambios.length > 0 && ` · ${cambios.length} sin guardar`}
          </span>
        </div>
      </section>
    </div>
  )
}
