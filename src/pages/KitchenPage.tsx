import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from 'react-hot-toast'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { updateOrderStatus } from '@/lib/supabase-helpers'
import type { Tables } from '@/types/database.types'
import {
  ChefHat, Check, RefreshCw, UtensilsCrossed,
  ChevronRight, LogOut,
} from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

type KDSOrderItem = {
  id: string
  qty: number
  notes: string | null
  sent_to_kitchen: boolean
  products: { id: string; name: string } | null
}

type KDSOrder = Tables<'orders'> & {
  tables: { id: string; name: string } | null
  order_items: KDSOrderItem[]
}

type KDSFilter = 'todas' | 'pendientes' | 'preparando' | 'listos'
type KDSPageState = 'setup' | 'loading' | 'pin' | 'board'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getElapsedMins(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000)
}

function formatElapsed(dateStr: string): string {
  const mins = getElapsedMins(dateStr)
  if (mins < 1) return 'ahora'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  const rem = mins % 60
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`
}

function getSemaphore(mins: number): { color: string; glow: string } {
  if (mins < 10) return { color: '#10b981', glow: 'rgba(16,185,129,.35)' }
  if (mins < 20) return { color: '#f59e0b', glow: 'rgba(245,158,11,.35)' }
  return { color: '#ef4444', glow: 'rgba(239,68,68,.35)' }
}

function getOrderLabel(order: KDSOrder): string {
  if (order.tables?.name) return order.tables.name
  if (order.type === 'takeaway') return 'Para llevar'
  if (order.type === 'delivery') {
    return order.customer_name ? `Delivery · ${order.customer_name}` : 'Delivery'
  }
  return `#${order.id.slice(-6).toUpperCase()}`
}

function getTypeBadge(type: KDSOrder['type']): { label: string; bg: string; fg: string } {
  switch (type) {
    case 'dine_in':  return { label: 'Mesa',        bg: '#ecfdf5', fg: '#065f46' }
    case 'takeaway': return { label: 'Para llevar',  bg: '#fef3c7', fg: '#854d0e' }
    case 'delivery': return { label: 'Delivery',     bg: '#dbeafe', fg: '#1e40af' }
  }
}

// ─── Web Audio alert (triple beep) ───────────────────────────────────────────

function playNewOrderAlert() {
  try {
    const ctx = new AudioContext()
    ;[0, 0.18, 0.36].forEach((t) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = 'sine'
      osc.frequency.setValueAtTime(880, ctx.currentTime + t)
      gain.gain.setValueAtTime(0.25, ctx.currentTime + t)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.14)
      osc.start(ctx.currentTime + t)
      osc.stop(ctx.currentTime + t + 0.14)
    })
  } catch { /* AudioContext blocked (needs user gesture first) */ }
}

// ─── SetupScreen ─────────────────────────────────────────────────────────────

function SetupScreen({ onSetup }: { onSetup: (rid: string) => void }) {
  const [rid, setRid] = useState('')

  return (
    <div style={{
      minHeight: '100vh', background: '#0f172a',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      <div style={{
        background: '#1e293b', borderRadius: 16, padding: '40px 36px',
        width: 420, border: '1px solid #334155',
        boxShadow: '0 25px 50px rgba(0,0,0,.5)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12,
            background: 'rgba(16,185,129,.12)', border: '1px solid rgba(16,185,129,.22)',
            display: 'grid', placeItems: 'center',
          }}>
            <ChefHat size={22} color="#10b981" />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#f8fafc' }}>Cocina KDS</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>Configuración inicial</div>
          </div>
        </div>

        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 8 }}>
          ID del restaurante
        </label>
        <input
          value={rid}
          onChange={(e) => setRid(e.target.value.trim())}
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          style={{
            width: '100%', padding: '11px 13px', background: '#0f172a',
            border: '1.5px solid #334155', borderRadius: 10,
            color: '#f8fafc', fontSize: 13, fontFamily: 'monospace',
            outline: 'none', boxSizing: 'border-box', marginBottom: 6,
          }}
        />
        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 24 }}>
          Disponible en la configuración del restaurante
        </div>

        <button
          onClick={() => {
            if (rid) {
              localStorage.setItem('kds_restaurant_id', rid)
              onSetup(rid)
            }
          }}
          disabled={!rid}
          style={{
            width: '100%', padding: 13, border: 'none',
            background: rid ? '#10b981' : '#334155',
            borderRadius: 10, cursor: rid ? 'pointer' : 'not-allowed',
            fontSize: 14, fontWeight: 700, color: '#fff',
            boxShadow: rid ? '0 6px 16px rgba(16,185,129,.35)' : 'none',
            transition: 'all .15s',
          }}
        >
          Continuar
        </button>
      </div>
    </div>
  )
}

