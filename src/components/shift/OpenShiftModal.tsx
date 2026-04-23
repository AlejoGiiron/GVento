import { useState } from 'react'
import { DollarSign, Wallet } from 'lucide-react'
import { useCashShift } from '@/hooks/useCashShift'

const formatCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n)

export function OpenShiftModal() {
  const { openShift, isOpeningShift } = useCashShift()
  const [rawAmount, setRawAmount] = useState('')

  const amount = parseInt(rawAmount.replace(/\D/g, ''), 10) || 0
  const isValid = amount >= 0

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isValid || isOpeningShift) return
    try {
      await openShift(amount)
    } catch {
      // error toast handled in hook
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(15,23,42,.85)',
        display: 'grid', placeItems: 'center',
        zIndex: 100,
        fontFamily: 'Inter, system-ui, sans-serif',
        padding: '20px',
      }}
    >
      <div style={{
        background: '#fff', borderRadius: 16,
        width: 420, maxWidth: '100%',
        boxShadow: '0 25px 60px -12px rgba(0,0,0,.4)',
        overflow: 'hidden',
      }}>
        {/* Top accent */}
        <div style={{ height: 4, background: 'linear-gradient(90deg, #10b981, #059669)' }} />

        <div style={{ padding: '32px 32px 28px' }}>
          {/* Icon + heading */}
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <div style={{
              width: 56, height: 56, borderRadius: 16,
              background: '#ecfdf5',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 16px',
            }}>
              <Wallet size={26} color="#10b981" strokeWidth={1.8} />
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#10b981', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
              Antes de comenzar
            </div>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', letterSpacing: -0.5, margin: 0 }}>
              Abrir turno de caja
            </h2>
            <p style={{ fontSize: 13, color: '#64748b', marginTop: 8, marginBottom: 0, lineHeight: 1.5 }}>
              Ingresa el efectivo que hay en caja al iniciar el turno. Este monto se usará para calcular diferencias al cierre.
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 8 }}>
                Efectivo en caja al inicio
              </label>
              <div style={{ position: 'relative' }}>
                <div style={{
                  position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)',
                  display: 'flex', alignItems: 'center', gap: 4,
                  color: '#94a3b8', pointerEvents: 'none',
                }}>
                  <DollarSign size={14} />
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  value={rawAmount ? formatCOP(amount).replace('$', '').trim() : ''}
                  onChange={(e) => setRawAmount(e.target.value.replace(/\D/g, ''))}
                  placeholder="0"
                  autoFocus
                  style={{
                    width: '100%', padding: '12px 14px 12px 32px',
                    border: '1.5px solid #e5e7eb', borderRadius: 10,
                    fontSize: 18, fontWeight: 600, color: '#0f172a',
                    fontFamily: 'monospace',
                    outline: 'none', boxSizing: 'border-box',
                    background: '#f8fafc',
                    transition: 'border .12s, background .12s',
                  }}
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
              <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 6 }}>
                Puedes ingresar 0 si la caja está vacía
              </div>
            </div>

            <button
              type="submit"
              disabled={isOpeningShift}
              style={{
                width: '100%', padding: '13px',
                border: 'none', borderRadius: 10,
                background: isOpeningShift ? '#cbd5e1' : '#10b981',
                color: '#fff', fontSize: 14, fontWeight: 700,
                cursor: isOpeningShift ? 'not-allowed' : 'pointer',
                boxShadow: isOpeningShift ? 'none' : '0 6px 16px rgba(16,185,129,.35)',
                transition: 'all .15s',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              {isOpeningShift ? 'Abriendo turno...' : 'Abrir turno de caja →'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
