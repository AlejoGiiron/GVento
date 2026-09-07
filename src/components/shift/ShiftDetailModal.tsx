import { X, Printer, AlertTriangle, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { printCashReport, ARQUEO_ORDER, ARQUEO_METHOD_LABEL } from '@/lib/printer'
import { buildShiftDetail, metodoDelArqueo } from '@/lib/shiftDetail'
import type { ClosedShiftRow } from '@/hooks/useShiftHistory'

const formatCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n)

const fmtDT = (iso: string) =>
  new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(iso))

const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatCOP(Math.abs(n))}`

interface ShiftDetailModalProps {
  row: ClosedShiftRow
  /** Totales de movimientos del turno, ya leídos por shift_id. */
  movements: { in: number; out: number }
  restaurantName?: string | null
  restaurantAddress?: string | null
  /** false = sin permiso de caja.cerrar → no se ofrece reimprimir. */
  canReprint: boolean
  onClose: () => void
}

const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '8px 0', fontSize: 13.5, color: '#334155',
}
const totalRowStyle: React.CSSProperties = {
  ...rowStyle, borderTop: '1px solid #e5e7eb', marginTop: 4, paddingTop: 12,
  fontWeight: 700, fontSize: 14, color: '#0f172a',
}
const seccion: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: '#94a3b8',
  textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10,
}
const caja: React.CSSProperties = { background: '#f8fafc', borderRadius: 10, padding: '4px 14px' }

export function ShiftDetailModal({
  row, movements, restaurantName, restaurantAddress, canReprint, onClose,
}: ShiftDetailModalProps) {
  // Toda la decisión vive en buildShiftDetail, que es PURO y está testeado con
  // filas construidas a mano — incluida la rama "sin arqueo", que no se puede
  // producir desde la UI y por lo tanto ningún E2E alcanza. Acá solo se pinta.
  //
  // Lo importante que resuelve esa función: NO llama a buildCashReportData
  // cuando close_reconciliation es null (el builder castea sin chequear).
  const v = buildShiftDetail(row, movements, { restaurantName, restaurantAddress })
  const { tieneArqueo, data, ventas } = v
  const rec = data?.reconciliation
  const { esperado, declarado, diferencia } = v.efectivo

  const handlePrint = () => {
    if (!data) return
    printCashReport(data)
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', display: 'grid', placeItems: 'center', zIndex: 50, fontFamily: 'Inter, system-ui, sans-serif', padding: 20 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        data-testid="shift-detail-modal"
        style={{ background: '#fff', borderRadius: 14, width: 540, maxWidth: '100%', maxHeight: '92vh', boxShadow: '0 25px 50px -12px rgba(0,0,0,.25)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
      >
        {/* Header */}
        <div style={{ padding: '18px 22px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#10b981', textTransform: 'uppercase', letterSpacing: 1 }}>
              Detalle del turno
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', letterSpacing: -0.3, marginTop: 1, fontFamily: 'monospace' }}>
              #{row.id.slice(-6).toUpperCase()}
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
        <div style={{ overflow: 'auto', flex: 1, padding: 22 }}>

          {/* ── Apertura y cierre — siempre disponible ── */}
          <div style={{ marginBottom: 20 }}>
            <div style={seccion}>Apertura y cierre</div>
            <div style={caja}>
              <div style={{ ...rowStyle, borderBottom: '1px solid #f1f5f9' }}>
                <span style={{ color: '#64748b' }}>Abrió</span>
                <span data-testid="detail-opened" style={{ textAlign: 'right' }}>
                  {fmtDT(row.opened_at)}
                  {row.abrio?.full_name && (
                    <span style={{ display: 'block', fontSize: 11.5, color: '#94a3b8' }}>{row.abrio.full_name}</span>
                  )}
                </span>
              </div>
              <div style={{ ...rowStyle, borderBottom: '1px solid #f1f5f9' }}>
                <span style={{ color: '#64748b' }}>Cerró</span>
                <span data-testid="detail-closed" style={{ textAlign: 'right' }}>
                  {row.closed_at ? fmtDT(row.closed_at) : '—'}
                  {row.cerro?.full_name && (
                    <span style={{ display: 'block', fontSize: 11.5, color: '#94a3b8' }}>{row.cerro.full_name}</span>
                  )}
                </span>
              </div>
              <div style={rowStyle}>
                <span style={{ color: '#64748b' }}>Monto de apertura</span>
                <span data-testid="detail-opening" style={{ fontFamily: 'monospace' }}>{formatCOP(row.opening_amount)}</span>
              </div>
            </div>
          </div>

          {/* ── Sin arqueo por método: se dice, y se muestra lo que SÍ hay ── */}
          {!tieneArqueo && (
            <div
              data-testid="detail-sin-arqueo"
              style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', borderRadius: 10, background: '#fffbeb', border: '1px solid #fde68a', marginBottom: 20 }}
            >
              <AlertTriangle size={15} color="#92400e" style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: '#92400e' }}>Sin arqueo por método</div>
                <div style={{ fontSize: 11.5, color: '#b45309', marginTop: 2, lineHeight: 1.45 }}>
                  Este turno se cerró antes de que existiera el arqueo multi-método. Queda el
                  cuadre de efectivo, que es lo que se registró entonces.
                </div>
              </div>
            </div>
          )}

          {/* ── Ventas por método — solo con snapshot ── */}
          {ventas && rec && (
            <div style={{ marginBottom: 20 }}>
              <div style={seccion}>Ventas por método de pago</div>
              <div style={caja}>
                {ARQUEO_ORDER.map((m) => (
                  <div key={m} style={{ ...rowStyle, borderBottom: '1px solid #f1f5f9' }}>
                    <span style={{ color: '#64748b' }}>{ARQUEO_METHOD_LABEL[m]}</span>
                    <span data-testid={`detail-sales-${m}`} style={{ fontFamily: 'monospace', fontWeight: ventas.byMethod[m] > 0 ? 600 : 400, color: ventas.byMethod[m] > 0 ? '#0f172a' : '#94a3b8' }}>
                      {formatCOP(ventas.byMethod[m])}
                    </span>
                  </div>
                ))}
                <div style={totalRowStyle}>
                  <span>Total ventas</span>
                  <span style={{ fontFamily: 'monospace', color: '#10b981' }}>
                    {formatCOP(ventas.total)}
                    <span style={{ color: '#94a3b8', fontWeight: 500 }}> · {v.salesCount} vta(s)</span>
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* ── Movimientos, si los hubo ── */}
          {(movements.in > 0 || movements.out > 0) && (
            <div style={{ marginBottom: 20 }}>
              <div style={seccion}>Movimientos de caja</div>
              <div style={caja}>
                {movements.in > 0 && (
                  <div style={{ ...rowStyle, borderBottom: movements.out > 0 ? '1px solid #f1f5f9' : undefined }}>
                    <span style={{ color: '#64748b' }}>Ingresos</span>
                    <span data-testid="detail-mov-in" style={{ fontFamily: 'monospace', color: '#059669' }}>+ {formatCOP(movements.in)}</span>
                  </div>
                )}
                {movements.out > 0 && (
                  <div style={rowStyle}>
                    <span style={{ color: '#64748b' }}>Egresos</span>
                    <span data-testid="detail-mov-out" style={{ fontFamily: 'monospace', color: '#dc2626' }}>− {formatCOP(movements.out)}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Arqueo por método — solo con snapshot ── */}
          {rec && (
            <div style={{ marginBottom: 20 }}>
              <div style={seccion}>Arqueo · esperado vs declarado</div>
              <div style={{ background: '#f8fafc', borderRadius: 10, padding: '8px 14px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 88px 88px 82px', gap: 6, fontSize: 10.5, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.4, paddingBottom: 6, borderBottom: '1px solid #eef2f7' }}>
                  <span>Método</span>
                  <span style={{ textAlign: 'right' }}>Esperado</span>
                  <span style={{ textAlign: 'right' }}>Declarado</span>
                  <span style={{ textAlign: 'right' }}>Dif.</span>
                </div>
                {ARQUEO_ORDER.map((m) => {
                  // Snapshot viejo: un método ausente vale 0 en vez de reventar.
                  const r = metodoDelArqueo(rec, m)
                  return (
                    <div key={m} data-testid={`detail-arqueo-${m}`} style={{ display: 'grid', gridTemplateColumns: '1fr 88px 88px 82px', gap: 6, alignItems: 'center', padding: '7px 0', borderBottom: '1px solid #f1f5f9' }}>
                      <span style={{ fontSize: 13, color: '#334155' }}>{ARQUEO_METHOD_LABEL[m]}</span>
                      <span style={{ fontSize: 12.5, fontFamily: 'monospace', textAlign: 'right' }}>{formatCOP(r.expected)}</span>
                      <span style={{ fontSize: 12.5, fontFamily: 'monospace', textAlign: 'right' }}>{formatCOP(r.declared)}</span>
                      <span style={{ fontSize: 12.5, fontFamily: 'monospace', textAlign: 'right', fontWeight: 600, color: r.difference === 0 ? '#64748b' : r.difference > 0 ? '#059669' : '#dc2626' }}>
                        {signed(r.difference)}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Cuadre de efectivo (F1) — SIEMPRE, con arqueo o sin él ── */}
          <div style={{ marginBottom: 20 }}>
            <div style={seccion}>Cuadre de efectivo</div>
            <div style={caja}>
              <div style={{ ...rowStyle, borderBottom: '1px solid #f1f5f9' }}>
                <span style={{ color: '#64748b' }}>Esperado</span>
                <span data-testid="detail-expected" style={{ fontFamily: 'monospace' }}>{formatCOP(esperado)}</span>
              </div>
              <div style={rowStyle}>
                <span style={{ color: '#64748b' }}>Declarado</span>
                <span data-testid="detail-declared" style={{ fontFamily: 'monospace' }}>{formatCOP(declarado)}</span>
              </div>
            </div>
            <div style={{
              marginTop: 10, padding: '12px 16px', borderRadius: 10,
              background: diferencia === 0 ? '#ecfdf5' : diferencia > 0 ? '#ecfdf5' : '#fef2f2',
              border: `1px solid ${diferencia >= 0 ? '#a7f3d0' : '#fecaca'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 600, color: diferencia >= 0 ? '#065f46' : '#991b1b' }}>
                {diferencia > 0 ? <TrendingUp size={15} color="#059669" />
                  : diferencia < 0 ? <TrendingDown size={15} color="#dc2626" />
                  : <Minus size={15} color="#10b981" />}
                {diferencia > 0 ? 'Sobrante' : diferencia < 0 ? 'Faltante' : 'Cuadre exacto'}
              </span>
              <span data-testid="detail-difference" style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 700, color: diferencia >= 0 ? '#059669' : '#dc2626' }}>
                {signed(diferencia)}
              </span>
            </div>
          </div>

          {/* ── Totales del arqueo — solo con snapshot ── */}
          {rec && (
            <div data-testid="detail-arqueo-total" style={{ padding: '12px 16px', borderRadius: 10, background: '#0f172a', display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                <span style={{ color: '#cbd5e1' }}>Esperado total</span>
                <span style={{ fontFamily: 'monospace', color: '#e2e8f0' }}>{formatCOP(rec.expected_total)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                <span style={{ color: '#cbd5e1' }}>Declarado total</span>
                <span style={{ fontFamily: 'monospace', color: '#e2e8f0' }}>{formatCOP(rec.declared_total)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 700, borderTop: '1px solid #1e293b', paddingTop: 7, marginTop: 1, color: '#fff' }}>
                <span>Diferencia total</span>
                <span style={{ fontFamily: 'monospace', color: rec.difference_total >= 0 ? '#34d399' : '#f87171' }}>
                  {signed(rec.difference_total)}
                </span>
              </div>
            </div>
          )}

          {/* Vales — informativo. buildShiftDetail ya lo bajó a 0 si el
              snapshot es anterior al vale y no trae la clave. */}
          {v.vouchers > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderRadius: 10, background: '#fffbeb', border: '1px solid #fde68a', marginBottom: 20 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: '#92400e' }}>Vales entregados en el turno</span>
              <span data-testid="detail-vouchers" style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700, color: '#92400e' }}>
                {formatCOP(v.vouchers)}
              </span>
            </div>
          )}

          {/* ── El comentario: la otra mitad del pedido del cliente ── */}
          <div>
            <div style={seccion}>Comentario del cierre</div>
            {row.close_comment ? (
              <div
                data-testid="detail-comment"
                style={{ padding: '12px 14px', borderRadius: 10, background: '#f8fafc', border: '1px solid #e5e7eb', fontSize: 13, color: '#334155', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}
              >
                {row.close_comment}
              </div>
            ) : (
              <div data-testid="detail-comment-empty" style={{ padding: '12px 14px', borderRadius: 10, background: '#f8fafc', border: '1px dashed #e5e7eb', fontSize: 12.5, color: '#94a3b8' }}>
                El cajero no dejó comentario.
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '16px 22px', borderTop: '1px solid #f1f5f9', display: 'flex', gap: 10, flexShrink: 0, background: 'linear-gradient(180deg, #f8fafc 0%, #fff 100%)' }}>
          <button
            type="button"
            onClick={onClose}
            style={{ flex: 1, padding: '11px 16px', border: '1.5px solid #e5e7eb', background: '#fff', borderRadius: 9, cursor: 'pointer', fontSize: 13.5, fontWeight: 600, color: '#334155' }}
          >
            Cerrar
          </button>
          {canReprint && (
            <button
              data-testid="shift-reprint"
              onClick={handlePrint}
              disabled={!tieneArqueo}
              title={tieneArqueo ? 'Reimprimir arqueo' : 'Sin arqueo por método'}
              style={{
                flex: 1, padding: '11px 16px', borderRadius: 9,
                border: `1.5px solid ${tieneArqueo ? '#e5e7eb' : '#f1f5f9'}`,
                background: tieneArqueo ? '#fff' : '#f8fafc',
                color: tieneArqueo ? '#334155' : '#cbd5e1',
                cursor: tieneArqueo ? 'pointer' : 'not-allowed',
                fontSize: 13.5, fontWeight: 600,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              }}
            >
              <Printer size={15} /> Reimprimir
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
