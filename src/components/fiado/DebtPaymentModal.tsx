import { useState } from 'react'
import { X, Loader2, HandCoins, Banknote } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { useRegisterDebtPayment, useDebtPayments } from '@/hooks/useDebts'
import type { Debt } from '@/hooks/useDebts'
import { PAYMENT_METHODS, paymentMethodLabel, type PaymentMethodValue } from '@/components/purchases/paymentMethods'

interface DebtPaymentModalProps {
  debt: Debt
  onClose: () => void
}

const formatCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)

const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))

const fieldLabel: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 6,
}
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 13px', border: '1.5px solid #e5e7eb', borderRadius: 9,
  fontSize: 14, color: '#0f172a', outline: 'none', boxSizing: 'border-box', background: '#fff',
}

export function DebtPaymentModal({ debt, onClose }: DebtPaymentModalProps) {
  const { registerDebtPayment, isRegistering } = useRegisterDebtPayment()
  const { payments, isLoading } = useDebtPayments(debt.id)

  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethodValue>('cash')

  const amountNum = parseInt(amount.replace(/\D/g, ''), 10) || 0
  const exceeds = amountNum > debt.saldo
  const isValid = amountNum > 0 && !exceeds

  const handleSubmit = async () => {
    if (amountNum <= 0) { toast.error('Ingresa el monto del abono'); return }
    if (exceeds) { toast.error('El abono no puede exceder el saldo pendiente'); return }
    await registerDebtPayment({ orderId: debt.id, amount: amountNum, paymentMethod: method })
    onClose()
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', display: 'grid', placeItems: 'center', zIndex: 50, fontFamily: 'Inter, system-ui, sans-serif', padding: 20 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        data-testid="debt-payment-modal"
        style={{ background: '#fff', borderRadius: 14, width: 480, maxWidth: '100%', maxHeight: '92vh', boxShadow: '0 25px 50px -12px rgba(0,0,0,.25)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
      >
        {/* Header */}
        <div style={{ padding: '18px 22px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#10b981', textTransform: 'uppercase', letterSpacing: 1 }}>Registrar abono</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', letterSpacing: -0.3, marginTop: 1 }}>
              {debt.customerName}{debt.order_number != null ? ` · Venta #${debt.order_number}` : ''}
            </div>
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, background: '#f1f5f9', border: 'none', cursor: 'pointer', color: '#64748b', display: 'grid', placeItems: 'center' }}><X size={16} /></button>
        </div>

        <div style={{ padding: 22, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Resumen de saldo */}
          <div style={{ display: 'flex', gap: 10 }}>
            {[
              { label: 'Total', value: debt.total, color: '#0f172a' },
              { label: 'Abonado', value: debt.abonado, color: '#059669' },
              { label: 'Saldo', value: debt.saldo, color: '#dc2626' },
            ].map((box) => (
              <div key={box.label} style={{ flex: 1, background: '#f8fafc', border: '1px solid #f1f5f9', borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ fontSize: 10.5, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>{box.label}</div>
                <div data-testid={`debt-${box.label.toLowerCase()}`} style={{ fontSize: 16, fontWeight: 700, fontFamily: 'monospace', color: box.color, marginTop: 2 }}>{formatCOP(box.value)}</div>
              </div>
            ))}
          </div>

          {/* Monto del abono */}
          <div>
            <label style={fieldLabel}>Monto del abono <span style={{ color: '#dc2626' }}>*</span></label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: `1.5px solid ${exceeds ? '#ef4444' : '#e5e7eb'}`, borderRadius: 9, padding: '10px 13px', background: '#fff' }}>
              <Banknote size={16} color="#94a3b8" />
              <input
                data-testid="debt-amount"
                value={amount ? formatCOP(amountNum) : ''}
                onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
                placeholder={formatCOP(debt.saldo)}
                inputMode="numeric"
                style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 18, fontWeight: 700, fontFamily: 'monospace', color: '#0f172a' }}
                autoFocus
              />
              <button
                data-testid="debt-amount-full"
                onClick={() => setAmount(String(debt.saldo))}
                style={{ padding: '5px 10px', border: '1.5px solid #a7f3d0', background: '#ecfdf5', borderRadius: 7, cursor: 'pointer', fontSize: 11.5, fontWeight: 700, color: '#065f46', flex: '0 0 auto' }}
              >
                Saldar
              </button>
            </div>
            {exceeds && (
              <div data-testid="debt-amount-error" style={{ marginTop: 6, fontSize: 11.5, color: '#b91c1c', fontWeight: 600 }}>
                El abono no puede exceder el saldo ({formatCOP(debt.saldo)}).
              </div>
            )}
          </div>

          {/* Método de pago */}
          <div>
            <label style={fieldLabel}>Método de pago</label>
            <select
              data-testid="debt-method"
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethodValue)}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <div style={{ marginTop: 6, fontSize: 11, color: '#94a3b8' }}>
              El efectivo entra a la caja del turno abierto como ingreso. Otros métodos no tocan caja.
            </div>
          </div>

          {/* Historial de abonos */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 6 }}>Abonos anteriores</div>
            {isLoading ? (
              <div style={{ fontSize: 12, color: '#94a3b8' }}>Cargando...</div>
            ) : payments.length === 0 ? (
              <div style={{ fontSize: 12, color: '#94a3b8' }}>Aún no hay abonos.</div>
            ) : (
              <div style={{ border: '1px solid #f1f5f9', borderRadius: 9, overflow: 'hidden' }}>
                {payments.map((p, idx) => (
                  <div key={p.id} data-testid="debt-payment-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: idx < payments.length - 1 ? '1px solid #f8fafc' : 'none', fontSize: 12.5 }}>
                    <span style={{ color: '#64748b' }}>{fmtDate(p.created_at)} · {paymentMethodLabel(p.payment_method)}</span>
                    <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#059669' }}>{formatCOP(p.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 22px', borderTop: '1px solid #f1f5f9', display: 'flex', gap: 10, justifyContent: 'flex-end', flexShrink: 0, background: 'linear-gradient(180deg, #f8fafc 0%, #fff 100%)' }}>
          <button onClick={onClose} style={{ padding: '10px 20px', border: '1.5px solid #e2e8f0', borderRadius: 9, background: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#334155' }}>Cancelar</button>
          <button
            data-testid="debt-submit"
            onClick={handleSubmit}
            disabled={!isValid || isRegistering}
            style={{ padding: '10px 24px', background: !isValid || isRegistering ? '#cbd5e1' : '#10b981', border: 'none', borderRadius: 10, cursor: !isValid || isRegistering ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 6, boxShadow: !isValid || isRegistering ? 'none' : '0 4px 12px rgba(16,185,129,.3)' }}
          >
            {isRegistering ? <Loader2 size={14} className="animate-spin" /> : <HandCoins size={15} />}
            {isRegistering ? 'Registrando...' : 'Registrar abono'}
          </button>
        </div>
      </div>
    </div>
  )
}
