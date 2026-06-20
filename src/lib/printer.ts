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

const CSS_ID = 'gvento-printer-css'
const CONTENT_ID = 'gvento-comanda-content'

function injectComandaCSS(): void {
  if (document.getElementById(CSS_ID)) return
  const style = document.createElement('style')
  style.id = CSS_ID
  style.textContent = `
@media print {
  body * { visibility: hidden !important; }
  .comanda-print, .comanda-print * { visibility: visible !important; }
  .comanda-print {
    display: block !important;
    position: fixed !important;
    top: 0 !important; left: 0 !important;
    width: 80mm !important;
    background: white !important;
    padding: 6mm !important;
    box-sizing: border-box !important;
    font-family: 'Courier New', monospace !important;
    font-size: 13px !important;
    line-height: 1.5 !important;
    color: black !important;
  }
}
.comanda-print { display: none; }
`
  document.head.appendChild(style)
}

export function printComanda(data: ComandaData): void {
  injectComandaCSS()

  const timeStr = new Date().toLocaleTimeString('es-CO', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota',
  })

  const existing = document.getElementById(CONTENT_ID)
  if (existing) existing.remove()

  const div = document.createElement('div')
  div.id = CONTENT_ID
  div.className = 'comanda-print'
  div.innerHTML = `
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
  document.body.appendChild(div)
  window.print()
  setTimeout(() => div.remove(), 1000)
}

export function printToThermal(_url: string, data: ComandaData): void {
  printComanda(data)
}

// ─── Ticket de venta (recibo de cobro) ────────────────────────────
// Reutilizable: lo usa la reimpresión desde el Historial de Ventas. El POS
// tiene su propio componente PrintTicket en pantalla; esta función imprime un
// recibo equivalente desde datos ya persistidos (sin React).

const SALE_CSS_ID = 'gvento-sale-ticket-css'
const SALE_CONTENT_ID = 'gvento-sale-ticket-content'

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

function injectSaleCSS(): void {
  if (document.getElementById(SALE_CSS_ID)) return
  const style = document.createElement('style')
  style.id = SALE_CSS_ID
  style.textContent = `
@media print {
  body * { visibility: hidden !important; }
  .sale-ticket-print, .sale-ticket-print * { visibility: visible !important; }
  .sale-ticket-print {
    display: block !important;
    position: fixed !important;
    top: 0 !important; left: 0 !important;
    width: 80mm !important;
    background: white !important;
    padding: 6mm !important;
    box-sizing: border-box !important;
    font-family: 'Courier New', monospace !important;
    font-size: 12px !important;
    line-height: 1.45 !important;
    color: black !important;
  }
}
.sale-ticket-print { display: none; }
`
  document.head.appendChild(style)
}

export function printSaleTicket(data: SaleTicketData): void {
  injectSaleCSS()

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

  const existing = document.getElementById(SALE_CONTENT_ID)
  if (existing) existing.remove()

  const div = document.createElement('div')
  div.id = SALE_CONTENT_ID
  div.className = 'sale-ticket-print'
  div.innerHTML = `
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
  document.body.appendChild(div)
  window.print()
  setTimeout(() => div.remove(), 1000)
}
