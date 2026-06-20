import { useState, useEffect } from 'react'
import { X, ChevronRight, Plus, Minus } from 'lucide-react'
import { useInventory } from '@/hooks/useInventory'
import type { ProductWithCategory } from '@/stores/cartStore'

interface StockAdjustModalProps {
  /** Productos candidatos (simple con stock_tracking). */
  products: ProductWithCategory[]
  /** Producto preseleccionado (al ajustar desde una fila). */
  preselectedId?: string | null
  onClose: () => void
}

const fieldLabel: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 6,
}
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 13px', border: '1.5px solid #e5e7eb', borderRadius: 9,
  fontSize: 14, color: '#0f172a', outline: 'none', boxSizing: 'border-box', background: '#fff',
}

/**
 * Ajuste manual de stock. qty CON SIGNO (+entrada / −salida) con preview del
 * stock resultante (rojo si queda negativo). Llama a la RPC adjust_stock.
 */
export function StockAdjustModal({ products, preselectedId, onClose }: StockAdjustModalProps) {
  const { adjust } = useInventory()
  const [productId, setProductId] = useState(preselectedId ?? '')
  const [sign, setSign] = useState<1 | -1>(1)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const selected = products.find(p => p.id === productId) ?? null
  const current = selected?.stock_qty ?? 0
  const delta = (parseInt(amount, 10) || 0) * sign
  const resulting = current + delta
  const isValid = !!productId && delta !== 0 && reason.trim().length > 0

  const handleSubmit = async () => {
    if (!isValid) return
    await adjust.mutateAsync({ productId, qty: delta, reason: reason.trim() })
    onClose()
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)',
        display: 'grid', placeItems: 'center', zIndex: 50,
        fontFamily: 'Inter, system-ui, sans-serif', padding: 20,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        data-testid="stock-adjust-modal"
        style={{
          background: '#fff', borderRadius: 14, width: 460, maxWidth: '100%',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,.25)', overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ padding: '18px 22px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#10b981', textTransform: 'uppercase', letterSpacing: 1 }}>
              Inventario
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', letterSpacing: -0.3, marginTop: 1 }}>
              Ajuste manual de stock
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
        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Producto */}
          <div>
            <label style={fieldLabel}>Producto</label>
            <select
              data-testid="adjust-product"
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              <option value="">Seleccionar insumo...</option>
              {products.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Stock actual */}
          {selected && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 9, background: '#f8fafc', border: '1px solid #e5e7eb' }}>
              <span style={{ fontSize: 12.5, color: '#64748b' }}>Stock actual</span>
              <span data-testid="adjust-current" style={{ fontSize: 16, fontWeight: 700, fontFamily: 'monospace', color: current < 0 ? '#b91c1c' : '#0f172a' }}>
                {current}
              </span>
            </div>
          )}

          {/* Cantidad con signo */}
          <div>
            <label style={fieldLabel}>Cantidad</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ display: 'flex', borderRadius: 9, overflow: 'hidden', border: '1.5px solid #e5e7eb', flexShrink: 0 }}>
                <button
                  type="button"
                  data-testid="adjust-sign-in"
                  onClick={() => setSign(1)}
                  title="Entrada"
                  style={{ width: 42, border: 'none', cursor: 'pointer', background: sign === 1 ? '#ecfdf5' : '#fff', color: sign === 1 ? '#059669' : '#94a3b8', display: 'grid', placeItems: 'center' }}
                >
                  <Plus size={16} strokeWidth={2.5} />
                </button>
                <button
                  type="button"
                  data-testid="adjust-sign-out"
                  onClick={() => setSign(-1)}
                  title="Salida"
                  style={{ width: 42, border: 'none', borderLeft: '1.5px solid #e5e7eb', cursor: 'pointer', background: sign === -1 ? '#fef2f2' : '#fff', color: sign === -1 ? '#dc2626' : '#94a3b8', display: 'grid', placeItems: 'center' }}
                >
                  <Minus size={16} strokeWidth={2.5} />
                </button>
              </div>
              <input
                type="number"
                min={1}
                data-testid="adjust-amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
                placeholder="0"
                style={{ ...inputStyle, fontFamily: 'monospace', fontWeight: 700 }}
              />
            </div>
          </div>

          {/* Preview resultante */}
          {selected && delta !== 0 && (
            <div
              data-testid="adjust-preview"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px', borderRadius: 9,
                background: resulting < 0 ? '#fef2f2' : '#ecfdf5',
                border: `1px solid ${resulting < 0 ? '#fecaca' : '#a7f3d0'}`,
              }}
            >
              <span style={{ fontSize: 12.5, fontWeight: 600, color: resulting < 0 ? '#b91c1c' : '#065f46' }}>
                Stock resultante
              </span>
              <span style={{ fontSize: 18, fontWeight: 700, fontFamily: 'monospace', color: resulting < 0 ? '#b91c1c' : '#065f46' }}>
                {current} {delta >= 0 ? '+' : '−'} {Math.abs(delta)} = {resulting}
              </span>
            </div>
          )}

          {/* Motivo */}
          <div>
            <label style={fieldLabel}>Motivo <span style={{ color: '#dc2626' }}>*</span></label>
            <input
              type="text"
              data-testid="adjust-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ej: compra, merma, conteo físico..."
              style={inputStyle}
              onFocus={(e) => { e.currentTarget.style.borderColor = '#10b981' }}
              onBlur={(e) => { e.currentTarget.style.borderColor = '#e5e7eb' }}
            />
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '16px 22px', borderTop: '1px solid #f1f5f9', display: 'flex', gap: 10, background: 'linear-gradient(180deg, #f8fafc 0%, #fff 100%)' }}>
          <button
            type="button"
            onClick={onClose}
            style={{ flex: 1, padding: '11px 16px', border: '1.5px solid #e5e7eb', background: '#fff', borderRadius: 9, cursor: 'pointer', fontSize: 13.5, fontWeight: 600, color: '#334155' }}
          >
            Cancelar
          </button>
          <button
            type="button"
            data-testid="adjust-confirm"
            onClick={handleSubmit}
            disabled={!isValid || adjust.isPending}
            style={{
              flex: 2, padding: '11px 16px', border: 'none', borderRadius: 9,
              background: !isValid || adjust.isPending ? '#cbd5e1' : '#10b981',
              cursor: !isValid || adjust.isPending ? 'not-allowed' : 'pointer',
              fontSize: 13.5, fontWeight: 700, color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              boxShadow: !isValid || adjust.isPending ? 'none' : '0 6px 16px rgba(16,185,129,.35)',
            }}
          >
            {adjust.isPending ? 'Aplicando...' : <><span>Aplicar ajuste</span><ChevronRight size={15} /></>}
          </button>
        </div>
      </div>
    </div>
  )
}
