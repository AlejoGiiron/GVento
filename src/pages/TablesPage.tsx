import { useState, useMemo, useEffect, useRef } from 'react'
import {
  UtensilsCrossed, Plus, Users, X, Check, Search,
  ChevronRight, Banknote, CreditCard, Building2, Smartphone,
  Trash, Minus, Settings, Pencil,
  ReceiptText, RefreshCw, ChefHat, HandCoins,
} from 'lucide-react'
import { toast } from 'react-hot-toast'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import { usePermissions } from '@/hooks/usePermissions'
import { useRestaurantConfig } from '@/hooks/useRestaurantConfig'
import { useCashShift } from '@/hooks/useCashShift'
import { useTables } from '@/hooks/useTables'
import { useProducts } from '@/hooks/useProducts'
import { useCategories } from '@/hooks/useCategories'
import { useProductsWithExtras } from '@/hooks/useProductsWithExtras'
import {
  createTable, updateTable, deleteTable,
  updateTableStatus, createOrder, addOrderItemsWithExtras,
  updateOrderTotal, updateOrderStatus, createPayment,
  getTableActiveOrderCount, removeOrderItem, markItemsSentToKitchen,
  assignOrderNumber, setOrderFiado,
} from '@/lib/supabase-helpers'
import { OpenShiftModal } from '@/components/shift/OpenShiftModal'
import { ItemConfigModal } from '@/components/pos/ItemConfigModal'
import { CustomerPicker } from '@/components/fiado/CustomerPicker'
import { printComanda } from '@/lib/printer'
import type { Enums } from '@/types/database.types'
import type { ProductWithCategory, CartExtra } from '@/stores/cartStore'
import { cartItemTotal } from '@/stores/cartStore'
import type { TableRow, ActiveOrder, OrderItemRow } from '@/hooks/useTables'

type TableStatus = TableRow['status']
type PaymentMethodUI = 'efectivo' | 'tarjeta' | 'transferencia' | 'nequi' | 'fiado'

// ─── Helpers ─────────────────────────────────────────────────────

const formatCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n)

// Extras de una línea ya persistida: order_item_extras.qty es el TOTAL de la
// línea (la RPC ya multiplicó por la qty del ítem).
function orderItemExtrasTotal(item: OrderItemRow): number {
  return item.order_item_extras.reduce((a, e) => a + e.unit_price * e.qty, 0)
}

function orderItemLineTotal(item: OrderItemRow): number {
  return item.unit_price * item.qty + orderItemExtrasTotal(item)
}

