import { useMemo, useState } from 'react'
import { X, Plus, Trash2, Loader2, PackageCheck } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { useSuppliers } from '@/hooks/useSuppliers'
import { useProducts } from '@/hooks/useProducts'
import { useRegisterPurchase } from '@/hooks/usePurchases'
import type { PaymentMethodValue } from '@/components/purchases/paymentMethods'
import { PAYMENT_METHODS } from '@/components/purchases/paymentMethods'

interface NewInvoiceModalProps {
  onClose: () => void
  /** Abre directo el form de proveedor (cuando no hay ninguno). */
  onNeedSupplier: () => void
}

interface DraftLine {
  key: string
  product_id: string
  qty: string
  unit_cost: string
}

const formatCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)

const fieldLabel: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 6,
}
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 13px', border: '1.5px solid #e5e7eb', borderRadius: 9,
  fontSize: 14, color: '#0f172a', outline: 'none', boxSizing: 'border-box', background: '#fff',
}

let lineSeq = 0
const newLine = (): DraftLine => ({ key: `l${lineSeq++}`, product_id: '', qty: '1', unit_cost: '' })

export function NewInvoiceModal({ onClose, onNeedSupplier }: NewInvoiceModalProps) {
  const { suppliers } = useSuppliers()
  const { data: products = [] } = useProducts()
  const { registerPurchase, isRegistering } = useRegisterPurchase()

  const [supplierId, setSupplierId] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodValue>('cash')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([newLine()])

  const productById = useMemo(() => {
    const m = new Map<string, (typeof products)[number]>()
    for (const p of products) m.set(p.id, p)
    return m
  }, [products])

  const lineSubtotal = (l: DraftLine) =>
    (parseInt(l.qty, 10) || 0) * (parseInt(l.unit_cost, 10) || 0)

  const total = useMemo(() => lines.reduce((s, l) => s + lineSubtotal(l), 0), [lines])

  const updateLine = (key: string, patch: Partial<DraftLine>) =>
    setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)))

  // Al elegir producto, prellena el costo con su último costo conocido.
  const onPickProduct = (key: string, productId: string) => {
    const p = productById.get(productId)
    const cost = p?.cost_price != null ? String(Math.round(p.cost_price)) : ''
    updateLine(key, { product_id: productId, unit_cost: cost })
  }

  const removeLine = (key: string) => setLines(ls => (ls.length > 1 ? ls.filter(l => l.key !== key) : ls))

  const validLines = lines.filter(
    l => l.product_id && (parseInt(l.qty, 10) || 0) > 0 && (parseInt(l.unit_cost, 10) || 0) >= 0,
  )
  const isValid = !!supplierId && validLines.length > 0

  const handleSubmit = async () => {
    if (!supplierId) { toast.error('Selecciona un proveedor'); return }
    if (validLines.length === 0) { toast.error('Agrega al menos un ítem con cantidad y costo'); return }

    await registerPurchase({
      invoice: {
        supplier_id: supplierId,
        invoice_number: invoiceNumber.trim() || null,
        payment_method: paymentMethod,
        notes: notes.trim() || null,
      },
      items: validLines.map(l => ({
        product_id: l.product_id,
        qty: parseInt(l.qty, 10),
        unit_cost: parseInt(l.unit_cost, 10),
      })),
    })
    onClose()
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', display: 'grid', placeItems: 'center', zIndex: 50, fontFamily: 'Inter, system-ui, sans-serif', padding: 20 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        data-testid="new-invoice-modal"
        style={{ background: '#fff', borderRadius: 14, width: 720, maxWidth: '100%', maxHeight: '92vh', boxShadow: '0 25px 50px -12px rgba(0,0,0,.25)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
      >
        {/* Header */}
        <div style={{ padding: '18px 22px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#10b981', textTransform: 'uppercase', letterSpacing: 1 }}>Compras</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', letterSpacing: -0.3, marginTop: 1 }}>Registrar compra</div>
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, background: '#f1f5f9', border: 'none', cursor: 'pointer', color: '#64748b', display: 'grid', placeItems: 'center' }}><X size={16} /></button>
        </div>

        {/* Body */}
        <div style={{ padding: 22, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Cabecera */}
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 2 }}>
              <label style={fieldLabel}>Proveedor <span style={{ color: '#dc2626' }}>*</span></label>
              {suppliers.length === 0 ? (
                <button
                  data-testid="invoice-create-supplier"
                  onClick={onNeedSupplier}
                  style={{ ...inputStyle, textAlign: 'left', cursor: 'pointer', color: '#10b981', fontWeight: 600 }}
                >
                  + Crea tu primer proveedor
                </button>
              ) : (
                <select data-testid="invoice-supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                  <option value="">Seleccionar proveedor...</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
            </div>
            <div style={{ flex: 1 }}>
              <label style={fieldLabel}>N.° factura</label>
              <input data-testid="invoice-number" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="Opcional" style={inputStyle} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={fieldLabel}>Pago</label>
              <select data-testid="invoice-payment-method" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethodValue)} style={{ ...inputStyle, cursor: 'pointer' }}>
                {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
          </div>

          {/* Líneas */}
          <div>
            <label style={fieldLabel}>Ítems</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {lines.map(l => {
                return (
                  <div key={l.key} data-testid="invoice-line-row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <div style={{ flex: 3, position: 'relative' }}>
                      <select
                        data-testid="invoice-item-product"
                        value={l.product_id}
                        onChange={(e) => onPickProduct(l.key, e.target.value)}
                        style={{ ...inputStyle, cursor: 'pointer', padding: '9px 12px' }}
                      >
                        <option value="">Producto...</option>
                        {products.map(pr => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
                      </select>
                    </div>
                    <input
                      data-testid="invoice-item-qty"
                      type="number" min={1}
                      value={l.qty}
                      onChange={(e) => updateLine(l.key, { qty: e.target.value.replace(/\D/g, '') })}
                      placeholder="Cant."
                      title="Cantidad"
                      style={{ ...inputStyle, width: 70, flex: '0 0 auto', fontFamily: 'monospace', textAlign: 'right', padding: '9px 10px' }}
                    />
                    <input
                      data-testid="invoice-item-cost"
                      type="number" min={0}
                      value={l.unit_cost}
                      onChange={(e) => updateLine(l.key, { unit_cost: e.target.value.replace(/\D/g, '') })}
                      placeholder="Costo unit."
                      title="Costo unitario"
                      style={{ ...inputStyle, width: 110, flex: '0 0 auto', fontFamily: 'monospace', textAlign: 'right', padding: '9px 10px' }}
                    />
                    <span data-testid="invoice-line-subtotal" style={{ width: 110, flex: '0 0 auto', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: 13, color: '#0f172a' }}>
                      {formatCOP(lineSubtotal(l))}
                    </span>
                    <button
                      onClick={() => removeLine(l.key)}
                      title="Quitar ítem"
                      disabled={lines.length === 1}
                      style={{ width: 32, height: 32, flex: '0 0 auto', border: '1px solid #fecaca', background: '#fef2f2', borderRadius: 8, cursor: lines.length === 1 ? 'not-allowed' : 'pointer', color: '#dc2626', display: 'grid', placeItems: 'center', opacity: lines.length === 1 ? 0.4 : 1 }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                )
              })}
            </div>

            {/* Hint de stock */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 11.5, color: '#64748b' }}>
              <PackageCheck size={13} color="#10b981" />
              Los productos con inventario suben su stock al registrar la compra. Todos actualizan su costo.
            </div>

            <button
              data-testid="invoice-add-item"
              onClick={() => setLines(ls => [...ls, newLine()])}
              style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', border: '1.5px dashed #cbd5e1', background: '#fff', borderRadius: 9, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#334155' }}
            >
              <Plus size={14} /> Agregar ítem
            </button>
          </div>

          {/* Notas */}
          <div>
            <label style={fieldLabel}>Notas</label>
            <input data-testid="invoice-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observaciones de la compra" style={inputStyle} />
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '16px 22px', borderTop: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, background: 'linear-gradient(180deg, #f8fafc 0%, #fff 100%)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 12.5, color: '#64748b', fontWeight: 600 }}>Total</span>
            <span data-testid="invoice-total" style={{ fontSize: 22, fontWeight: 700, fontFamily: 'monospace', color: '#0f172a' }}>{formatCOP(total)}</span>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={onClose} style={{ padding: '11px 18px', border: '1.5px solid #e2e8f0', background: '#fff', borderRadius: 9, cursor: 'pointer', fontSize: 13.5, fontWeight: 600, color: '#334155' }}>Cancelar</button>
            <button
              data-testid="invoice-submit"
              onClick={handleSubmit}
              disabled={!isValid || isRegistering}
              style={{ padding: '11px 24px', border: 'none', borderRadius: 10, background: !isValid || isRegistering ? '#cbd5e1' : '#10b981', cursor: !isValid || isRegistering ? 'not-allowed' : 'pointer', fontSize: 13.5, fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 6, boxShadow: !isValid || isRegistering ? 'none' : '0 6px 16px rgba(16,185,129,.35)' }}
            >
              {isRegistering && <Loader2 size={15} className="animate-spin" />}
              {isRegistering ? 'Registrando...' : 'Registrar compra'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
