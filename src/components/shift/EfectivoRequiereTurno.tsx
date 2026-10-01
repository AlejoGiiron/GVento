import { useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { useEfectivoRequiereTurno } from '@/hooks/useEfectivoRequiereTurno'
import { OpenShiftModal } from '@/components/shift/OpenShiftModal'

/** Aviso + "Abrir turno" cuando el método es efectivo y no hay turno. Ver src/hooks/useEfectivoRequiereTurno.ts. */
export function AvisoEfectivoRequiereTurno({ metodo }: { metodo: string }) {
  const { estado } = useEfectivoRequiereTurno(metodo)
  const [abrir, setAbrir] = useState(false)

  if (estado === 'cargando') {
    return (
      <div data-testid="efectivo-turno" data-estado="cargando"
        style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#94a3b8' }}>
        <Loader2 size={12} className="animate-spin" /> Verificando el turno de caja…
      </div>
    )
  }
  if (estado !== 'sin-turno') return <span data-testid="efectivo-turno" data-estado={estado} hidden />

  return (
    <>
      <div data-testid="efectivo-turno" data-estado="sin-turno" role="alert"
        style={{ marginTop: 8, padding: '10px 12px', borderRadius: 9, background: '#fffbeb', border: '1px solid #fde68a', display: 'flex', alignItems: 'flex-start', gap: 9 }}>
        <AlertTriangle size={15} color="#92400e" style={{ flexShrink: 0, marginTop: 1 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: '#92400e' }}>No hay turno de caja abierto</div>
          <div style={{ fontSize: 12, color: '#92400e', marginTop: 2 }}>
            Para recibir efectivo hay que abrir el turno: si no, la plata no entra a ningún cierre de caja.
            Otros métodos (tarjeta, transferencia, Nequi) se pueden registrar sin turno.
          </div>
          <button type="button" data-testid="efectivo-abrir-turno" onClick={() => setAbrir(true)}
            style={{ marginTop: 8, padding: '6px 12px', border: 'none', borderRadius: 8, background: '#10b981', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            Abrir turno
          </button>
        </div>
      </div>
      {abrir && <OpenShiftModal onClose={() => setAbrir(false)} onOpened={() => setAbrir(false)} />}
    </>
  )
}
