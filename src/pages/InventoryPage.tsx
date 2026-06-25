import { useMemo, useState } from 'react'
import {
  Search, X, Plus, Boxes, PackageX, AlertTriangle, TrendingDown,
  ChevronLeft, ChevronRight, ArrowDownCircle, ArrowUpCircle, RotateCcw, SlidersHorizontal,
} from 'lucide-react'
import { useProducts } from '@/hooks/useProducts'
import { useStockMovements } from '@/hooks/useStockMovements'
import { StockAdjustModal } from '@/components/inventory/StockAdjustModal'
import type { ProductWithCategory } from '@/stores/cartStore'
import type { StockMovementType } from '@/lib/supabase-helpers'

const PAGE_SIZE = 25

type StockStatus = 'out' | 'negative' | 'low' | 'ok'

function stockStatus(p: ProductWithCategory): StockStatus {
  const s = p.stock_qty ?? 0
  if (s < 0) return 'negative'
  if (s === 0) return 'out'
  if (p.min_stock > 0 && s <= p.min_stock) return 'low'
  return 'ok'
}

const fmtDateTime = (iso: string) =>
  new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'short',
  }).format(new Date(iso))

// ─── Status badge ────────────────────────────────────────────────
function StatusBadge({ status, stock }: { status: StockStatus; stock: number }) {
  const map = {
    negative: { bg: '#fef2f2', fg: '#b91c1c', label: `Reponer (${stock})` },
    out: { bg: '#fef2f2', fg: '#b91c1c', label: 'Sin stock' },
    low: { bg: '#fffbeb', fg: '#92400e', label: 'Stock bajo' },
    ok: { bg: '#ecfdf5', fg: '#065f46', label: 'Disponible' },
  }[status]
  return (
    <span
      data-testid="stock-status-badge"
      style={{ padding: '3px 9px', borderRadius: 8, background: map.bg, color: map.fg, fontSize: 11, fontWeight: 700 }}
    >
      {map.label}
    </span>
  )
}

// ─── KPI card ────────────────────────────────────────────────────
function KpiCard({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: string }) {
  return (
    <div style={{ flex: 1, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: tone }}>
        {icon}
        <span style={{ fontSize: 11.5, fontWeight: 600, color: '#64748b' }}>{label}</span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: '#0f172a', fontFamily: 'monospace', marginTop: 6 }}>{value}</div>
    </div>
  )
}

