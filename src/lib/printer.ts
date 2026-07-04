import type { ShiftReconciliation, ArqueoMethod } from '@/lib/shiftCalc'

export interface ComandaData {
  restaurantName?: string | null
  tableName: string
  zone?: string | null
  waiter?: string | null
  orderId: string
  items: {
    qty: number
    name: string
    notes?: string | null
    extras?: { name: string; qty: number }[]
  }[]
}

// ─── Andamiaje térmico común (80mm) ───────────────────────────────
// Una sola fuente para el envoltorio de estilos y el ciclo
// crear-DOM → imprimir → limpiar que comparten TODOS los comprobantes
// (comanda, ticket de venta y, próximamente, el arqueo de caja).

// CSS del envoltorio térmico 80mm. Solo varían la clase y el par
// font-size/line-height; el resto es idéntico entre comprobantes.
function thermalPrintCss(cls: string, fontSize = 12, lineHeight = 1.45): string {
  return `
@media print {
  body * { visibility: hidden !important; }
  .${cls}, .${cls} * { visibility: visible !important; }
  .${cls} {
    display: block !important;
    position: fixed !important;
    top: 0 !important; left: 0 !important;
    width: 80mm !important;
    background: white !important;
    padding: 6mm !important;
    box-sizing: border-box !important;
    font-family: 'Courier New', monospace !important;
    font-size: ${fontSize}px !important;
    line-height: ${lineHeight} !important;
    color: black !important;
  }
}
.${cls} { display: none; }
`
}

interface ThermalPrintOptions {
  styleId: string
  contentId: string
  className: string
  fontSize?: number
  lineHeight?: number
}

// Inyecta el CSS térmico (una sola vez, guard por styleId), monta el
// nodo oculto con el contenido variable, imprime y limpia.
function printThermal(contentHtml: string, opts: ThermalPrintOptions): void {
  const { styleId, contentId, className, fontSize, lineHeight } = opts

  if (!document.getElementById(styleId)) {
    const style = document.createElement('style')
    style.id = styleId
    style.textContent = thermalPrintCss(className, fontSize, lineHeight)
    document.head.appendChild(style)
  }

  const existing = document.getElementById(contentId)
  if (existing) existing.remove()

  const div = document.createElement('div')
  div.id = contentId
  div.className = className
  div.innerHTML = contentHtml
  document.body.appendChild(div)
  window.print()
  setTimeout(() => div.remove(), 1000)
}

export function printComanda(data: ComandaData): void {
  const timeStr = new Date().toLocaleTimeString('es-CO', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota',
  })

  const html = `
    <div style="text-align:center;margin-bottom:8px">
      ${data.restaurantName ? `<div style="font-size:13px;font-weight:700;letter-spacing:1px">${data.restaurantName.toUpperCase()}</div>` : ''}
      <div style="font-size:16px;font-weight:700;letter-spacing:2px">COMANDA</div>
      <div style="font-size:14px;font-weight:700">Mesa: ${data.tableName}</div>
      ${data.zone ? `<div style="font-size:11px">${data.zone}</div>` : ''}
      ${data.waiter ? `<div style="font-size:11px">Atiende: ${data.waiter}</div>` : ''}
      <div style="font-size:10px;margin-top:2px">${timeStr} · #${data.orderId.slice(-6).toUpperCase()}</div>
    </div>
    <div style="border-top:1px dashed #000;margin:6px 0"></div>
    ${data.items.map(item => `
      <div style="margin-bottom:4px">
        <div style="font-weight:700;font-size:14px">${item.qty}x ${item.name}</div>
        ${(item.extras ?? []).map(ex => `<div style="padding-left:16px;font-size:12px">+ ${ex.name} ×${ex.qty}</div>`).join('')}
        ${item.notes ? `<div style="padding-left:16px;font-size:11px">* ${item.notes}</div>` : ''}
      </div>
    `).join('')}
    <div style="border-top:1px dashed #000;margin:8px 0"></div>
    <div style="text-align:center;font-size:11px">— Cocina G-Vento —</div>
  `

  printThermal(html, {
    styleId: 'gvento-printer-css',
    contentId: 'gvento-comanda-content',
    className: 'comanda-print',
    fontSize: 13,
    lineHeight: 1.5,
  })
}

