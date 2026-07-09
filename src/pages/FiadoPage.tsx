import { useMemo, useState } from 'react'
import { Plus, Pencil, Trash2, HandCoins, UserRound, Search, Phone, Wallet, Users, ReceiptText } from 'lucide-react'
import { useCustomers, useCustomerMutations, type Customer } from '@/hooks/useCustomers'
import { useDebts, type Debt } from '@/hooks/useDebts'
import { CustomerFormModal } from '@/components/fiado/CustomerFormModal'
import { DebtPaymentModal } from '@/components/fiado/DebtPaymentModal'

type Tab = 'debts' | 'customers'

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

// Iniciales para el avatar del cliente (1-2 letras).
const initials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// Un cliente con deuda: sus fiados abiertos agrupados y su saldo consolidado.
interface CustomerGroup {
  key: string            // customer_id, o `name:<nombre>` para walk-ins sin cliente
  customerName: string
  phone: string | null
  count: number          // nº de fiados con saldo>0
  saldoTotal: number     // Σ saldos del cliente
  fiados: Debt[]         // ASC por fecha: el más viejo (más tiempo debiendo) arriba
}

// ─── Cartera (maestro-detalle por cliente) ───────────────────────
function DebtsTab({ onAbono }: { onAbono: (d: Debt) => void }) {
  const { debts, isLoading } = useDebts()
  const { customers } = useCustomers()
  const [search, setSearch] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  // Teléfono por cliente (para el buscador) — sin queries nuevas.
  const phoneById = useMemo(() => {
    const m = new Map<string, string | null>()
    for (const c of customers) m.set(c.id, c.phone ?? null)
    return m
  }, [customers])

  // Agrupación por cliente: SOLO presentación. El saldo ya viene derivado de useDebts.
  const groups = useMemo(() => {
    const map = new Map<string, CustomerGroup>()
    for (const d of debts) {
      if (d.saldo <= 0) continue
      const key = d.customerId ?? `name:${d.customerName}`
      const g = map.get(key) ?? {
        key,
        customerName: d.customerName,
        phone: d.customerId ? phoneById.get(d.customerId) ?? null : null,
        count: 0,
        saldoTotal: 0,
        fiados: [] as Debt[],
      }
      g.count += 1
      g.saldoTotal += d.saldo
      g.fiados.push(d)
      map.set(key, g)
    }
    const arr = [...map.values()]
    for (const g of arr) g.fiados.sort((a, b) => a.created_at.localeCompare(b.created_at))
    return arr.sort((a, b) => b.saldoTotal - a.saldoTotal)
  }, [debts, phoneById])

  // KPIs de la cartera completa (independientes del buscador).
  const totalPorCobrar = groups.reduce((s, g) => s + g.saldoTotal, 0)
  const clientesConDeuda = groups.length
  const fiadosAbiertos = groups.reduce((s, g) => s + g.count, 0)

  // Lista de la izquierda filtrada por nombre/teléfono.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return groups
    return groups.filter(
      (g) => g.customerName.toLowerCase().includes(q) || (g.phone ?? '').toLowerCase().includes(q),
    )
  }, [groups, search])

  // Detalle DERIVADO: si el cliente saldó su última deuda tras un abono, sale de
  // `groups` y `selected` queda null → el detalle se limpia solo (sin efecto).
  const selected = groups.find((g) => g.key === selectedKey) ?? null

  const kpis = [
    { key: 'por-cobrar', label: 'Total por cobrar', value: formatCOP(totalPorCobrar), Icon: Wallet, color: '#dc2626' },
    { key: 'clientes-deuda', label: 'Clientes con deuda', value: String(clientesConDeuda), Icon: Users, color: '#0f172a' },
    { key: 'fiados-abiertos', label: 'Fiados abiertos', value: String(fiadosAbiertos), Icon: ReceiptText, color: '#0f172a' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        {kpis.map((k) => (
          <div key={k.key} data-testid={`kpi-${k.key}`} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 42, height: 42, borderRadius: 10, background: '#ecfdf5', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <k.Icon size={20} color="#10b981" />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 }}>{k.label}</div>
              <div data-testid={`kpi-${k.key}-value`} style={{ fontSize: 22, fontWeight: 700, fontFamily: 'monospace', color: k.color, marginTop: 2, letterSpacing: -0.5 }}>{k.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Maestro-detalle 35 / 65 */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {/* IZQUIERDA — clientes con deuda */}
        <div style={{ flex: '0 0 35%', maxWidth: '35%', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1.5px solid #e5e7eb', borderRadius: 9, padding: '8px 12px', background: '#fff' }}>
            <Search size={15} color="#94a3b8" />
            <input data-testid="debt-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar cliente o teléfono" style={inputStyle} />
          </div>

          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', opacity: isLoading ? 0.6 : 1 }}>
            {filtered.length === 0 ? (
              <div style={{ padding: '40px 16px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
                {isLoading ? 'Cargando...' : search.trim() ? 'Sin resultados' : 'No hay clientes con deuda'}
              </div>
            ) : filtered.map((g, idx) => {
              const active = g.key === selectedKey
              return (
                <button
                  key={g.key}
                  data-testid="customer-row"
                  onClick={() => setSelectedKey(g.key)}
                  style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', border: 'none', borderTop: idx > 0 ? '1px solid #f1f5f9' : 'none', borderLeft: `3px solid ${active ? '#10b981' : 'transparent'}`, background: active ? '#ecfdf5' : '#fff', cursor: 'pointer' }}
                >
                  <div style={{ width: 38, height: 38, borderRadius: '50%', background: active ? '#10b981' : '#e2e8f0', color: active ? '#fff' : '#475569', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                    {initials(g.customerName)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.customerName}</div>
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 1 }}>{g.count} fiado{g.count !== 1 ? 's' : ''} abierto{g.count !== 1 ? 's' : ''}</div>
                  </div>
                  <div data-testid="customer-row-saldo" style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 14, color: '#dc2626', flexShrink: 0 }}>{formatCOP(g.saldoTotal)}</div>
                </button>
              )
            })}
          </div>
        </div>

        {/* DERECHA — detalle del cliente */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {!selected ? (
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '56px 16px', textAlign: 'center', color: '#94a3b8' }}>
              <UserRound size={30} style={{ margin: '0 auto 10px', display: 'block', opacity: 0.5 }} />
              <div style={{ fontSize: 13.5 }}>Selecciona un cliente para ver sus fiados</div>
            </div>
          ) : (
            <div data-testid="customer-detail" style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
              {/* Cabecera del cliente */}
              <div style={{ padding: '18px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ width: 46, height: 46, borderRadius: '50%', background: '#10b981', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 15, fontWeight: 700, flexShrink: 0 }}>
                  {initials(selected.customerName)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', letterSpacing: -0.3 }}>{selected.customerName}</div>
                  <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 1, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <span>{selected.count} fiado{selected.count !== 1 ? 's' : ''} abierto{selected.count !== 1 ? 's' : ''}</span>
                    {selected.phone && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Phone size={11} /> {selected.phone}</span>}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>Total adeudado</div>
                  <div data-testid="detail-total" style={{ fontSize: 20, fontWeight: 700, fontFamily: 'monospace', color: '#dc2626', marginTop: 1 }}>{formatCOP(selected.saldoTotal)}</div>
                </div>
              </div>

              {/* Fiados individuales */}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#f8fafc', textAlign: 'left', color: '#64748b', fontSize: 11.5 }}>
                    <th style={{ padding: '10px 16px', fontWeight: 600 }}>Venta</th>
                    <th style={{ padding: '10px 16px', fontWeight: 600 }}>Fecha</th>
                    <th style={{ padding: '10px 16px', fontWeight: 600, textAlign: 'right' }}>Total</th>
                    <th style={{ padding: '10px 16px', fontWeight: 600, textAlign: 'right' }}>Pagado</th>
                    <th style={{ padding: '10px 16px', fontWeight: 600, textAlign: 'right' }}>Saldo</th>
                    <th style={{ padding: '10px 16px', fontWeight: 600 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {selected.fiados.map((d) => {
                    const badge = STATUS_BADGE[d.payment_status] ?? STATUS_BADGE.pending
                    return (
                      <tr key={d.id} data-testid="credit-row" style={{ borderTop: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '11px 16px', fontFamily: 'monospace', fontWeight: 700, color: '#0f172a' }}>{d.order_number != null ? `#${d.order_number}` : '—'}</td>
                        <td style={{ padding: '11px 16px', color: '#64748b', fontFamily: 'monospace', fontSize: 12 }}>{fmtDate(d.created_at)}</td>
                        <td style={{ padding: '11px 16px', textAlign: 'right', fontFamily: 'monospace', color: '#0f172a' }}>{formatCOP(d.total)}</td>
                        <td style={{ padding: '11px 16px', textAlign: 'right', fontFamily: 'monospace', color: '#059669' }}>{formatCOP(d.abonado)}</td>
                        <td data-testid="credit-row-saldo" style={{ padding: '11px 16px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#dc2626' }}>{formatCOP(d.saldo)}</td>
                        <td style={{ padding: '11px 16px', textAlign: 'right' }}>
                          <span style={{ display: 'inline-block', background: badge.bg, color: badge.fg, borderRadius: 6, padding: '3px 9px', fontSize: 11, fontWeight: 600, marginRight: 8 }}>{badge.label}</span>
                          <button
                            data-testid="abonar-btn"
                            onClick={() => onAbono(d)}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', border: 'none', background: '#10b981', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#fff', boxShadow: '0 3px 8px rgba(16,185,129,.3)' }}
                          >
                            <HandCoins size={13} /> Abonar
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
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
            { value: 'debts' as const, label: 'Cartera', testid: 'fiado-tab-debts' },
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
