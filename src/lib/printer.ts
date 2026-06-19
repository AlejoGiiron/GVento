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
