import { useState } from 'react'
import { X, DollarSign, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { useCashShift } from '@/hooks/useCashShift'

const formatCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n)

const METHOD_LABELS: Record<string, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
  nequi: 'Nequi',
}

interface CloseShiftModalProps {
  onClose: () => void
}

export function CloseShiftModal({ onClose }: CloseShiftModalProps) {
  const { currentShift, salesSummary, movements, closeShift, isClosingShift } = useCashShift()
  const [rawAmount, setRawAmount] = useState('')

  const declared = parseInt(rawAmount.replace(/\D/g, ''), 10) || 0

  const cashSales = salesSummary?.cash ?? 0
  const movementsIn = movements.filter(m => m.type === 'in').reduce((s, m) => s + m.amount, 0)
  const movementsOut = movements.filter(m => m.type === 'out').reduce((s, m) => s + m.amount, 0)
  const expectedCash = (currentShift?.opening_amount ?? 0) + cashSales + movementsIn - movementsOut
  const difference = declared - expectedCash

  const canClose = rawAmount.length > 0

  const handleClose = async () => {
    if (!canClose || isClosingShift) return
    try {
      await closeShift(declared)
      onClose()
    } catch {
      // error toast handled in hook
    }
  }

  const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 0',
    fontSize: 13.5, color: '#334155',
  }

  const totalRowStyle: React.CSSProperties = {
    ...rowStyle,
    borderTop: '1px solid #e5e7eb',
    marginTop: 4, paddingTop: 12,
    fontWeight: 700, fontSize: 14, color: '#0f172a',
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '12px 14px 12px 32px',
    border: '1.5px solid #e5e7eb', borderRadius: 10,
    fontSize: 18, fontWeight: 600, color: '#0f172a',
    fontFamily: 'monospace', outline: 'none',
    boxSizing: 'border-box', background: '#f8fafc',
    transition: 'border .12s, background .12s',
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(15,23,42,.55)',
        display: 'grid', placeItems: 'center',
        zIndex: 50, fontFamily: 'Inter, system-ui, sans-serif',
        padding: '20px',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: '#fff', borderRadius: 14,
        width: 520, maxWidth: '100%',
        boxShadow: '0 25px 50px -12px rgba(0,0,0,.25)',
        overflow: 'hidden', maxHeight: '92vh',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          padding: '18px 22px', borderBottom: '1px solid #f1f5f9',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#10b981', textTransform: 'uppercase', letterSpacing: 1 }}>
              Resumen del turno
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', letterSpacing: -0.3, marginTop: 1 }}>
              Cerrar turno de caja
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 32, height: 32, borderRadius: 8,
              background: '#f1f5f9', border: 'none',
              cursor: 'pointer', color: '#64748b',
              display: 'grid', placeItems: 'center',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ overflow: 'auto', flex: 1, padding: '22px' }}>

          {/* Sales breakdown */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
              Ventas por método de pago
            </div>
            <div style={{ background: '#f8fafc', borderRadius: 10, padding: '4px 14px' }}>
              {(['cash', 'card', 'transfer', 'nequi'] as const).map((method) => {
                const amount = salesSummary?.[method] ?? 0
                return (
                  <div key={method} style={{ ...rowStyle, borderBottom: '1px solid #f1f5f9' }}>
                    <span style={{ color: '#64748b' }}>{METHOD_LABELS[method]}</span>
                    <span style={{ fontFamily: 'monospace', fontWeight: amount > 0 ? 600 : 400, color: amount > 0 ? '#0f172a' : '#94a3b8' }}>
                      {formatCOP(amount)}
                    </span>
                  </div>
                )
              })}
              <div style={totalRowStyle}>
                <span>Total ventas</span>
                <span style={{ fontFamily: 'monospace', color: '#10b981' }}>
                  {formatCOP(salesSummary?.total ?? 0)}
                </span>
              </div>
            </div>
          </div>

          {/* Expected cash calculation */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
              Cálculo de efectivo esperado
            </div>
            <div style={{ background: '#f8fafc', borderRadius: 10, padding: '4px 14px' }}>
              <div style={{ ...rowStyle, borderBottom: '1px solid #f1f5f9' }}>
                <span style={{ color: '#64748b' }}>Monto de apertura</span>
                <span style={{ fontFamily: 'monospace' }}>{formatCOP(currentShift?.opening_amount ?? 0)}</span>
              </div>
              <div style={{ ...rowStyle, borderBottom: '1px solid #f1f5f9' }}>
                <span style={{ color: '#64748b' }}>Ventas en efectivo</span>
                <span style={{ fontFamily: 'monospace' }}>+ {formatCOP(cashSales)}</span>
              </div>
              {movementsIn > 0 && (
                <div style={{ ...rowStyle, borderBottom: '1px solid #f1f5f9' }}>
                  <span style={{ color: '#64748b' }}>Ingresos manuales</span>
                  <span style={{ fontFamily: 'monospace', color: '#059669' }}>+ {formatCOP(movementsIn)}</span>
                </div>
              )}
              {movementsOut > 0 && (
                <div style={{ ...rowStyle, borderBottom: '1px solid #f1f5f9' }}>
                  <span style={{ color: '#64748b' }}>Egresos manuales</span>
                  <span style={{ fontFamily: 'monospace', color: '#dc2626' }}>− {formatCOP(movementsOut)}</span>
                </div>
              )}
              <div style={totalRowStyle}>
                <span>Efectivo esperado</span>
                <span style={{ fontFamily: 'monospace' }}>{formatCOP(expectedCash)}</span>
              </div>
            </div>
          </div>

          {/* Declared amount input */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 8 }}>
              Monto declarado en caja <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <div style={{ position: 'relative' }}>
              <div style={{
                position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)',
                color: '#94a3b8', pointerEvents: 'none',
              }}>
                <DollarSign size={14} />
              </div>
              <input
                type="text"
                inputMode="numeric"
                value={rawAmount ? formatCOP(declared).replace('$', '').trim() : ''}
                onChange={(e) => setRawAmount(e.target.value.replace(/\D/g, ''))}
                placeholder="0"
                autoFocus
                style={inputStyle}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = '#10b981'
                  e.currentTarget.style.background = '#fff'
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = '#e5e7eb'
                  e.currentTarget.style.background = '#f8fafc'
                }}
              />
            </div>
          </div>

          {/* Difference */}
          {canClose && (
            <div style={{
              padding: '14px 16px', borderRadius: 10,
              background: difference === 0 ? '#ecfdf5' : difference > 0 ? '#ecfdf5' : '#fef2f2',
              border: `1px solid ${difference === 0 ? '#a7f3d0' : difference > 0 ? '#a7f3d0' : '#fecaca'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {difference > 0
                  ? <TrendingUp size={16} color="#059669" />
                  : difference < 0
                    ? <TrendingDown size={16} color="#dc2626" />
                    : <Minus size={16} color="#10b981" />
                }
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: difference >= 0 ? '#065f46' : '#991b1b' }}>
                    {difference > 0 ? 'Sobrante' : difference < 0 ? 'Faltante' : 'Cuadre exacto'}
                  </div>
                  <div style={{ fontSize: 11.5, color: difference >= 0 ? '#059669' : '#b91c1c', marginTop: 1 }}>
                    {difference === 0
                      ? 'El monto declarado coincide exactamente'
                      : difference > 0
                        ? 'Hay más efectivo del esperado'
                        : 'Hay menos efectivo del esperado'}
                  </div>
                </div>
              </div>
              <span style={{
                fontFamily: 'monospace', fontSize: 17, fontWeight: 700,
                color: difference >= 0 ? '#059669' : '#dc2626',
              }}>
                {difference >= 0 ? '+' : ''}{formatCOP(difference)}
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '16px 22px', borderTop: '1px solid #f1f5f9',
          display: 'flex', gap: 10, flexShrink: 0,
          background: 'linear-gradient(180deg, #f8fafc 0%, #fff 100%)',
        }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              flex: 1, padding: '11px 16px',
              border: '1.5px solid #e5e7eb', background: '#fff',
              borderRadius: 9, cursor: 'pointer',
              fontSize: 13.5, fontWeight: 600, color: '#334155',
            }}
          >
            Cancelar
          </button>
          <button
            onClick={handleClose}
            disabled={!canClose || isClosingShift}
            style={{
              flex: 2, padding: '11px 16px', border: 'none',
              background: !canClose || isClosingShift ? '#cbd5e1' : '#0f172a',
              borderRadius: 9,
              cursor: !canClose || isClosingShift ? 'not-allowed' : 'pointer',
              fontSize: 13.5, fontWeight: 700, color: '#fff',
              transition: 'all .15s',
            }}
          >
            {isClosingShift ? 'Cerrando turno...' : 'Confirmar cierre'}
          </button>
        </div>
      </div>
    </div>
  )
}
