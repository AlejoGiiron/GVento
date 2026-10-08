import { useMemo, useState } from 'react'
import { Search, Plus, Check, UserRound, X } from 'lucide-react'
import { useCustomers, useCustomerMutations } from '@/hooks/useCustomers'
import { useUltimoFiado } from '@/hooks/usePosMovil'
import { ordenarClientes, posiblesDuplicados } from '@/lib/clientesFiado'
import { M, botonGrande } from '@/components/movil/estilo'

export type ClienteElegido = { id: string; name: string }

const fecha = (iso: string) =>
  new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short', timeZone: 'America/Bogota' }).format(new Date(iso))

const campo: React.CSSProperties = {
  minHeight: 54, borderRadius: 12, border: `1px solid ${M.borde}`, background: M.panel, color: M.texto,
  fontSize: 16, padding: '0 14px', outline: 'none', width: '100%', boxSizing: 'border-box',
}

/**
 * Elegir (o crear) el cliente de una venta a fiado, en el celular. Búsqueda por
 * nombre o teléfono, recientes primero (lib/clientesFiado.ts). El alta rápida pide
 * nombre y teléfono, y antes de crear muestra los que parecen el mismo cliente.
 * Crear exige fiado.gestionar (RLS de customers): la misma regla que el botón Fiado.
 */
