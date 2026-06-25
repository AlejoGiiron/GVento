import { useMemo, useState } from 'react'
import { Plus, Pencil, Trash2, HandCoins, UserRound, Search, Phone } from 'lucide-react'
import { useCustomers, useCustomerMutations, type Customer } from '@/hooks/useCustomers'
import { useDebts, type Debt } from '@/hooks/useDebts'
import { CustomerFormModal } from '@/components/fiado/CustomerFormModal'
import { DebtPaymentModal } from '@/components/fiado/DebtPaymentModal'

type Tab = 'debts' | 'customers'
type DebtFilter = 'all' | 'pending' | 'partial'

const formatCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)

const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))

const STATUS_BADGE: Record<string, { label: string; bg: string; fg: string }> = {
  pending: { label: 'Pendiente', bg: '#fef3c7', fg: '#854d0e' },
  partial: { label: 'Parcial', bg: '#dbeafe', fg: '#1e40af' },
}

const inputStyle: React.CSSProperties = {
  flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13.5, color: '#0f172a',
}

// ─── Cuentas por cobrar ──────────────────────────────────────────
function DebtsTab({ onAbono }: { onAbono: (d: Debt) => void }) {
  const { debts, isLoading } = useDebts()
  const [filter, setFilter] = useState<DebtFilter>('all')
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return debts.filter((d) => {
      if (filter !== 'all' && d.payment_status !== filter) return false
      if (q && !d.customerName.toLowerCase().includes(q)) return false
      return true
    })
  }, [debts, filter, search])

  const totalSaldo = filtered.reduce((s, d) => s + d.saldo, 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Controles */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1.5px solid #e5e7eb', borderRadius: 9, padding: '8px 12px', background: '#fff', flex: 1, minWidth: 220 }}>
          <Search size={15} color="#94a3b8" />
          <input data-testid="debt-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por cliente" style={inputStyle} />
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {([
            { value: 'all' as const, label: 'Todas' },
            { value: 'pending' as const, label: 'Pendientes' },
            { value: 'partial' as const, label: 'Parciales' },
          ]).map((f) => (
            <button
              key={f.value}
              data-testid={`debt-filter-${f.value}`}
              onClick={() => setFilter(f.value)}
              style={{ padding: '8px 14px', borderRadius: 8, border: `1.5px solid ${filter === f.value ? '#10b981' : '#e2e8f0'}`, background: filter === f.value ? '#ecfdf5' : '#fff', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: filter === f.value ? '#065f46' : '#64748b' }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', opacity: isLoading ? 0.6 : 1 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8fafc', textAlign: 'left', color: '#64748b', fontSize: 11.5 }}>
              <th style={{ padding: '10px 16px', fontWeight: 600 }}>Venta</th>
              <th style={{ padding: '10px 16px', fontWeight: 600 }}>Cliente</th>
              <th style={{ padding: '10px 16px', fontWeight: 600 }}>Fecha</th>
              <th style={{ padding: '10px 16px', fontWeight: 600, textAlign: 'right' }}>Total</th>
              <th style={{ padding: '10px 16px', fontWeight: 600, textAlign: 'right' }}>Abonado</th>
              <th style={{ padding: '10px 16px', fontWeight: 600, textAlign: 'right' }}>Saldo</th>
              <th style={{ padding: '10px 16px', fontWeight: 600 }}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: '40px 16px', textAlign: 'center', color: '#94a3b8' }}>
                {isLoading ? 'Cargando...' : 'No hay cuentas por cobrar'}
              </td></tr>
            ) : filtered.map((d) => {
              const badge = STATUS_BADGE[d.payment_status] ?? STATUS_BADGE.pending
              return (
                <tr key={d.id} data-testid="debt-row" onClick={() => onAbono(d)} style={{ borderTop: '1px solid #f1f5f9', cursor: 'pointer' }}>
                  <td style={{ padding: '11px 16px', fontFamily: 'monospace', fontWeight: 700, color: '#0f172a' }}>{d.order_number != null ? `#${d.order_number}` : '—'}</td>
                  <td style={{ padding: '11px 16px', fontWeight: 600, color: '#0f172a' }}>{d.customerName}</td>
                  <td style={{ padding: '11px 16px', color: '#64748b', fontFamily: 'monospace', fontSize: 12 }}>{fmtDate(d.created_at)}</td>
                  <td style={{ padding: '11px 16px', textAlign: 'right', fontFamily: 'monospace', color: '#0f172a' }}>{formatCOP(d.total)}</td>
                  <td style={{ padding: '11px 16px', textAlign: 'right', fontFamily: 'monospace', color: '#059669' }}>{formatCOP(d.abonado)}</td>
                  <td data-testid="debt-row-saldo" style={{ padding: '11px 16px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#dc2626' }}>{formatCOP(d.saldo)}</td>
                  <td style={{ padding: '11px 16px' }}>
                    <span style={{ display: 'inline-block', background: badge.bg, color: badge.fg, borderRadius: 6, padding: '3px 9px', fontSize: 11.5, fontWeight: 600 }}>{badge.label}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 12.5, color: '#64748b' }}>{filtered.length} cuenta{filtered.length !== 1 ? 's' : ''}</span>
        <span style={{ fontSize: 13, color: '#64748b' }}>Saldo total: <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#dc2626' }}>{formatCOP(totalSaldo)}</span></span>
      </div>
    </div>
  )
}