export function printToThermal(_url: string, data: ComandaData): void {
  printComanda(data)
}

// ─── Ticket de venta (recibo de cobro) ────────────────────────────
// Reutilizable: lo usa la reimpresión desde el Historial de Ventas. El POS
// tiene su propio componente PrintTicket en pantalla; esta función imprime un
// recibo equivalente desde datos ya persistidos (sin React).

const ORDER_TYPE_LABEL: Record<string, string> = {
  dine_in: 'Mesa', takeaway: 'Para llevar', delivery: 'Delivery',
}
const METHOD_LABEL: Record<string, string> = {
  cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', nequi: 'Nequi / QR',
}

const formatCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n)

export interface SaleTicketData {
  restaurantName?: string | null
  restaurantAddress?: string | null
  orderNumber: number | null
  orderId: string
  type: string
  method?: string | null
  createdAt: string
  items: {
    qty: number
    name: string
    unitPrice: number
    notes?: string | null
    extras?: { name: string; qty: number; unitPrice: number }[]
  }[]
  total: number
}

export function printSaleTicket(data: SaleTicketData): void {
  const d = new Date(data.createdAt)
  const dateStr = d.toLocaleDateString('es-CO', {
    day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'America/Bogota',
  })
  const timeStr = d.toLocaleTimeString('es-CO', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota',
  })
  const ventaLabel = data.orderNumber != null
    ? `Venta #${data.orderNumber}`
    : `#${data.orderId.slice(-8).toUpperCase()}`
  const typeLabel = ORDER_TYPE_LABEL[data.type] ?? data.type
  const methodLabel = data.method ? (METHOD_LABEL[data.method] ?? data.method) : null
  const iva = Math.round(data.total - data.total / 1.19)

  const html = `
    <div style="text-align:center;margin-bottom:6px">
      ${data.restaurantName ? `<div style="font-size:16px;font-weight:700;letter-spacing:3px">${data.restaurantName.toUpperCase()}</div>` : ''}
      ${data.restaurantAddress ? `<div style="font-size:11px">${data.restaurantAddress}</div>` : ''}
      <div style="font-size:13px;font-weight:700;margin-top:4px">${ventaLabel}</div>
      <div style="font-size:10px;margin-top:2px">${dateStr}  ${timeStr} · ${typeLabel}</div>
    </div>
    <div style="border-top:1px dashed #000;margin:6px 0"></div>
    ${data.items.map(item => `
      <div style="margin-bottom:3px">
        <div style="display:flex;justify-content:space-between">
          <span style="font-weight:600">${item.qty}x ${item.name}</span>
          <span>${formatCOP(item.unitPrice * item.qty)}</span>
        </div>
        ${(item.extras ?? []).map(ex => `
          <div style="display:flex;justify-content:space-between;padding-left:14px;font-size:10px">
            <span>+ ${ex.name} ×${ex.qty}</span>
            <span>${formatCOP(ex.unitPrice * ex.qty)}</span>
          </div>`).join('')}
        ${item.notes ? `<div style="padding-left:14px;font-size:10px">* ${item.notes}</div>` : ''}
      </div>
    `).join('')}
    <div style="border-top:1px dashed #000;margin:6px 0"></div>
    <div style="display:flex;justify-content:space-between;font-size:10px">
      <span>IVA 19% incl.</span><span>${formatCOP(iva)}</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-weight:700;font-size:14px;margin-top:4px">
      <span>TOTAL</span><span>${formatCOP(data.total)}</span>
    </div>
    ${methodLabel ? `<div style="display:flex;justify-content:space-between;font-size:11px;margin-top:2px"><span>${methodLabel}</span></div>` : ''}
    <div style="border-top:1px dashed #000;margin:8px 0"></div>
    <div style="text-align:center;font-size:11px">¡Gracias por su visita!</div>
  `

  printThermal(html, {
    styleId: 'gvento-sale-ticket-css',
    contentId: 'gvento-sale-ticket-content',
    className: 'sale-ticket-print',
  })
}

