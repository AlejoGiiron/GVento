import { useState } from 'react'
import {
  Plus, Pencil, Trash2, ChevronLeft, ChevronRight, ShoppingBag, Building2, Phone,
} from 'lucide-react'
import { useSuppliers, type Supplier } from '@/hooks/useSuppliers'
import { usePurchaseInvoices } from '@/hooks/usePurchases'
import { SupplierFormModal } from '@/components/purchases/SupplierFormModal'
import { NewInvoiceModal } from '@/components/purchases/NewInvoiceModal'
import { PurchaseDetailModal } from '@/components/purchases/PurchaseDetailModal'
import { paymentMethodLabel } from '@/components/purchases/paymentMethods'

type Tab = 'invoices' | 'suppliers'

const formatCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)

const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))

// ─── Compras tab ─────────────────────────────────────────────────
function InvoicesTab({ onNew, onOpen }: { onNew: () => void; onOpen: (id: string) => void }) {
  const [page, setPage] = useState(0)
  const { rows, count, pageCount, isFetching } = usePurchaseInvoices(page)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          data-testid="new-invoice-btn"
          onClick={onNew}
          style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 18px', border: 'none', background: '#10b981', borderRadius: 10, cursor: 'pointer', fontSize: 13.5, fontWeight: 700, color: '#fff', boxShadow: '0 6px 16px rgba(16,185,129,.35)' }}
        >
          <Plus size={16} strokeWidth={2.5} /> Registrar compra
        </button>
      </div>

      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', opacity: isFetching ? 0.6 : 1, transition: 'opacity .15s' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8fafc', textAlign: 'left', color: '#64748b', fontSize: 11.5 }}>
              <th style={{ padding: '10px 16px', fontWeight: 600 }}>Fecha</th>
              <th style={{ padding: '10px 16px', fontWeight: 600 }}>Proveedor</th>
              <th style={{ padding: '10px 16px', fontWeight: 600 }}>N.° factura</th>
              <th style={{ padding: '10px 16px', fontWeight: 600 }}>Pago</th>
              <th style={{ padding: '10px 16px', fontWeight: 600, textAlign: 'right' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: '40px 16px', textAlign: 'center', color: '#94a3b8' }}>Aún no hay compras registradas</td></tr>
            ) : rows.map(inv => (
              <tr
                key={inv.id}
                data-testid="purchase-row"
                onClick={() => onOpen(inv.id)}
                style={{ borderTop: '1px solid #f1f5f9', cursor: 'pointer' }}
              >
                <td style={{ padding: '11px 16px', color: '#64748b', fontFamily: 'monospace', fontSize: 12 }}>{fmtDate(inv.created_at)}</td>
                <td style={{ padding: '11px 16px', fontWeight: 600, color: '#0f172a' }}>{inv.suppliers?.name ?? '—'}</td>
                <td style={{ padding: '11px 16px', color: '#64748b' }}>{inv.invoice_number ?? '—'}</td>
                <td style={{ padding: '11px 16px', color: '#64748b' }}>{paymentMethodLabel(inv.payment_method)}</td>
                <td style={{ padding: '11px 16px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#0f172a' }}>{formatCOP(inv.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12.5, color: '#64748b' }}>{count} compra{count !== 1 ? 's' : ''}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', cursor: page === 0 ? 'not-allowed' : 'pointer', color: '#334155', opacity: page === 0 ? 0.4 : 1, display: 'grid', placeItems: 'center' }}><ChevronLeft size={15} /></button>
          <span style={{ fontSize: 12.5, color: '#64748b', fontFamily: 'monospace' }}>{page + 1} / {pageCount}</span>
          <button onClick={() => setPage(p => (p + 1 < pageCount ? p + 1 : p))} disabled={page + 1 >= pageCount} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', cursor: page + 1 >= pageCount ? 'not-allowed' : 'pointer', color: '#334155', opacity: page + 1 >= pageCount ? 0.4 : 1, display: 'grid', placeItems: 'center' }}><ChevronRight size={15} /></button>
        </div>
      </div>
    </div>
  )
}