// ─── PinScreen ───────────────────────────────────────────────────────────────

function PinScreen({ pin, onAuthenticated }: { pin: string; onAuthenticated: () => void }) {
  const [digits, setDigits] = useState('')
  const [error, setError] = useState(false)
  const [shake, setShake] = useState(false)

  useEffect(() => {
    if (digits.length !== 4) return
    if (digits === pin) {
      sessionStorage.setItem('kds_auth', '1')
      onAuthenticated()
    } else {
      setShake(true)
      setError(true)
      setTimeout(() => { setShake(false); setDigits(''); setError(false) }, 600)
    }
  }, [digits, pin, onAuthenticated])

  const addDigit = (d: string) => {
    if (digits.length < 4 && !shake) setDigits((p) => p + d)
  }
  const removeDigit = () => {
    if (!shake) setDigits((p) => p.slice(0, -1))
  }

  const numpadKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '←']

  return (
    <div style={{
      minHeight: '100vh', background: '#0f172a',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      <div style={{
        background: '#1e293b', borderRadius: 20, padding: '44px 40px',
        width: 360, textAlign: 'center', border: '1px solid #334155',
        boxShadow: '0 25px 50px rgba(0,0,0,.5)',
        transform: shake ? 'translateX(8px)' : 'none',
        transition: shake ? 'none' : 'transform .1s',
      }}>
        <div style={{
          width: 52, height: 52, borderRadius: 14,
          background: 'rgba(16,185,129,.12)', border: '1px solid rgba(16,185,129,.22)',
          display: 'grid', placeItems: 'center', margin: '0 auto 20px',
        }}>
          <ChefHat size={24} color="#10b981" />
        </div>

        <div style={{ fontSize: 18, fontWeight: 700, color: '#f8fafc', marginBottom: 6 }}>
          Cocina KDS
        </div>
        <div style={{ fontSize: 13, color: '#64748b', marginBottom: 32 }}>
          Ingresa el PIN de acceso
        </div>

        {/* PIN dots */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 14, marginBottom: 36 }}>
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              style={{
                width: 16, height: 16, borderRadius: '50%',
                background: digits.length > i
                  ? (error ? '#ef4444' : '#10b981')
                  : '#334155',
                boxShadow: digits.length > i && !error
                  ? '0 0 0 4px rgba(16,185,129,.15)' : 'none',
                transition: 'background .15s, box-shadow .15s',
              }}
            />
          ))}
        </div>

        {/* Numpad */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {numpadKeys.map((key, idx) => {
            if (key === '') return <div key={idx} />
            const isBack = key === '←'
            return (
              <button
                key={idx}
                onClick={() => isBack ? removeDigit() : addDigit(key)}
                style={{
                  height: 60, borderRadius: 12,
                  background: isBack ? '#334155' : '#0f172a',
                  border: '1.5px solid #334155',
                  color: '#f8fafc', fontSize: isBack ? 18 : 22,
                  fontWeight: 700, cursor: 'pointer',
                  transition: 'background .1s',
                }}
              >
                {key}
              </button>
            )
          })}
        </div>

        {error && (
          <div style={{ fontSize: 12, color: '#ef4444', marginTop: 16, fontWeight: 600 }}>
            PIN incorrecto
          </div>
        )}
      </div>
    </div>
  )
}

// ─── OrderCard ───────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  pending:   'Nuevo',
  preparing: 'Preparando',
  ready:     'Listo',
}