// ─── Clientes (CRM) ──────────────────────────────────────────────
function CustomersTab({ onEdit }: { onEdit: (c: Customer | 'new') => void }) {
  const { customers, isLoading } = useCustomers()
  const { deactivate } = useCustomerMutations()

  const handleDeactivate = async (c: Customer) => {
    if (!window.confirm(`¿Desactivar el cliente "${c.name}"?`)) return
    await deactivate(c.id)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          data-testid="new-customer-btn"
          onClick={() => onEdit('new')}
          style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 18px', border: 'none', background: '#10b981', borderRadius: 10, cursor: 'pointer', fontSize: 13.5, fontWeight: 700, color: '#fff', boxShadow: '0 6px 16px rgba(16,185,129,.35)' }}
        >
          <Plus size={16} strokeWidth={2.5} /> Nuevo cliente
        </button>
      </div>

      {isLoading ? (
        <div style={{ padding: '40px 0', textAlign: 'center', color: '#94a3b8' }}>Cargando...</div>
      ) : customers.length === 0 ? (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '48px 16px', textAlign: 'center', color: '#94a3b8' }}>
          <UserRound size={28} style={{ margin: '0 auto 8px', display: 'block', opacity: 0.5 }} />
          Aún no hay clientes. Crea el primero para vender a fiado.
        </div>
      ) : (
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
          {customers.map((c, idx) => (
            <div key={c.id} data-testid="customer-row" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: idx < customers.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{c.name}</div>
                <div style={{ display: 'flex', gap: 14, fontSize: 12, color: '#64748b', marginTop: 2, flexWrap: 'wrap' }}>
                  {c.phone && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Phone size={11} /> {c.phone}</span>}
                  {c.document && <span>Doc. {c.document}</span>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => onEdit(c)} title="Editar" style={{ width: 30, height: 30, border: '1px solid #e2e8f0', background: '#fff', borderRadius: 7, cursor: 'pointer', color: '#64748b', display: 'grid', placeItems: 'center' }}><Pencil size={13} /></button>
                <button data-testid="customer-deactivate" onClick={() => handleDeactivate(c)} title="Desactivar" style={{ width: 30, height: 30, border: '1px solid #fecaca', background: '#fef2f2', borderRadius: 7, cursor: 'pointer', color: '#dc2626', display: 'grid', placeItems: 'center' }}><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────
export function FiadoPage() {
  const [tab, setTab] = useState<Tab>('debts')
  const [editCustomer, setEditCustomer] = useState<Customer | 'new' | null>(null)
  const [abonoDebt, setAbonoDebt] = useState<Debt | null>(null)

  return (
    <div style={{ height: '100%', overflow: 'auto', background: '#f8fafc', fontFamily: 'Inter, system-ui, sans-serif', color: '#0f172a' }}>
      <div style={{ background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '20px 28px 0', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#10b981', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Administración</div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', letterSpacing: -0.5, margin: 0, display: 'flex', alignItems: 'center', gap: 9 }}>
              <HandCoins size={20} color="#10b981" /> Fiado
            </h1>
            <p style={{ fontSize: 13, color: '#64748b', marginTop: 3, marginBottom: 0 }}>Cuentas por cobrar y clientes por sede</p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 4 }}>
          {([
            { value: 'debts' as const, label: 'Cuentas por cobrar', testid: 'fiado-tab-debts' },
            { value: 'customers' as const, label: 'Clientes', testid: 'fiado-tab-customers' },
          ]).map((t) => (
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

      <div style={{ padding: '24px 28px' }}>
        {tab === 'debts'
          ? <DebtsTab onAbono={setAbonoDebt} />
          : <CustomersTab onEdit={setEditCustomer} />}
      </div>

      {editCustomer && <CustomerFormModal customer={editCustomer} onClose={() => setEditCustomer(null)} />}
      {abonoDebt && <DebtPaymentModal debt={abonoDebt} onClose={() => setAbonoDebt(null)} />}
    </div>
  )
}