// ─── Arqueo de caja (comprobante de cierre de turno) ──────────────
// Se reusa idéntico al cerrar (datos en vivo) y al reimprimir desde el
// historial (datos del snapshot persistido). Una sola forma: CashReportData.

const ARQUEO_METHOD_LABEL: Record<ArqueoMethod, string> = {
  cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', nequi: 'Nequi',
}
const ARQUEO_ORDER: ArqueoMethod[] = ['cash', 'card', 'transfer', 'nequi']

export interface CashReportData {
  restaurantName?: string | null
  restaurantAddress?: string | null
  shiftId: string
  openedAt: string
  closedAt: string | null
  openedByName?: string | null
  closedByName?: string | null
  openingAmount: number
  movementsIn: number
  movementsOut: number
  reconciliation: ShiftReconciliation
  comment?: string | null
}

function buildCashReportHtml(data: CashReportData): string {
  const rec = data.reconciliation
  const fmtDT = (iso: string) =>
    new Date(iso).toLocaleString('es-CO', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota',
    })

  // Ventas efectivo = esperado_cash − apertura − ingresos + egresos (inverso de
  // la fórmula del esperado). Para los demás, ventas = esperado del método.
  const cashSales =
    rec.methods.cash.expected - data.openingAmount - data.movementsIn + data.movementsOut
  const salesByMethod: Record<ArqueoMethod, number> = {
    cash: cashSales,
    card: rec.methods.card.expected,
    transfer: rec.methods.transfer.expected,
    nequi: rec.methods.nequi.expected,
  }
  const salesTotal = ARQUEO_ORDER.reduce((s, m) => s + salesByMethod[m], 0)

  const money = (n: number) => formatCOP(n)
  const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatCOP(Math.abs(n))}`
  const dash = '<div style="border-top:1px dashed #000;margin:6px 0"></div>'
  const line = (a: string, b: string, opts: { bold?: boolean; size?: number } = {}) =>
    `<div style="display:flex;justify-content:space-between;font-size:${opts.size ?? 11}px${opts.bold ? ';font-weight:700' : ''}">
      <span>${a}</span><span style="font-family:monospace">${b}</span>
    </div>`

  const salesRows = ARQUEO_ORDER
    .filter((m) => salesByMethod[m] !== 0)
    .map((m) => line(ARQUEO_METHOD_LABEL[m], money(salesByMethod[m])))
    .join('')

  // Arqueo por método: esperado | declarado | diferencia (compacto).
  const arqueoRows = ARQUEO_ORDER.map((m) => {
    const r = rec.methods[m]
    return `
      <div style="margin-bottom:3px">
        <div style="font-size:11px;font-weight:600">${ARQUEO_METHOD_LABEL[m]}</div>
        <div style="display:flex;justify-content:space-between;font-size:10px;font-family:monospace;color:#000">
          <span>esp ${money(r.expected)}</span>
          <span>dec ${money(r.declared)}</span>
          <span>${r.difference === 0 ? 'ok' : 'dif ' + signed(r.difference)}</span>
        </div>
      </div>`
  }).join('')

  return `
    <div style="text-align:center;margin-bottom:6px">
      ${data.restaurantName ? `<div style="font-size:15px;font-weight:700;letter-spacing:2px">${data.restaurantName.toUpperCase()}</div>` : ''}
      ${data.restaurantAddress ? `<div style="font-size:11px">${data.restaurantAddress}</div>` : ''}
      <div style="font-size:13px;font-weight:700;margin-top:4px">ARQUEO DE CAJA</div>
      <div style="font-size:10px;margin-top:2px">Turno #${data.shiftId.slice(-6).toUpperCase()}</div>
    </div>
    ${dash}
    ${line('Abrió', fmtDT(data.openedAt))}
    ${data.openedByName ? line('', data.openedByName, { size: 10 }) : ''}
    ${data.closedAt ? line('Cerró', fmtDT(data.closedAt)) : ''}
    ${data.closedByName ? line('', data.closedByName, { size: 10 }) : ''}
    ${line('Apertura', money(data.openingAmount))}
    ${dash}
    <div style="font-size:10px;font-weight:700;letter-spacing:1px;margin-bottom:2px">VENTAS POR MÉTODO</div>
    ${salesRows || `<div style="font-size:11px;color:#000">Sin ventas</div>`}
    ${line('Total ventas', `${money(salesTotal)}  ·  ${rec.sales_count} vta(s)`, { bold: true })}
    ${(data.movementsIn > 0 || data.movementsOut > 0) ? `
      ${dash}
      ${data.movementsIn > 0 ? line('Ingresos', signed(data.movementsIn)) : ''}
      ${data.movementsOut > 0 ? line('Egresos', signed(-data.movementsOut)) : ''}
    ` : ''}
    ${dash}
    <div style="font-size:10px;font-weight:700;letter-spacing:1px;margin-bottom:4px">ARQUEO (esperado / declarado)</div>
    ${arqueoRows}
    ${dash}
    ${line('Esperado total', money(rec.expected_total))}
    ${line('Declarado total', money(rec.declared_total))}
    ${line('Diferencia total', signed(rec.difference_total), { bold: true, size: 13 })}
    ${(rec.vouchers_total ?? 0) > 0 ? `${dash}${line('Vales entregados', money(rec.vouchers_total))}` : ''}
    ${data.comment ? `${dash}<div style="font-size:10.5px"><span style="font-weight:600">Comentario:</span> ${data.comment}</div>` : ''}
    ${dash}
    <div style="text-align:center;font-size:11px">— Arqueo G-Vento —</div>
  `
}

// Fila de turno cerrado (subset compartido por el cierre en vivo y el historial).
export interface CashReportShiftRow {
  id: string
  opened_at: string
  closed_at: string | null
  opening_amount: number
  close_reconciliation: unknown
  close_comment: string | null
  abrio: { full_name: string | null } | null
  cerro: { full_name: string | null } | null
}

// Arma CashReportData desde una fila de turno + contexto. Lo usan IDÉNTICO el
// cierre (fila recién persistida) y la reimpresión del historial (misma fila) →
// el comprobante reimpreso es idéntico al del cierre. Usa el SNAPSHOT
// (row.close_reconciliation), NUNCA recomputa el esperado (bug de ventana).
export function buildCashReportData(
  row: CashReportShiftRow,
  ctx: { restaurantName?: string | null; restaurantAddress?: string | null; movementsIn: number; movementsOut: number },
): CashReportData {
  return {
    restaurantName: ctx.restaurantName,
    restaurantAddress: ctx.restaurantAddress,
    shiftId: row.id,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    openedByName: row.abrio?.full_name ?? null,
    closedByName: row.cerro?.full_name ?? null,
    openingAmount: row.opening_amount,
    movementsIn: ctx.movementsIn,
    movementsOut: ctx.movementsOut,
    reconciliation: row.close_reconciliation as ShiftReconciliation,
    comment: row.close_comment,
  }
}

export function printCashReport(data: CashReportData): void {
  printThermal(buildCashReportHtml(data), {
    styleId: 'gvento-cash-report-css',
    contentId: 'gvento-cash-report-content',
    className: 'cash-report-print',
  })
}
