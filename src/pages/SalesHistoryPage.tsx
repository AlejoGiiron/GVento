import { useState, useMemo } from 'react'
import {
  Search, X, ChevronLeft, ChevronRight, Printer, Receipt,
  Store, Bike, UtensilsCrossed, Calendar,
} from 'lucide-react'
import { useRestaurantConfig } from '@/hooks/useRestaurantConfig'
import {
  useSalesHistory, useSaleDetail, SALES_PAGE_SIZE,
  type SalesHistoryRow,
} from '@/hooks/useSalesHistory'
import { printSaleTicket } from '@/lib/printer'
import type { Enums } from '@/types/database.types'

// ─── Helpers ──────────────────────────────────────────────────────

const formatCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n)

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('es-CO', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota',
  })

// 'YYYY-MM-DD' de hoy en zona Bogotá.
function todayBogota(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/Bogota',
  }).format(new Date())
  return parts // en-CA da YYYY-MM-DD
}

function daysAgoBogota(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/Bogota',
  }).format(d)
}

// Unión concreta (no el conditional perezoso Enums<...>) para poder indexar
// ORDER_TYPE sin TS7053. sale.type/row.type (Enums<'order_type'>) se castean
// a este alias en el punto de indexado: resuelven a la misma unión.
type OrderType = 'dine_in' | 'takeaway' | 'delivery'
type PayMethod = Enums<'payment_method'>

const ORDER_TYPE: Record<OrderType, { label: string; icon: React.ReactNode; bg: string; fg: string }> = {
  dine_in:  { label: 'Mesa',        icon: <UtensilsCrossed size={12} />, bg: '#ecfdf5', fg: '#065f46' },
  takeaway: { label: 'Mostrador',   icon: <Store size={12} />,           bg: '#fef3c7', fg: '#854d0e' },
  delivery: { label: 'Delivery',    icon: <Bike size={12} />,            bg: '#dbeafe', fg: '#1e40af' },
}

const METHOD_LABEL: Record<PayMethod, string> = {
  cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', nequi: 'Nequi / QR',
}

const METHOD_OPTIONS: { value: PayMethod | ''; label: string }[] = [
  { value: '',         label: 'Todos los métodos' },
  { value: 'cash',     label: 'Efectivo' },
  { value: 'card',     label: 'Tarjeta' },
  { value: 'transfer', label: 'Transferencia' },
  { value: 'nequi',    label: 'Nequi / QR' },
]

// Métodos DISTINTOS de la venta. Con pago mixto hay una fila por método; el
// pago simple tiene una sola. Se deduplica por si acaso (no debería repetirse).
function paymentMethodsOf(row: { payments: { method: PayMethod }[] }): PayMethod[] {
  return [...new Set(row.payments.map((p) => p.method))]
}

// Etiqueta de método(s) para la lista/detalle. Simple → un método (igual que
// hoy); mixto → "Efectivo + Nequi". Una venta a fiado NO tiene fila en
// `payments` (la liquidación vive en debt_payments), así que se deriva del
// payment_status para que no aparezca como venta sin método.
function methodDisplay(row: { payment_status: string; total: number; payments: { method: PayMethod }[] }): string {
  const methods = paymentMethodsOf(row)
  if (methods.length > 0) return methods.map((m) => METHOD_LABEL[m]).join(' + ')
  // Venta GRATIS (vale 100%): total 0, sin filas en payments, saldada ('paid').
  // Se distingue del fiado saldado (que tiene total > 0).
  if (row.total === 0) return 'Cortesía'
  if (row.payment_status === 'paid') return 'Fiado (saldado)'
  if (row.payment_status === 'partial') return 'Fiado (parcial)'
  return 'Fiado'
}

// ─── Detalle de venta (modal) ─────────────────────────────────────

