import { useState } from 'react'
import { ClipboardList, Calendar, ChevronLeft, ChevronRight, Printer } from 'lucide-react'
import { usePermissions } from '@/hooks/usePermissions'
import { useRestaurantConfig } from '@/hooks/useRestaurantConfig'
import { getShiftMovementTotals } from '@/lib/supabase-helpers'
import { printCashReport, buildCashReportData } from '@/lib/printer'
import {
  useShiftHistory, SHIFTS_PAGE_SIZE,
  type ClosedShiftRow, type HistoryScope,
} from '@/hooks/useShiftHistory'

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

// Diferencia = declarado − esperado. Dato estrella: color inmediato.
//   < 0 → faltante (rojo) · > 0 → sobrante (verde) · = 0 → cuadrado (gris)
function diffStyle(diff: number | null): { label: string; color: string; bg: string } {
  if (diff == null) return { label: '—', color: '#94a3b8', bg: 'transparent' }
  if (diff < 0) return { label: `${formatCOP(diff)} faltante`, color: '#dc2626', bg: '#fef2f2' }
  if (diff > 0) return { label: `+${formatCOP(diff)} sobrante`, color: '#059669', bg: '#ecfdf5' }
  return { label: 'Cuadrado', color: '#64748b', bg: '#f1f5f9' }
}

const inputStyle: React.CSSProperties = {
  padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8,
  fontSize: 13, color: '#0f172a', outline: 'none', boxSizing: 'border-box',
  fontFamily: 'Inter, system-ui, sans-serif', background: '#fff',
}

// ─── Página ───────────────────────────────────────────────────────

