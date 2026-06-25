import { useState, useMemo, useEffect, useRef } from 'react'
import {
  Search, X, Plus, Trash, Minus, ShoppingCart, Percent,
  ChevronRight, Store, Bike, StickyNote,
  Banknote, CreditCard, Smartphone, Check, Building2, Printer,
  Pause, Play, Clock, AlertTriangle, HandCoins,
} from 'lucide-react'
import { toast } from 'react-hot-toast'
import { useQueryClient } from '@tanstack/react-query'
import { useCartStore, cartItemTotal } from '@/stores/cartStore'
import { useProducts } from '@/hooks/useProducts'
import { useCategories } from '@/hooks/useCategories'
import { useProductsWithExtras } from '@/hooks/useProductsWithExtras'
import { useAuth } from '@/hooks/useAuth'
import { usePermissions } from '@/hooks/usePermissions'
import { useRestaurantConfig } from '@/hooks/useRestaurantConfig'
import { useCashShift } from '@/hooks/useCashShift'
import { OpenShiftModal } from '@/components/shift/OpenShiftModal'
import { ItemConfigModal } from '@/components/pos/ItemConfigModal'
import { createOrder, addOrderItemsWithExtras, createPayment, assignOrderNumber } from '@/lib/supabase-helpers'
import { CustomerPicker } from '@/components/fiado/CustomerPicker'
import { cashQuickAmounts } from '@/lib/cashRounding'
import type { ProductWithCategory, CartItem, DiscountType, HeldOrder } from '@/stores/cartStore'
import type { Enums } from '@/types/database.types'

type OrderType = 'dine_in' | 'takeaway' | 'delivery'
type PaymentMethodUI = 'efectivo' | 'tarjeta' | 'transferencia' | 'nequi' | 'fiado'

const formatCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n)

const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  .ticket-print, .ticket-print * { visibility: visible !important; }
  .ticket-print {
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
.ticket-print { display: none; }
`

// ─── Shared button styles ────────────────────────────────────────
const qtyBtnStyle: React.CSSProperties = {
  width: 28, height: 28, border: 'none', background: 'transparent',
  cursor: 'pointer', color: '#334155', display: 'grid', placeItems: 'center', padding: 0,
}

const iconBtnStyle: React.CSSProperties = {
  width: 30, height: 30, borderRadius: 7,
  border: '1px solid #e5e7eb', background: '#fff',
  cursor: 'pointer', color: '#64748b', display: 'grid', placeItems: 'center',
}

// ─── Print ticket ────────────────────────────────────────────────
function PrintTicket({
  items,
  subtotal,
  discountAmt,
  discount,
  discountType,
  iva,
  total,
  method,
  orderType,
  orderId,
  orderNumber,
  receivedAmt,
  restaurantName,
  restaurantAddress,
}: {
  items: CartItem[]
  subtotal: number
  discountAmt: number
  discount: number
  discountType: DiscountType
  iva: number
  total: number
  method: PaymentMethodUI
  orderType: OrderType
  orderId: string
  orderNumber: number | null
  receivedAmt?: number
  restaurantName: string
  restaurantAddress?: string | null
}) {
  const now = new Date()
  const dateStr = now.toLocaleDateString('es-CO', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    timeZone: 'America/Bogota',
  })
  const timeStr = now.toLocaleTimeString('es-CO', {
    hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Bogota',
  })
  const ventaLabel = orderNumber != null
    ? `Venta #${orderNumber}`
    : `#${orderId.slice(-8).toUpperCase()}`
  const orderTypeLabel = { dine_in: 'Mesa', takeaway: 'Para llevar', delivery: 'Delivery' }[orderType]
  const methodLabel = {
    efectivo: 'Efectivo', tarjeta: 'Tarjeta',
    transferencia: 'Transferencia', nequi: 'Nequi', fiado: 'Fiado',
  }[method]

  return (
    <div className="ticket-print">
      <div style={{ textAlign: 'center', marginBottom: 6 }}>
        <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: 3 }}>{restaurantName.toUpperCase()}</div>
        {restaurantAddress && <div style={{ fontSize: 11 }}>{restaurantAddress}</div>}
        <div style={{ fontSize: 13, fontWeight: 700, marginTop: 4 }}>{ventaLabel}</div>
        <div style={{ fontSize: 10, marginTop: 2 }}>{dateStr}  {timeStr} · {orderTypeLabel}</div>
      </div>

      <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />

      {items.map((item, i) => (
        <div key={i} style={{ marginBottom: 3 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 600 }}>{item.qty}x {item.product.name}</span>
            <span>{formatCOP(item.product.price * item.qty)}</span>
          </div>
          {item.extras.map((ex) => (
            <div key={ex.extra_id} style={{ display: 'flex', justifyContent: 'space-between', paddingLeft: 14, fontSize: 10 }}>
              <span>+ {ex.name} ×{ex.qty * item.qty}</span>
              <span>{formatCOP(ex.price * ex.qty * item.qty)}</span>
            </div>
          ))}
          {item.note && (
            <div style={{ paddingLeft: 14, fontSize: 10 }}>* {item.note}</div>
          )}
        </div>
      ))}

      <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
        <span>Subtotal</span><span>{formatCOP(subtotal)}</span>
      </div>
      {discountAmt > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
          <span>Descuento {discountType === 'pct' ? `(${discount}%)` : ''}</span>
          <span>-{formatCOP(discountAmt)}</span>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
        <span>IVA 19% incl.</span><span>{formatCOP(iva)}</span>
      </div>

      <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />

      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 14 }}>
        <span>TOTAL</span><span>{formatCOP(total)}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginTop: 2 }}>
        <span>{methodLabel}</span>
        {receivedAmt !== undefined && receivedAmt > total && (
          <span>Vuelto: {formatCOP(receivedAmt - total)}</span>
        )}
      </div>

      <div style={{ borderTop: '1px dashed #000', margin: '8px 0' }} />
      <div style={{ textAlign: 'center', fontSize: 11 }}>¡Gracias por su visita!</div>
    </div>
  )
}

// ─── Product image placeholder ───────────────────────────────────
function ProductImage({ product, color = '#10b981' }: { product: ProductWithCategory; color?: string }) {
  const hash = product.id.charCodeAt(0) + product.id.charCodeAt(product.id.length - 1)
  const angle = (hash % 4) * 45

  if (product.image_url) {
    return (
      <img src={product.image_url} alt={product.name}
        style={{ width: '100%', height: 140, objectFit: 'cover' }} />
    )
  }

  return (
    <div style={{
      width: '100%', height: 140,
      background: `${color}20`,
      backgroundImage: `repeating-linear-gradient(${angle}deg, transparent, transparent 7px, rgba(0,0,0,.035) 7px, rgba(0,0,0,.035) 14px)`,
      display: 'flex', alignItems: 'flex-end', padding: 7,
    }}>
      <div style={{ fontFamily: 'monospace', fontSize: 11, color, opacity: 0.7, letterSpacing: -0.2 }}>
        {product.name.substring(0, 10).toUpperCase()}
      </div>
    </div>
  )
}

