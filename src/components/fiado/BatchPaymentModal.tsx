import { useState } from 'react'
import { X, Loader2, HandCoins, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useRegisterDebtPaymentsBatch } from '@/hooks/useDebts'
import type { Debt } from '@/hooks/useDebts'
import { splitFifo } from '@/lib/splitFifo'
import { PAYMENT_METHODS, type PaymentMethodValue } from '@/components/purchases/paymentMethods'

const formatCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n)

interface BatchPaymentModalProps {
  customerName: string
  /** Las deudas SELECCIONADAS. El orden en que llegan es indistinto: el reparto
   *  lo ordena por antigüedad, igual que la RPC. */
  debts: Debt[]
  onClose: () => void
  onDone: () => void
}

const fieldLabel: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 6,
}

export function BatchPaymentModal({ customerName, debts, onClose, onDone }: BatchPaymentModalProps) {
  const { registerBatch, isRegistering } = useRegisterDebtPaymentsBatch()
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethodValue>('cash')

  const amountNum = parseInt(amount.replace(/\D/g, ''), 10) || 0

  // ── LA PREVISUALIZACIÓN ────────────────────────────────────────────────────
  // Sale de la MISMA función pura que documenta el contrato con el SQL
  // (src/lib/splitFifo.ts). Sin esto el cajero confirma a ciegas: pone un monto
  // y no sabe qué venta queda saldada ni cuál abonada.
  const split = splitFifo(debts, amountNum)

  // El sobrepago se bloquea acá por CONVENIENCIA — para que el cajero vea el
  // motivo antes de confirmar. La garantía es la RPC, que lo rechaza igual
  // aunque este botón se habilite por un bug (mismo reparto que anular-venta).
  const puedeConfirmar = amountNum > 0 && !split.excede && !isRegistering

  const handleSubmit = async () => {
    if (!puedeConfirmar) return
    await registerBatch({
      orderIds: debts.map((d) => d.id),
      amount: amountNum,
      paymentMethod: method,
    })
    onDone()
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', display: 'grid', placeItems: 'center', zIndex: 50, fontFamily: 'Inter, system-ui, sans-serif', padding: 20 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        data-testid="batch-payment-modal"
        style={{ background: '#fff', borderRadius: 14, width: 520, maxWidth: '100%', maxHeight: '92vh', boxShadow: '0 25px 50px -12px rgba(0,0,0,.25)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
      >
        {/* Header */}
        <div style={{ padding: '18px 22px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#10b981', textTransform: 'uppercase', letterSpacing: 1 }}>
              Pago de varias ventas
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', letterSpacing: -0.3, marginTop: 1 }}>
              {customerName}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ width: 32, height: 32, borderRadius: 8, background: '#f1f5f9', border: 'none', cursor: 'pointer', color: '#64748b', display: 'grid', placeItems: 'center' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ overflow: 'auto', flex: 1, padding: 22 }}>

          {/* Resumen de lo seleccionado */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderRadius: 10, background: '#f8fafc', border: '1px solid #e5e7eb', marginBottom: 18 }}>
            <span style={{ fontSize: 13, color: '#64748b' }}>
              {debts.length} venta{debts.length === 1 ? '' : 's'} seleccionada{debts.length === 1 ? '' : 's'}
            </span>
            <span data-testid="batch-saldo-total" style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 700, color: '#dc2626' }}>
              {formatCOP(split.saldoSeleccionado)}
            </span>
          </div>

          {/* Monto */}
          <div style={{ marginBottom: 18 }}>
            <label style={fieldLabel}>
              Monto que entrega el cliente <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <input
              data-testid="batch-amount"
              inputMode="numeric"
              autoFocus
              value={amount ? formatCOP(amountNum).replace('$', '').trim() : ''}
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
              placeholder="0"
              style={{
                width: '100%', boxSizing: 'border-box', padding: '12px 14px',
                border: `1.5px solid ${split.excede ? '#fecaca' : '#e5e7eb'}`,
                borderRadius: 10, fontSize: 18, fontWeight: 600,
                color: '#0f172a', fontFamily: 'monospace', outline: 'none',
                background: split.excede ? '#fef2f2' : '#f8fafc',
              }}
            />
            {split.excede && (
              <p data-testid="batch-excede" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: '#b91c1c', marginTop: 7, lineHeight: 1.4 }}>
                <AlertTriangle size={12} style={{ flexShrink: 0 }} />
                Supera el saldo seleccionado en {formatCOP(split.sobrante)}. Una deuda no da vuelto:
                cobrá el saldo exacto o seleccioná otra venta.
              </p>
            )}
          </div>

          {/* Método — UNO para todo el lote (pago mixto está fuera de alcance) */}
          <div style={{ marginBottom: 18 }}>
            <label style={fieldLabel}>Método de pago</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  data-testid={`batch-method-${m.value}`}
                  onClick={() => setMethod(m.value)}
                  style={{
                    padding: '8px 14px', borderRadius: 9, cursor: 'pointer',
                    fontSize: 12.5, fontWeight: 600,
                    border: `1.5px solid ${method === m.value ? '#10b981' : '#e5e7eb'}`,
                    background: method === m.value ? '#ecfdf5' : '#fff',
                    color: method === m.value ? '#047857' : '#334155',
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* ── PREVISUALIZACIÓN DEL REPARTO ────────────────────────────────
              Lo que el cajero necesita ver ANTES de confirmar: qué venta queda
              saldada y cuál abonada. El orden es el mismo que impone la RPC
              (más vieja primero), así que lo que se lee acá es lo que pasa. */}
          <div>
            <label style={fieldLabel}>Cómo se reparte</label>
            {split.allocations.length === 0 ? (
              <div data-testid="batch-preview-empty" style={{ padding: '18px 16px', borderRadius: 10, background: '#f8fafc', border: '1px dashed #e5e7eb', textAlign: 'center', fontSize: 12.5, color: '#94a3b8' }}>
                Escribí el monto para ver el reparto
              </div>
            ) : (
              <div data-testid="batch-preview" style={{ borderRadius: 10, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
                {split.allocations.map((a, i) => (
                  <div
                    key={a.id}
                    data-testid="batch-preview-row"
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      gap: 10, padding: '10px 14px',
                      borderTop: i === 0 ? 'none' : '1px solid #f1f5f9',
                      background: a.saldada ? '#f0fdf4' : '#fff',
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                      {a.saldada
                        ? <CheckCircle2 size={13} color="#059669" style={{ flexShrink: 0 }} />
                        : <HandCoins size={13} color="#b45309" style={{ flexShrink: 0 }} />}
                      <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12.5, color: '#0f172a' }}>
                        {a.order_number != null ? `#${a.order_number}` : '—'}
                      </span>
                      <span style={{ fontFamily: 'monospace', fontSize: 12.5, color: '#334155' }}>
                        {formatCOP(a.applied)}
                      </span>
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: a.saldada ? '#059669' : '#b45309', textAlign: 'right' }}>
                      {a.saldada
                        ? 'saldado'
                        : `abonado, quedan ${formatCOP(a.saldoRestante)}`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '16px 22px', borderTop: '1px solid #f1f5f9', display: 'flex', gap: 10, flexShrink: 0, background: 'linear-gradient(180deg, #f8fafc 0%, #fff 100%)' }}>
          <button
            type="button"
            onClick={onClose}
            style={{ flex: 1, padding: '11px 16px', border: '1.5px solid #e5e7eb', background: '#fff', borderRadius: 9, cursor: 'pointer', fontSize: 13.5, fontWeight: 600, color: '#334155' }}
          >
            Cancelar
          </button>
          <button
            data-testid="batch-confirm"
            onClick={handleSubmit}
            disabled={!puedeConfirmar}
            title={split.excede ? 'El monto excede el saldo seleccionado' : undefined}
            style={{
              flex: 2, padding: '11px 16px', border: 'none',
              background: puedeConfirmar ? '#10b981' : '#cbd5e1',
              borderRadius: 9, cursor: puedeConfirmar ? 'pointer' : 'not-allowed',
              fontSize: 13.5, fontWeight: 700, color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            }}
          >
            {isRegistering
              ? <><Loader2 size={15} className="animate-spin" /> Registrando…</>
              : <><HandCoins size={15} /> Confirmar pago</>}
          </button>
        </div>
      </div>
    </div>
  )
}