const NEXT_ACTION: Record<string, { label: string; next: 'preparing' | 'ready'; bg: string; shadow: string }> = {
  pending:   { label: 'En preparación', next: 'preparing', bg: '#7c3aed', shadow: 'rgba(124,58,237,.35)' },
  preparing: { label: 'Marcar listo',   next: 'ready',     bg: '#10b981', shadow: 'rgba(16,185,129,.35)' },
}

function OrderCard({
  order,
  onAdvance,
  advancing,
}: {
  order: KDSOrder
  onAdvance: (order: KDSOrder) => void
  advancing: boolean
}) {
  // Re-render every 30s so elapsed time stays fresh
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  const mins      = getElapsedMins(order.created_at)
  const semaphore = getSemaphore(mins)
  const sentItems = order.order_items.filter((i) => i.sent_to_kitchen)
  const typeBadge = getTypeBadge(order.type)
  const nextAction = NEXT_ACTION[order.status]

  return (
    <div style={{
      background: '#1e293b', borderRadius: 16,
      border: `2px solid ${semaphore.color}`,
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
      boxShadow: `0 0 20px ${semaphore.glow}, 0 4px 16px rgba(0,0,0,.3)`,
    }}>
      {/* Semaphore stripe */}
      <div style={{
        height: 5, background: semaphore.color,
        boxShadow: `0 0 10px ${semaphore.glow}`,
        flexShrink: 0,
      }} />

      {/* Header */}
      <div style={{
        padding: '14px 18px 12px', borderBottom: '1px solid #334155',
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
      }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#f8fafc', letterSpacing: -0.5, lineHeight: 1 }}>
            {getOrderLabel(order)}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 7 }}>
            <span style={{
              padding: '3px 8px', borderRadius: 6,
              background: typeBadge.bg, color: typeBadge.fg,
              fontSize: 11, fontWeight: 600,
            }}>
              {typeBadge.label}
            </span>
            <span style={{
              padding: '3px 8px', borderRadius: 6,
              background: '#0f172a',
              color: order.status === 'pending' ? '#fbbf24' : order.status === 'preparing' ? '#c4b5fd' : '#6ee7b7',
              fontSize: 11, fontWeight: 600,
            }}>
              {STATUS_LABELS[order.status] ?? order.status}
            </span>
          </div>
        </div>

        <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 12 }}>
          <div style={{
            fontSize: 24, fontWeight: 800,
            color: semaphore.color, fontFamily: 'monospace', lineHeight: 1,
          }}>
            {formatElapsed(order.created_at)}
          </div>
          <div style={{ fontSize: 10, color: '#475569', marginTop: 3, fontFamily: 'monospace' }}>
            #{order.id.slice(-6).toUpperCase()}
          </div>
        </div>
      </div>

      {/* Items */}
      <div style={{ flex: 1 }}>
        {sentItems.map((item, idx) => (
          <div
            key={item.id}
            style={{
              padding: '11px 18px',
              display: 'flex', gap: 14, alignItems: 'flex-start',
              borderBottom: idx < sentItems.length - 1 ? '1px solid rgba(51,65,85,.6)' : 'none',
            }}
          >
            <div style={{
              minWidth: 38, height: 38, borderRadius: 9,
              background: '#0f172a', border: '1.5px solid #334155',
              display: 'grid', placeItems: 'center',
              fontSize: 18, fontWeight: 800, color: '#f8fafc',
              fontFamily: 'monospace', flexShrink: 0,
            }}>
              {item.qty}
            </div>
            <div style={{ flex: 1, paddingTop: 2 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', lineHeight: 1.2 }}>
                {item.products?.name ?? '—'}
              </div>
              {item.notes && (
                <div style={{ fontSize: 12, color: '#fca5a5', marginTop: 3, fontWeight: 500 }}>
                  ⚠ {item.notes}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Action */}
      <div style={{ padding: '12px 18px 16px', borderTop: '1px solid #334155', flexShrink: 0 }}>
        {nextAction ? (
          <button
            onClick={() => onAdvance(order)}
            disabled={advancing}
            style={{
              width: '100%', padding: 13, border: 'none', borderRadius: 10,
              background: advancing ? '#334155' : nextAction.bg,
              cursor: advancing ? 'not-allowed' : 'pointer',
              fontSize: 14, fontWeight: 700, color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              boxShadow: advancing ? 'none' : `0 6px 16px ${nextAction.shadow}`,
              transition: 'all .15s',
            }}
          >
            {advancing ? 'Actualizando...' : (
              order.status === 'pending'
                ? <><ChevronRight size={16} strokeWidth={2.5} /> {nextAction.label}</>
                : <><Check size={16} strokeWidth={2.5} /> {nextAction.label}</>
            )}
          </button>
        ) : (
          <div style={{
            textAlign: 'center', padding: 10, borderRadius: 10,
            background: 'rgba(16,185,129,.1)', border: '1px solid rgba(16,185,129,.22)',
            color: '#10b981', fontSize: 14, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            <Check size={16} strokeWidth={2.5} /> Lista para entregar
          </div>
        )}
      </div>
    </div>
  )
}

// ─── KDSBoard ────────────────────────────────────────────────────────────────

function KDSBoard({ restaurantId, onLogout }: { restaurantId: string; onLogout: () => void }) {
  const [orders, setOrders]       = useState<KDSOrder[]>([])
  const [loading, setLoading]     = useState(true)
  const [filter, setFilter]       = useState<KDSFilter>('todas')
  const [advancingId, setAdvancingId] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [, setClockTick]          = useState(0)

  const channelRef      = useRef<RealtimeChannel | null>(null)
  const wakeLockRef     = useRef<WakeLockSentinel | null>(null)
  const firstLoadRef    = useRef(false)
  const prevOrderIdsRef = useRef<Set<string>>(new Set())

  // Screen Wake Lock — keeps tablet screen on in kitchen
  useEffect(() => {
    const acquire = async () => {
      if (!('wakeLock' in navigator)) return
      try {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen')
      } catch { /* device may deny */ }
    }
    acquire()
    const onVisible = () => { if (document.visibilityState === 'visible') acquire() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      wakeLockRef.current?.release()
    }
  }, [])

  // Clock tick every 30s so elapsed timers on cards update
  useEffect(() => {
    const id = setInterval(() => setClockTick((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  const fetchOrders = useCallback(async () => {
    const { data, error } = await supabase
      .from('orders')
      .select('*, tables(id, name), order_items(id, qty, notes, sent_to_kitchen, products(id, name))')
      .eq('restaurant_id', restaurantId)
      .in('status', ['pending', 'preparing', 'ready'])
      .order('created_at', { ascending: true })

    if (error) { toast.error('Error cargando pedidos'); return }

    const all = (data ?? []) as KDSOrder[]
    const kitchen = all.filter((o) => o.order_items.some((i) => i.sent_to_kitchen))
    const newIds  = new Set(kitchen.map((o) => o.id))

    // Play alert only after first load, and only for genuinely new orders
    if (firstLoadRef.current) {
      for (const id of newIds) {
        if (!prevOrderIdsRef.current.has(id)) {
          playNewOrderAlert()
          break
        }
      }
    }
    firstLoadRef.current    = true
    prevOrderIdsRef.current = newIds

    setOrders(all)
    setLoading(false)
  }, [restaurantId])

  useEffect(() => { fetchOrders() }, [fetchOrders])

  // Realtime subscription with unique channel name (avoids ghost subscriptions)
  useEffect(() => {
    const name = `kds-standalone:${restaurantId}:${Math.random().toString(36).slice(2)}`
    const ch = supabase
      .channel(name)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'orders',
        filter: `restaurant_id=eq.${restaurantId}`,
      }, fetchOrders)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'order_items',
      }, fetchOrders)
      .subscribe((status) => {
        setConnected(status === 'SUBSCRIBED')
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setTimeout(fetchOrders, 5_000)
      })
    channelRef.current = ch
    return () => { ch.unsubscribe(); supabase.removeChannel(ch); channelRef.current = null }
  }, [restaurantId, fetchOrders])

  const handleAdvance = async (order: KDSOrder) => {
    // Capture order state before Realtime can modify it (checkoutOrder pattern)
    const capturedId     = order.id
    const capturedStatus = order.status
    const nextStatus = capturedStatus === 'pending' ? 'preparing' : 'ready'
    setAdvancingId(capturedId)
    try {
      const { error } = await updateOrderStatus(capturedId, nextStatus)
      if (error) throw error
      await fetchOrders()
    } catch {
      toast.error('Error al actualizar estado')
    } finally {
      setAdvancingId(null)
    }
  }

  const kitchenOrders = orders.filter((o) => o.order_items.some((i) => i.sent_to_kitchen))

  const filtered =
    filter === 'todas'      ? kitchenOrders :
    filter === 'pendientes' ? kitchenOrders.filter((o) => o.status === 'pending') :
    filter === 'preparando' ? kitchenOrders.filter((o) => o.status === 'preparing') :
                              kitchenOrders.filter((o) => o.status === 'ready')

  const counts = {
    todas:      kitchenOrders.length,
    pendientes: kitchenOrders.filter((o) => o.status === 'pending').length,
    preparando: kitchenOrders.filter((o) => o.status === 'preparing').length,
    listos:     kitchenOrders.filter((o) => o.status === 'ready').length,
  }

  const filterDefs: { key: KDSFilter; label: string; activeColor: string }[] = [
    { key: 'todas',      label: 'Todos',        activeColor: '#f8fafc' },
    { key: 'pendientes', label: 'Nuevos',        activeColor: '#fbbf24' },
    { key: 'preparando', label: 'Preparando',    activeColor: '#c4b5fd' },
    { key: 'listos',     label: 'Listos',        activeColor: '#6ee7b7' },
  ]

  const nowTime = new Date().toLocaleTimeString('es-CO', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota',
  })

  return (
    <div style={{
      minHeight: '100vh', background: '#0f172a',
      display: 'flex', flexDirection: 'column',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div style={{
        height: 64, flexShrink: 0, padding: '0 20px',
        background: '#1e293b', borderBottom: '1px solid #334155',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 16,
      }}>
        {/* Brand + filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 11, flexShrink: 0,
            background: 'rgba(16,185,129,.12)', border: '1px solid rgba(16,185,129,.22)',
            display: 'grid', placeItems: 'center',
          }}>
            <ChefHat size={20} color="#10b981" />
          </div>
          <div style={{ marginRight: 4 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#f8fafc', letterSpacing: -0.3 }}>
              Cocina KDS
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
              <div style={{
                width: 6, height: 6, borderRadius: '50%',
                background: connected ? '#10b981' : '#475569',
                boxShadow: connected ? '0 0 0 3px rgba(16,185,129,.2)' : 'none',
              }} />
              <span style={{ fontSize: 11, color: connected ? '#10b981' : '#475569', fontWeight: 500 }}>
                {connected ? 'En línea' : 'Conectando…'}
              </span>
            </div>
          </div>

          {/* Status filter tabs */}
          <div style={{
            display: 'flex', gap: 3,
            background: '#0f172a', borderRadius: 10, padding: 4,
          }}>
            {filterDefs.map(({ key, label, activeColor }) => {
              const count  = counts[key]
              const active = filter === key
              return (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  style={{
                    padding: '7px 14px', borderRadius: 7, border: 'none', cursor: 'pointer',
                    background: active ? '#1e293b' : 'transparent',
                    color: active ? activeColor : '#64748b',
                    fontSize: 13, fontWeight: active ? 700 : 500,
                    display: 'flex', alignItems: 'center', gap: 6,
                    transition: 'all .15s',
                  }}
                >
                  {label}
                  {count > 0 && (
                    <span style={{
                      minWidth: 18, height: 18, borderRadius: 9, padding: '0 5px',
                      background: active ? activeColor : '#334155',
                      color: active ? '#0f172a' : '#94a3b8',
                      fontSize: 10, fontWeight: 700,
                      display: 'grid', placeItems: 'center',
                    }}>
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Clock + actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#64748b', fontFamily: 'monospace' }}>
            {nowTime}
          </div>
          <button
            onClick={fetchOrders}
            title="Actualizar"
            style={{
              width: 38, height: 38, borderRadius: 9, border: '1px solid #334155',
              background: '#0f172a', cursor: 'pointer', color: '#64748b',
              display: 'grid', placeItems: 'center',
            }}
          >
            <RefreshCw size={15} />
          </button>
          <button
            onClick={onLogout}
            title="Salir"
            style={{
              width: 38, height: 38, borderRadius: 9, border: '1px solid #334155',
              background: '#0f172a', cursor: 'pointer', color: '#64748b',
              display: 'grid', placeItems: 'center',
            }}
          >
            <LogOut size={15} />
          </button>
        </div>
      </div>

      {/* ── Order grid ──────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        {loading ? (
          <div style={{ padding: 80, textAlign: 'center', color: '#64748b', fontSize: 14 }}>
            Cargando pedidos…
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 80, textAlign: 'center' }}>
            <UtensilsCrossed
              size={40}
              style={{ margin: '0 auto 16px', display: 'block', color: '#334155' }}
            />
            <div style={{ fontSize: 16, fontWeight: 600, color: '#475569' }}>
              {filter === 'todas' ? 'Sin pedidos activos' : `Sin pedidos ${filter}`}
            </div>
            <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
              Los ítems enviados desde las mesas aparecerán aquí
            </div>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
            gap: 16,
            alignItems: 'start',
          }}>
            {filtered.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                onAdvance={handleAdvance}
                advancing={advancingId === order.id}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main export ─────────────────────────────────────────────────────────────

export function KitchenPage() {
  // Always start in 'loading' — initialization resolves the correct state
  const [pageState, setPageState] = useState<KDSPageState>('loading')
  const [restaurantId, setRestaurantId] = useState<string | null>(null)
  const [kitchenPin, setKitchenPin] = useState<string | null>(null)

  // Fetch restaurant config and decide: pin screen or board
  const checkPinAndProceed = useCallback(async (rid: string) => {
    const { data } = await supabase
      .from('restaurants')
      .select('config')
      .eq('id', rid)
      .single()
    const pin = (data?.config as Record<string, unknown> | null)?.kitchen_pin
    if (pin && typeof pin === 'string' && /^\d{4}$/.test(pin)) {
      setKitchenPin(pin)
      setPageState('pin')
    } else {
      setPageState('board')
    }
  }, [])

  // Initialization: localStorage → sesión Supabase activa → pantalla de setup
  useEffect(() => {
    ;(async () => {
      // 1. Restaurant ID ya guardado localmente
      let rid = localStorage.getItem('kds_restaurant_id')

      // 2. Sesión de esta pestaña ya autenticada → ir directo al board
      if (rid && sessionStorage.getItem('kds_auth') === '1') {
        setRestaurantId(rid)
        setPageState('board')
        return
      }

      // 3. Sin restaurant ID local → detectar sesión Supabase activa (admin logueado)
      if (!rid) {
        const { data: { session } } = await supabase.auth.getSession()
        if (session?.user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('restaurant_id')
            .eq('id', session.user.id)
            .single()
          if (profile?.restaurant_id) {
            rid = profile.restaurant_id
            localStorage.setItem('kds_restaurant_id', rid)
          }
        }
      }

      // 4. Sin ningún restaurant ID → mostrar setup manual
      if (!rid) {
        setPageState('setup')
        return
      }

      setRestaurantId(rid)
      await checkPinAndProceed(rid)
    })()
  }, [checkPinAndProceed])

  // Llamado desde SetupScreen cuando el admin ingresa el UUID manualmente
  const handleSetup = (rid: string) => {
    setRestaurantId(rid)
    checkPinAndProceed(rid)
  }

  const handleAuthenticated = () => setPageState('board')

  const handleLogout = () => {
    sessionStorage.removeItem('kds_auth')
    setPageState(kitchenPin ? 'pin' : 'board')
  }

  if (pageState === 'setup') {
    return <SetupScreen onSetup={handleSetup} />
  }

  if (pageState === 'loading') {
    return (
      <div style={{
        minHeight: '100vh', background: '#0f172a',
        display: 'grid', placeItems: 'center',
        color: '#64748b', fontSize: 14, fontFamily: 'Inter, system-ui, sans-serif',
      }}>
        Cargando configuración…
      </div>
    )
  }

  if (pageState === 'pin' && kitchenPin) {
    return <PinScreen pin={kitchenPin} onAuthenticated={handleAuthenticated} />
  }

  return <KDSBoard restaurantId={restaurantId!} onLogout={handleLogout} />
}