function SaleDetailModal({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const { sale, isLoading } = useSaleDetail(orderId)
  const { restaurant } = useRestaurantConfig()

  const subtotal = useMemo(() => {
    if (!sale) return 0
    return sale.order_items.reduce((acc, it) => {
      const extras = it.order_item_extras.reduce((a, e) => a + e.unit_price * e.qty, 0)
      return acc + it.unit_price * it.qty + extras
    }, 0)
  }, [sale])

  const discount = sale ? Math.max(0, subtotal - sale.total) : 0
  // Reimpresión: etiqueta de método(s) combinada ("Efectivo + Nequi" en mixto);
  // null si es fiado sin payments (el ticket omite la línea de método).
  const method = sale && sale.payments.length > 0 ? methodDisplay(sale) : null

  const handleReprint = () => {
    if (!sale) return
    printSaleTicket({
      restaurantName: restaurant?.name,
      restaurantAddress: restaurant?.address,
      orderNumber: sale.order_number,
      orderId: sale.id,
      type: sale.type,
      method,
      createdAt: sale.created_at,
      total: sale.total,
      items: sale.order_items.map((it) => ({
        qty: it.qty,
        name: it.products?.name ?? '—',
        unitPrice: it.unit_price,
        notes: it.notes,
        extras: it.order_item_extras.map((e) => ({
          name: e.extras?.name ?? 'Extra', qty: e.qty, unitPrice: e.unit_price,
        })),
      })),
    })
  }

  return (
    <div
      style={{ position: 'absolute', inset: 0, background: 'rgba(15,23,42,.55)', display: 'grid', placeItems: 'center', zIndex: 50 }}
      onClick={onClose}
    >
      <div
        data-testid="sale-detail-modal"
        style={{ background: '#fff', borderRadius: 14, width: 480, maxWidth: '94%', maxHeight: '88%', boxShadow: '0 25px 50px -12px rgba(0,0,0,.25)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '18px 22px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Detalle de venta
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', letterSpacing: -0.4 }}>
              {sale?.order_number != null ? `Venta #${sale.order_number}` : 'Venta'}
            </div>
            {sale && (
              <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 2 }}>
                {formatDateTime(sale.created_at)} · {ORDER_TYPE[sale.type as OrderType].label}
              </div>
            )}
          </div>
          <button onClick={onClose} style={{ background: '#f1f5f9', border: 'none', width: 32, height: 32, borderRadius: 8, cursor: 'pointer', color: '#64748b', display: 'grid', placeItems: 'center' }}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', padding: 22 }}>
          {isLoading || !sale ? (
            <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
              Cargando detalle...
            </div>
          ) : (
            <>
              {/* Meta */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16, fontSize: 12.5, color: '#475569' }}>
                {sale.customer_name && <div>Cliente: <span style={{ fontWeight: 600, color: '#0f172a' }}>{sale.customer_name}</span>{sale.customer_phone ? ` · ${sale.customer_phone}` : ''}</div>}
                {sale.waiter_name && <div>Responsable: <span style={{ fontWeight: 600, color: '#0f172a' }}>{sale.waiter_name}</span></div>}
                <div>Atendió: <span style={{ fontWeight: 600, color: '#0f172a' }}>{sale.profiles?.full_name ?? '—'}</span></div>
                <div>Pago: <span data-testid="sale-detail-method" style={{ fontWeight: 600, color: '#0f172a' }}>{methodDisplay(sale)}</span></div>
                {sale.payments.length > 1 && (
                  <div data-testid="sale-detail-payments" style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 2, paddingLeft: 10 }}>
                    {sale.payments.map((p, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', maxWidth: 220 }}>
                        <span>{METHOD_LABEL[p.method]}</span>
                        <span style={{ fontFamily: 'monospace', color: '#0f172a' }}>{formatCOP(p.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Items */}
              <div style={{ border: '1px solid #f1f5f9', borderRadius: 10, overflow: 'hidden' }}>
                {sale.order_items.map((it) => {
                  const extrasTotal = it.order_item_extras.reduce((a, e) => a + e.unit_price * e.qty, 0)
                  const lineTotal = it.unit_price * it.qty + extrasTotal
                  return (
                    <div key={it.id} data-testid="sale-detail-item" style={{ padding: '10px 14px', borderBottom: '1px solid #f8fafc' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 600, color: '#0f172a' }}>
                          {it.qty}× {it.products?.name ?? '—'}
                        </span>
                        <span style={{ fontSize: 13.5, fontWeight: 700, color: '#0f172a', fontFamily: 'monospace' }}>
                          {formatCOP(lineTotal)}
                        </span>
                      </div>
                      {it.order_item_extras.length > 0 && (
                        <div data-testid="sale-detail-extras" style={{ marginTop: 3 }}>
                          {it.order_item_extras.map((e) => (
                            <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: '#065f46', paddingLeft: 10 }}>
                              <span>+ {e.extras?.name ?? 'Extra'} ×{e.qty}</span>
                              <span style={{ fontFamily: 'monospace' }}>{formatCOP(e.unit_price * e.qty)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {it.notes && (
                        <div style={{ fontSize: 11.5, color: '#854d0e', marginTop: 2, paddingLeft: 10 }}>* {it.notes}</div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Totals */}
              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: '#475569' }}>
                  <span>Subtotal</span>
                  <span style={{ fontFamily: 'monospace' }}>{formatCOP(subtotal)}</span>
                </div>
                {discount > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: '#dc2626' }}>
                    <span>Descuento</span>
                    <span style={{ fontFamily: 'monospace' }}>-{formatCOP(discount)}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 4 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>Total</span>
                  <span style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', fontFamily: 'monospace', letterSpacing: -0.6 }}>
                    {formatCOP(sale.total)}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 22px', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'flex-end' }}>
          <button
            data-testid="sale-reprint"
            disabled={!sale}
            onClick={handleReprint}
            style={{
              padding: '11px 20px', border: 'none',
              background: sale ? '#10b981' : '#cbd5e1', borderRadius: 9,
              cursor: sale ? 'pointer' : 'not-allowed', fontSize: 13.5, fontWeight: 700, color: '#fff',
              display: 'flex', alignItems: 'center', gap: 7,
              boxShadow: sale ? '0 6px 16px rgba(16,185,129,.35)' : 'none',
            }}
          >
            <Printer size={15} /> Reimprimir ticket
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Página ───────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8,
  fontSize: 13, color: '#0f172a', outline: 'none', boxSizing: 'border-box',
  fontFamily: 'Inter, system-ui, sans-serif', background: '#fff',
}

export function SalesHistoryPage() {
  const [from, setFrom] = useState(daysAgoBogota(30))
  const [to, setTo] = useState(todayBogota())
  const [method, setMethod] = useState<PayMethod | ''>('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [detailId, setDetailId] = useState<string | null>(null)

  const { rows, count, pageCount, isLoading, isFetching } = useSalesHistory({
    from, to, method: method || null, search, page,
  })

  // Cualquier cambio de filtro vuelve a la primera página.
  const resetPage = () => setPage(0)

  const rangeFrom = count === 0 ? 0 : page * SALES_PAGE_SIZE + 1
  const rangeTo = Math.min(count, (page + 1) * SALES_PAGE_SIZE)

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{ background: '#f8fafc', color: '#0f172a', fontFamily: 'Inter, system-ui, sans-serif', position: 'relative' }}
    >
      {/* Controls bar */}
      <div style={{ padding: '16px 24px', background: '#fff', borderBottom: '1px solid #f1f5f9', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <Receipt size={18} color="#10b981" />
          <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', letterSpacing: -0.3 }}>
            Historial de ventas
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8', fontFamily: 'monospace' }}>
            {count} {count === 1 ? 'venta' : 'ventas'}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Search por número */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#f8fafc', borderRadius: 8, padding: '8px 12px', border: '1px solid #e2e8f0', minWidth: 220 }}>
            <Search size={15} color="#94a3b8" />
            <input
              data-testid="sales-search"
              value={search}
              onChange={(e) => { setSearch(e.target.value); resetPage() }}
              placeholder="Buscar por número de venta..."
              inputMode="numeric"
              style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, color: '#0f172a' }}
            />
            {search && (
              <button onClick={() => { setSearch(''); resetPage() }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0, display: 'grid', placeItems: 'center' }}>
                <X size={14} />
              </button>
            )}
          </div>

          {/* Rango de fechas */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Calendar size={15} color="#94a3b8" />
            <input
              data-testid="sales-from"
              type="date"
              value={from}
              max={to}
              onChange={(e) => { setFrom(e.target.value); resetPage() }}
              style={inputStyle}
            />
            <span style={{ color: '#94a3b8', fontSize: 13 }}>→</span>
            <input
              data-testid="sales-to"
              type="date"
              value={to}
              min={from}
              max={todayBogota()}
              onChange={(e) => { setTo(e.target.value); resetPage() }}
              style={inputStyle}
            />
          </div>

          {/* Método */}
          <select
            data-testid="sales-method"
            value={method}
            onChange={(e) => { setMethod(e.target.value as PayMethod | ''); resetPage() }}
            style={{ ...inputStyle, cursor: 'pointer' }}
          >
            {METHOD_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflow: 'auto', padding: '12px 24px 24px' }}>
        {isLoading ? (
          <div style={{ padding: 50, textAlign: 'center', color: '#94a3b8', fontSize: 13.5 }}>
            Cargando ventas...
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: '#94a3b8', fontSize: 13.5 }}>
            <Receipt size={32} style={{ margin: '0 auto 14px', display: 'block', opacity: 0.3 }} />
            No hay ventas para los filtros seleccionados.
          </div>
        ) : (
          <div style={{ background: '#fff', border: '1px solid #f1f5f9', borderRadius: 12, overflow: 'hidden', opacity: isFetching ? 0.7 : 1, transition: 'opacity .12s' }}>
            {/* Head */}
            <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 130px 130px 120px', gap: 12, padding: '11px 16px', borderBottom: '1px solid #f1f5f9', background: '#f8fafc', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 }}>
              <span>Venta</span>
              <span>Fecha · Cliente</span>
              <span>Tipo</span>
              <span>Método</span>
              <span style={{ textAlign: 'right' }}>Total</span>
            </div>
            {/* Rows */}
            {rows.map((row: SalesHistoryRow) => {
              const ot = ORDER_TYPE[row.type as OrderType]
              return (
                <button
                  key={row.id}
                  data-testid="sale-row"
                  onClick={() => setDetailId(row.id)}
                  style={{
                    width: '100%', textAlign: 'left', display: 'grid',
                    gridTemplateColumns: '90px 1fr 130px 130px 120px', gap: 12, alignItems: 'center',
                    padding: '13px 16px', borderBottom: '1px solid #f8fafc',
                    background: '#fff', border: 'none', cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = '#fff')}
                >
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', fontFamily: 'monospace' }}>
                    #{row.order_number}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13, color: '#0f172a', fontFamily: 'monospace' }}>
                      {formatDateTime(row.created_at)}
                    </span>
                    {row.customer_name && (
                      <span style={{ display: 'block', fontSize: 12, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row.customer_name}
                      </span>
                    )}
                  </span>
                  <span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: ot.bg, color: ot.fg, borderRadius: 6, padding: '3px 9px', fontSize: 11.5, fontWeight: 600 }}>
                      {ot.icon} {ot.label}
                    </span>
                  </span>
                  <span data-testid="sale-row-method" style={{ fontSize: 12.5, color: '#475569' }}>
                    {methodDisplay(row)}
                  </span>
                  <span style={{ textAlign: 'right', fontSize: 14, fontWeight: 700, color: '#0f172a', fontFamily: 'monospace' }}>
                    {formatCOP(row.total)}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Pagination */}
      {count > 0 && (
        <div style={{ flexShrink: 0, padding: '12px 24px', borderTop: '1px solid #f1f5f9', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12.5, color: '#64748b' }}>
            {rangeFrom}–{rangeTo} de {count}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              data-testid="sales-prev"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              style={{
                width: 34, height: 34, borderRadius: 8, border: '1px solid #e5e7eb',
                background: '#fff', cursor: page === 0 ? 'not-allowed' : 'pointer',
                color: page === 0 ? '#cbd5e1' : '#334155', display: 'grid', placeItems: 'center',
              }}
            >
              <ChevronLeft size={16} />
            </button>
            <span style={{ fontSize: 12.5, color: '#334155', fontFamily: 'monospace', minWidth: 70, textAlign: 'center' }}>
              {page + 1} / {pageCount}
            </span>
            <button
              data-testid="sales-next"
              disabled={page + 1 >= pageCount}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              style={{
                width: 34, height: 34, borderRadius: 8, border: '1px solid #e5e7eb',
                background: '#fff', cursor: page + 1 >= pageCount ? 'not-allowed' : 'pointer',
                color: page + 1 >= pageCount ? '#cbd5e1' : '#334155', display: 'grid', placeItems: 'center',
              }}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Detail modal */}
      {detailId && <SaleDetailModal orderId={detailId} onClose={() => setDetailId(null)} />}
    </div>
  )
}
