import { useState } from 'react'
import { Banknote, Calendar, ChevronLeft, ChevronRight } from 'lucide-react'
import { usePermissions } from '@/hooks/usePermissions'
import {
  useExpensesHistory, EXPENSES_PAGE_SIZE, type CashOutRow,
} from '@/hooks/useExpensesHistory'
import type { HistoryScope } from '@/hooks/useShiftHistory'

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

function todayBogota(): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/Bogota',
  }).format(new Date())
}
function daysAgoBogota(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/Bogota',
  }).format(d)
}

const inputStyle: React.CSSProperties = {
  padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8,
  fontSize: 13, color: '#0f172a', outline: 'none', boxSizing: 'border-box',
  fontFamily: 'Inter, system-ui, sans-serif', background: '#fff',
}

// ─── Página ───────────────────────────────────────────────────────

export function ExpensesHistoryPage() {
  // "Elevado" (owner/admin) controla el default de vista y el toggle. Filtro de
  // PRESENTACIÓN, no seguridad: la RLS ya limita a la sede activa.
  const { can } = usePermissions()
  const elevated = can('reportes.financiero')

  const [from, setFrom] = useState(daysAgoBogota(30))
  const [to, setTo] = useState(todayBogota())
  const [scope, setScope] = useState<HistoryScope>(elevated ? 'all' : 'mine')
  const [page, setPage] = useState(0)

  const { rows, count, periodTotal, pageCount, isLoading, isFetching } =
    useExpensesHistory({ from, to, scope, page })

  const resetPage = () => setPage(0)
  const rangeFrom = count === 0 ? 0 : page * EXPENSES_PAGE_SIZE + 1
  const rangeTo = Math.min(count, (page + 1) * EXPENSES_PAGE_SIZE)

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{ background: '#f8fafc', color: '#0f172a', fontFamily: 'Inter, system-ui, sans-serif', position: 'relative' }}
    >
      {/* Controls bar */}
      <div style={{ padding: '16px 24px', background: '#fff', borderBottom: '1px solid #f1f5f9', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <Banknote size={18} color="#10b981" />
          <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', letterSpacing: -0.3 }}>
            Historial de gastos
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8', fontFamily: 'monospace' }}>
            {count} {count === 1 ? 'egreso' : 'egresos'}
          </div>
          {/* Total del período (todas las filas filtradas, no solo la página) */}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Total del período
            </span>
            <span data-testid="expenses-total" style={{ fontSize: 18, fontWeight: 700, color: '#dc2626', fontFamily: 'monospace', letterSpacing: -0.4 }}>
              {formatCOP(periodTotal)}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Calendar size={15} color="#94a3b8" />
            <input
              data-testid="expense-from" type="date" value={from} max={to}
              onChange={(e) => { setFrom(e.target.value); resetPage() }} style={inputStyle}
            />
            <span style={{ color: '#94a3b8', fontSize: 13 }}>→</span>
            <input
              data-testid="expense-to" type="date" value={to} min={from} max={todayBogota()}
              onChange={(e) => { setTo(e.target.value); resetPage() }} style={inputStyle}
            />
          </div>

          {elevated && (
            <div data-testid="expense-scope-toggle" style={{ display: 'flex', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
              {(['all', 'mine'] as HistoryScope[]).map((s) => (
                <button
                  key={s}
                  data-testid={`expense-scope-${s}`}
                  onClick={() => { setScope(s); resetPage() }}
                  style={{
                    padding: '8px 14px', border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
                    background: scope === s ? '#10b981' : '#fff',
                    color: scope === s ? '#fff' : '#64748b',
                  }}
                >
                  {s === 'all' ? 'Todos' : 'Míos'}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflow: 'auto', padding: '12px 24px 24px' }}>
        {isLoading ? (
          <div style={{ padding: 50, textAlign: 'center', color: '#94a3b8', fontSize: 13.5 }}>
            Cargando egresos...
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: '#94a3b8', fontSize: 13.5 }}>
            <Banknote size={32} style={{ margin: '0 auto 14px', display: 'block', opacity: 0.3 }} />
            No hay egresos para los filtros seleccionados.
          </div>
        ) : (
          <div style={{ background: '#fff', border: '1px solid #f1f5f9', borderRadius: 12, overflow: 'hidden', opacity: isFetching ? 0.7 : 1, transition: 'opacity .12s' }}>
            {/* Head */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px 150px 110px', gap: 12, padding: '11px 16px', borderBottom: '1px solid #f1f5f9', background: '#f8fafc', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 }}>
              <span>Motivo</span>
              <span>Quién · Cuándo</span>
              <span>Turno</span>
              <span style={{ textAlign: 'right' }}>Monto</span>
            </div>
            {/* Rows */}
            {rows.map((row: CashOutRow) => (
              <div
                key={row.id}
                data-testid="expense-row"
                style={{
                  display: 'grid', gridTemplateColumns: '1fr 180px 150px 110px', gap: 12, alignItems: 'center',
                  padding: '13px 16px', borderBottom: '1px solid #f8fafc',
                }}
              >
                <span data-testid="expense-reason" style={{ fontSize: 13.5, fontWeight: 600, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {row.reason}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12.5, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.autor?.full_name ?? '—'}
                  </span>
                  <span style={{ display: 'block', fontSize: 12, color: '#64748b', fontFamily: 'monospace' }}>
                    {formatDateTime(row.created_at)}
                  </span>
                </span>
                <span style={{ fontSize: 12, color: '#94a3b8', fontFamily: 'monospace' }}>
                  #{row.shift_id.slice(-6).toUpperCase()}
                </span>
                <span data-testid="expense-amount" style={{ textAlign: 'right', fontSize: 14, fontWeight: 700, color: '#dc2626', fontFamily: 'monospace' }}>
                  −{formatCOP(row.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {count > 0 && (
        <div style={{ flexShrink: 0, padding: '12px 24px', borderTop: '1px solid #f1f5f9', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12.5, color: '#64748b' }}>{rangeFrom}–{rangeTo} de {count}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              data-testid="expense-prev" disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              style={{ width: 34, height: 34, borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', cursor: page === 0 ? 'not-allowed' : 'pointer', color: page === 0 ? '#cbd5e1' : '#334155', display: 'grid', placeItems: 'center' }}
            >
              <ChevronLeft size={16} />
            </button>
            <span style={{ fontSize: 12.5, color: '#334155', fontFamily: 'monospace', minWidth: 70, textAlign: 'center' }}>
              {page + 1} / {pageCount}
            </span>
            <button
              data-testid="expense-next" disabled={page + 1 >= pageCount}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              style={{ width: 34, height: 34, borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', cursor: page + 1 >= pageCount ? 'not-allowed' : 'pointer', color: page + 1 >= pageCount ? '#cbd5e1' : '#334155', display: 'grid', placeItems: 'center' }}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