// ─── Product card ────────────────────────────────────────────────
function ProductCard({ product, onAdd }: { product: ProductWithCategory; onAdd: () => void }) {
  const color = product.categories?.color ?? '#10b981'

  // Indicador discreto de stock para productos simples con inventario en ≤ 0.
  // NO bloquea la venta (stock negativo permitido); solo señala reponer.
  const stockQty = product.stock_qty ?? 0
  const lowStock = product.stock_tracking && product.kind === 'simple' && stockQty <= 0
  const stockLabel = stockQty < 0 ? 'Reponer' : 'Sin stock'

  return (
    <button
      data-testid="product-card"
      onClick={onAdd}
      style={{
        position: 'relative',
        background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14,
        padding: 0, cursor: 'pointer', textAlign: 'left',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        transition: 'all .15s', width: '100%',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = color
        e.currentTarget.style.transform = 'translateY(-2px)'
        e.currentTarget.style.boxShadow = '0 8px 20px rgba(0,0,0,.06)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = '#e5e7eb'
        e.currentTarget.style.transform = 'translateY(0)'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      <ProductImage product={product} color={color} />
      {lowStock && (
        <span
          data-testid="pos-stock-indicator"
          style={{
            position: 'absolute', top: 8, right: 8,
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '2px 8px', borderRadius: 8,
            background: stockQty < 0 ? '#dc2626' : 'rgba(15,23,42,.72)',
            color: '#fff', fontSize: 10.5, fontWeight: 700,
          }}
        >
          <AlertTriangle size={10} /> {stockLabel}
        </span>
      )}
      <div style={{ padding: '12px 14px 14px' }}>
        <div style={{ fontSize: 14.5, fontWeight: 600, color: '#0f172a', letterSpacing: -0.2, lineHeight: 1.25 }}>
          {product.name}
        </div>
        {product.description && (
          <div style={{
            fontSize: 12, color: '#94a3b8', marginTop: 3,
            height: 17, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {product.description}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', fontFamily: 'monospace', letterSpacing: -0.4 }}>
            {formatCOP(product.price)}
          </div>
          <div style={{
            width: 30, height: 30, borderRadius: 8, background: '#10b981', color: '#fff',
            display: 'grid', placeItems: 'center',
            boxShadow: '0 2px 6px rgba(16,185,129,.3)', flexShrink: 0,
          }}>
            <Plus size={16} strokeWidth={2.4} />
          </div>
        </div>
      </div>
    </button>
  )
}

// ─── Cart line item ──────────────────────────────────────────────
function CartLine({ item, index, noting, onToggleNote, hasExtras, onEditExtras }: {
  item: CartItem; index: number; noting: boolean; onToggleNote: () => void
  hasExtras: boolean; onEditExtras: () => void
}) {
  const setQty = useCartStore((s) => s.setQty)
  const setNote = useCartStore((s) => s.setNote)
  const remove = useCartStore((s) => s.remove)
  const color = item.product.categories?.color ?? '#10b981'

  return (
    <div style={{ padding: '14px 22px', borderBottom: '1px solid #f8fafc', display: 'flex', gap: 12 }}>
      <div style={{
        width: 4, borderRadius: 2, background: color, flexShrink: 0,
        alignSelf: 'stretch', marginTop: 2, marginBottom: 2,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <div style={{
            fontSize: 14, fontWeight: 600, color: '#0f172a', lineHeight: 1.3,
            minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {item.product.name}
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', fontFamily: 'monospace', flexShrink: 0 }}>
            {formatCOP(cartItemTotal(item))}
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: '#94a3b8', fontFamily: 'monospace', marginTop: 2 }}>
          {formatCOP(item.product.price)} c/u
        </div>

        {/* Extras del ítem */}
        {item.extras.length > 0 && (
          <div data-testid="cart-item-extras" style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {item.extras.map((ex) => (
              <div key={ex.extra_id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: '#065f46' }}>
                <span>+ {ex.name} ×{ex.qty}</span>
                <span style={{ fontFamily: 'monospace' }}>{formatCOP(ex.price * ex.qty * item.qty)}</span>
              </div>
            ))}
          </div>
        )}

        {item.note && !noting && (
          <div style={{
            marginTop: 6, padding: '4px 8px', background: '#fef3c7', color: '#854d0e',
            fontSize: 11.5, borderRadius: 5, display: 'inline-flex', alignItems: 'center',
            gap: 5, fontWeight: 500,
          }}>
            <StickyNote size={11} />{item.note}
          </div>
        )}

        {noting && (
          <input
            autoFocus
            value={item.note}
            onChange={(e) => setNote(index, e.target.value)}
            onBlur={onToggleNote}
            onKeyDown={(e) => e.key === 'Enter' && onToggleNote()}
            placeholder="Nota (ej: sin hielo)"
            style={{
              marginTop: 6, width: '100%', border: '1.5px solid #10b981', outline: 'none',
              borderRadius: 6, padding: '6px 9px', fontSize: 12,
              fontFamily: 'Inter, sans-serif', boxSizing: 'border-box',
            }}
          />
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 9 }}>
          <div style={{
            display: 'flex', alignItems: 'center',
            background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0',
          }}>
            <button
              onClick={() => item.qty === 1 ? remove(index) : setQty(index, item.qty - 1)}
              style={qtyBtnStyle}
            >
              {item.qty === 1 ? <Trash size={13} /> : <Minus size={13} />}
            </button>
            <div style={{
              minWidth: 32, textAlign: 'center', fontFamily: 'monospace',
              fontWeight: 700, fontSize: 14, color: '#0f172a',
            }}>
              {item.qty}
            </div>
            <button onClick={() => setQty(index, item.qty + 1)} style={qtyBtnStyle}>
              <Plus size={13} />
            </button>
          </div>
          <div style={{ flex: 1 }} />
          {hasExtras && (
            <button onClick={onEditExtras} style={iconBtnStyle} title="Extras" data-testid="cart-edit-extras">
              <Plus size={13} />
            </button>
          )}
          <button onClick={onToggleNote} style={iconBtnStyle} title="Nota">
            <StickyNote size={13} />
          </button>
          <button
            onClick={() => remove(index)}
            style={{ ...iconBtnStyle, color: '#dc2626' }}
            title="Eliminar"
          >
            <X size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Total row ───────────────────────────────────────────────────
function TotalRow({ label, value, color, muted }: {
  label: string; value: number; color?: string; muted?: boolean
}) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '3px 0',
      color: muted ? '#94a3b8' : (color ?? '#475569'),
    }}>
      <span>{label}</span>
      <span style={{ fontFamily: 'monospace', fontWeight: 500 }}>
        {value < 0 ? '-' : ''}{formatCOP(Math.abs(value))}
      </span>
    </div>
  )
}

// ─── Cart panel ──────────────────────────────────────────────────
function CartPanel({
  subtotal,
  discountAmt,
  iva,
  total,
  orderType,
  setOrderType,
  notingIdx,
  setNotingIdx,
  onCheckout,
  onHold,
  heldCount,
  onShowHeld,
  productsWithExtras,
  onEditExtras,
}: {
  subtotal: number
  discountAmt: number
  iva: number
  total: number
  orderType: OrderType
  setOrderType: (t: OrderType) => void
  notingIdx: number | null
  setNotingIdx: (i: number | null) => void
  onCheckout: () => void
  onHold: () => void
  heldCount: number
  onShowHeld: () => void
  productsWithExtras: Set<string>
  onEditExtras: (item: CartItem) => void
}) {
  const items = useCartStore((s) => s.items)
  const discount = useCartStore((s) => s.discount)
  const discountType = useCartStore((s) => s.discountType)
  const clear = useCartStore((s) => s.clear)
  const setDiscount = useCartStore((s) => s.setDiscount)
  const { can } = usePermissions()

  // dine_in requires a table_id (DB constraint) — that's handled by TablesPage, not the POS quick-sale flow
  const orderTypes = [
    { id: 'takeaway' as OrderType, label: 'Para llevar', icon: <Store size={17} />,    bg: '#fef3c7', fg: '#854d0e' },
    { id: 'delivery' as OrderType, label: 'Delivery',    icon: <Bike size={17} />,     bg: '#dbeafe', fg: '#1e40af' },
  ]
  const current = orderTypes.find((t) => t.id === orderType)!

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      background: '#fff', minWidth: 0, borderLeft: '1px solid #e5e7eb',
    }}>
      {/* Header */}
      <div style={{ padding: '18px 22px 14px', borderBottom: '1px solid #f1f5f9' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 36, height: 36, borderRadius: 10,
                background: current.bg, color: current.fg,
                display: 'grid', placeItems: 'center', cursor: 'pointer',
              }}
              onClick={() => {
                const ids = orderTypes.map((t) => t.id)
                setOrderType(ids[(ids.indexOf(orderType) + 1) % ids.length])
              }}
              title="Cambiar tipo de orden"
            >
              {current.icon}
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', letterSpacing: -0.2 }}>
                {current.label}
              </div>
              <div style={{ fontSize: 11.5, color: '#64748b', fontFamily: 'monospace', marginTop: 1 }}>
                Nueva orden
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Indicador de ventas en espera */}
            {heldCount > 0 && (
              <button
                onClick={onShowHeld}
                title="Ventas en espera"
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  height: 34, padding: '0 11px', borderRadius: 8,
                  border: '1px solid #fde68a', background: '#fffbeb',
                  cursor: 'pointer', color: '#854d0e', fontSize: 12.5, fontWeight: 600,
                }}
              >
                <Pause size={14} />
                En espera
                <span style={{
                  background: '#f59e0b', color: '#fff', borderRadius: 100,
                  minWidth: 18, height: 18, display: 'grid', placeItems: 'center',
                  fontSize: 11, fontWeight: 700, padding: '0 4px',
                }}>
                  {heldCount}
                </span>
              </button>
            )}
            {can('pos.anular') && (
              <button
                onClick={clear}
                style={{
                  width: 34, height: 34, borderRadius: 8,
                  border: '1px solid #e5e7eb', background: '#fff',
                  cursor: 'pointer', color: '#64748b', display: 'grid', placeItems: 'center',
                }}
                title="Vaciar carrito (anular)"
              >
                <Trash size={15} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Items */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {items.length === 0 ? (
          <div style={{ padding: 50, textAlign: 'center', color: '#94a3b8', fontSize: 13.5 }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%', background: '#f1f5f9',
              margin: '0 auto 14px', display: 'grid', placeItems: 'center', color: '#cbd5e1',
            }}>
              <ShoppingCart size={24} />
            </div>
            <div style={{ fontWeight: 600, color: '#64748b', marginBottom: 4 }}>Carrito vacío</div>
            <div style={{ fontSize: 12 }}>Toca un producto para agregarlo</div>
          </div>
        ) : (
          items.map((item, idx) => (
            <CartLine
              key={item.id}
              item={item}
              index={idx}
              noting={notingIdx === idx}
              onToggleNote={() => setNotingIdx(notingIdx === idx ? null : idx)}
              hasExtras={productsWithExtras.has(item.product.id)}
              onEditExtras={() => onEditExtras(item)}
            />
          ))
        )}
      </div>

      {/* Discount — requiere permiso pos.descuento */}
      {can('pos.descuento') && (
      <div style={{ padding: '12px 22px', borderTop: '1px solid #f1f5f9' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
          <Percent size={13} color="#334155" />
          <span style={{
            fontSize: 11.5, fontWeight: 700, color: '#334155',
            textTransform: 'uppercase', letterSpacing: 0.5,
          }}>
            Descuento
          </span>
          <div style={{ flex: 1 }} />
          {/* Mode toggle */}
          <div style={{ display: 'flex', borderRadius: 7, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
            {(['pct', 'fixed'] as DiscountType[]).map((t) => (
              <button
                key={t}
                onClick={() => setDiscount(0, t)}
                style={{
                  padding: '4px 12px', border: 'none',
                  background: discountType === t ? '#0f172a' : '#fff',
                  color: discountType === t ? '#fff' : '#64748b',
                  fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'monospace',
                  transition: 'all .1s',
                }}
              >
                {t === 'pct' ? '%' : '$'}
              </button>
            ))}
          </div>
        </div>

        {discountType === 'pct' ? (
          <div>
            {/* Input % editable (clamp 0–100 en el store) */}
            <div style={{ position: 'relative', marginBottom: 6 }}>
              <input
                type="text"
                inputMode="numeric"
                value={discount ? String(discount) : ''}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, '')
                  setDiscount(digits === '' ? 0 : parseInt(digits, 10), 'pct')
                }}
                placeholder="0"
                style={{
                  width: '100%', padding: '8px 26px 8px 12px',
                  border: `1.5px solid ${discount > 0 ? '#10b981' : '#e2e8f0'}`,
                  borderRadius: 8, fontSize: 13, fontFamily: 'monospace',
                  outline: 'none', boxSizing: 'border-box', color: '#0f172a',
                }}
              />
              <span style={{
                position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                fontSize: 13, color: '#94a3b8', fontFamily: 'monospace', pointerEvents: 'none',
              }}>%</span>
            </div>
            {/* Presets rápidos */}
            <div style={{ display: 'flex', gap: 4 }}>
              {[0, 5, 10, 15, 20].map((v) => (
                <button
                  key={v}
                  onClick={() => setDiscount(v, 'pct')}
                  style={{
                    flex: 1, padding: '6px 0',
                    border: discount === v ? '1.5px solid #10b981' : '1px solid #e5e7eb',
                    background: discount === v ? '#ecfdf5' : '#fff',
                    color: discount === v ? '#065f46' : '#64748b',
                    borderRadius: 7, fontSize: 11.5, fontWeight: 600,
                    fontFamily: 'monospace', cursor: 'pointer',
                  }}
                >
                  {v === 0 ? '—' : `${v}%`}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ position: 'relative' }}>
            <span style={{
              position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
              fontSize: 13, color: '#94a3b8', fontFamily: 'monospace', pointerEvents: 'none',
            }}>$</span>
            <input
              type="text"
              inputMode="numeric"
              value={discount ? String(discount) : ''}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, '')
                setDiscount(digits === '' ? 0 : parseInt(digits, 10), 'fixed')
              }}
              placeholder="0"
              style={{
                width: '100%', padding: '8px 12px 8px 22px',
                border: `1.5px solid ${discount > 0 ? '#10b981' : '#e2e8f0'}`,
                borderRadius: 8, fontSize: 13, fontFamily: 'monospace',
                outline: 'none', boxSizing: 'border-box', color: '#0f172a',
              }}
            />
            {discount > 0 && (
              <button
                onClick={() => setDiscount(0, 'fixed')}
                style={{
                  position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: '#94a3b8', display: 'grid', placeItems: 'center', padding: 0,
                }}
              >
                <X size={13} />
              </button>
            )}
          </div>
        )}
      </div>
      )}

      {/* Totals */}
      <div style={{ padding: '10px 22px', borderTop: '1px solid #f1f5f9' }}>
        <TotalRow label="Subtotal" value={subtotal} />
        {discountAmt > 0 && (
          <TotalRow
            label={`Descuento${discountType === 'pct' ? ` (${discount}%)` : ''}`}
            value={-discountAmt}
            color="#dc2626"
          />
        )}
        <TotalRow label="IVA 19% (incluido)" value={iva} muted />
      </div>

      {/* Total + Cobrar */}
      <div style={{
        padding: '16px 22px 20px',
        background: 'linear-gradient(180deg, #f8fafc 0%, #ffffff 100%)',
        borderTop: '1px solid #e5e7eb',
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          alignItems: 'baseline', marginBottom: 12,
        }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>Total</span>
          <span
            data-testid="cart-total"
            style={{
              fontSize: 30, fontWeight: 700, color: '#0f172a',
              fontFamily: 'monospace', letterSpacing: -0.8,
            }}
          >
            {formatCOP(total)}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            disabled={items.length === 0}
            onClick={onHold}
            title="Poner la venta en espera"
            style={{
              flexShrink: 0, padding: '15px 16px',
              background: '#fff',
              border: `1.5px solid ${items.length === 0 ? '#e5e7eb' : '#fde68a'}`,
              borderRadius: 10,
              cursor: items.length === 0 ? 'not-allowed' : 'pointer',
              fontSize: 14, fontWeight: 700,
              color: items.length === 0 ? '#cbd5e1' : '#854d0e',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            }}
          >
            <Pause size={16} /> En espera
          </button>
          <button
            disabled={items.length === 0}
            onClick={onCheckout}
            style={{
              flex: 1, padding: '15px 16px',
              background: items.length === 0 ? '#cbd5e1' : '#10b981',
              border: 'none', borderRadius: 10,
              cursor: items.length === 0 ? 'not-allowed' : 'pointer',
              fontSize: 15, fontWeight: 700, color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              boxShadow: items.length === 0 ? 'none' : '0 6px 16px rgba(16,185,129,.35)',
              letterSpacing: 0.2,
            }}
          >
            Cobrar <ChevronRight size={17} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Checkout modal ──────────────────────────────────────────────
function CheckoutModal({
  items,
  total,
  subtotal,
  discountAmt,
  discount,
  discountType,
  iva,
  orderType,
  onClose,
  onComplete,
}: {
  items: CartItem[]
  total: number
  subtotal: number
  discountAmt: number
  discount: number
  discountType: DiscountType
  iva: number
  orderType: OrderType
  onClose: () => void
  onComplete: () => void
}) {
  const { profile } = useAuth()
  const { can } = usePermissions()
  const { restaurant } = useRestaurantConfig()
  const { refetchSales } = useCashShift()
  const queryClient = useQueryClient()
  const [step, setStep] = useState<'method' | 'amount' | 'success'>('method')
  const [method, setMethod] = useState<PaymentMethodUI>('efectivo')
  const [received, setReceived] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [orderId, setOrderId] = useState<string | null>(null)
  const [orderNumber, setOrderNumber] = useState<number | null>(null)
  // Fiado: cliente seleccionado (solo aplica si method === 'fiado').
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [customerName, setCustomerName] = useState<string>('')

  const canFiado = can('fiado.gestionar')
  const receivedNum = parseInt(received.replace(/\D/g, ''), 10) || 0
  const change = receivedNum - total

  const paymentMethods: { id: PaymentMethodUI; label: string; icon: React.ReactNode }[] = [
    { id: 'efectivo',      label: 'Efectivo',     icon: <Banknote size={22} /> },
    { id: 'tarjeta',       label: 'Tarjeta',       icon: <CreditCard size={22} /> },
    { id: 'transferencia', label: 'Transferencia', icon: <Building2 size={22} /> },
    { id: 'nequi',         label: 'Nequi / QR',   icon: <Smartphone size={22} /> },
    ...(canFiado ? [{ id: 'fiado' as const, label: 'Fiado', icon: <HandCoins size={22} /> }] : []),
  ]

  const quickAmounts = cashQuickAmounts(total)

  const methodMap: Record<Exclude<PaymentMethodUI, 'fiado'>, Enums<'payment_method'>> = {
    efectivo:      'cash',
    tarjeta:       'card',
    transferencia: 'transfer',
    nequi:         'nequi',
  }

  const isFiado = method === 'fiado'

  const handleConfirm = async () => {
    if (!profile) return
    if (isFiado && !customerId) { toast.error('Selecciona un cliente para la venta a fiado'); return }
    setSubmitting(true)
    try {
      // Venta a fiado: la orden se crea como pendiente de pago y ligada al
      // cliente; NO entra dinero (no toca caja) y NO se registra payment.
      // El stock SÍ se descuenta igual (la mercancía salió). Copiamos el nombre
      // del cliente a customer_name para que tickets/historial sigan leyéndolo.
      const { data: order, error: orderErr } = await createOrder({
        type: orderType,
        status: 'pending',
        total,
        restaurant_id: profile.restaurant_id,
        created_by: profile.id,
        ...(isFiado
          ? { payment_status: 'pending', customer_id: customerId, customer_name: customerName }
          : {}),
      })
      if (orderErr || !order) throw orderErr ?? new Error('Error al crear orden')

      const { error: itemsErr } = await addOrderItemsWithExtras(
        order.id,
        items.map((item) => ({
          product_id: item.product.id,
          qty: item.qty,
          unit_price: item.product.price,
          notes: item.note || null,
          extras: item.extras.map((ex) => ({ extra_id: ex.extra_id, qty: ex.qty })),
        })),
      )
      if (itemsErr) throw itemsErr

      if (!isFiado) {
        const { error: payErr } = await createPayment({
          order_id: order.id,
          method: methodMap[method],
          amount: total,
          restaurant_id: profile.restaurant_id,
        })
        if (payErr) throw payErr
      }

      // Numeración: es una venta real (cobrada o a fiado) → asignar número
      // correlativo. Si falla, no se tumba la venta (queda registrada igual).
      const n = await assignOrderNumber(order.id, profile.restaurant_id)
      setOrderNumber(n)

      if (isFiado) queryClient.invalidateQueries({ queryKey: ['debts'] })
      refetchSales()
      setOrderId(order.id)
      setStep('success')
    } catch (err) {
      const msg = err instanceof Error ? err.message : (err as { message?: string })?.message ?? 'Error desconocido'
      toast.error(`Error al procesar el cobro: ${msg}`)
      console.error('[checkout]', err)
    } finally {
      setSubmitting(false)
    }
  }

  const methodLabel = (m: PaymentMethodUI) =>
    ({ efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', nequi: 'Nequi / QR', fiado: 'Fiado' })[m]

  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: 'rgba(15,23,42,.55)',
      display: 'grid', placeItems: 'center',
      zIndex: 50, fontFamily: 'Inter, sans-serif',
    }}>
      <div style={{
        background: '#fff', borderRadius: 14,
        width: step === 'method' ? 540 : 440,
        maxWidth: '92%',
        boxShadow: '0 25px 50px -12px rgba(0,0,0,.25)',
        overflow: 'hidden',
      }}>
        {/* ── Step: method ── */}
        {step === 'method' && (
          <>
            <div style={{
              padding: '18px 22px', borderBottom: '1px solid #f1f5f9',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Total a cobrar
                </div>
                <div style={{ fontSize: 28, fontWeight: 700, color: '#0f172a', fontFamily: 'monospace', letterSpacing: -0.5 }}>
                  {formatCOP(total)}
                </div>
              </div>
              <button
                onClick={onClose}
                style={{ background: '#f1f5f9', border: 'none', width: 32, height: 32, borderRadius: 8, cursor: 'pointer', color: '#64748b', display: 'grid', placeItems: 'center' }}
              >
                <X size={16} />
              </button>
            </div>
            <div style={{ padding: 22 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', marginBottom: 12 }}>
                Método de pago
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                {paymentMethods.map((m) => (
                  <button
                    key={m.id}
                    data-testid={`pay-method-${m.id}`}
                    onClick={() => setMethod(m.id)}
                    style={{
                      padding: '16px 8px',
                      border: method === m.id ? '2px solid #10b981' : '1.5px solid #e5e7eb',
                      background: method === m.id ? '#ecfdf5' : '#fff',
                      borderRadius: 10, cursor: 'pointer',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                      color: method === m.id ? '#065f46' : '#334155',
                      transition: 'all .12s',
                    }}
                  >
                    {m.icon}
                    <div style={{ fontSize: 11.5, fontWeight: 600, textAlign: 'center', lineHeight: 1.2 }}>
                      {m.label}
                    </div>
                  </button>
                ))}
              </div>

              {/* Fiado: selección de cliente obligatoria */}
              {isFiado && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                    Cliente <span style={{ color: '#dc2626' }}>*</span>
                  </div>
                  <CustomerPicker
                    value={customerId}
                    onChange={(id, name) => { setCustomerId(id); setCustomerName(name) }}
                  />
                  <div style={{ marginTop: 8, fontSize: 11.5, color: '#854d0e', background: '#fef3c7', borderRadius: 8, padding: '8px 11px' }}>
                    La venta a fiado queda pendiente de pago. No entra dinero a la caja; los abonos se registran en Fiado → Cuentas por cobrar.
                  </div>
                </div>
              )}

              <div style={{ marginTop: 18, display: 'flex', gap: 10 }}>
                <button
                  onClick={onClose}
                  style={{ flex: 1, padding: '12px', border: '1.5px solid #e5e7eb', background: '#fff', borderRadius: 9, cursor: 'pointer', fontSize: 13.5, fontWeight: 600, color: '#334155' }}
                >
                  Cancelar
                </button>
                <button
                  data-testid="checkout-continue"
                  disabled={submitting || (isFiado && !customerId)}
                  onClick={() => method === 'efectivo' ? setStep('amount') : handleConfirm()}
                  style={{
                    flex: 2, padding: '12px', border: 'none',
                    background: submitting || (isFiado && !customerId) ? '#cbd5e1' : '#10b981',
                    borderRadius: 9, cursor: submitting || (isFiado && !customerId) ? 'not-allowed' : 'pointer',
                    fontSize: 13.5, fontWeight: 600, color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}
                >
                  {submitting
                    ? 'Procesando...'
                    : isFiado
                      ? <><HandCoins size={15} /><span>Registrar fiado</span></>
                      : <><span>Continuar</span><ChevronRight size={15} /></>}
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── Step: amount (efectivo) ── */}
        {step === 'amount' && (
          <>
            <div style={{ padding: '18px 22px', borderBottom: '1px solid #f1f5f9' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Efectivo recibido
              </div>
              <input
                autoFocus
                data-testid="checkout-received"
                value={received ? formatCOP(receivedNum) : ''}
                onChange={(e) => setReceived(e.target.value)}
                placeholder={formatCOP(total)}
                style={{
                  width: '100%', border: 'none', outline: 'none',
                  fontSize: 32, fontWeight: 700, color: '#0f172a',
                  fontFamily: 'monospace', padding: '6px 0', letterSpacing: -0.5,
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                {quickAmounts.map((chip) => {
                  const active = receivedNum === chip.amount && received !== ''
                  return (
                    <button
                      key={chip.exact ? 'exact' : chip.amount}
                      data-testid={chip.exact ? 'quick-amount-exact' : 'quick-amount-chip'}
                      onClick={() => setReceived(String(chip.amount))}
                      style={{
                        padding: '6px 12px',
                        border: chip.exact
                          ? `1.5px solid ${active ? '#10b981' : '#a7f3d0'}`
                          : `1px solid ${active ? '#10b981' : '#e5e7eb'}`,
                        background: chip.exact ? '#ecfdf5' : active ? '#ecfdf5' : '#f8fafc',
                        borderRadius: 6, fontSize: 11.5, fontWeight: chip.exact ? 700 : 600,
                        color: chip.exact ? '#065f46' : '#334155',
                        fontFamily: 'monospace', cursor: 'pointer',
                        transition: 'all .12s',
                      }}
                    >
                      {chip.exact ? `Exacto · ${formatCOP(chip.amount)}` : formatCOP(chip.amount)}
                    </button>
                  )
                })}
              </div>
            </div>
            <div style={{ padding: 22 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#64748b', marginBottom: 6 }}>
                <span>Total</span>
                <span style={{ fontFamily: 'monospace' }}>{formatCOP(total)}</span>
              </div>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                padding: '12px 14px',
                background: change >= 0 ? '#ecfdf5' : '#fef2f2',
                borderRadius: 10, marginBottom: 18,
              }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: change >= 0 ? '#065f46' : '#991b1b' }}>
                  {change >= 0 ? 'Vuelto' : 'Falta'}
                </span>
                <span data-testid="checkout-change" style={{ fontSize: 22, fontWeight: 700, fontFamily: 'monospace', color: change >= 0 ? '#065f46' : '#991b1b' }}>
                  {formatCOP(Math.abs(change))}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={() => setStep('method')}
                  style={{ flex: 1, padding: '12px', border: '1.5px solid #e5e7eb', background: '#fff', borderRadius: 9, cursor: 'pointer', fontSize: 13.5, fontWeight: 600, color: '#334155' }}
                >
                  Atrás
                </button>
                <button
                  disabled={change < 0 || submitting}
                  onClick={handleConfirm}
                  style={{
                    flex: 2, padding: '12px', border: 'none',
                    background: change < 0 || submitting ? '#cbd5e1' : '#10b981',
                    borderRadius: 9, cursor: change < 0 || submitting ? 'not-allowed' : 'pointer',
                    fontSize: 13.5, fontWeight: 600, color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}
                >
                  {submitting ? 'Procesando...' : <><Check size={15} /><span>Confirmar cobro</span></>}
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── Step: success ── */}
        {step === 'success' && orderId && (
          <div style={{ padding: '36px 28px', textAlign: 'center' }}>
            <div style={{
              width: 64, height: 64, borderRadius: '50%', background: '#ecfdf5',
              display: 'grid', placeItems: 'center', margin: '0 auto 16px', color: '#10b981',
            }}>
              <Check size={32} strokeWidth={2.5} />
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>
              {orderNumber != null ? `¡Venta #${orderNumber} registrada!` : '¡Cobro exitoso!'}
            </div>
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 4 }}>
              {formatCOP(total)} · {methodLabel(method)}
            </div>
            {method === 'efectivo' && receivedNum > total && (
              <div style={{ fontSize: 12, color: '#10b981', fontWeight: 600, marginBottom: 4 }}>
                Vuelto: {formatCOP(receivedNum - total)}
              </div>
            )}
            <div data-testid="success-order-number" style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace', marginBottom: 24 }}>
              {orderNumber != null ? `Venta #${orderNumber}` : `#${orderId.slice(-8).toUpperCase()}`}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button
                onClick={() => window.print()}
                style={{
                  padding: '10px 18px', border: '1.5px solid #e5e7eb', background: '#fff',
                  borderRadius: 9, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#334155',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                <Printer size={15} /> Imprimir
              </button>
              <button
                onClick={onComplete}
                style={{
                  padding: '10px 22px', border: 'none', background: '#10b981',
                  borderRadius: 9, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#fff',
                }}
              >
                Nueva venta
              </button>
            </div>

            {/* Hidden ticket — visible only on print */}
            <PrintTicket
              items={items}
              subtotal={subtotal}
              discountAmt={discountAmt}
              discount={discount}
              discountType={discountType}
              iva={iva}
              total={total}
              method={method}
              orderType={orderType}
              orderId={orderId}
              orderNumber={orderNumber}
              receivedAmt={method === 'efectivo' ? receivedNum : undefined}
              restaurantName={restaurant?.name ?? 'G-Vento'}
              restaurantAddress={restaurant?.address}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Held orders (ventas en espera) ──────────────────────────────

function heldItemCount(h: HeldOrder): number {
  return h.items.reduce((a, x) => a + x.qty, 0)
}

function heldTotal(h: HeldOrder): number {
  const subtotal = h.items.reduce((a, x) => a + cartItemTotal(x), 0)
  const disc = h.discountType === 'pct'
    ? Math.round((subtotal * h.discount) / 100)
    : Math.min(h.discount, subtotal)
  return subtotal - disc
}

function formatHeldElapsed(createdAt: number): string {
  const mins = Math.floor((Date.now() - createdAt) / 60000)
  if (mins < 1) return 'recién'
  if (mins < 60) return `hace ${mins} min`
  const h = Math.floor(mins / 60)
  const r = mins % 60
  return r > 0 ? `hace ${h}h ${r}m` : `hace ${h}h`
}

// Mini-modal para capturar la referencia (label) al poner en espera.
function HoldLabelModal({ onConfirm, onClose }: {
  onConfirm: (label: string) => void
  onClose: () => void
}) {
  const [label, setLabel] = useState('')

  return (
    <div
      style={{ position: 'absolute', inset: 0, background: 'rgba(15,23,42,.55)', display: 'grid', placeItems: 'center', zIndex: 60 }}
      onClick={onClose}
    >
      <div
        style={{ background: '#fff', borderRadius: 14, width: 420, maxWidth: '92%', boxShadow: '0 25px 50px -12px rgba(0,0,0,.25)', overflow: 'hidden' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: '18px 22px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Pause size={16} color="#854d0e" />
            <span style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>Poner en espera</span>
          </div>
          <button onClick={onClose} style={{ background: '#f1f5f9', border: 'none', width: 30, height: 30, borderRadius: 8, cursor: 'pointer', color: '#64748b', display: 'grid', placeItems: 'center' }}>
            <X size={15} />
          </button>
        </div>
        <div style={{ padding: 22 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
            Referencia
          </label>
          <input
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onConfirm(label.trim())}
            placeholder="Ej: Señor de gorra, Mesa azul…"
            style={{
              width: '100%', padding: '11px 13px', border: '1.5px solid #e2e8f0',
              borderRadius: 10, fontSize: 14, color: '#0f172a', outline: 'none', boxSizing: 'border-box',
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = '#10b981')}
            onBlur={(e) => (e.currentTarget.style.borderColor = '#e2e8f0')}
          />
          <p style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 6, marginBottom: 0 }}>
            Opcional. Si lo dejas vacío se usará la hora actual.
          </p>
          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <button
              onClick={onClose}
              style={{ flex: 1, padding: '12px', border: '1.5px solid #e5e7eb', background: '#fff', borderRadius: 9, cursor: 'pointer', fontSize: 13.5, fontWeight: 600, color: '#334155' }}
            >
              Cancelar
            </button>
            <button
              onClick={() => onConfirm(label.trim())}
              style={{ flex: 2, padding: '12px', border: 'none', background: '#10b981', borderRadius: 9, cursor: 'pointer', fontSize: 13.5, fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            >
              <Pause size={15} /> Guardar en espera
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Panel con la lista de ventas en espera.
function HeldOrdersPanel({ held, onResume, onDiscard, onClose }: {
  held: HeldOrder[]
  onResume: (id: string) => void
  onDiscard: (id: string) => void
  onClose: () => void
}) {
  return (
    <div
      style={{ position: 'absolute', inset: 0, background: 'rgba(15,23,42,.55)', display: 'grid', placeItems: 'center', zIndex: 55 }}
      onClick={onClose}
    >
      <div
        style={{ background: '#fff', borderRadius: 14, width: 460, maxWidth: '94%', maxHeight: '85%', boxShadow: '0 25px 50px -12px rgba(0,0,0,.25)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Pause size={16} color="#854d0e" />
            <span style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>
              Ventas en espera ({held.length})
            </span>
          </div>
          <button onClick={onClose} style={{ background: '#f1f5f9', border: 'none', width: 30, height: 30, borderRadius: 8, cursor: 'pointer', color: '#64748b', display: 'grid', placeItems: 'center' }}>
            <X size={15} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {held.length === 0 ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', color: '#94a3b8', fontSize: 13.5 }}>
              No hay ventas en espera
            </div>
          ) : (
            held.map((h) => (
              <div key={h.id} style={{ border: '1px solid #e5e7eb', borderRadius: 11, padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 700, color: '#0f172a', letterSpacing: -0.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {h.label}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3, fontSize: 12, color: '#64748b' }}>
                      <span>{heldItemCount(h)} {heldItemCount(h) === 1 ? 'ítem' : 'ítems'}</span>
                      <span style={{ color: '#cbd5e1' }}>·</span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        <Clock size={11} /> {formatHeldElapsed(h.createdAt)}
                      </span>
                    </div>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', fontFamily: 'monospace', flexShrink: 0 }}>
                    {formatCOP(heldTotal(h))}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button
                    onClick={() => onResume(h.id)}
                    style={{ flex: 1, padding: '9px', border: 'none', background: '#10b981', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                  >
                    <Play size={14} /> Retomar
                  </button>
                  <button
                    onClick={() => onDiscard(h.id)}
                    style={{ flexShrink: 0, padding: '9px 14px', border: '1.5px solid #fecaca', background: '#fef2f2', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#dc2626', display: 'flex', alignItems: 'center', gap: 6 }}
                  >
                    <Trash size={14} /> Descartar
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

// Diálogo: qué hacer con el carrito activo al retomar otra venta.
function ResumeConflictDialog({ onKeep, onDiscardCurrent, onCancel }: {
  onKeep: () => void
  onDiscardCurrent: () => void
  onCancel: () => void
}) {
  return (
    <div
      style={{ position: 'absolute', inset: 0, background: 'rgba(15,23,42,.6)', display: 'grid', placeItems: 'center', zIndex: 65 }}
      onClick={onCancel}
    >
      <div
        style={{ background: '#fff', borderRadius: 14, width: 420, maxWidth: '92%', boxShadow: '0 25px 50px -12px rgba(0,0,0,.25)', overflow: 'hidden', padding: 22 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>
          Tienes una venta activa
        </div>
        <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 18px', lineHeight: 1.5 }}>
          El carrito actual tiene ítems. ¿Qué hacer antes de retomar la otra venta?
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            onClick={onKeep}
            style={{ width: '100%', padding: '12px', border: '1.5px solid #fde68a', background: '#fffbeb', borderRadius: 9, cursor: 'pointer', fontSize: 13.5, fontWeight: 700, color: '#854d0e', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}
          >
            <Pause size={15} /> Guardar la actual en espera
          </button>
          <button
            onClick={onDiscardCurrent}
            style={{ width: '100%', padding: '12px', border: '1.5px solid #fecaca', background: '#fef2f2', borderRadius: 9, cursor: 'pointer', fontSize: 13.5, fontWeight: 700, color: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}
          >
            <Trash size={15} /> Descartar la actual
          </button>
          <button
            onClick={onCancel}
            style={{ width: '100%', padding: '11px', border: '1.5px solid #e5e7eb', background: '#fff', borderRadius: 9, cursor: 'pointer', fontSize: 13.5, fontWeight: 600, color: '#334155' }}
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main page export ────────────────────────────────────────────
export function POSPage() {
  const [activeCat, setActiveCat] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [orderType, setOrderType] = useState<OrderType>('takeaway')
  const [checkout, setCheckout] = useState(false)
  const [showOpenShift, setShowOpenShift] = useState(false)
  const [notingIdx, setNotingIdx] = useState<number | null>(null)
  const [showHoldModal, setShowHoldModal] = useState(false)
  const [showHeldPanel, setShowHeldPanel] = useState(false)
  const [resumeTarget, setResumeTarget] = useState<string | null>(null)
  // Configuración de extras: producto a agregar, o ítem del carrito a editar.
  const [configProduct, setConfigProduct] = useState<ProductWithCategory | null>(null)
  const [editingItem, setEditingItem] = useState<CartItem | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const { isOpen: isShiftOpen } = useCashShift()
  const productsWithExtras = useProductsWithExtras()

  // Cobrar exige turno abierto: si no hay, abre el modal de apertura primero.
  const handleCheckout = () => {
    if (!isShiftOpen) { setShowOpenShift(true); return }
    setCheckout(true)
  }

  const { data: categories = [], isLoading: catsLoading } = useCategories()
  const { data: products = [], isLoading: prodsLoading } = useProducts()

  // Set first category as default
  useEffect(() => {
    if (!activeCat && categories.length > 0) setActiveCat(categories[0].id)
  }, [activeCat, categories])

  // Keyboard shortcut: / to focus search
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement)?.tagName
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  // Inject print CSS
  useEffect(() => {
    const existing = document.getElementById('gvento-ticket-print')
    if (existing) return
    const style = document.createElement('style')
    style.id = 'gvento-ticket-print'
    style.textContent = PRINT_CSS
    document.head.appendChild(style)
    return () => style.remove()
  }, [])

  const resolvedCat = activeCat ?? categories[0]?.id ?? null

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q) {
      return products.filter(
        (p) => p.name.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q),
      )
    }
    if (!resolvedCat) return products
    return products.filter((p) => p.category_id === resolvedCat)
  }, [products, resolvedCat, query])

  const activeCatObj = categories.find((c) => c.id === resolvedCat)

  const items = useCartStore((s) => s.items)
  const discount = useCartStore((s) => s.discount)
  const discountType = useCartStore((s) => s.discountType)
  const add = useCartStore((s) => s.add)
  const addItem = useCartStore((s) => s.addItem)
  const updateItemExtras = useCartStore((s) => s.updateItemExtras)
  const clear = useCartStore((s) => s.clear)
  const heldOrders = useCartStore((s) => s.heldOrders)
  const holdCurrentOrder = useCartStore((s) => s.holdCurrentOrder)
  const resumeHeldOrder = useCartStore((s) => s.resumeHeldOrder)
  const discardHeldOrder = useCartStore((s) => s.discardHeldOrder)

  // ── Ventas en espera ──
  const confirmHold = (label: string) => {
    holdCurrentOrder(label)
    setShowHoldModal(false)
    toast.success('Venta puesta en espera')
  }

  const handleResume = (id: string) => {
    // Si el carrito actual tiene ítems, preguntar qué hacer con él primero.
    if (items.length > 0) {
      setResumeTarget(id)
    } else {
      resumeHeldOrder(id)
      setShowHeldPanel(false)
    }
  }

  const resumeKeepingCurrent = () => {
    if (!resumeTarget) return
    holdCurrentOrder('')          // guarda el carrito actual con label automático
    resumeHeldOrder(resumeTarget) // restaura la venta elegida
    setResumeTarget(null)
    setShowHeldPanel(false)
  }

  const resumeDiscardingCurrent = () => {
    if (!resumeTarget) return
    resumeHeldOrder(resumeTarget) // sobrescribe el carrito actual
    setResumeTarget(null)
    setShowHeldPanel(false)
  }

  const handleDiscardHeld = (id: string) => {
    if (!window.confirm('¿Descartar esta venta en espera? No se puede deshacer.')) return
    discardHeldOrder(id)
  }

  // Agregar producto: si tiene extras asignados, abrir el modal de
  // configuración; si no, agregar directo (sin fricción).
  const handleAddProduct = (product: ProductWithCategory) => {
    if (productsWithExtras.has(product.id)) setConfigProduct(product)
    else add(product)
  }

  const subtotal = useMemo(
    () => items.reduce((a, x) => a + cartItemTotal(x), 0),
    [items],
  )
  const discountAmt =
    discountType === 'pct'
      ? Math.round((subtotal * discount) / 100)
      : Math.min(discount, subtotal)
  const afterDiscount = subtotal - discountAmt
  const iva = Math.round(afterDiscount - afterDiscount / 1.19)
  const total = afterDiscount

  if (catsLoading || prodsLoading) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 text-sm">
        Cargando productos...
      </div>
    )
  }

  return (
    <div
      className="flex h-full overflow-hidden"
      style={{
        background: '#f8fafc', color: '#0f172a',
        fontFamily: 'Inter, system-ui, sans-serif', position: 'relative',
      }}
    >
      {/* ─── LEFT: Catalog 60% ─── */}
      <div style={{ flex: '0 0 60%', display: 'flex', flexDirection: 'column', minHeight: 0, background: '#fafafa' }}>

        {/* Search + category tabs */}
        <div style={{ padding: '18px 24px 4px', background: '#fff', borderBottom: '1px solid #f1f5f9' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14 }}>
            <div style={{
              flex: 1, display: 'flex', alignItems: 'center', gap: 10,
              background: '#f8fafc', borderRadius: 10,
              padding: '11px 14px', border: '1px solid #e2e8f0',
            }}>
              <Search size={17} color="#94a3b8" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur() }
                }}
                placeholder="Buscar producto..."
                style={{
                  flex: 1, border: 'none', outline: 'none',
                  background: 'transparent', fontSize: 14, color: '#0f172a',
                  fontFamily: 'Inter, system-ui, sans-serif',
                }}
              />
              {query ? (
                <button
                  onClick={() => setQuery('')}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0, display: 'grid', placeItems: 'center' }}
                >
                  <X size={14} />
                </button>
              ) : (
                <kbd style={{
                  fontSize: 10, color: '#cbd5e1', border: '1px solid #e5e7eb',
                  borderRadius: 4, padding: '1px 5px', fontFamily: 'monospace',
                  background: '#f1f5f9', userSelect: 'none',
                }}>/</kbd>
              )}
            </div>
          </div>

          {/* Category tabs */}
          <div style={{ display: 'flex', gap: 4, overflowX: 'auto', paddingBottom: 2, scrollbarWidth: 'none' }}>
            {categories.map((c) => {
              const active = resolvedCat === c.id && !query
              return (
                <button
                  key={c.id}
                  onClick={() => { setActiveCat(c.id); setQuery('') }}
                  style={{
                    padding: '12px 16px 14px',
                    border: 'none', background: 'transparent',
                    borderBottom: active ? `3px solid ${c.color}` : '3px solid transparent',
                    color: active ? c.color : '#64748b',
                    fontWeight: active ? 700 : 500, fontSize: 14,
                    fontFamily: 'Inter, sans-serif', cursor: 'pointer',
                    whiteSpace: 'nowrap', letterSpacing: -0.2, transition: 'color .12s',
                  }}
                >
                  {c.name}
                </button>
              )
            })}
          </div>
        </div>

        {/* Section header */}
        <div style={{ padding: '16px 24px 8px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 4, height: 18, borderRadius: 2, background: activeCatObj?.color ?? '#10b981', flexShrink: 0 }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', letterSpacing: -0.3 }}>
            {query ? `"${query}"` : (activeCatObj?.name ?? 'Todos')}
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8', fontFamily: 'monospace' }}>
            {filtered.length} {filtered.length === 1 ? 'producto' : 'productos'}
          </div>
        </div>

        {/* Product grid */}
        <div style={{ flex: 1, overflow: 'auto', padding: '4px 24px 24px' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
              Sin resultados para "{query}"
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
              {filtered.map((p) => (
                <ProductCard key={p.id} product={p} onAdd={() => handleAddProduct(p)} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ─── RIGHT: Cart 40% ─── */}
      <CartPanel
        subtotal={subtotal}
        discountAmt={discountAmt}
        iva={iva}
        total={total}
        orderType={orderType}
        setOrderType={setOrderType}
        notingIdx={notingIdx}
        setNotingIdx={setNotingIdx}
        onCheckout={handleCheckout}
        onHold={() => setShowHoldModal(true)}
        heldCount={heldOrders.length}
        onShowHeld={() => setShowHeldPanel(true)}
        productsWithExtras={productsWithExtras}
        onEditExtras={(item) => setEditingItem(item)}
      />

      {/* Configurar extras al AGREGAR un producto */}
      {configProduct && (
        <ItemConfigModal
          product={configProduct}
          onConfirm={(extras) => { addItem(configProduct, extras); setConfigProduct(null) }}
          onClose={() => setConfigProduct(null)}
        />
      )}

      {/* Editar extras de un ítem ya en el carrito */}
      {editingItem && (
        <ItemConfigModal
          product={editingItem.product}
          initial={editingItem.extras}
          confirmLabel="Guardar extras"
          onConfirm={(extras) => { updateItemExtras(editingItem.id, extras); setEditingItem(null) }}
          onClose={() => setEditingItem(null)}
        />
      )}

      {showHoldModal && (
        <HoldLabelModal
          onConfirm={confirmHold}
          onClose={() => setShowHoldModal(false)}
        />
      )}

      {showHeldPanel && (
        <HeldOrdersPanel
          held={heldOrders}
          onResume={handleResume}
          onDiscard={handleDiscardHeld}
          onClose={() => setShowHeldPanel(false)}
        />
      )}

      {resumeTarget && (
        <ResumeConflictDialog
          onKeep={resumeKeepingCurrent}
          onDiscardCurrent={resumeDiscardingCurrent}
          onCancel={() => setResumeTarget(null)}
        />
      )}

      {showOpenShift && (
        <OpenShiftModal
          onClose={() => setShowOpenShift(false)}
          onOpened={() => { setShowOpenShift(false); setCheckout(true) }}
        />
      )}

      {checkout && (
        <CheckoutModal
          items={items}
          total={total}
          subtotal={subtotal}
          discountAmt={discountAmt}
          discount={discount}
          discountType={discountType}
          iva={iva}
          orderType={orderType}
          onClose={() => setCheckout(false)}
          onComplete={() => { setCheckout(false); clear() }}
        />
      )}
    </div>
  )
}
