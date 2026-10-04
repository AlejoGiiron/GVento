import { useCashShift } from '@/hooks/useCashShift'
import { useMisVentas } from '@/hooks/usePosMovil'
import { M, formatCOP } from '@/components/movil/estilo'
import type { Enums } from '@/types/database.types'

const NOMBRE: Record<Enums<'payment_method'>, string> = { cash: 'Efectivo', nequi: 'Nequi', card: 'Tarjeta', transfer: 'Transferencia' }

const hora = (iso: string) =>
  new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Bogota' }).format(new Date(iso))

/**
 * Lo que cobró el usuario logueado en el turno abierto de la sede (ver
 * useMisVentas: de dónde sale "quién cobró" y por qué es la misma ventana que el
 * arqueo). Es informativo: no cierra nada ni entrega plata.
 */
export function MisVentasMovil() {
  const { isOpen, isLoadingShift } = useCashShift()
  const { data, isLoading, isError } = useMisVentas()

  if (isLoadingShift) return <Centro>Cargando…</Centro>
  if (!isOpen) return <Centro testid="m-mis-ventas-sin-turno">No hay turno abierto. Tus ventas aparecen cuando se abre la caja.</Centro>
  if (isError) return <Centro>No se pudieron cargar tus ventas. Revisá la conexión.</Centro>
  // Mientras carga NO se muestran ceros: un "$0" que en realidad es "todavía no
  // sé" es un dato falso (DEUDAS → "Ausencias y ceros que la UI muestra mientras carga").
  if (isLoading || !data) return <Centro>Cargando tus ventas…</Centro>

  const otros = data.porMetodo.card + data.porMetodo.transfer
  return (
    <div data-testid="m-mis-ventas" style={{ padding: 12, display: 'grid', gap: 12 }}>
      <div style={{ fontSize: 13, color: M.suave }}>Tus ventas de este turno</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Cifra testid="m-mis-efectivo" titulo="Efectivo" valor={data.porMetodo.cash} color={M.verde} />
        <Cifra testid="m-mis-nequi" titulo="Nequi" valor={data.porMetodo.nequi} color={M.nequi} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', background: M.panel, borderRadius: 14, padding: '12px 14px', fontSize: 15 }}>
        <span>Ventas: <b data-testid="m-mis-cantidad">{data.cantidad}</b></span>
        {otros > 0 && <span style={{ color: M.suave }}>Otros: {formatCOP(otros)}</span>}
      </div>

      <div style={{ display: 'grid' }}>
        {data.ventas.slice(0, 30).map((v) => (
          <div key={v.orderId} data-testid="m-mi-venta" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 2px', borderBottom: `1px solid ${M.borde}` }}>
            <div style={{ width: 64, fontWeight: 700 }}>{v.numero != null ? `#${v.numero}` : '—'}</div>
            <div style={{ flex: 1, color: M.suave, fontSize: 14 }}>
              {hora(v.creada)} · {v.metodos.length ? v.metodos.map((m) => NOMBRE[m]).join(' + ') : 'Gratis'}
            </div>
            <div style={{ fontFamily: 'monospace', fontWeight: 600 }}>{formatCOP(v.cobrado)}</div>
          </div>
        ))}
        {data.ventas.length === 0 && <div style={{ color: M.suave, padding: 24, textAlign: 'center' }}>Todavía no cobraste nada en este turno.</div>}
      </div>
    </div>
  )
}

function Cifra({ titulo, valor, color, testid }: { titulo: string; valor: number; color: string; testid: string }) {
  return (
    <div style={{ background: M.panel, borderRadius: 14, padding: '14px', borderTop: `4px solid ${color}` }}>
      <div style={{ fontSize: 13, color: M.suave }}>{titulo}</div>
      <div data-testid={testid} style={{ fontSize: 22, fontWeight: 800, fontFamily: 'monospace' }}>{formatCOP(valor)}</div>
    </div>
  )
}

function Centro({ children, testid }: { children: React.ReactNode; testid?: string }) {
  return <div data-testid={testid} style={{ padding: 32, textAlign: 'center', color: M.suave, fontSize: 15 }}>{children}</div>
}
