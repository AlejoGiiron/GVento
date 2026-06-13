import { useState } from 'react'
import { Clock, ArrowRightLeft, PowerOff, MoonStar } from 'lucide-react'
import { useCashShift } from '@/hooks/useCashShift'
import { CloseShiftModal } from './CloseShiftModal'
import { MovementsModal } from './MovementsModal'

const formatCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n)

const formatTime = (isoStr: string) =>
  new Intl.DateTimeFormat('es-CO', {
    hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Bogota', hour12: false,
  }).format(new Date(isoStr))

export function ShiftBanner() {
  const { currentShift, salesSummary } = useCashShift()
  const [showClose, setShowClose] = useState(false)
  const [showMovements, setShowMovements] = useState(false)

  // Sin turno activo: píldora gris "Sin turno" (no bloquea la navegación)
  if (!currentShift) {
    return (
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 7,
        padding: '6px 12px', borderRadius: 9,
        background: '#f1f5f9', border: '1px solid #e2e8f0',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}>
        <MoonStar size={13} color="#94a3b8" strokeWidth={2} />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: '#64748b' }}>
          Sin turno
        </span>
      </div>
    )
  }

  const totalSales = salesSummary?.total ?? 0

  return (
    <>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        fontFamily: 'Inter, system-ui, sans-serif',
      }}>
        {/* Shift info pill */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 12px', borderRadius: 9,
          background: '#ecfdf5', border: '1px solid #a7f3d0',
        }}>
          {/* Green pulse dot */}
          <span style={{
            width: 7, height: 7, borderRadius: '50%',
            background: '#10b981', flexShrink: 0,
            boxShadow: '0 0 0 2px rgba(16,185,129,.25)',
          }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Clock size={13} color="#059669" strokeWidth={2} />
            <span style={{ fontSize: 12.5, fontWeight: 600, color: '#065f46' }}>
              Turno desde {formatTime(currentShift.opened_at)}
            </span>
          </div>

          <span style={{ width: 1, height: 14, background: '#a7f3d0' }} />

          <span style={{ fontSize: 12.5, fontWeight: 700, color: '#059669', fontFamily: 'monospace' }}>
            {formatCOP(totalSales)}
          </span>
        </div>

        {/* Movements button */}
        <button
          onClick={() => setShowMovements(true)}
          title="Movimientos de caja"
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '6px 10px', borderRadius: 8,
            border: '1px solid #e2e8f0', background: '#fff',
            cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#64748b',
            transition: 'all .12s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = '#10b981'
            e.currentTarget.style.color = '#059669'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = '#e2e8f0'
            e.currentTarget.style.color = '#64748b'
          }}
        >
          <ArrowRightLeft size={13} />
          Movimientos
        </button>

        {/* Close shift button */}
        <button
          onClick={() => setShowClose(true)}
          title="Cerrar turno"
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '6px 10px', borderRadius: 8,
            border: '1px solid #fecaca', background: '#fef2f2',
            cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#dc2626',
            transition: 'all .12s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#fee2e2'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = '#fef2f2'
          }}
        >
          <PowerOff size={13} />
          Cerrar turno
        </button>
      </div>

      {showClose && <CloseShiftModal onClose={() => setShowClose(false)} />}
      {showMovements && <MovementsModal onClose={() => setShowMovements(false)} />}
    </>
  )
}
