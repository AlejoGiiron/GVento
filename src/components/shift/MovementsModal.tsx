import { useState } from 'react'
import { X, ArrowDownLeft, ArrowUpRight, DollarSign, AlertTriangle } from 'lucide-react'
import { useCashShift } from '@/hooks/useCashShift'
import { useRestaurantConfig } from '@/hooks/useRestaurantConfig'
import { availableCash } from '@/lib/shiftCalc'

const OTHER_REASON = 'Otro'

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

interface MovementsModalProps {
  onClose: () => void
}

export function MovementsModal({ onClose }: MovementsModalProps) {
  const { currentShift, salesSummary, movements, addMovement, isAddingMovement } = useCashShift()
  const { config } = useRestaurantConfig()

  const [type, setType] = useState<'in' | 'out'>('in')
  const [rawAmount, setRawAmount] = useState('')
  const [reason, setReason] = useState('')           // ingresos (texto libre)
  const [outReason, setOutReason] = useState('')      // egresos (motivo de la lista)
  const [customReason, setCustomReason] = useState('') // egresos: fallback "Otro"
  const [overdraftPending, setOverdraftPending] = useState(false)

  // Motivos de egreso configurables; siempre garantizamos la opción "Otro".
  const configuredReasons = config.cash_out_reasons ?? []
  const outReasonOptions = configuredReasons.includes(OTHER_REASON)
    ? configuredReasons
    : [...configuredReasons, OTHER_REASON]

  const amount = parseInt(rawAmount.replace(/\D/g, ''), 10) || 0

  // Motivo efectivo según el tipo de movimiento.
  const effectiveReason =
    type === 'in'
      ? reason.trim()
      : outReason === OTHER_REASON
        ? customReason.trim()
        : outReason.trim()

  const isValid = amount > 0 && effectiveReason.length > 0

  // Efectivo disponible actual (apertura + ventas efectivo + ingresos − egresos previos).
  const movementsIn = movements.filter(m => m.type === 'in').reduce((s, m) => s + m.amount, 0)
  const movementsOut = movements.filter(m => m.type === 'out').reduce((s, m) => s + m.amount, 0)
  const cashOnHand = availableCash({
    openingAmount: currentShift?.opening_amount ?? 0,
    cashSales: salesSummary?.cash ?? 0,
    movementsIn,
    movementsOut,
  })
  const wouldOverdraft = type === 'out' && amount > cashOnHand

  const resetForm = () => {
    setRawAmount('')
    setReason('')
    setOutReason('')
    setCustomReason('')
    setOverdraftPending(false)
  }

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isValid || isAddingMovement) return
    // Sobregiro: advertir y exigir confirmación antes de registrar (no bloquea).
    if (wouldOverdraft && !overdraftPending) {
      setOverdraftPending(true)
      return
    }
    try {
      await addMovement({ type, amount, reason: effectiveReason })
      resetForm()
    } catch {
      // error toast handled in hook
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 13px',
    border: '1.5px solid #e5e7eb', borderRadius: 9,
    fontSize: 14, color: '#0f172a', outline: 'none',
    fontFamily: 'Inter, system-ui, sans-serif',
    boxSizing: 'border-box', background: '#fff',
    transition: 'border .12s',
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
        width: 500, maxWidth: '100%',
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
              Caja
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', letterSpacing: -0.3, marginTop: 1 }}>
              Movimientos manuales
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

        {/* Scrollable body */}
        <div style={{ overflow: 'auto', flex: 1, padding: '22px', display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* New movement form */}
          <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#334155' }}>Registrar movimiento</div>

            {/* Type selector */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button
                type="button"
                onClick={() => { setType('in'); setOverdraftPending(false) }}
                style={{
                  padding: '10px 12px', border: `2px solid ${type === 'in' ? '#10b981' : '#e5e7eb'}`,
                  borderRadius: 9, background: type === 'in' ? '#ecfdf5' : '#fff',
                  cursor: 'pointer', transition: 'all .12s',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                  fontSize: 13.5, fontWeight: 600,
                  color: type === 'in' ? '#065f46' : '#64748b',
                }}
              >
                <ArrowDownLeft size={15} color={type === 'in' ? '#10b981' : '#94a3b8'} />
                Ingreso
              </button>
              <button
                type="button"
                onClick={() => { setType('out'); setOverdraftPending(false) }}
                style={{
                  padding: '10px 12px', border: `2px solid ${type === 'out' ? '#dc2626' : '#e5e7eb'}`,
                  borderRadius: 9, background: type === 'out' ? '#fef2f2' : '#fff',
                  cursor: 'pointer', transition: 'all .12s',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                  fontSize: 13.5, fontWeight: 600,
                  color: type === 'out' ? '#991b1b' : '#64748b',
                }}
              >
                <ArrowUpRight size={15} color={type === 'out' ? '#dc2626' : '#94a3b8'} />
                Egreso
              </button>
            </div>

            {/* Amount */}
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                Monto <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <div style={{ position: 'relative' }}>
                <div style={{
                  position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)',
                  color: '#94a3b8', pointerEvents: 'none',
                }}>
                  <DollarSign size={13} />
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  data-testid="movement-amount"
                  value={rawAmount ? formatCOP(amount).replace('$', '').trim() : ''}
                  onChange={(e) => { setRawAmount(e.target.value.replace(/\D/g, '')); setOverdraftPending(false) }}
                  placeholder="0"
                  style={{ ...inputStyle, paddingLeft: 30, fontFamily: 'monospace', fontSize: 15, fontWeight: 600 }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = '#10b981' }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = '#e5e7eb' }}
                />
              </div>
            </div>

            {/* Reason */}
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                Motivo <span style={{ color: '#dc2626' }}>*</span>
              </label>
              {type === 'in' ? (
                <input
                  type="text"
                  data-testid="movement-reason-in"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Ej: Venta externa, cambio de billetes..."
                  style={inputStyle}
                  onFocus={(e) => { e.currentTarget.style.borderColor = '#10b981' }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = '#e5e7eb' }}
                />
              ) : (
                <>
                  <select
                    data-testid="movement-reason-out"
                    value={outReason}
                    onChange={(e) => setOutReason(e.target.value)}
                    style={{ ...inputStyle, cursor: 'pointer', appearance: 'auto' }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = '#10b981' }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = '#e5e7eb' }}
                  >
                    <option value="" disabled>Selecciona un motivo...</option>
                    {outReasonOptions.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                  {outReason === OTHER_REASON && (
                    <input
                      type="text"
                      data-testid="movement-reason-custom"
                      value={customReason}
                      onChange={(e) => setCustomReason(e.target.value)}
                      placeholder="Especifica el motivo..."
                      style={{ ...inputStyle, marginTop: 8 }}
                      autoFocus
                      onFocus={(e) => { e.currentTarget.style.borderColor = '#10b981' }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = '#e5e7eb' }}
                    />
                  )}
                </>
              )}
            </div>

            {/* Overdraft warning + confirmación (no bloquea) */}
            {overdraftPending && wouldOverdraft && (
              <div
                data-testid="overdraft-warning"
                style={{
                  padding: '12px 14px', borderRadius: 9,
                  background: '#fef2f2', border: '1px solid #fecaca',
                  display: 'flex', alignItems: 'flex-start', gap: 9,
                }}
              >
                <AlertTriangle size={16} color="#dc2626" style={{ flexShrink: 0, marginTop: 1 }} />
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: '#991b1b' }}>
                    Este egreso supera el efectivo disponible
                  </div>
                  <div style={{ fontSize: 11.5, color: '#b91c1c', marginTop: 2, lineHeight: 1.5 }}>
                    Disponible en caja: <strong>{formatCOP(cashOnHand)}</strong>. La caja quedará en{' '}
                    <strong data-testid="overdraft-amount">{formatCOP(cashOnHand - amount)}</strong>{' '}
                    (sobregiro de {formatCOP(amount - cashOnHand)}). Vuelve a presionar para
                    registrarlo de todos modos.
                  </div>
                </div>
              </div>
            )}

            <button
              type="submit"
              data-testid="movement-submit"
              disabled={!isValid || isAddingMovement}
              style={{
                padding: '10px 16px', border: 'none', borderRadius: 9,
                background: !isValid || isAddingMovement
                  ? '#cbd5e1'
                  : type === 'in' ? '#10b981' : '#dc2626',
                color: '#fff', fontSize: 13.5, fontWeight: 700,
                cursor: !isValid || isAddingMovement ? 'not-allowed' : 'pointer',
                boxShadow: !isValid || isAddingMovement ? 'none'
                  : type === 'in'
                    ? '0 4px 12px rgba(16,185,129,.35)'
                    : '0 4px 12px rgba(220,38,38,.25)',
                transition: 'all .15s',
              }}
            >
              {isAddingMovement
                ? 'Registrando...'
                : overdraftPending && wouldOverdraft
                  ? 'Registrar de todos modos'
                  : type === 'in' ? '+ Registrar ingreso' : '− Registrar egreso'}
            </button>
          </form>

          {/* Movements list */}
          {movements.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                Movimientos del turno
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {movements.map((m) => (
                  <div
                    key={m.id}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '10px 14px', borderRadius: 9,
                      background: m.type === 'in' ? '#f0fdf4' : '#fef2f2',
                      border: `1px solid ${m.type === 'in' ? '#bbf7d0' : '#fecaca'}`,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {m.type === 'in'
                        ? <ArrowDownLeft size={14} color="#10b981" />
                        : <ArrowUpRight size={14} color="#dc2626" />
                      }
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{m.reason}</div>
                        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>
                          {formatTime(m.created_at)}
                        </div>
                      </div>
                    </div>
                    <span style={{
                      fontFamily: 'monospace', fontWeight: 700, fontSize: 13.5,
                      color: m.type === 'in' ? '#059669' : '#dc2626',
                    }}>
                      {m.type === 'in' ? '+' : '−'} {formatCOP(m.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {movements.length === 0 && (
            <div style={{ textAlign: 'center', padding: '20px 0', color: '#94a3b8', fontSize: 13 }}>
              Sin movimientos manuales en este turno
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