export function ClienteFiadoMovil({ value, onChange }: { value: ClienteElegido | null; onChange: (c: ClienteElegido) => void }) {
  const { customers, isLoading } = useCustomers()
  const { data: ultimo = new Map<string, string>() } = useUltimoFiado()
  const { save, isMutating } = useCustomerMutations()
  const [busqueda, setBusqueda] = useState('')
  const [nuevo, setNuevo] = useState<{ nombre: string; telefono: string } | null>(null)

  const lista = useMemo(() => ordenarClientes(customers, ultimo, busqueda), [customers, ultimo, busqueda])
  const parecidos = nuevo ? posiblesDuplicados(customers, nuevo.nombre, nuevo.telefono) : []

  const abrirNuevo = () => {
    const q = busqueda.trim()
    const esTelefono = q.replace(/\D/g, '').length >= 3 && !/[a-zA-ZÀ-ÿ]/.test(q)
    setNuevo({ nombre: esTelefono ? '' : q, telefono: esTelefono ? q : '' })
  }

  const guardar = async () => {
    if (!nuevo || !nuevo.nombre.trim() || isMutating) return
    try {
      const c = await save({ name: nuevo.nombre.trim(), phone: nuevo.telefono.trim() || null, document: null, notes: null })
      onChange({ id: c.id, name: c.name })
      setNuevo(null)
      setBusqueda('')
    } catch {
      // El toast lo muestra useCustomerMutations; el formulario queda abierto para reintentar.
    }
  }

  if (nuevo) {
    return (
      <div data-testid="m-fiado-form" style={{ display: 'grid', gap: 12 }}>
        <div style={{ fontSize: 17, fontWeight: 700 }}>Cliente nuevo</div>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 14, color: M.suave }}>Nombre</span>
          <input
            data-testid="m-fiado-nombre"
            value={nuevo.nombre}
            onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })}
            autoComplete="off"
            autoCapitalize="words"
            enterKeyHint="next"
            style={campo}
          />
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 14, color: M.suave }}>Teléfono (para cobrarle)</span>
          <input
            data-testid="m-fiado-telefono"
            value={nuevo.telefono}
            onChange={(e) => setNuevo({ ...nuevo, telefono: e.target.value })}
            inputMode="tel"
            autoComplete="off"
            enterKeyHint="done"
            style={campo}
          />
        </label>

        {parecidos.length > 0 && (
          <div data-testid="m-fiado-parecidos" style={{ display: 'grid', gap: 8, background: 'rgba(245,158,11,.10)', border: `1px solid ${M.ambar}`, borderRadius: 12, padding: 12 }}>
            <div style={{ fontSize: 14, color: '#fcd34d' }}>Ya existe un cliente así. ¿Es este?</div>
            {parecidos.map((c) => (
              <button
                key={c.id}
                type="button"
                data-testid="m-fiado-parecido"
                onClick={() => { onChange({ id: c.id, name: c.name }); setNuevo(null); setBusqueda('') }}
                style={{ ...filaCliente(false), background: M.panel }}
              >
                <UserRound size={18} color={M.suave} />
                <span style={{ flex: 1 }}>{c.name}{c.phone ? ` · ${c.phone}` : ''}</span>
              </button>
            ))}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <button type="button" data-testid="m-fiado-cancelar" onClick={() => setNuevo(null)} style={{ ...botonGrande(M.panel), fontSize: 16 }}>
            Cancelar
          </button>
          <button
            type="button"
            data-testid="m-fiado-guardar"
            disabled={!nuevo.nombre.trim() || isMutating}
            onClick={() => void guardar()}
            style={{ ...botonGrande(M.verde), fontSize: 16, opacity: !nuevo.nombre.trim() || isMutating ? 0.5 : 1 }}
          >
            {isMutating ? 'Guardando…' : parecidos.length ? 'Crear igual' : 'Crear'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div data-testid="m-fiado-clientes" style={{ display: 'grid', gap: 10 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, ...campo, padding: '0 14px' }}>
        <Search size={18} color={M.suave} />
        <input
          data-testid="m-fiado-buscar"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Nombre o teléfono"
          autoComplete="off"
          enterKeyHint="search"
          style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: M.texto, fontSize: 16 }}
        />
        {busqueda && (
          <button type="button" aria-label="Borrar búsqueda" onClick={() => setBusqueda('')} style={{ background: 'none', border: 'none', color: M.suave, padding: 6 }}>
            <X size={18} />
          </button>
        )}
      </label>

      <button
        type="button"
        data-testid="m-fiado-nuevo"
        onClick={abrirNuevo}
        style={{ ...filaCliente(false), border: `1px dashed ${M.verde}`, color: '#6ee7b7', justifyContent: 'center', fontWeight: 700 }}
      >
        <Plus size={18} /> {busqueda.trim() ? `Crear «${busqueda.trim()}»` : 'Cliente nuevo'}
      </button>

      {isLoading && <div style={{ color: M.suave, padding: 16, textAlign: 'center' }}>Cargando clientes…</div>}
      {!isLoading && lista.length === 0 && (
        <div style={{ color: M.suave, padding: 16, textAlign: 'center' }}>
          {customers.length === 0 ? 'Todavía no hay clientes. Crea el primero.' : 'Ningún cliente coincide.'}
        </div>
      )}

      {lista.slice(0, 60).map((c) => {
        const elegido = c.id === value?.id
        const reciente = ultimo.get(c.id)
        return (
          <button
            key={c.id}
            type="button"
            data-testid="m-fiado-cliente"
            data-cliente-id={c.id}
            aria-pressed={elegido}
            onClick={() => onChange({ id: c.id, name: c.name })}
            style={filaCliente(elegido)}
          >
            <span style={{
              width: 36, height: 36, borderRadius: '50%', display: 'grid', placeItems: 'center', flex: '0 0 auto',
              background: elegido ? M.verde : M.fondo, color: elegido ? '#fff' : M.suave,
            }}>
              {elegido ? <Check size={20} /> : <UserRound size={18} />}
            </span>
            <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
              <span style={{ display: 'block', fontSize: 16, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
              {(c.phone || reciente) && (
                <span style={{ display: 'block', fontSize: 13, color: M.suave }}>
                  {[c.phone, reciente ? `último fiado ${fecha(reciente)}` : null].filter(Boolean).join(' · ')}
                </span>
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}

const filaCliente = (elegido: boolean): React.CSSProperties => ({
  minHeight: 60, width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px',
  borderRadius: 12, border: `1px solid ${elegido ? M.verde : M.borde}`,
  background: elegido ? 'rgba(16,185,129,.15)' : M.panel, color: M.texto, fontSize: 16,
})