// ─── Niveles tab ─────────────────────────────────────────────────
function LevelsTab({ products, onAdjust }: { products: ProductWithCategory[]; onAdjust: (id: string) => void }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | StockStatus>('all')

  const tracked = useMemo(
    () => products.filter(p => p.kind === 'simple' && p.stock_tracking),
    [products],
  )

  const summary = useMemo(() => {
    let negative = 0, out = 0, low = 0
    for (const p of tracked) {
      const st = stockStatus(p)
      if (st === 'negative') negative++
      else if (st === 'out') out++
      else if (st === 'low') low++
    }
    return { total: tracked.length, negative, out, low }
  }, [tracked])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return tracked.filter(p => {
      if (q && !p.name.toLowerCase().includes(q)) return false
      if (filter === 'all') return true
      return stockStatus(p) === filter
    })
  }, [tracked, query, filter])

  const FILTERS: { value: 'all' | StockStatus; label: string }[] = [
    { value: 'all', label: 'Todos' },
    { value: 'negative', label: 'Negativo' },
    { value: 'out', label: 'Sin stock' },
    { value: 'low', label: 'Bajo' },
    { value: 'ok', label: 'Disponible' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* KPIs */}
      <div style={{ display: 'flex', gap: 12 }}>
        <KpiCard icon={<Boxes size={15} />} label="Insumos con inventario" value={summary.total} tone="#10b981" />
        <KpiCard icon={<PackageX size={15} />} label="Sin stock (0)" value={summary.out} tone="#64748b" />
        <KpiCard icon={<AlertTriangle size={15} />} label="Stock bajo" value={summary.low} tone="#f59e0b" />
        <KpiCard icon={<TrendingDown size={15} />} label="En negativo" value={summary.negative} tone="#dc2626" />
      </div>

      {/* Search + filter */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 9, padding: '8px 12px', width: 240 }}>
          <Search size={15} color="#94a3b8" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar insumo..."
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, color: '#0f172a' }}
          />
          {query && <button onClick={() => setQuery('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0, display: 'grid', placeItems: 'center' }}><X size={13} /></button>}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              style={{
                padding: '7px 12px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                border: `1px solid ${filter === f.value ? '#10b981' : '#e2e8f0'}`,
                background: filter === f.value ? '#ecfdf5' : '#fff',
                color: filter === f.value ? '#065f46' : '#64748b',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8fafc', textAlign: 'left', color: '#64748b', fontSize: 11.5 }}>
              <th style={{ padding: '10px 16px', fontWeight: 600 }}>Insumo</th>
              <th style={{ padding: '10px 16px', fontWeight: 600 }}>Categoría</th>
              <th style={{ padding: '10px 16px', fontWeight: 600, textAlign: 'right' }}>Stock</th>
              <th style={{ padding: '10px 16px', fontWeight: 600, textAlign: 'right' }}>Mínimo</th>
              <th style={{ padding: '10px 16px', fontWeight: 600 }}>Estado</th>
              <th style={{ padding: '10px 16px', fontWeight: 600, textAlign: 'right' }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: '40px 16px', textAlign: 'center', color: '#94a3b8' }}>Sin insumos que coincidan</td></tr>
            ) : filtered.map(p => {
              const st = stockStatus(p)
              const stock = p.stock_qty ?? 0
              return (
                <tr key={p.id} data-testid="stock-level-row" style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '11px 16px', fontWeight: 600, color: '#0f172a' }}>{p.name}</td>
                  <td style={{ padding: '11px 16px', color: '#64748b' }}>{p.categories?.name ?? '—'}</td>
                  <td data-testid="stock-level-qty" style={{ padding: '11px 16px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: stock < 0 ? '#b91c1c' : '#0f172a' }}>{stock}</td>
                  <td style={{ padding: '11px 16px', textAlign: 'right', fontFamily: 'monospace', color: '#94a3b8' }}>{p.min_stock}</td>
                  <td style={{ padding: '11px 16px' }}><StatusBadge status={st} stock={stock} /></td>
                  <td style={{ padding: '8px 16px', textAlign: 'right' }}>
                    <button
                      data-testid="stock-level-adjust"
                      onClick={() => onAdjust(p.id)}
                      title="Ajustar stock"
                      style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', color: '#334155', fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}
                    >
                      <SlidersHorizontal size={12} /> Ajustar
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Movimientos tab ─────────────────────────────────────────────
const MOV_META: Record<string, { bg: string; fg: string; label: string; icon: React.ReactNode }> = {
  sale: { bg: '#eff6ff', fg: '#1e40af', label: 'Venta', icon: <ArrowDownCircle size={12} /> },
  adjustment: { bg: '#f5f3ff', fg: '#6d28d9', label: 'Ajuste', icon: <SlidersHorizontal size={12} /> },
  return: { bg: '#ecfdf5', fg: '#065f46', label: 'Devolución', icon: <RotateCcw size={12} /> },
  purchase: { bg: '#ecfdf5', fg: '#047857', label: 'Compra', icon: <ArrowUpCircle size={12} /> },
}

function MovementsTab() {
  const [type, setType] = useState<StockMovementType | null>(null)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(0)

  const { data, isLoading, isFetching } = useStockMovements({
    type,
    from: from ? new Date(from).toISOString() : undefined,
    to: to ? new Date(to + 'T23:59:59').toISOString() : undefined,
    page,
    pageSize: PAGE_SIZE,
  })

  const rows = data?.rows ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const TYPES: { value: StockMovementType | null; label: string }[] = [
    { value: null, label: 'Todos' },
    { value: 'sale', label: 'Ventas' },
    { value: 'purchase', label: 'Compras' },
    { value: 'adjustment', label: 'Ajustes' },
    { value: 'return', label: 'Devoluciones' },
  ]

  const inputStyle: React.CSSProperties = {
    padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12.5, color: '#0f172a', outline: 'none',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {TYPES.map(t => (
            <button
              key={t.label}
              onClick={() => { setType(t.value); setPage(0) }}
              style={{
                padding: '7px 12px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                border: `1px solid ${type === t.value ? '#10b981' : '#e2e8f0'}`,
                background: type === t.value ? '#ecfdf5' : '#fff',
                color: type === t.value ? '#065f46' : '#64748b',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0) }} style={inputStyle} />
          <span style={{ color: '#94a3b8', fontSize: 12 }}>→</span>
          <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(0) }} style={inputStyle} />
        </div>
      </div>

      {/* Table */}
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', opacity: isFetching ? 0.6 : 1, transition: 'opacity .15s' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f8fafc', textAlign: 'left', color: '#64748b', fontSize: 11.5 }}>
              <th style={{ padding: '10px 16px', fontWeight: 600 }}>Fecha</th>
              <th style={{ padding: '10px 16px', fontWeight: 600 }}>Tipo</th>
              <th style={{ padding: '10px 16px', fontWeight: 600 }}>Producto</th>
              <th style={{ padding: '10px 16px', fontWeight: 600, textAlign: 'right' }}>Cantidad</th>
              <th style={{ padding: '10px 16px', fontWeight: 600 }}>Usuario</th>
              <th style={{ padding: '10px 16px', fontWeight: 600 }}>Referencia</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} style={{ padding: '40px 16px', textAlign: 'center', color: '#94a3b8' }}>Cargando...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: '40px 16px', textAlign: 'center', color: '#94a3b8' }}>Sin movimientos en el período</td></tr>
            ) : rows.map(m => {
              const meta = MOV_META[m.type] ?? { bg: '#f1f5f9', fg: '#64748b', label: m.type, icon: null }
              const ref = (m.type === 'sale' || m.type === 'purchase') && m.reference_id
                ? `#${m.reference_id.slice(0, 8)}`
                : (m.notes ?? '—')
              return (
                <tr key={m.id} data-testid="stock-movement-row" style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '11px 16px', color: '#64748b', fontFamily: 'monospace', fontSize: 12 }}>{fmtDateTime(m.created_at)}</td>
                  <td style={{ padding: '11px 16px' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 8, background: meta.bg, color: meta.fg, fontSize: 11, fontWeight: 700 }}>
                      {meta.icon}{meta.label}
                    </span>
                  </td>
                  <td style={{ padding: '11px 16px', fontWeight: 600, color: '#0f172a' }}>{m.products?.name ?? '—'}</td>
                  <td data-testid="stock-movement-qty" style={{ padding: '11px 16px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: m.qty >= 0 ? '#059669' : '#dc2626' }}>
                    {m.qty >= 0 ? '+' : '−'}{Math.abs(m.qty)}
                  </td>
                  <td style={{ padding: '11px 16px', color: '#64748b' }}>{m.profiles?.full_name ?? '—'}</td>
                  <td style={{ padding: '11px 16px', color: '#94a3b8', fontFamily: 'monospace', fontSize: 12 }}>{ref}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12.5, color: '#64748b' }}>{total} movimiento{total !== 1 ? 's' : ''}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', cursor: page === 0 ? 'not-allowed' : 'pointer', color: '#334155', opacity: page === 0 ? 0.4 : 1, display: 'grid', placeItems: 'center' }}
          >
            <ChevronLeft size={15} />
          </button>
          <span style={{ fontSize: 12.5, color: '#64748b', fontFamily: 'monospace' }}>{page + 1} / {pageCount}</span>
          <button
            onClick={() => setPage(p => (p + 1 < pageCount ? p + 1 : p))}
            disabled={page + 1 >= pageCount}
            style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', cursor: page + 1 >= pageCount ? 'not-allowed' : 'pointer', color: '#334155', opacity: page + 1 >= pageCount ? 0.4 : 1, display: 'grid', placeItems: 'center' }}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────
export function InventoryPage() {
  const { data: products = [] } = useProducts()
  const [tab, setTab] = useState<'levels' | 'movements'>('levels')
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [preselectedId, setPreselectedId] = useState<string | null>(null)

  const adjustable = useMemo(
    () => products.filter(p => p.kind === 'simple' && p.stock_tracking),
    [products],
  )

  const openAdjust = (id: string | null) => { setPreselectedId(id); setAdjustOpen(true) }

  return (
    <div style={{ height: '100%', overflow: 'auto', background: '#f8fafc', fontFamily: 'Inter, system-ui, sans-serif', color: '#0f172a' }}>
      {/* Header */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '20px 28px 0', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#10b981', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Administración</div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', letterSpacing: -0.5, margin: 0 }}>Inventario</h1>
            <p style={{ fontSize: 13, color: '#64748b', marginTop: 3, marginBottom: 0 }}>Niveles de stock y movimientos por sede</p>
          </div>
          <button
            data-testid="inventory-adjust-btn"
            onClick={() => openAdjust(null)}
            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 18px', border: 'none', background: '#10b981', borderRadius: 10, cursor: 'pointer', fontSize: 13.5, fontWeight: 700, color: '#fff', boxShadow: '0 6px 16px rgba(16,185,129,.35)', flexShrink: 0 }}
          >
            <Plus size={16} strokeWidth={2.5} /> Ajuste manual
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4 }}>
          {([
            { value: 'levels' as const, label: 'Niveles de stock', testid: 'inventory-tab-levels' },
            { value: 'movements' as const, label: 'Movimientos', testid: 'inventory-tab-movements' },
          ]).map(t => (
            <button
              key={t.value}
              data-testid={t.testid}
              onClick={() => setTab(t.value)}
              style={{
                padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer',
                fontSize: 14, fontWeight: tab === t.value ? 700 : 500,
                color: tab === t.value ? '#0f172a' : '#64748b',
                borderBottom: `3px solid ${tab === t.value ? '#10b981' : 'transparent'}`,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: '24px 28px' }}>
        {tab === 'levels'
          ? <LevelsTab products={products} onAdjust={openAdjust} />
          : <MovementsTab />}
      </div>

      {adjustOpen && (
        <StockAdjustModal
          products={adjustable}
          preselectedId={preselectedId}
          onClose={() => setAdjustOpen(false)}
        />
      )}
    </div>
  )
}