export function ShiftHistoryPage() {
  // "Elevado" (owner/admin) = tiene reportes.financiero (cajero NO). Proxy limpio
  // y ya sembrado. Solo controla el DEFAULT de vista y si se muestra el toggle:
  // es filtro de PRESENTACIÓN, no seguridad (la RLS limita a la sede igual).
  const { can } = usePermissions()
  const elevated = can('reportes.financiero')
  const { restaurant } = useRestaurantConfig()
  // Reimpresión del arqueo: mismo permiso que P3 (la ruta ya exige caja.cerrar).
  const canReprint = can('caja.cerrar')

  // Reimprime el comprobante desde el SNAPSHOT persistido (no recomputa el
  // esperado → inmune al bug de ventana). Movimientos re-leídos por shift_id.
  // Mismo builder/print que el cierre → comprobante idéntico al original.
  const handleReprint = async (row: ClosedShiftRow) => {
    if (!row.close_reconciliation) return
    const totals = await getShiftMovementTotals(row.id)
    printCashReport(buildCashReportData(row, {
      restaurantName: restaurant?.name,
      restaurantAddress: restaurant?.address,
      movementsIn: totals.in,
      movementsOut: totals.out,
    }))
  }

  const [from, setFrom] = useState(daysAgoBogota(30))
  const [to, setTo] = useState(todayBogota())
  const [scope, setScope] = useState<HistoryScope>(elevated ? 'all' : 'mine')
  const [page, setPage] = useState(0)

  const { rows, count, pageCount, isLoading, isFetching } = useShiftHistory({ from, to, scope, page })

  const resetPage = () => setPage(0)
  const rangeFrom = count === 0 ? 0 : page * SHIFTS_PAGE_SIZE + 1
  const rangeTo = Math.min(count, (page + 1) * SHIFTS_PAGE_SIZE)

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{ background: '#f8fafc', color: '#0f172a', fontFamily: 'Inter, system-ui, sans-serif', position: 'relative' }}
    >
      {/* Controls bar */}
      <div style={{ padding: '16px 24px', background: '#fff', borderBottom: '1px solid #f1f5f9', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <ClipboardList size={18} color="#10b981" />
          <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', letterSpacing: -0.3 }}>
            Historial de turnos
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8', fontFamily: 'monospace' }}>
            {count} {count === 1 ? 'turno' : 'turnos'}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Rango de fechas (sobre closed_at) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Calendar size={15} color="#94a3b8" />
            <input
              data-testid="shift-from" type="date" value={from} max={to}
              onChange={(e) => { setFrom(e.target.value); resetPage() }} style={inputStyle}
            />
            <span style={{ color: '#94a3b8', fontSize: 13 }}>→</span>
            <input
              data-testid="shift-to" type="date" value={to} min={from} max={todayBogota()}
              onChange={(e) => { setTo(e.target.value); resetPage() }} style={inputStyle}
            />
          </div>

          {/* Scope toggle (solo elevado: owner/admin). Presentación, no seguridad. */}
          {elevated && (
            <div data-testid="shift-scope-toggle" style={{ display: 'flex', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
              {(['all', 'mine'] as HistoryScope[]).map((s) => (
                <button
                  key={s}
                  data-testid={`shift-scope-${s}`}
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
            Cargando turnos...
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: '#94a3b8', fontSize: 13.5 }}>
            <ClipboardList size={32} style={{ margin: '0 auto 14px', display: 'block', opacity: 0.3 }} />
            No hay turnos cerrados para los filtros seleccionados.
          </div>
        ) : (
          <div style={{ background: '#fff', border: '1px solid #f1f5f9', borderRadius: 12, overflow: 'hidden', opacity: isFetching ? 0.7 : 1, transition: 'opacity .12s' }}>
            {/* Head */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr 1.2fr auto', gap: 12, padding: '11px 16px', borderBottom: '1px solid #f1f5f9', background: '#f8fafc', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 }}>
              <span>Apertura</span>
              <span style={{ textAlign: 'right' }}>Declarado</span>
              <span style={{ textAlign: 'right' }}>Esperado</span>
              <span style={{ textAlign: 'right' }}>Diferencia</span>
              <span style={{ width: 96 }} />
            </div>
            {/* Rows */}
            {rows.map((row: ClosedShiftRow) => {
              const d = diffStyle(row.difference)
              return (
                <div
                  key={row.id}
                  data-testid="shift-history-row"
                  style={{
                    display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr 1.2fr auto', gap: 12, alignItems: 'center',
                    padding: '13px 16px', borderBottom: '1px solid #f8fafc',
                  }}
                >
                  {/* Apertura: monto, quién abrió, cuándo (con cierre debajo) */}
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: '#0f172a', fontFamily: 'monospace' }}>
                      {formatCOP(row.opening_amount)}
                    </span>
                    <span data-testid="shift-opened-by" style={{ display: 'block', fontSize: 12, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      Abrió {row.abrio?.full_name ?? '—'} · {formatDateTime(row.opened_at)}
                    </span>
                    <span data-testid="shift-closed-by" style={{ display: 'block', fontSize: 12, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      Cerró {row.cerro?.full_name ?? '—'}
                      {row.closed_at ? ` · ${formatDateTime(row.closed_at)}` : ''}
                    </span>
                  </span>
                  <span data-testid="shift-declared" style={{ textAlign: 'right', fontSize: 13.5, color: '#0f172a', fontFamily: 'monospace' }}>
                    {row.closing_amount != null ? formatCOP(row.closing_amount) : '—'}
                  </span>
                  <span data-testid="shift-expected" style={{ textAlign: 'right', fontSize: 13.5, color: '#475569', fontFamily: 'monospace' }}>
                    {row.expected_amount != null ? formatCOP(row.expected_amount) : '—'}
                  </span>
                  <span style={{ textAlign: 'right' }}>
                    <span
                      data-testid="shift-diff"
                      style={{
                        display: 'inline-block', background: d.bg, color: d.color,
                        borderRadius: 6, padding: '4px 10px', fontSize: 12.5, fontWeight: 700, fontFamily: 'monospace',
                      }}
                    >
                      {d.label}
                    </span>
                  </span>
                  <span style={{ textAlign: 'right' }}>
                    {canReprint && (
                      <button
                        data-testid="shift-reprint"
                        onClick={() => handleReprint(row)}
                        disabled={row.close_reconciliation == null}
                        title={row.close_reconciliation != null ? 'Reimprimir arqueo' : 'Sin arqueo por método'}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          padding: '6px 10px', borderRadius: 7, border: '1px solid #e5e7eb',
                          background: row.close_reconciliation != null ? '#fff' : '#f8fafc',
                          color: row.close_reconciliation != null ? '#334155' : '#cbd5e1',
                          cursor: row.close_reconciliation != null ? 'pointer' : 'not-allowed',
                          fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
                        }}
                      >
                        <Printer size={13} /> Arqueo
                      </button>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Pagination */}
      {count > 0 && (
        <div style={{ flexShrink: 0, padding: '12px 24px', borderTop: '1px solid #f1f5f9', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12.5, color: '#64748b' }}>{rangeFrom}–{rangeTo} de {count}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              data-testid="shift-prev" disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              style={{ width: 34, height: 34, borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', cursor: page === 0 ? 'not-allowed' : 'pointer', color: page === 0 ? '#cbd5e1' : '#334155', display: 'grid', placeItems: 'center' }}
            >
              <ChevronLeft size={16} />
            </button>
            <span style={{ fontSize: 12.5, color: '#334155', fontFamily: 'monospace', minWidth: 70, textAlign: 'center' }}>
              {page + 1} / {pageCount}
            </span>
            <button
              data-testid="shift-next" disabled={page + 1 >= pageCount}
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