// ─── Proveedores tab ─────────────────────────────────────────────
function SuppliersTab({ onEdit }: { onEdit: (s: Supplier | 'new') => void }) {
  const { suppliers, isLoading, deactivate } = useSuppliers()

  const handleDeactivate = async (s: Supplier) => {
    if (!window.confirm(`¿Desactivar el proveedor "${s.name}"?`)) return
    await deactivate(s.id)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          data-testid="new-supplier-btn"
          onClick={() => onEdit('new')}
          style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 18px', border: 'none', background: '#10b981', borderRadius: 10, cursor: 'pointer', fontSize: 13.5, fontWeight: 700, color: '#fff', boxShadow: '0 6px 16px rgba(16,185,129,.35)' }}
        >
          <Plus size={16} strokeWidth={2.5} /> Nuevo proveedor
        </button>
      </div>

      {isLoading ? (
        <div style={{ padding: '40px 0', textAlign: 'center', color: '#94a3b8' }}>Cargando...</div>
      ) : suppliers.length === 0 ? (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '48px 16px', textAlign: 'center', color: '#94a3b8' }}>
          <Building2 size={28} style={{ margin: '0 auto 8px', display: 'block', opacity: 0.5 }} />
          Aún no hay proveedores. Crea el primero para registrar compras.
        </div>
      ) : (
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
          {suppliers.map((s, idx) => (
            <div key={s.id} data-testid="supplier-row" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: idx < suppliers.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{s.name}</div>
                <div style={{ display: 'flex', gap: 14, fontSize: 12, color: '#64748b', marginTop: 2, flexWrap: 'wrap' }}>
                  {s.contact_name && <span>{s.contact_name}</span>}
                  {s.phone && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Phone size={11} /> {s.phone}</span>}
                  {s.document && <span>NIT {s.document}</span>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => onEdit(s)} title="Editar" style={{ width: 30, height: 30, border: '1px solid #e2e8f0', background: '#fff', borderRadius: 7, cursor: 'pointer', color: '#64748b', display: 'grid', placeItems: 'center' }}><Pencil size={13} /></button>
                <button data-testid="supplier-deactivate" onClick={() => handleDeactivate(s)} title="Desactivar" style={{ width: 30, height: 30, border: '1px solid #fecaca', background: '#fef2f2', borderRadius: 7, cursor: 'pointer', color: '#dc2626', display: 'grid', placeItems: 'center' }}><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────
export function PurchasesPage() {
  const [tab, setTab] = useState<Tab>('invoices')
  const [invoiceOpen, setInvoiceOpen] = useState(false)
  const [editSupplier, setEditSupplier] = useState<Supplier | 'new' | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)

  return (
    <div style={{ height: '100%', overflow: 'auto', background: '#f8fafc', fontFamily: 'Inter, system-ui, sans-serif', color: '#0f172a' }}>
      {/* Header */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '20px 28px 0', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#10b981', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Administración</div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', letterSpacing: -0.5, margin: 0, display: 'flex', alignItems: 'center', gap: 9 }}>
              <ShoppingBag size={20} color="#10b981" /> Compras
            </h1>
            <p style={{ fontSize: 13, color: '#64748b', marginTop: 3, marginBottom: 0 }}>Facturas de compra y proveedores por sede</p>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4 }}>
          {([
            { value: 'invoices' as const, label: 'Compras', testid: 'purchases-tab-invoices' },
            { value: 'suppliers' as const, label: 'Proveedores', testid: 'purchases-tab-suppliers' },
          ]).map(t => (
            <button
              key={t.value}
              data-testid={t.testid}
              onClick={() => setTab(t.value)}
              style={{ padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 14, fontWeight: tab === t.value ? 700 : 500, color: tab === t.value ? '#0f172a' : '#64748b', borderBottom: `3px solid ${tab === t.value ? '#10b981' : 'transparent'}` }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: '24px 28px' }}>
        {tab === 'invoices'
          ? <InvoicesTab onNew={() => setInvoiceOpen(true)} onOpen={setDetailId} />
          : <SuppliersTab onEdit={setEditSupplier} />}
      </div>

      {invoiceOpen && (
        <NewInvoiceModal
          onClose={() => setInvoiceOpen(false)}
          onNeedSupplier={() => { setInvoiceOpen(false); setEditSupplier('new'); setTab('suppliers') }}
        />
      )}
      {editSupplier && <SupplierFormModal supplier={editSupplier} onClose={() => setEditSupplier(null)} />}
      {detailId && <PurchaseDetailModal invoiceId={detailId} onClose={() => setDetailId(null)} />}
    </div>
  )
}
