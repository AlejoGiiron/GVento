import { X } from 'lucide-react'
import { usePurchaseInvoiceDetail } from '@/hooks/usePurchases'
import { paymentMethodLabel } from '@/components/purchases/paymentMethods'

interface PurchaseDetailModalProps {
  invoiceId: string
  onClose: () => void
}

const formatCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)

const fmtDateTime = (iso: string) =>
  new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))

export function PurchaseDetailModal({ invoiceId, onClose }: PurchaseDetailModalProps) {
  const { invoice, isLoading } = usePurchaseInvoiceDetail(invoiceId)

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', display: 'grid', placeItems: 'center', zIndex: 50, fontFamily: 'Inter, system-ui, sans-serif', padding: 20 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        data-testid="purchase-detail-modal"
        style={{ background: '#fff', borderRadius: 14, width: 560, maxWidth: '100%', maxHeight: '90vh', boxShadow: '0 25px 50px -12px rgba(0,0,0,.25)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ padding: '18px 22px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#10b981', textTransform: 'uppercase', letterSpacing: 1 }}>Compra</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', letterSpacing: -0.3, marginTop: 1 }}>
              {invoice?.suppliers?.name ?? 'Detalle de compra'}
            </div>
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, background: '#f1f5f9', border: 'none', cursor: 'pointer', color: '#64748b', display: 'grid', placeItems: 'center' }}><X size={16} /></button>
        </div>

        <div style={{ padding: 22, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {isLoading || !invoice ? (
            <div style={{ padding: '30px 0', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Cargando...</div>
          ) : (
            <>
              {/* Metadatos */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 13 }}>
                <Meta label="Fecha" value={fmtDateTime(invoice.created_at)} />
                <Meta label="Método de pago" value={paymentMethodLabel(invoice.payment_method)} />
                <Meta label="N.° factura" value={invoice.invoice_number ?? '—'} />
                <Meta label="Registró" value={invoice.profiles?.full_name ?? '—'} />
                {invoice.suppliers?.contact_name && <Meta label="Contacto" value={invoice.suppliers.contact_name} />}
                {invoice.suppliers?.phone && <Meta label="Teléfono" value={invoice.suppliers.phone} />}
              </div>

              {invoice.notes && (
                <div style={{ fontSize: 13, color: '#475569', background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 9, padding: '10px 12px' }}>
                  {invoice.notes}
                </div>
              )}

              {/* Ítems */}
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', textAlign: 'left', color: '#64748b', fontSize: 11.5 }}>
                      <th style={{ padding: '9px 12px', fontWeight: 600 }}>Producto</th>
                      <th style={{ padding: '9px 12px', fontWeight: 600, textAlign: 'right' }}>Cant.</th>
                      <th style={{ padding: '9px 12px', fontWeight: 600, textAlign: 'right' }}>Costo</th>
                      <th style={{ padding: '9px 12px', fontWeight: 600, textAlign: 'right' }}>Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.purchase_invoice_items.map(it => (
                      <tr key={it.id} data-testid="purchase-detail-item" style={{ borderTop: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '10px 12px', fontWeight: 600, color: '#0f172a' }}>{it.products?.name ?? '—'}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace' }}>{it.qty}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', color: '#64748b' }}>{formatCOP(it.unit_cost)}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>{formatCOP(it.subtotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Total */}
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'flex-end', gap: 10 }}>
                <span style={{ fontSize: 12.5, color: '#64748b', fontWeight: 600 }}>Total</span>
                <span style={{ fontSize: 22, fontWeight: 700, fontFamily: 'monospace', color: '#0f172a' }}>{formatCOP(invoice.total)}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>{label}</div>
      <div style={{ color: '#0f172a', fontWeight: 600, marginTop: 1 }}>{value}</div>
    </div>
  )
}