function formatElapsed(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'ahora'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  const rem = mins % 60
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`
}

const ZONES = ['Salón', 'Terraza', 'Barra']

const STATUS_CONFIG: Record<TableStatus, { bg: string; border: string; fg: string; dot: string; label: string }> = {
  free:         { bg: '#f8fafc', border: '#e2e8f0', fg: '#64748b', dot: '#cbd5e1',  label: 'Libre'           },
  occupied:     { bg: '#ecfdf5', border: '#a7f3d0', fg: '#065f46', dot: '#10b981',  label: 'Ocupada'         },
  waiting_bill: { bg: '#fef3c7', border: '#fde68a', fg: '#854d0e', dot: '#f59e0b',  label: 'Pide cuenta'     },
  reserved:     { bg: '#dbeafe', border: '#bfdbfe', fg: '#1e40af', dot: '#3b82f6',  label: 'Reservada'       },
}

// ─── Table card ───────────────────────────────────────────────────

function TableCard({
  table,
  order,
  selected,
  onClick,
}: {
  table: TableRow
  order?: ActiveOrder
  selected: boolean
  onClick: () => void
}) {
  const cfg = STATUS_CONFIG[table.status]

  return (
    <button
      onClick={onClick}
      style={{
        background: selected ? cfg.bg : '#fff',
        border: `2px solid ${selected ? cfg.dot : cfg.border}`,
        borderRadius: 14,
        padding: '16px 14px',
        cursor: 'pointer',
        textAlign: 'left',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        transition: 'all .15s',
        boxShadow: selected ? `0 0 0 3px ${cfg.dot}33` : 'none',
        width: '100%',
      }}
      onMouseEnter={(e) => {
        if (!selected) {
          e.currentTarget.style.borderColor = cfg.dot
          e.currentTarget.style.transform = 'translateY(-2px)'
          e.currentTarget.style.boxShadow = '0 8px 20px rgba(0,0,0,.06)'
        }
      }}
      onMouseLeave={(e) => {
        if (!selected) {
          e.currentTarget.style.borderColor = cfg.border
          e.currentTarget.style.transform = 'translateY(0)'
          e.currentTarget.style.boxShadow = 'none'
        }
      }}
    >
      {/* Top: name + status dot */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', letterSpacing: -0.5 }}>
          {table.name}
        </div>
        <div style={{
          width: 10, height: 10, borderRadius: '50%',
          background: cfg.dot,
          boxShadow: table.status !== 'free' ? `0 0 0 3px ${cfg.dot}33` : 'none',
        }} />
      </div>

      {/* Capacity + zone */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {table.capacity && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            fontSize: 11.5, color: '#94a3b8',
          }}>
            <Users size={11} />
            {table.capacity}
          </div>
        )}
        {table.zone && (
          <div style={{ fontSize: 11.5, color: '#94a3b8' }}>
            {table.zone}
          </div>
        )}
      </div>

      {/* Status badge */}
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        background: cfg.bg, color: cfg.fg,
        border: `1px solid ${cfg.border}`,
        borderRadius: 6, padding: '4px 8px',
        fontSize: 11.5, fontWeight: 600,
      }}>
        {cfg.label}
        {order && (table.status === 'occupied' || table.status === 'waiting_bill') && (
          <span style={{ fontWeight: 400, color: cfg.fg, opacity: 0.75 }}>
            · {formatElapsed(order.created_at)}
          </span>
        )}
      </div>

      {/* Responsable */}
      {order?.waiter_name && (table.status === 'occupied' || table.status === 'waiting_bill') && (
        <div style={{ fontSize: 11.5, color: '#64748b' }}>
          Atiende: <span style={{ fontWeight: 600, color: '#334155' }}>{order.waiter_name}</span>
        </div>
      )}

      {/* Order total */}
      {order && (
        <div style={{
          fontSize: 15, fontWeight: 700, color: '#0f172a',
          fontFamily: 'monospace', letterSpacing: -0.4,
        }}>
          {formatCOP(order.total)}
        </div>
      )}
    </button>
  )
}

// ─── Kitchen comanda (hidden, print only) ─────────────────────────

// ─── Open table modal ─────────────────────────────────────────────

function OpenTableModal({
  table,
  onClose,
  onOpened,
}: {
  table: TableRow
  onClose: () => void
  onOpened: () => void
}) {
  const { profile } = useAuth()
  const [submitting, setSubmitting] = useState(false)
  const [waiterName, setWaiterName] = useState('')

  const handleOpen = async () => {
    if (!profile) return
    setSubmitting(true)
    try {
      const { data: order, error: orderErr } = await createOrder({
        type: 'dine_in',
        status: 'pending',
        table_id: table.id,
        total: 0,
        waiter_name: waiterName.trim() || null,
        restaurant_id: profile.restaurant_id,
        created_by: profile.id,
      })
      if (orderErr || !order) throw orderErr ?? new Error('Error al crear la orden')

      const { error: statusErr } = await updateTableStatus(table.id, 'occupied')
      if (statusErr) throw statusErr

      toast.success(`Mesa ${table.name} abierta`)
      onOpened()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      toast.error(`Error al abrir mesa: ${msg}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', display: 'grid', placeItems: 'center', zIndex: 50 }}
      onClick={onClose}
    >
      <div
        style={{ background: '#fff', borderRadius: 14, width: 380, maxWidth: '92%', boxShadow: '0 25px 50px -12px rgba(0,0,0,.25)', overflow: 'hidden' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: '18px 22px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Abrir mesa
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', letterSpacing: -0.4 }}>
              {table.name}
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
          <div style={{
            background: '#f8fafc', borderRadius: 10, padding: '12px 14px', marginBottom: 18,
            display: 'flex', gap: 12, alignItems: 'center',
          }}>
            <UtensilsCrossed size={18} color="#10b981" />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>Mesa para comer</div>
              <div style={{ fontSize: 11.5, color: '#64748b' }}>
                {table.zone ?? 'Sin zona asignada'}{table.capacity ? ` · ${table.capacity} personas` : ''}
              </div>
            </div>
          </div>

          {/* Responsable (opcional) */}
          <div style={{ marginBottom: 18 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
              Responsable <span style={{ color: '#94a3b8', fontWeight: 400 }}>(opcional)</span>
            </label>
            <input
              value={waiterName}
              onChange={(e) => setWaiterName(e.target.value)}
              placeholder="¿Quién atiende la mesa?"
              style={{
                width: '100%', padding: '10px 12px', border: '1.5px solid #e5e7eb',
                borderRadius: 10, fontSize: 13.5, outline: 'none', boxSizing: 'border-box',
                color: '#0f172a', fontFamily: 'Inter, system-ui, sans-serif',
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={onClose}
              style={{ flex: 1, padding: '12px', border: '1.5px solid #e5e7eb', background: '#fff', borderRadius: 9, cursor: 'pointer', fontSize: 13.5, fontWeight: 600, color: '#334155' }}
            >
              Cancelar
            </button>
            <button
              disabled={submitting}
              onClick={handleOpen}
              style={{
                flex: 2, padding: '12px', border: 'none',
                background: submitting ? '#cbd5e1' : '#10b981',
                borderRadius: 9, cursor: submitting ? 'not-allowed' : 'pointer',
                fontSize: 13.5, fontWeight: 600, color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              {submitting ? 'Abriendo...' : <><Check size={15} /><span>Abrir mesa</span></>}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Product picker modal ─────────────────────────────────────────

type PickerItem = { product: ProductWithCategory; qty: number; note: string; extras: CartExtra[] }

function ProductPickerModal({
  orderId,
  currentTotal,
  onClose,
  onAdded,
}: {
  orderId: string
  currentTotal: number
  onClose: () => void
  onAdded: () => void
}) {
  const [query, setQuery] = useState('')
  const [activeCat, setActiveCat] = useState<string | null>(null)
  const [selection, setSelection] = useState<PickerItem[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [configProduct, setConfigProduct] = useState<ProductWithCategory | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const { data: categories = [] } = useCategories()
  const { data: products = [] } = useProducts()
  const productsWithExtras = useProductsWithExtras()

  useEffect(() => {
    if (!activeCat && categories.length > 0) setActiveCat(categories[0].id)
  }, [activeCat, categories])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q) return products.filter((p) => p.name.toLowerCase().includes(q))
    if (!activeCat) return products
    return products.filter((p) => p.category_id === activeCat)
  }, [products, activeCat, query])

  // Producto sin extras → fusiona/incrementa. Con extras → abre el modal de config.
  const addProduct = (product: ProductWithCategory) => {
    if (productsWithExtras.has(product.id)) { setConfigProduct(product); return }
    setSelection((prev) => {
      const idx = prev.findIndex((x) => x.product.id === product.id && x.extras.length === 0)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 }
        return next
      }
      return [...prev, { product, qty: 1, note: '', extras: [] }]
    })
  }

  // Confirmación del modal de extras → línea nueva con sus extras.
  const addConfigured = (product: ProductWithCategory, extras: CartExtra[]) => {
    setSelection((prev) => [...prev, { product, qty: 1, note: '', extras }])
    setConfigProduct(null)
  }

  const setQty = (idx: number, qty: number) => {
    if (qty <= 0) {
      setSelection((prev) => prev.filter((_, i) => i !== idx))
    } else {
      setSelection((prev) => {
        const next = [...prev]
        next[idx] = { ...next[idx], qty }
        return next
      })
    }
  }

  const addedTotal = useMemo(
    () => selection.reduce((s, x) => s + cartItemTotal(x), 0),
    [selection],
  )

  const handleConfirm = async () => {
    if (selection.length === 0) return
    setSubmitting(true)
    try {
      const { error: itemsErr } = await addOrderItemsWithExtras(
        orderId,
        selection.map((x) => ({
          product_id: x.product.id,
          qty: x.qty,
          unit_price: x.product.price,
          notes: x.note || null,
          extras: x.extras.map((ex) => ({ extra_id: ex.extra_id, qty: ex.qty })),
        })),
      )
      if (itemsErr) throw itemsErr

      const { error: totalErr } = await updateOrderTotal(orderId, currentTotal + addedTotal)
      if (totalErr) throw totalErr

      toast.success('Ítems agregados')
      onAdded()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      toast.error(`Error al agregar ítems: ${msg}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', display: 'grid', placeItems: 'center', zIndex: 50 }}
      onClick={onClose}
    >
      <div
        style={{ background: '#fff', borderRadius: 14, width: 680, maxWidth: '96%', height: '85vh', boxShadow: '0 25px 50px -12px rgba(0,0,0,.25)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>Agregar ítems</div>
          </div>
          <button onClick={onClose} style={{ background: '#f1f5f9', border: 'none', width: 30, height: 30, borderRadius: 7, cursor: 'pointer', color: '#64748b', display: 'grid', placeItems: 'center' }}>
            <X size={15} />
          </button>
        </div>

        {/* Search + category tabs */}
        <div style={{ padding: '14px 18px 0', background: '#fff', borderBottom: '1px solid #f1f5f9' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: '#f8fafc', borderRadius: 10,
            padding: '10px 13px', border: '1px solid #e2e8f0', marginBottom: 12,
          }}>
            <Search size={15} color="#94a3b8" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar producto..."
              style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13.5 }}
            />
            {query && (
              <button onClick={() => setQuery('')} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0, display: 'grid', placeItems: 'center' }}>
                <X size={13} />
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 2, overflowX: 'auto', paddingBottom: 2, scrollbarWidth: 'none' }}>
            {categories.map((c) => {
              const active = activeCat === c.id && !query
              return (
                <button
                  key={c.id}
                  onClick={() => { setActiveCat(c.id); setQuery('') }}
                  style={{
                    padding: '10px 14px 12px',
                    border: 'none', background: 'transparent',
                    borderBottom: active ? `3px solid ${c.color}` : '3px solid transparent',
                    color: active ? c.color : '#64748b',
                    fontWeight: active ? 700 : 500, fontSize: 13.5,
                    cursor: 'pointer', whiteSpace: 'nowrap',
                  }}
                >
                  {c.name}
                </button>
              )
            })}
          </div>
        </div>

        {/* Product grid */}
        <div style={{ flex: 1, overflow: 'auto', padding: '12px 18px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {filtered.map((p) => {
              const inSel = selection.find((x) => x.product.id === p.id)
              const color = p.categories?.color ?? '#10b981'
              return (
                <button
                  key={p.id}
                  onClick={() => addProduct(p)}
                  style={{
                    background: inSel ? '#ecfdf5' : '#fff',
                    border: inSel ? `2px solid #10b981` : '1.5px solid #e5e7eb',
                    borderRadius: 10, padding: '12px', cursor: 'pointer',
                    textAlign: 'left', transition: 'all .12s',
                  }}
                >
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: '#0f172a', lineHeight: 1.25 }}>{p.name}</div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color, fontFamily: 'monospace' }}>{formatCOP(p.price)}</div>
                    {inSel && (
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#065f46', background: '#d1fae5', borderRadius: 5, padding: '2px 7px' }}>
                        ×{inSel.qty}
                      </div>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Selection summary + confirm */}
        {selection.length > 0 && (
          <div style={{ padding: '14px 18px', borderTop: '1px solid #e5e7eb', background: '#f8fafc' }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              {selection.map((x, idx) => (
                <div key={idx} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: '#fff', border: '1px solid #e5e7eb',
                  borderRadius: 7, padding: '5px 8px',
                }}>
                  <span style={{ fontSize: 12, color: '#0f172a', fontWeight: 500 }}>
                    {x.qty}× {x.product.name}
                    {x.extras.length > 0 && (
                      <span style={{ color: '#065f46' }}> · {x.extras.map((e) => `${e.name}×${e.qty}`).join(', ')}</span>
                    )}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <button onClick={() => setQty(idx, x.qty - 1)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', display: 'grid', placeItems: 'center', padding: 2 }}>
                      <Minus size={11} />
                    </button>
                    <button onClick={() => setQty(idx, x.qty + 1)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', display: 'grid', placeItems: 'center', padding: 2 }}>
                      <Plus size={11} />
                    </button>
                    <button onClick={() => setSelection((p) => p.filter((_, i) => i !== idx))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', display: 'grid', placeItems: 'center', padding: 2 }}>
                      <X size={11} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, fontSize: 14, fontWeight: 700, color: '#0f172a', fontFamily: 'monospace' }}>
                +{formatCOP(addedTotal)}
              </div>
              <button
                disabled={submitting}
                onClick={handleConfirm}
                style={{
                  padding: '11px 22px', border: 'none',
                  background: submitting ? '#cbd5e1' : '#10b981',
                  borderRadius: 9, cursor: submitting ? 'not-allowed' : 'pointer',
                  fontSize: 13.5, fontWeight: 600, color: '#fff',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                {submitting ? 'Agregando...' : <><Check size={14} /><span>Agregar a la mesa</span></>}
              </button>
            </div>
          </div>
        )}

        {/* Configurar extras del producto elegido */}
        {configProduct && (
          <ItemConfigModal
            product={configProduct}
            confirmLabel="Agregar a la selección"
            onConfirm={(extras) => addConfigured(configProduct, extras)}
            onClose={() => setConfigProduct(null)}
          />
        )}
      </div>
    </div>
  )
}

// ─── Table checkout modal ─────────────────────────────────────────

function TableCheckoutModal({
  table,
  order,
  onClose,
  onComplete,
}: {
  table: TableRow
  order: ActiveOrder
  onClose: () => void
  onComplete: () => void
}) {
  const { profile } = useAuth()
  const { can } = usePermissions()
  const { refetchSales } = useCashShift()
  const queryClient = useQueryClient()
  const [step, setStep] = useState<'method' | 'amount' | 'success'>('method')
  const [method, setMethod] = useState<PaymentMethodUI>('efectivo')
  const [received, setReceived] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [orderNumber, setOrderNumber] = useState<number | null>(null)
  // Fiado: cliente seleccionado (solo aplica si method === 'fiado').
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [customerName, setCustomerName] = useState<string>('')

  const canFiado = can('fiado.gestionar')
  const isFiado = method === 'fiado'
  const total = order.total
  const receivedNum = parseInt(received.replace(/\D/g, ''), 10) || 0
  const change = receivedNum - total

  const paymentMethods: { id: PaymentMethodUI; label: string; icon: React.ReactNode }[] = [
    { id: 'efectivo',      label: 'Efectivo',     icon: <Banknote size={22} /> },
    { id: 'tarjeta',       label: 'Tarjeta',       icon: <CreditCard size={22} /> },
    { id: 'transferencia', label: 'Transferencia', icon: <Building2 size={22} /> },
    { id: 'nequi',         label: 'Nequi / QR',   icon: <Smartphone size={22} /> },
    ...(canFiado ? [{ id: 'fiado' as const, label: 'Fiado', icon: <HandCoins size={22} /> }] : []),
  ]

  const quickAmounts = [...new Set([total, 50000, 100000, 200000])].filter((a) => a >= total)

  const methodMap: Record<Exclude<PaymentMethodUI, 'fiado'>, Enums<'payment_method'>> = {
    efectivo: 'cash', tarjeta: 'card', transferencia: 'transfer', nequi: 'nequi',
  }

  const handleConfirm = async () => {
    if (!profile) return
    if (isFiado && !customerId) { toast.error('Selecciona un cliente para la venta a fiado'); return }
    setSubmitting(true)
    try {
      // Venta a fiado de mesa: la orden YA existe con sus ítems y el stock YA se
      // descontó al agregarlos (etapa de "Agregar a mesa", no aquí). Solo la
      // marcamos como pendiente de pago y ligada al cliente; NO entra dinero
      // (no toca caja) y NO se vuelve a tocar stock (sin doble descuento).
      if (isFiado) {
        const { error: fiadoErr } = await setOrderFiado(order.id, customerId!, customerName)
        if (fiadoErr) throw fiadoErr
      } else {
        const { error: payErr } = await createPayment({
          order_id: order.id,
          method: methodMap[method],
          amount: total,
          restaurant_id: profile.restaurant_id,
        })
        if (payErr) throw payErr
      }

      // Numeración: es una venta real (cobrada o a fiado) → asignar número.
      // Si falla, no se tumba la venta (queda registrada igual).
      const n = await assignOrderNumber(order.id, profile.restaurant_id)
      setOrderNumber(n)

      refetchSales()
      if (isFiado) queryClient.invalidateQueries({ queryKey: ['debts'] })

      const { error: orderErr } = await updateOrderStatus(order.id, 'delivered')
      if (orderErr) throw orderErr

      const { error: tableErr } = await updateTableStatus(table.id, 'free')
      if (tableErr) throw tableErr

      setStep('success')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      toast.error(`Error al cobrar: ${msg}`)
    } finally {
      setSubmitting(false)
    }
  }

  const methodLabel = ({ efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', nequi: 'Nequi / QR', fiado: 'Fiado' } as Record<PaymentMethodUI, string>)[method]

  // En paso success la mesa ya está cobrada: overlay click = onComplete (limpia estado)
  const overlayClick = step === 'success' ? onComplete : onClose

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', display: 'grid', placeItems: 'center', zIndex: 50 }}
      onClick={overlayClick}
    >
      <div
        style={{ background: '#fff', borderRadius: 14, width: step === 'method' ? 540 : 440, maxWidth: '92%', boxShadow: '0 25px 50px -12px rgba(0,0,0,.25)', overflow: 'hidden' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* method */}
        {step === 'method' && (
          <>
            <div style={{ padding: '18px 22px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {table.name} · Total a cobrar
                </div>
                <div style={{ fontSize: 28, fontWeight: 700, color: '#0f172a', fontFamily: 'monospace', letterSpacing: -0.5 }}>
                  {formatCOP(total)}
                </div>
              </div>
              <button onClick={onClose} style={{ background: '#f1f5f9', border: 'none', width: 32, height: 32, borderRadius: 8, cursor: 'pointer', color: '#64748b', display: 'grid', placeItems: 'center' }}>
                <X size={16} />
              </button>
            </div>
            <div style={{ padding: 22 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', marginBottom: 12 }}>Método de pago</div>
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
                    <div style={{ fontSize: 11.5, fontWeight: 600, textAlign: 'center', lineHeight: 1.2 }}>{m.label}</div>
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
                    La mesa se cierra a fiado: queda pendiente de pago y se libera. No entra dinero a la caja; los abonos se registran en Fiado → Cuentas por cobrar.
                  </div>
                </div>
              )}

              <div style={{ marginTop: 18, display: 'flex', gap: 10 }}>
                <button onClick={onClose} style={{ flex: 1, padding: '12px', border: '1.5px solid #e5e7eb', background: '#fff', borderRadius: 9, cursor: 'pointer', fontSize: 13.5, fontWeight: 600, color: '#334155' }}>
                  Cancelar
                </button>
                <button
                  data-testid="checkout-continue"
                  disabled={submitting || (isFiado && !customerId)}
                  onClick={() => method === 'efectivo' ? setStep('amount') : handleConfirm()}
                  style={{ flex: 2, padding: '12px', border: 'none', background: submitting || (isFiado && !customerId) ? '#cbd5e1' : '#10b981', borderRadius: 9, cursor: submitting || (isFiado && !customerId) ? 'not-allowed' : 'pointer', fontSize: 13.5, fontWeight: 600, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                >
                  {submitting
                    ? 'Procesando...'
                    : isFiado
                      ? <><HandCoins size={15} /><span>Cerrar a fiado</span></>
                      : <><span>Continuar</span><ChevronRight size={15} /></>}
                </button>
              </div>
            </div>
          </>
        )}

        {/* amount (efectivo) */}
        {step === 'amount' && (
          <>
            <div style={{ padding: '18px 22px', borderBottom: '1px solid #f1f5f9' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>Efectivo recibido</div>
              <input
                autoFocus
                value={received ? formatCOP(receivedNum) : ''}
                onChange={(e) => setReceived(e.target.value)}
                placeholder={formatCOP(total)}
                style={{ width: '100%', border: 'none', outline: 'none', fontSize: 32, fontWeight: 700, color: '#0f172a', fontFamily: 'monospace', padding: '6px 0', letterSpacing: -0.5, boxSizing: 'border-box' }}
              />
              <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                {quickAmounts.map((a, i) => (
                  <button key={i} onClick={() => setReceived(String(a))} style={{ padding: '6px 10px', border: '1px solid #e5e7eb', background: '#f8fafc', borderRadius: 6, fontSize: 11.5, fontWeight: 600, color: '#334155', fontFamily: 'monospace', cursor: 'pointer' }}>
                    {formatCOP(a)}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ padding: 22 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#64748b', marginBottom: 6 }}>
                <span>Total</span><span style={{ fontFamily: 'monospace' }}>{formatCOP(total)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '12px 14px', background: change >= 0 ? '#ecfdf5' : '#fef2f2', borderRadius: 10, marginBottom: 18 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: change >= 0 ? '#065f46' : '#991b1b' }}>{change >= 0 ? 'Vuelto' : 'Falta'}</span>
                <span style={{ fontSize: 22, fontWeight: 700, fontFamily: 'monospace', color: change >= 0 ? '#065f46' : '#991b1b' }}>{formatCOP(Math.abs(change))}</span>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setStep('method')} style={{ flex: 1, padding: '12px', border: '1.5px solid #e5e7eb', background: '#fff', borderRadius: 9, cursor: 'pointer', fontSize: 13.5, fontWeight: 600, color: '#334155' }}>Atrás</button>
                <button
                  disabled={change < 0 || submitting}
                  onClick={handleConfirm}
                  style={{ flex: 2, padding: '12px', border: 'none', background: change < 0 || submitting ? '#cbd5e1' : '#10b981', borderRadius: 9, cursor: change < 0 || submitting ? 'not-allowed' : 'pointer', fontSize: 13.5, fontWeight: 600, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                >
                  {submitting ? 'Procesando...' : <><Check size={15} /><span>Confirmar cobro</span></>}
                </button>
              </div>
            </div>
          </>
        )}

        {/* success */}
        {step === 'success' && (
          <div style={{ padding: '36px 28px', textAlign: 'center' }}>
            <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#ecfdf5', display: 'grid', placeItems: 'center', margin: '0 auto 16px', color: '#10b981' }}>
              <Check size={32} strokeWidth={2.5} />
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>
              {orderNumber != null ? `¡Venta #${orderNumber} registrada!` : '¡Cobro exitoso!'}
            </div>
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 4 }}>{table.name} · {formatCOP(total)} · {methodLabel}</div>
            {method === 'efectivo' && receivedNum > total && (
              <div style={{ fontSize: 12, color: '#10b981', fontWeight: 600, marginBottom: 4 }}>Vuelto: {formatCOP(receivedNum - total)}</div>
            )}
            <div data-testid="success-order-number" style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace', marginBottom: 24 }}>
              {orderNumber != null ? `Venta #${orderNumber}` : `#${order.id.slice(-8).toUpperCase()}`}
            </div>
            <button
              onClick={onComplete}
              style={{ padding: '11px 28px', border: 'none', background: '#10b981', borderRadius: 9, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#fff', boxShadow: '0 6px 16px rgba(16,185,129,.35)' }}
            >
              Listo
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Table config modal (admin) ───────────────────────────────────

function TableConfigModal({
  tables,
  restaurantId,
  onClose,
  onChanged,
}: {
  tables: TableRow[]
  restaurantId: string
  onClose: () => void
  onChanged: () => void
}) {
  const [form, setForm] = useState({ name: '', capacity: '', zone: 'Salón' })
  const [editId, setEditId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const startEdit = (t: TableRow) => {
    setEditId(t.id)
    setForm({ name: t.name, capacity: t.capacity ? String(t.capacity) : '', zone: t.zone ?? 'Salón' })
  }

  const resetForm = () => {
    setEditId(null)
    setForm({ name: '', capacity: '', zone: 'Salón' })
  }

  const handleSave = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        capacity: form.capacity ? parseInt(form.capacity) : null,
        zone: form.zone || null,
      }
      if (editId) {
        const { error } = await updateTable(editId, payload)
        if (error) throw error
        toast.success('Mesa actualizada')
      } else {
        const { error } = await createTable({ ...payload, restaurant_id: restaurantId, status: 'free' })
        if (error) throw error
        toast.success('Mesa creada')
      }
      resetForm()
      onChanged()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      toast.error(`Error: ${msg}`)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (t: TableRow) => {
    if (t.status !== 'free') {
      toast.error('No se puede eliminar una mesa con orden activa')
      return
    }
    const { count } = await getTableActiveOrderCount(t.id)
    if ((count ?? 0) > 0) {
      toast.error('La mesa tiene órdenes activas')
      return
    }
    setDeletingId(t.id)
    try {
      const { error } = await deleteTable(t.id)
      if (error) throw error
      toast.success(`Mesa ${t.name} eliminada`)
      onChanged()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      toast.error(`Error: ${msg}`)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', display: 'grid', placeItems: 'center', zIndex: 50 }}
      onClick={onClose}
    >
      <div
        style={{ background: '#fff', borderRadius: 14, width: 540, maxWidth: '94%', maxHeight: '85vh', boxShadow: '0 25px 50px -12px rgba(0,0,0,.25)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>Configuración de mesas</div>
          <button onClick={onClose} style={{ background: '#f1f5f9', border: 'none', width: 30, height: 30, borderRadius: 7, cursor: 'pointer', color: '#64748b', display: 'grid', placeItems: 'center' }}>
            <X size={15} />
          </button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
          {/* Form */}
          <div style={{ background: '#f8fafc', borderRadius: 10, padding: 16, marginBottom: 20, border: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 12 }}>
              {editId ? 'Editar mesa' : 'Nueva mesa'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 1fr', gap: 10, marginBottom: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: '#334155', marginBottom: 4 }}>Nombre</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Mesa 1"
                  style={{ width: '100%', padding: '8px 10px', border: '1.5px solid #e5e7eb', borderRadius: 8, fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: '#334155', marginBottom: 4 }}>Sillas</label>
                <input
                  type="number"
                  value={form.capacity}
                  onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))}
                  placeholder="4"
                  min={1}
                  style={{ width: '100%', padding: '8px 10px', border: '1.5px solid #e5e7eb', borderRadius: 8, fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: '#334155', marginBottom: 4 }}>Zona</label>
                <select
                  value={form.zone}
                  onChange={(e) => setForm((f) => ({ ...f, zone: e.target.value }))}
                  style={{ width: '100%', padding: '8px 10px', border: '1.5px solid #e5e7eb', borderRadius: 8, fontSize: 13, outline: 'none', boxSizing: 'border-box', background: '#fff' }}
                >
                  {ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              {editId && (
                <button onClick={resetForm} style={{ padding: '8px 14px', border: '1.5px solid #e5e7eb', background: '#fff', borderRadius: 7, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: '#334155' }}>
                  Cancelar
                </button>
              )}
              <button
                disabled={saving || !form.name.trim()}
                onClick={handleSave}
                style={{ padding: '8px 18px', border: 'none', background: saving || !form.name.trim() ? '#cbd5e1' : '#10b981', borderRadius: 7, cursor: saving || !form.name.trim() ? 'not-allowed' : 'pointer', fontSize: 12.5, fontWeight: 600, color: '#fff' }}
              >
                {saving ? 'Guardando...' : (editId ? 'Actualizar' : 'Crear mesa')}
              </button>
            </div>
          </div>

          {/* Table list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {tables.map((t) => {
              const cfg = STATUS_CONFIG[t.status]
              return (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 9 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: cfg.dot, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: '#0f172a' }}>{t.name}</div>
                    <div style={{ fontSize: 11.5, color: '#94a3b8' }}>
                      {t.zone ?? '—'}{t.capacity ? ` · ${t.capacity} sillas` : ''}
                    </div>
                  </div>
                  <div style={{ fontSize: 11.5, color: cfg.fg, background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 5, padding: '3px 8px', fontWeight: 600 }}>
                    {cfg.label}
                  </div>
                  <button
                    onClick={() => startEdit(t)}
                    title="Editar mesa"
                    style={{ width: 28, height: 28, border: '1px solid #e5e7eb', background: '#fff', borderRadius: 6, cursor: 'pointer', color: '#64748b', display: 'grid', placeItems: 'center' }}
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    onClick={() => handleDelete(t)}
                    disabled={deletingId === t.id}
                    title="Eliminar mesa"
                    style={{ width: 28, height: 28, border: '1px solid #fecaca', background: '#fef2f2', borderRadius: 6, cursor: deletingId === t.id ? 'not-allowed' : 'pointer', color: '#dc2626', display: 'grid', placeItems: 'center' }}
                  >
                    <Trash size={12} />
                  </button>
                </div>
              )
            })}
            {tables.length === 0 && (
              <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
                Sin mesas configuradas
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Active table side panel ──────────────────────────────────────

function TableSidePanel({
  table,
  order,
  onClose,
  onAddItems,
  onRequestBill,
  onCheckout,
  onRefresh,
}: {
  table: TableRow
  order: ActiveOrder | null
  onClose: () => void
  onAddItems: () => void
  onRequestBill: () => void
  onCheckout: () => void
  onRefresh: () => void
}) {
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null)
  const [sendingToKitchen, setSendingToKitchen] = useState(false)
  const [closingTable, setClosingTable] = useState(false)
  const { restaurant } = useRestaurantConfig()
  const cfg = STATUS_CONFIG[table.status]

  const unsentItems = order?.order_items.filter((i) => !i.sent_to_kitchen) ?? []
  // Cocina por sede + por producto: solo van a cocina los ítems no enviados
  // cuyo producto enruta a cocina, y solo si la sede usa cocina. Default true
  // mientras carga el restaurant (preserva el comportamiento previo).
  const sedeUsesKitchen = restaurant?.uses_kitchen ?? true
  const itemsForKitchen = sedeUsesKitchen
    ? unsentItems.filter((i) => i.products?.routes_to_kitchen)
    : []
  const isEmptyOrder = !!order && order.order_items.length === 0

  // Fix 4 — Cerrar mesa sin consumo: cancela la orden vacía y libera la mesa.
  const handleCloseEmptyTable = async () => {
    if (!order || order.order_items.length > 0) return
    if (!window.confirm(`¿Cerrar ${table.name} sin consumo? Se cancelará la orden vacía y la mesa quedará libre.`)) return
    setClosingTable(true)
    try {
      const { error: orderErr } = await updateOrderStatus(order.id, 'cancelled')
      if (orderErr) throw orderErr
      const { error: tableErr } = await updateTableStatus(table.id, 'free')
      if (tableErr) throw tableErr
      toast.success(`Mesa ${table.name} liberada`)
      onClose()
      onRefresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      toast.error(`Error al cerrar mesa: ${msg}`)
    } finally {
      setClosingTable(false)
    }
  }

  const handleRemoveItem = async (item: OrderItemRow) => {
    if (!order) return
    setDeletingItemId(item.id)
    try {
      // TODO (inventario, pasada aparte): este ítem YA descontó stock al
      // agregarse (addOrderItemsWithExtras descuenta producto/receta/extras al
      // insertar la línea). Al borrarlo aquí NO se devuelve ese stock, así que
      // el inventario queda subestimado por la cantidad del ítem.
      // Pendiente: función SECURITY DEFINER return_stock_for_order_item(p_id)
      // que emita stock_movements('return', +qty) por el producto (simple),
      // sus insumos (composite vía product_components) y los insumos de los
      // extras vinculados, ANTES de borrar la línea — reflejando la lógica de
      // deducción. Caso borde a resolver: receta cambiada entre venta y borrado.
      // Solo aplica a ítems no enviados a cocina (los únicos borrables hoy).
      const { error: rmErr } = await removeOrderItem(item.id)
      if (rmErr) throw rmErr
      const newTotal = Math.max(0, order.total - orderItemLineTotal(item))
      const { error: totalErr } = await updateOrderTotal(order.id, newTotal)
      if (totalErr) throw totalErr
      onRefresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      toast.error(`Error: ${msg}`)
    } finally {
      setDeletingItemId(null)
    }
  }

  const handleSendToKitchen = async () => {
    // Defensa: una sede sin cocina nunca envía comanda (la UI ocultará el botón).
    if (restaurant && !restaurant.uses_kitchen) return
    if (!order || itemsForKitchen.length === 0) return
    setSendingToKitchen(true)
    try {
      const { error } = await markItemsSentToKitchen(itemsForKitchen.map((i) => i.id))
      if (error) throw error
      if (order.status === 'pending') {
        await updateOrderStatus(order.id, 'preparing')
      }
      printComanda({
        restaurantName: restaurant?.name,
        tableName: table.name,
        zone: table.zone,
        waiter: order.waiter_name,
        orderId: order.id,
        items: itemsForKitchen.map((i) => ({
          qty: i.qty,
          name: i.products?.name ?? '—',
          notes: i.notes,
          extras: i.order_item_extras.map((e) => ({ name: e.extras?.name ?? 'Extra', qty: e.qty })),
        })),
      })
      toast.success('Comanda enviada a cocina')
      onRefresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      toast.error(`Error: ${msg}`)
    } finally {
      setSendingToKitchen(false)
    }
  }

  return (
    <div style={{
      width: 380, flexShrink: 0, display: 'flex', flexDirection: 'column',
      background: '#fff', borderLeft: '1px solid #e5e7eb', height: '100%',
    }}>
      {/* Header */}
      <div style={{ padding: '16px 18px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 38, height: 38, borderRadius: 10,
          background: cfg.bg, color: cfg.fg,
          display: 'grid', placeItems: 'center', flexShrink: 0,
          border: `1px solid ${cfg.border}`,
        }}>
          <UtensilsCrossed size={17} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', letterSpacing: -0.3 }}>{table.name}</div>
          <div style={{ fontSize: 11.5, color: '#64748b' }}>
            {cfg.label}
            {table.zone ? ` · ${table.zone}` : ''}
            {order ? ` · ${formatElapsed(order.created_at)}` : ''}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ width: 28, height: 28, border: '1px solid #e5e7eb', background: '#fff', borderRadius: 7, cursor: 'pointer', color: '#64748b', display: 'grid', placeItems: 'center' }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Items list */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {!order ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
            <RefreshCw size={20} style={{ margin: '0 auto 10px', display: 'block', opacity: 0.4 }} />
            Cargando orden...
          </div>
        ) : order.order_items.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
            <UtensilsCrossed size={20} style={{ margin: '0 auto 10px', display: 'block', opacity: 0.4 }} />
            Sin ítems — agrega productos
          </div>
        ) : (
          order.order_items.map((item) => (
            <div key={item.id} data-testid="table-item" style={{
              padding: '12px 18px', borderBottom: '1px solid #f8fafc',
              display: 'flex', alignItems: 'center', gap: 10,
              opacity: item.sent_to_kitchen ? 0.6 : 1,
            }}>
              <div style={{
                width: 28, height: 28, borderRadius: 7,
                background: item.sent_to_kitchen ? '#f0fdf4' : '#f1f5f9',
                display: 'grid', placeItems: 'center',
                fontSize: 12, fontWeight: 700,
                color: item.sent_to_kitchen ? '#16a34a' : '#334155',
                flexShrink: 0, fontFamily: 'monospace',
              }}>
                {item.qty}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.products?.name ?? '—'}
                </div>
                {item.order_item_extras.length > 0 && (
                  <div data-testid="table-item-extras" style={{ marginTop: 2 }}>
                    {item.order_item_extras.map((ex) => (
                      <div key={ex.id} style={{ fontSize: 11, color: '#065f46' }}>
                        + {ex.extras?.name ?? 'Extra'} ×{ex.qty}
                      </div>
                    ))}
                  </div>
                )}
                {item.notes && (
                  <div style={{ fontSize: 11, color: '#854d0e', marginTop: 2 }}>* {item.notes}</div>
                )}
                {item.sent_to_kitchen && (
                  <div style={{ fontSize: 10.5, color: '#16a34a', fontWeight: 600, marginTop: 2, display: 'flex', alignItems: 'center', gap: 3 }}>
                    <Check size={10} strokeWidth={3} /> En cocina
                  </div>
                )}
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', fontFamily: 'monospace', flexShrink: 0 }}>
                {formatCOP(orderItemLineTotal(item))}
              </div>
              <button
                onClick={() => handleRemoveItem(item)}
                disabled={deletingItemId === item.id || item.sent_to_kitchen}
                style={{ width: 24, height: 24, border: 'none', background: 'transparent', cursor: item.sent_to_kitchen ? 'not-allowed' : 'pointer', color: '#dc2626', display: 'grid', placeItems: 'center', opacity: deletingItemId === item.id || item.sent_to_kitchen ? 0.2 : 1 }}
              >
                <X size={13} />
              </button>
            </div>
          ))
        )}
      </div>

      {/* Total */}
      {order && order.order_items.length > 0 && (
        <div style={{ padding: '12px 18px', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: 13, color: '#64748b' }}>Total</span>
          <span style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', fontFamily: 'monospace', letterSpacing: -0.5 }}>
            {formatCOP(order.total)}
          </span>
        </div>
      )}

      {/* Actions */}
      <div style={{ padding: '14px 18px 18px', borderTop: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button
          onClick={onAddItems}
          style={{
            width: '100%', padding: '11px', border: '1.5px solid #e5e7eb', background: '#fff',
            borderRadius: 9, cursor: 'pointer', fontSize: 13.5, fontWeight: 600, color: '#334155',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
          }}
        >
          <Plus size={15} /> Agregar ítems
        </button>

        <div style={{ display: 'flex', gap: 8 }}>
          {sedeUsesKitchen && (
            <button
              disabled={sendingToKitchen || itemsForKitchen.length === 0}
              onClick={handleSendToKitchen}
              style={{
                flex: 1, padding: '10px',
                border: itemsForKitchen.length === 0 ? '1.5px solid #e5e7eb' : '1.5px solid #7c3aed',
                background: itemsForKitchen.length === 0 ? '#f8fafc' : '#f5f3ff',
                borderRadius: 9,
                cursor: sendingToKitchen || itemsForKitchen.length === 0 ? 'not-allowed' : 'pointer',
                fontSize: 12.5, fontWeight: 600,
                color: itemsForKitchen.length === 0 ? '#94a3b8' : '#7c3aed',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                opacity: sendingToKitchen ? 0.6 : 1,
              }}
            >
              <ChefHat size={14} />
              {itemsForKitchen.length > 0 ? `Cocina (${itemsForKitchen.length})` : 'Cocina'}
            </button>
          )}
          {table.status === 'occupied' && (
            <button
              onClick={onRequestBill}
              style={{ flex: 1, padding: '10px', border: '1.5px solid #fde68a', background: '#fef3c7', borderRadius: 9, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: '#854d0e', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            >
              <ReceiptText size={14} /> Pide cuenta
            </button>
          )}
        </div>

        {isEmptyOrder ? (
          <button
            disabled={closingTable}
            onClick={handleCloseEmptyTable}
            style={{
              width: '100%', padding: '14px',
              background: '#fff', border: '1.5px solid #fecaca', borderRadius: 10,
              cursor: closingTable ? 'not-allowed' : 'pointer',
              fontSize: 14, fontWeight: 700, color: '#dc2626',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              opacity: closingTable ? 0.6 : 1,
            }}
          >
            <X size={16} strokeWidth={2.5} /> {closingTable ? 'Cerrando...' : 'Cerrar mesa'}
          </button>
        ) : (
          <button
            disabled={!order}
            onClick={onCheckout}
            style={{
              width: '100%', padding: '14px',
              background: !order ? '#cbd5e1' : '#10b981',
              border: 'none', borderRadius: 10,
              cursor: !order ? 'not-allowed' : 'pointer',
              fontSize: 15, fontWeight: 700, color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              boxShadow: !order ? 'none' : '0 6px 16px rgba(16,185,129,.35)',
            }}
          >
            Cobrar <ChevronRight size={17} strokeWidth={2.5} />
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────

export function TablesPage() {
  const { profile } = useAuth()
  const { tables, activeOrders, loading, refetch } = useTables()

  const [selectedTableId, setSelectedTableId] = useState<string | null>(null)
  const [activeZone, setActiveZone] = useState<string | null>(null)
  const [showOpenModal, setShowOpenModal] = useState(false)
  const [showProductPicker, setShowProductPicker] = useState(false)
  const [showCheckout, setShowCheckout] = useState(false)
  const [showConfig, setShowConfig] = useState(false)
  const [showOpenShift, setShowOpenShift] = useState(false)
  // Orden capturada al abrir el checkout — aislada de actualizaciones Realtime
  // para evitar que el modal se desmonte mientras está en progreso.
  const [checkoutOrder, setCheckoutOrder] = useState<ActiveOrder | null>(null)
  const { refetchSales, isOpen: isShiftOpen } = useCashShift()

  // Cobrar exige turno abierto: si no hay, abre el modal de apertura primero.
  const handleStartCheckout = () => {
    if (!selectedOrder) return
    if (!isShiftOpen) { setShowOpenShift(true); return }
    setCheckoutOrder(selectedOrder)
    setShowCheckout(true)
  }

  const { can } = usePermissions()
  const canManageTables = can('mesas.gestionar')

  const zones = useMemo(
    () => [...new Set(tables.map((t) => t.zone).filter(Boolean))] as string[],
    [tables],
  )

  const filteredTables = useMemo(
    () => (activeZone ? tables.filter((t) => t.zone === activeZone) : tables),
    [tables, activeZone],
  )

  const selectedTable = tables.find((t) => t.id === selectedTableId) ?? null
  const selectedOrder = selectedTableId ? (activeOrders[selectedTableId] ?? null) : null

  // Cierra el panel cuando la mesa queda libre por Realtime (otro dispositivo),
  // pero no mientras el modal de apertura está visible (click intencional sobre mesa libre).
  useEffect(() => {
    if (selectedTable?.status === 'free' && !showOpenModal) {
      setSelectedTableId(null)
    }
  }, [selectedTable?.status, showOpenModal])

  const handleTableClick = (table: TableRow) => {
    if (table.status === 'free') {
      setSelectedTableId(table.id)
      setShowOpenModal(true)
    } else {
      setSelectedTableId(table.id)
    }
  }

  const handleOpened = () => {
    setShowOpenModal(false)
    refetch()
  }

  const handleRequestBill = async () => {
    if (!selectedTableId) return
    const { error } = await updateTableStatus(selectedTableId, 'waiting_bill')
    if (error) { toast.error('Error al actualizar estado'); return }
    toast.success('Estado actualizado a "Pide cuenta"')
    refetch()
  }

  const handleCheckoutComplete = () => {
    setShowCheckout(false)
    setCheckoutOrder(null)
    setSelectedTableId(null)
    refetchSales()
    refetch()
  }

  const handleItemsAdded = () => {
    setShowProductPicker(false)
    refetch()
  }

  const statusCounts = useMemo(() => ({
    total: tables.length,
    free: tables.filter((t) => t.status === 'free').length,
    occupied: tables.filter((t) => t.status === 'occupied' || t.status === 'waiting_bill').length,
  }), [tables])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 text-sm">
        Cargando mesas...
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: '#f8fafc', fontFamily: 'Inter, system-ui, sans-serif', color: '#0f172a' }}>

      {/* ── LEFT: Map ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

        {/* Top bar */}
        <div style={{ padding: '16px 22px 0', background: '#fff', borderBottom: '1px solid #f1f5f9' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', letterSpacing: -0.3 }}>
                Mapa del salón
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <span style={{ fontSize: 11.5, color: '#64748b' }}>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#10b981' }}>{statusCounts.occupied}</span> ocupadas
                </span>
                <span style={{ fontSize: 11.5, color: '#94a3b8' }}>·</span>
                <span style={{ fontSize: 11.5, color: '#64748b' }}>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#0f172a' }}>{statusCounts.free}</span> libres
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={refetch}
                style={{ width: 32, height: 32, border: '1px solid #e5e7eb', background: '#fff', borderRadius: 8, cursor: 'pointer', color: '#64748b', display: 'grid', placeItems: 'center' }}
                title="Actualizar"
              >
                <RefreshCw size={14} />
              </button>
              {canManageTables && (
                <button
                  onClick={() => setShowConfig(true)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '7px 13px', border: '1.5px solid #e5e7eb', background: '#fff',
                    borderRadius: 8, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: '#334155',
                  }}
                >
                  <Settings size={14} /> Configurar
                </button>
              )}
            </div>
          </div>

          {/* Zone tabs */}
          {zones.length > 0 && (
            <div style={{ display: 'flex', gap: 2 }}>
              {[null, ...zones].map((z) => (
                <button
                  key={z ?? '__all__'}
                  onClick={() => setActiveZone(z)}
                  style={{
                    padding: '10px 16px 12px',
                    border: 'none', background: 'transparent',
                    borderBottom: activeZone === z ? '3px solid #10b981' : '3px solid transparent',
                    color: activeZone === z ? '#10b981' : '#64748b',
                    fontWeight: activeZone === z ? 700 : 500, fontSize: 13.5,
                    cursor: 'pointer', whiteSpace: 'nowrap', transition: 'color .12s',
                  }}
                >
                  {z ?? 'Todos'}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Grid */}
        <div style={{ flex: 1, overflow: 'auto', padding: 22 }}>
          {filteredTables.length === 0 ? (
            <div style={{ padding: 60, textAlign: 'center', color: '#94a3b8', fontSize: 13.5 }}>
              <UtensilsCrossed size={32} style={{ margin: '0 auto 14px', display: 'block', opacity: 0.3 }} />
              {canManageTables
                ? 'Sin mesas. Usa "Configurar" para agregar.'
                : 'Sin mesas disponibles.'}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14 }}>
              {filteredTables.map((table) => (
                <TableCard
                  key={table.id}
                  table={table}
                  order={activeOrders[table.id]}
                  selected={selectedTableId === table.id}
                  onClick={() => handleTableClick(table)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── RIGHT: Side panel ── */}
      {selectedTable && !showOpenModal && selectedTable.status !== 'free' && (
        <TableSidePanel
          table={selectedTable}
          order={selectedOrder}
          onClose={() => setSelectedTableId(null)}
          onAddItems={() => setShowProductPicker(true)}
          onRequestBill={handleRequestBill}
          onCheckout={handleStartCheckout}
          onRefresh={refetch}
        />
      )}

      {/* ── Modals ── */}
      {showOpenModal && selectedTable && (
        <OpenTableModal
          table={selectedTable}
          onClose={() => { setShowOpenModal(false); setSelectedTableId(null) }}
          onOpened={handleOpened}
        />
      )}

      {showProductPicker && selectedOrder && (
        <ProductPickerModal
          orderId={selectedOrder.id}
          currentTotal={selectedOrder.total}
          onClose={() => setShowProductPicker(false)}
          onAdded={handleItemsAdded}
        />
      )}

      {showCheckout && selectedTable && checkoutOrder && (
        <TableCheckoutModal
          table={selectedTable}
          order={checkoutOrder}
          onClose={() => { setShowCheckout(false); setCheckoutOrder(null) }}
          onComplete={handleCheckoutComplete}
        />
      )}

      {showConfig && profile && (
        <TableConfigModal
          tables={tables}
          restaurantId={profile.restaurant_id}
          onClose={() => setShowConfig(false)}
          onChanged={() => { refetch(); setShowConfig(false) }}
        />
      )}

      {showOpenShift && (
        <OpenShiftModal
          onClose={() => setShowOpenShift(false)}
          onOpened={() => {
            setShowOpenShift(false)
            if (selectedOrder) { setCheckoutOrder(selectedOrder); setShowCheckout(true) }
          }}
        />
      )}
    </div>
  )
}
