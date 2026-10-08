import { useEffect, useMemo, useState } from 'react'
import { ArrowUp, ArrowDown, X, Plus, Star } from 'lucide-react'
import { useRestaurantConfig } from '@/hooks/useRestaurantConfig'
import { useProducts } from '@/hooks/useProducts'
import { leerPosMovil, POS_MOVIL_DEFAULT, type PosMovilConfig } from '@/lib/posMovil'

/**
 * Configuración del POS móvil (/m): productos FIJADOS arriba de todo (en este
 * orden, por id) y cuántos MÁS VENDIDOS automáticos se agregan después.
 * Se guarda como UNA clave (pos_movil) por update_restaurant_config: no toca el
 * resto de la configuración.
 */
export function SeccionPosMovil() {
  const { config, updateConfig, isSaving, isLoading } = useRestaurantConfig()
  const { data: productos = [] } = useProducts()
  // Por CONTENIDO, no por identidad: un refetch (p. ej. al volver el foco a la
  // ventana) trae un objeto nuevo igual, y no debe borrar lo que se está editando.
  const guardadaTexto = JSON.stringify(config.pos_movil ?? null)
  const guardada = useMemo(() => leerPosMovil(JSON.parse(guardadaTexto)), [guardadaTexto])

  const [fijados, setFijados] = useState<string[]>(guardada.fijados)
  const [cantidad, setCantidad] = useState(String(guardada.mas_vendidos.cantidad))
  const [dias, setDias] = useState(String(guardada.mas_vendidos.dias))
  const [busqueda, setBusqueda] = useState('')

  // Cuando llega (o cambia) lo guardado, la pantalla arranca de ahí.
  useEffect(() => {
    setFijados(guardada.fijados)
    setCantidad(String(guardada.mas_vendidos.cantidad))
    setDias(String(guardada.mas_vendidos.dias))
  }, [guardada])

  const porId = useMemo(() => new Map(productos.map((p) => [p.id, p])), [productos])
  const candidatos = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return []
    return productos.filter((p) => !fijados.includes(p.id) && p.name.toLowerCase().includes(q)).slice(0, 8)
  }, [productos, busqueda, fijados])

  const mover = (i: number, d: -1 | 1) => setFijados((f) => {
    const n = [...f]
    ;[n[i], n[i + d]] = [n[i + d], n[i]]
    return n
  })

  // Lo que se guarda pasa por leerPosMovil: un número fuera de rango vuelve al
  // valor por defecto en vez de guardarse mal.
  const aGuardar: PosMovilConfig = leerPosMovil({
    fijados,
    mas_vendidos: { cantidad: Number(cantidad), dias: Number(dias) },
  })
  const fueraDeRango = String(aGuardar.mas_vendidos.cantidad) !== cantidad || String(aGuardar.mas_vendidos.dias) !== dias

  if (isLoading) return null

  return (
    <div data-testid="cfg-pos-movil">
      <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>POS móvil</h2>
      <p style={{ fontSize: 13, color: '#64748b', marginBottom: 24 }}>
        Lo que aparece arriba de todo en <b>Vender</b>, en el celular: primero los fijados, en este orden; después los más vendidos.
      </p>

      <Etiqueta>Productos fijados</Etiqueta>
      <div style={{ border: '1.5px solid #e2e8f0', borderRadius: 10, marginBottom: 12 }}>
        {fijados.length === 0 && (
          <div style={{ padding: 14, fontSize: 13, color: '#94a3b8' }}>Ninguno. Buscá un producto abajo para fijarlo.</div>
        )}
        {fijados.map((id, i) => {
          const p = porId.get(id)
          return (
            <div key={id} data-testid="cfg-fijado" data-producto-id={id} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
              borderTop: i === 0 ? 'none' : '1px solid #f1f5f9',
            }}>
              <Star size={14} fill="#f59e0b" color="#f59e0b" />
              <span style={{ flex: 1, fontSize: 14, color: p ? '#0f172a' : '#94a3b8' }}>
                {p ? p.name : 'Producto inactivo o borrado (no se muestra)'}
              </span>
              <BotonIcono titulo="Subir" testid="cfg-fijado-subir" disabled={i === 0} onClick={() => mover(i, -1)}><ArrowUp size={15} /></BotonIcono>
              <BotonIcono titulo="Bajar" testid="cfg-fijado-bajar" disabled={i === fijados.length - 1} onClick={() => mover(i, 1)}><ArrowDown size={15} /></BotonIcono>
              <BotonIcono titulo="Quitar" testid="cfg-fijado-quitar" onClick={() => setFijados((f) => f.filter((x) => x !== id))}><X size={15} /></BotonIcono>
            </div>
          )
        })}
      </div>

      <input
        data-testid="cfg-fijado-buscar"
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder="Buscar un producto para fijar…"
        style={entrada}
      />
      {candidatos.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          {candidatos.map((p) => (
            <button
              key={p.id}
              type="button"
              data-testid="cfg-fijado-agregar"
              onClick={() => { setFijados((f) => [...f, p.id]); setBusqueda('') }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8,
                border: '1.5px solid #a7f3d0', background: '#ecfdf5', color: '#065f46', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              <Plus size={14} /> {p.name}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 28, maxWidth: 420 }}>
        <div>
          <Etiqueta>Más vendidos a mostrar (0–24)</Etiqueta>
          <input data-testid="cfg-mv-cantidad" inputMode="numeric" value={cantidad} onChange={(e) => setCantidad(e.target.value.replace(/\D/g, ''))} style={entrada} />
        </div>
        <div>
          <Etiqueta>De los últimos … días (1–90)</Etiqueta>
          <input data-testid="cfg-mv-dias" inputMode="numeric" value={dias} onChange={(e) => setDias(e.target.value.replace(/\D/g, ''))} style={entrada} />
        </div>
      </div>
      {fueraDeRango && (
        <div data-testid="cfg-mv-fuera-de-rango" style={{ fontSize: 12, color: '#b45309', marginTop: 8 }}>
          Fuera de rango: se guardará {aGuardar.mas_vendidos.cantidad} productos de {aGuardar.mas_vendidos.dias} días
          (por defecto {POS_MOVIL_DEFAULT.mas_vendidos.cantidad} y {POS_MOVIL_DEFAULT.mas_vendidos.dias}).
        </div>
      )}

      <button
        type="button"
        data-testid="cfg-pos-movil-guardar"
        disabled={isSaving}
        onClick={() => void updateConfig({ pos_movil: aGuardar })}
        style={{
          marginTop: 28, background: isSaving ? '#cbd5e1' : '#10b981', color: '#fff', border: 'none', borderRadius: 10,
          padding: '11px 28px', fontSize: 14, fontWeight: 700, cursor: isSaving ? 'default' : 'pointer',
          boxShadow: '0 6px 16px rgba(16,185,129,.35)',
        }}
      >
        {isSaving ? 'Guardando…' : 'Guardar'}
      </button>
    </div>
  )
}

function Etiqueta({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 6 }}>{children}</div>
}

function BotonIcono({ children, titulo, testid, disabled, onClick }: { children: React.ReactNode; titulo: string; testid: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      title={titulo}
      aria-label={titulo}
      data-testid={testid}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: 30, height: 30, display: 'grid', placeItems: 'center', borderRadius: 7, border: '1px solid #e2e8f0',
        background: '#fff', color: '#475569', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.35 : 1,
      }}
    >
      {children}
    </button>
  )
}

const entrada: React.CSSProperties = {
  width: '100%', border: '1.5px solid #e2e8f0', borderRadius: 8, padding: '10px 12px', fontSize: 14,
  color: '#0f172a', outline: 'none', background: '#fff', boxSizing: 'border-box',
}
