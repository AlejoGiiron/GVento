import { useState } from 'react'
import {
  Truck, Phone, MapPin, Clock, User, X, Check, ChevronRight,
  Pencil, Trash, RefreshCw, Settings, Package,
} from 'lucide-react'
import { toast } from 'react-hot-toast'
import { useAuth } from '@/hooks/useAuth'
import { usePermissions } from '@/hooks/usePermissions'
import {
  useDelivery,
  getDeliveryColumn,
  type DeliveryOrder,
  type CourierRow,
  type DeliveryColumn,
} from '@/hooks/useDelivery'
import { upsertCourier, deleteCourier } from '@/lib/supabase-helpers'
import type { TablesInsert } from '@/types/database.types'

// ─── Helpers ──────────────────────────────────────────────────────

const formatCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n)

function formatElapsed(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'ahora'
  if (mins < 60) return `${mins} min`
  const hrs = Math.floor(mins / 60)
  const rem = mins % 60
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`
}

// ─── Column config ────────────────────────────────────────────────

type ColumnConfig = {
  label: string
  bg: string
  border: string
  fg: string
  dot: string
  headerBg: string
}

const COLUMN_CONFIG: Record<DeliveryColumn, ColumnConfig> = {
  new: {
    label: 'Nuevos',
    bg: '#fffbeb', border: '#fde68a', fg: '#854d0e', dot: '#f59e0b',
    headerBg: '#fef3c7',
  },
  in_transit: {
    label: 'En camino',
    bg: '#fff7ed', border: '#fed7aa', fg: '#c2410c', dot: '#f97316',
    headerBg: '#ffedd5',
  },
  delivered: {
    label: 'Entregados',
    bg: '#f0fdf4', border: '#bbf7d0', fg: '#065f46', dot: '#10b981',
    headerBg: '#dcfce7',
  },
}

const COLUMNS: DeliveryColumn[] = ['new', 'in_transit', 'delivered']

// Umbral de urgencia: pedidos no entregados con más de estos minutos se resaltan.
const URGENT_MINUTES = 30

// Hora absoluta de creación (zona Bogotá).
function formatClock(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('es-CO', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota',
  })
}

function elapsedMinutes(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000)
}

const mapsLink = (address: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`

// ─── Assign courier modal ─────────────────────────────────────────

function AssignCourierModal({
  order,
  couriers,
  onConfirm,
  onClose,
}: {
  order: DeliveryOrder
  couriers: CourierRow[]
  onConfirm: (courierId: string, estimatedMinutes: number | null) => void
  onClose: () => void
}) {
  const [courierId, setCourierId] = useState(order.courier_id ?? '')
  const [estMinutes, setEstMinutes] = useState(
    order.estimated_delivery_minutes ? String(order.estimated_delivery_minutes) : '',
  )
  const [submitting, setSubmitting] = useState(false)

  const handleConfirm = async () => {
    if (!courierId) return
    setSubmitting(true)
    const mins = estMinutes ? parseInt(estMinutes, 10) : null
    await onConfirm(courierId, mins && mins > 0 ? mins : null)
    setSubmitting(false)
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', display: 'grid', placeItems: 'center', zIndex: 50 }}
      onClick={onClose}
    >
      <div
        style={{ background: '#fff', borderRadius: 14, width: 400, maxWidth: '92%', boxShadow: '0 25px 50px -12px rgba(0,0,0,.25)', overflow: 'hidden' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: '18px 22px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Asignar repartidor
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', letterSpacing: -0.3 }}>
              #{order.id.slice(-6).toUpperCase()}
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
          {/* Customer info */}
          {(order.customer_name || order.delivery_address) && (
            <div style={{ background: '#f8fafc', borderRadius: 10, padding: '10px 14px', marginBottom: 18, fontSize: 13, color: '#475569' }}>
              {order.customer_name && (
                <div style={{ fontWeight: 600, color: '#0f172a', marginBottom: 2 }}>{order.customer_name}</div>
              )}
              {order.delivery_address && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                  <MapPin size={12} color="#94a3b8" />
                  {order.delivery_address}
                </div>
              )}
            </div>
          )}

          {/* Courier select */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
              Repartidor *
            </label>
            {couriers.length === 0 ? (
              <div style={{ fontSize: 13, color: '#94a3b8', padding: '10px 14px', border: '1.5px solid #e5e7eb', borderRadius: 9, background: '#f8fafc' }}>
                Sin repartidores activos. Agrégalos en Configuración.
              </div>
            ) : (
              <select
                value={courierId}
                onChange={(e) => setCourierId(e.target.value)}
                style={{ width: '100%', padding: '10px 13px', border: '1.5px solid #e5e7eb', borderRadius: 9, fontSize: 13.5, color: '#0f172a', outline: 'none', boxSizing: 'border-box', background: '#fff' }}
              >
                <option value="">— Selecciona repartidor —</option>
                {couriers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.phone ? ` · ${c.phone}` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Estimated time */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
              Tiempo estimado (minutos)
            </label>
            <input
              type="number"
              min={1}
              max={180}
              value={estMinutes}
              onChange={(e) => setEstMinutes(e.target.value)}
              placeholder="Ej: 30"
              style={{ width: '100%', padding: '10px 13px', border: '1.5px solid #e5e7eb', borderRadius: 9, fontSize: 13.5, outline: 'none', boxSizing: 'border-box' }}
            />
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={onClose}
              style={{ flex: 1, padding: '12px', border: '1.5px solid #e5e7eb', background: '#fff', borderRadius: 9, cursor: 'pointer', fontSize: 13.5, fontWeight: 600, color: '#334155' }}
            >
              Cancelar
            </button>
            <button
              disabled={!courierId || submitting}
              onClick={handleConfirm}
              style={{
                flex: 2, padding: '12px', border: 'none',
                background: !courierId || submitting ? '#cbd5e1' : '#3b82f6',
                borderRadius: 9, cursor: !courierId || submitting ? 'not-allowed' : 'pointer',
                fontSize: 13.5, fontWeight: 600, color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              {submitting ? 'Asignando...' : <><Check size={15} /><span>Aceptar pedido</span></>}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Courier config modal (admin) ─────────────────────────────────

function CourierConfigModal({
  couriers,
  restaurantId,
  onClose,
  onChanged,
}: {
  couriers: CourierRow[]
  restaurantId: string
  onClose: () => void
  onChanged: () => void
}) {
  const [form, setForm] = useState({ name: '', phone: '' })
  const [editId, setEditId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const startEdit = (c: CourierRow) => {
    setEditId(c.id)
    setForm({ name: c.name, phone: c.phone ?? '' })
  }

  const resetForm = () => {
    setEditId(null)
    setForm({ name: '', phone: '' })
  }

  const handleSave = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const payload: TablesInsert<'couriers'> = {
        id: editId ?? undefined,
        restaurant_id: restaurantId,
        name: form.name.trim(),
        phone: form.phone.trim() || null,
      }
      const { error } = await upsertCourier(payload)
      if (error) throw error
      toast.success(editId ? 'Repartidor actualizado' : 'Repartidor creado')
      resetForm()
      onChanged()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      toast.error(`Error: ${msg}`)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (c: CourierRow) => {
    setDeletingId(c.id)
    try {
      const { error } = await deleteCourier(c.id)
      if (error) throw error
      toast.success(`${c.name} desactivado`)
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
        style={{ background: '#fff', borderRadius: 14, width: 480, maxWidth: '94%', maxHeight: '80vh', boxShadow: '0 25px 50px -12px rgba(0,0,0,.25)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>Repartidores</div>
          <button onClick={onClose} style={{ background: '#f1f5f9', border: 'none', width: 30, height: 30, borderRadius: 7, cursor: 'pointer', color: '#64748b', display: 'grid', placeItems: 'center' }}>
            <X size={15} />
          </button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
          {/* Form */}
          <div style={{ background: '#f8fafc', borderRadius: 10, padding: 16, marginBottom: 20, border: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 12 }}>
              {editId ? 'Editar repartidor' : 'Nuevo repartidor'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: '#334155', marginBottom: 4 }}>Nombre *</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Juan López"
                  style={{ width: '100%', padding: '8px 10px', border: '1.5px solid #e5e7eb', borderRadius: 8, fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: '#334155', marginBottom: 4 }}>Teléfono</label>
                <input
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="310 000 0000"
                  style={{ width: '100%', padding: '8px 10px', border: '1.5px solid #e5e7eb', borderRadius: 8, fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                />
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
                {saving ? 'Guardando...' : (editId ? 'Actualizar' : 'Agregar')}
              </button>
            </div>
          </div>

          {/* Courier list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {couriers.map((c) => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 9 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: '#dbeafe', display: 'grid', placeItems: 'center', color: '#3b82f6', flexShrink: 0 }}>
                  <Truck size={15} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: '#0f172a' }}>{c.name}</div>
                  {c.phone && <div style={{ fontSize: 11.5, color: '#94a3b8' }}>{c.phone}</div>}
                </div>
                <button
                  onClick={() => startEdit(c)}
                  style={{ width: 28, height: 28, border: '1px solid #e5e7eb', background: '#fff', borderRadius: 6, cursor: 'pointer', color: '#64748b', display: 'grid', placeItems: 'center' }}
                >
                  <Pencil size={12} />
                </button>
                <button
                  onClick={() => handleDelete(c)}
                  disabled={deletingId === c.id}
                  style={{ width: 28, height: 28, border: '1px solid #fecaca', background: '#fef2f2', borderRadius: 6, cursor: deletingId === c.id ? 'not-allowed' : 'pointer', color: '#dc2626', display: 'grid', placeItems: 'center' }}
                >
                  <Trash size={12} />
                </button>
              </div>
            ))}
            {couriers.length === 0 && (
              <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
                Sin repartidores activos
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Delivery card ────────────────────────────────────────────────

function DeliveryCard({
  order,
  onAssign,
  onAdvance,
  onCancel,
  isAdmin,
}: {
  order: DeliveryOrder
  onAssign: () => void
  onAdvance: () => void
  onCancel: () => void
  isAdmin: boolean
}) {
  const col = getDeliveryColumn(order)
  const cfg = COLUMN_CONFIG[col]

  const mins = elapsedMinutes(order.created_at)
  const urgent = col !== 'delivered' && mins >= URGENT_MINUTES

  // Flujo de 3 pasos: avanzar al siguiente estado.
  const nextLabel: Record<DeliveryColumn, string | null> = {
    new:        'Marcar en camino',
    in_transit: 'Marcar entregado',
    delivered:  null,
  }

  const nextBg: Record<DeliveryColumn, string> = {
    new:        '#f97316',
    in_transit: '#10b981',
    delivered:  '#10b981',
  }

  return (
    <div style={{
      background: '#fff',
      border: urgent ? '1.5px solid #f59e0b' : `1.5px solid ${cfg.border}`,
      borderRadius: 12,
      overflow: 'hidden',
      boxShadow: urgent ? '0 0 0 3px rgba(245,158,11,.18)' : '0 1px 4px rgba(0,0,0,.05)',
    }}>
      {/* Card header */}
      <div style={{
        background: cfg.headerBg,
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Package size={13} color={cfg.fg} />
          <span style={{ fontSize: 12, fontWeight: 700, color: cfg.fg, fontFamily: 'monospace' }}>
            {order.order_number != null ? `Venta #${order.order_number}` : `#${order.id.slice(-6).toUpperCase()}`}
          </span>
          {urgent && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              background: '#f59e0b', color: '#fff', borderRadius: 5,
              padding: '1px 6px', fontSize: 9.5, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: 0.3,
            }}>
              <Clock size={9} /> Urgente
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            fontSize: 11, color: cfg.fg, opacity: 0.85, fontFamily: 'monospace',
          }}>
            <span>{formatClock(order.created_at)}</span>
            <span style={{ opacity: 0.5 }}>·</span>
            <span style={{ fontWeight: 700 }}>{formatElapsed(order.created_at)}</span>
          </div>
          {isAdmin && col !== 'delivered' && (
            <button
              onClick={onCancel}
              title="Cancelar pedido"
              style={{ width: 20, height: 20, border: 'none', background: 'rgba(0,0,0,.08)', borderRadius: 4, cursor: 'pointer', color: cfg.fg, display: 'grid', placeItems: 'center', opacity: 0.7 }}
            >
              <X size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Card body */}
      <div style={{ padding: '12px 14px' }}>
        {/* Customer */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <User size={13} color="#64748b" />
            <span style={{ fontSize: 14.5, fontWeight: 700, color: '#0f172a', letterSpacing: -0.2 }}>
              {order.customer_name || 'Cliente sin nombre'}
            </span>
          </div>
          {order.delivery_address && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 8 }}>
              <MapPin size={12} color="#94a3b8" style={{ marginTop: 2, flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: '#64748b', lineHeight: 1.35 }}>{order.delivery_address}</span>
            </div>
          )}
          {/* Acciones de contacto */}
          {(order.customer_phone || order.delivery_address) && (
            <div style={{ display: 'flex', gap: 6 }}>
              {order.customer_phone && (
                <a
                  href={`tel:${order.customer_phone}`}
                  style={{
                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                    padding: '7px 8px', border: '1px solid #bbf7d0', background: '#f0fdf4',
                    borderRadius: 7, fontSize: 12, fontWeight: 600, color: '#065f46', textDecoration: 'none',
                  }}
                >
                  <Phone size={12} /> {order.customer_phone}
                </a>
              )}
              {order.delivery_address && (
                <a
                  href={mapsLink(order.delivery_address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Abrir en mapas"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                    padding: '7px 12px', border: '1px solid #bfdbfe', background: '#eff6ff',
                    borderRadius: 7, fontSize: 12, fontWeight: 600, color: '#1e40af', textDecoration: 'none',
                    flexShrink: 0,
                  }}
                >
                  <MapPin size={12} /> Mapa
                </a>
              )}
            </div>
          )}
        </div>

        {/* Items */}
        {order.order_items.length > 0 && (
          <div style={{ background: '#f8fafc', borderRadius: 8, padding: '8px 10px', marginBottom: 10 }}>
            {order.order_items.map((item) => (
              <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#334155', marginBottom: 2 }}>
                <span>
                  <span style={{ fontWeight: 700, fontFamily: 'monospace' }}>{item.qty}×</span>
                  {' '}{item.products?.name ?? '—'}
                  {item.notes && <span style={{ color: '#854d0e', fontStyle: 'italic' }}> ({item.notes})</span>}
                </span>
                <span style={{ fontFamily: 'monospace', color: '#64748b' }}>
                  {formatCOP(item.unit_price * item.qty)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Total */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
          <span style={{ fontSize: 11.5, color: '#64748b' }}>Total</span>
          <span style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', fontFamily: 'monospace', letterSpacing: -0.4 }}>
            {formatCOP(order.total)}
          </span>
        </div>

        {/* Courier info */}
        {order.couriers && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: '#eff6ff', borderRadius: 7, padding: '6px 10px', marginBottom: 10,
          }}>
            <Truck size={13} color="#3b82f6" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: '#1e40af' }}>{order.couriers.name}</div>
              {order.couriers.phone && (
                <div style={{ fontSize: 11, color: '#3b82f6' }}>{order.couriers.phone}</div>
              )}
            </div>
            {order.estimated_delivery_minutes && (
              <div style={{ fontSize: 11, fontWeight: 600, color: '#3b82f6', fontFamily: 'monospace', flexShrink: 0 }}>
                ~{order.estimated_delivery_minutes} min
              </div>
            )}
          </div>
        )}

        {/* Notes */}
        {order.notes && (
          <div style={{ fontSize: 11.5, color: '#854d0e', background: '#fef3c7', borderRadius: 6, padding: '5px 8px', marginBottom: 10 }}>
            {order.notes}
          </div>
        )}

        {/* Actions */}
        {col !== 'delivered' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Asignar / reasignar repartidor (sigue funcionando como antes) */}
            <button
              onClick={onAssign}
              style={{
                width: '100%', padding: '9px',
                border: '1.5px solid #e5e7eb', background: '#fff',
                borderRadius: 8, cursor: 'pointer',
                fontSize: 12.5, fontWeight: 600, color: '#334155',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              <Truck size={13} /> {order.couriers ? 'Reasignar repartidor' : 'Asignar repartidor'}
            </button>
            {/* Avanzar de estado (flujo de 3 pasos) */}
            {nextLabel[col] && (
              <button
                onClick={onAdvance}
                style={{
                  width: '100%', padding: '10px',
                  border: 'none',
                  background: nextBg[col],
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontSize: 12.5, fontWeight: 600, color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  boxShadow: col === 'in_transit' ? '0 4px 12px rgba(16,185,129,.3)' : 'none',
                }}
              >
                {nextLabel[col]} <ChevronRight size={13} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Kanban column ────────────────────────────────────────────────

function KanbanColumn({
  column,
  orders,
  onAssign,
  onAdvance,
  onCancel,
  isAdmin,
}: {
  column: DeliveryColumn
  orders: DeliveryOrder[]
  onAssign: (order: DeliveryOrder) => void
  onAdvance: (order: DeliveryOrder) => void
  onCancel: (order: DeliveryOrder) => void
  isAdmin: boolean
}) {
  const cfg = COLUMN_CONFIG[column]

  return (
    <div style={{
      flex: 1,
      minWidth: 0,
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: '#f8fafc',
      borderRadius: 12,
      border: '1px solid #e5e7eb',
      overflow: 'hidden',
    }}>
      {/* Column header (fijo arriba) */}
      <div style={{
        padding: '12px 16px',
        background: cfg.headerBg,
        borderBottom: `1px solid ${cfg.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: cfg.dot }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: cfg.fg }}>
            {cfg.label}
          </span>
        </div>
        {orders.length > 0 && (
          <div style={{
            background: cfg.dot, color: '#fff',
            borderRadius: 100, minWidth: 20, height: 20,
            display: 'grid', placeItems: 'center',
            fontSize: 11, fontWeight: 700, padding: '0 5px',
          }}>
            {orders.length}
          </div>
        )}
      </div>

      {/* Cards (scroll interno) */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {orders.length === 0 ? (
          <div style={{ padding: '24px 12px', textAlign: 'center', color: '#94a3b8' }}>
            <div style={{ fontSize: 22, marginBottom: 6, opacity: 0.4 }}>
              {column === 'delivered' ? '✓' : '—'}
            </div>
            <div style={{ fontSize: 12 }}>Sin pedidos</div>
          </div>
        ) : (
          orders.map((order) => (
            <DeliveryCard
              key={order.id}
              order={order}
              onAssign={() => onAssign(order)}
              onAdvance={() => onAdvance(order)}
              onCancel={() => onCancel(order)}
              isAdmin={isAdmin}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────

export function DeliveryPage() {
  const { profile } = useAuth()
  const {
    grouped,
    couriers,
    loading,
    activeCount,
    newCount,
    updateStatus,
    assignCourier,
    refetch,
    refetchCouriers,
  } = useDelivery()

  const { can } = usePermissions()
  // Quien gestiona delivery: avanza estados y administra repartidores.
  const isAdmin = can('delivery.gestionar')

  // Patrón checkoutOrder: orden capturada al abrir modal, aislada del Realtime
  const [assigningOrder, setAssigningOrder] = useState<DeliveryOrder | null>(null)
  const [showCourierConfig, setShowCourierConfig] = useState(false)

  const ADVANCE_STATUS: Record<DeliveryColumn, DeliveryOrder['status'] | null> = {
    new:        'ready',      // Nuevos → En camino
    in_transit: 'delivered',  // En camino → Entregados
    delivered:  null,
  }

  const handleAdvance = async (order: DeliveryOrder) => {
    const col = getDeliveryColumn(order)
    const nextStatus = ADVANCE_STATUS[col]
    if (!nextStatus) return
    await updateStatus(order.id, nextStatus)
  }

  const handleAssignConfirm = async (courierId: string, estimatedMinutes: number | null) => {
    if (!assigningOrder) return
    const ok = await assignCourier(assigningOrder.id, courierId, estimatedMinutes)
    if (ok) {
      toast.success('Repartidor asignado')
      setAssigningOrder(null)
    }
  }

  const handleCancel = async (order: DeliveryOrder) => {
    if (!window.confirm(`¿Cancelar el pedido #${order.id.slice(-6).toUpperCase()}?`)) return
    await updateStatus(order.id, 'cancelled')
    toast.success('Pedido cancelado')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400 text-sm">
        Cargando delivery...
      </div>
    )
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      fontFamily: 'Inter, system-ui, sans-serif', color: '#0f172a',
      background: '#f8fafc',
    }}>

      {/* ── Top bar ── */}
      <div style={{
        padding: '14px 22px',
        background: '#fff',
        borderBottom: '1px solid #e5e7eb',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', letterSpacing: -0.3 }}>
            Delivery
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            {newCount > 0 && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 5,
                background: '#fef3c7', border: '1px solid #fde68a',
                borderRadius: 7, padding: '4px 10px',
                fontSize: 11.5, fontWeight: 600, color: '#854d0e',
              }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b' }} />
                {newCount} {newCount === 1 ? 'nuevo' : 'nuevos'}
              </div>
            )}
            <div style={{ fontSize: 12, color: '#64748b' }}>
              <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#0f172a' }}>{activeCount}</span> activos
            </div>
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
          {isAdmin && (
            <button
              onClick={() => setShowCourierConfig(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 13px', border: '1.5px solid #e5e7eb', background: '#fff',
                borderRadius: 8, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: '#334155',
              }}
            >
              <Settings size={14} /> Repartidores
            </button>
          )}
        </div>
      </div>

      {/* ── Kanban (3 columnas, sin scroll horizontal de página) ── */}
      <div style={{
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        padding: '18px 20px',
        display: 'flex',
        gap: 14,
      }}>
        {COLUMNS.map((col) => (
          <KanbanColumn
            key={col}
            column={col}
            orders={grouped[col]}
            onAssign={(order) => setAssigningOrder(order)}
            onAdvance={handleAdvance}
            onCancel={handleCancel}
            isAdmin={isAdmin}
          />
        ))}
      </div>

      {/* ── Modals ── */}
      {assigningOrder && (
        <AssignCourierModal
          order={assigningOrder}
          couriers={couriers}
          onConfirm={handleAssignConfirm}
          onClose={() => setAssigningOrder(null)}
        />
      )}

      {showCourierConfig && profile && (
        <CourierConfigModal
          couriers={couriers}
          restaurantId={profile.restaurant_id}
          onClose={() => setShowCourierConfig(false)}
          onChanged={() => {
            refetchCouriers()
            setShowCourierConfig(false)
          }}
        />
      )}
    </div>
  )
}
