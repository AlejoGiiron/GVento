import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from 'react-hot-toast'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { updateOrderStatus } from '@/lib/supabase-helpers'
import type { Tables } from '@/types/database.types'
import { ChefHat, Check, RefreshCw, UtensilsCrossed, ChevronRight } from 'lucide-react'

type KitchenOrderItem = {
  id: string
  qty: number
  notes: string | null
  sent_to_kitchen: boolean
  products: { id: string; name: string } | null
}

type KitchenOrder = Tables<'orders'> & {
  tables: { id: string; name: string } | null
  order_items: KitchenOrderItem[]
}

const STATUS_CONFIG = {
  pending:   { label: 'Pendiente',  bg: '#fef3c7', border: '#fde68a', fg: '#854d0e', dot: '#f59e0b', next: 'preparing' as const },
  preparing: { label: 'Preparando', bg: '#dbeafe', border: '#bfdbfe', fg: '#1e40af', dot: '#3b82f6', next: 'ready'     as const },
  ready:     { label: 'Lista',      bg: '#ecfdf5', border: '#a7f3d0', fg: '#065f46', dot: '#10b981', next: null              },
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

export function KitchenPage() {
  const { profile } = useAuth()
  const [orders, setOrders] = useState<KitchenOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [advancingId, setAdvancingId] = useState<string | null>(null)
  const channelRef = useRef<RealtimeChannel | null>(null)

  const fetchOrders = useCallback(async () => {
    if (!profile?.restaurant_id) return
    const { data, error } = await supabase
      .from('orders')
      .select('*, tables(id, name), order_items(id, qty, notes, sent_to_kitchen, products(id, name))')
      .eq('restaurant_id', profile.restaurant_id)
      .in('status', ['pending', 'preparing', 'ready'])
      .order('created_at', { ascending: true })
    if (error) {
      toast.error('Error cargando pedidos')
      return
    }
    setOrders((data ?? []) as KitchenOrder[])
    setLoading(false)
  }, [profile?.restaurant_id])

  useEffect(() => {
    fetchOrders()
  }, [fetchOrders])

  useEffect(() => {
    if (!profile?.restaurant_id) return
    const channelName = `kitchen-kds-${Math.random().toString(36).slice(2)}`
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${profile.restaurant_id}` }, fetchOrders)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, fetchOrders)
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setTimeout(fetchOrders, 5000)
      })
    channelRef.current = channel
    return () => {
      channel.unsubscribe()
      supabase.removeChannel(channel)
      channelRef.current = null
    }
  }, [profile?.restaurant_id, fetchOrders])

  const handleAdvance = async (order: KitchenOrder) => {
    const cfg = STATUS_CONFIG[order.status as keyof typeof STATUS_CONFIG]
    if (!cfg?.next) return
    setAdvancingId(order.id)
    try {
      const { error } = await updateOrderStatus(order.id, cfg.next)
      if (error) throw error
      toast.success(cfg.next === 'ready' ? 'Orden marcada como lista' : 'Orden en preparación')
      fetchOrders()
    } catch {
      toast.error('Error al actualizar estado')
    } finally {
      setAdvancingId(null)
    }
  }

  const kitchenOrders = orders.filter((o) => o.order_items.some((i) => i.sent_to_kitchen))

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94a3b8', fontSize: 13 }}>
        Cargando pedidos...
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#f8fafc', fontFamily: 'Inter, system-ui, sans-serif', color: '#0f172a' }}>

      {/* Header */}
      <div style={{ padding: '16px 24px', background: '#fff', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: '#f5f3ff', display: 'grid', placeItems: 'center' }}>
            <ChefHat size={18} color="#7c3aed" />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', letterSpacing: -0.3 }}>Pantalla de Cocina</div>
            <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 1 }}>
              {kitchenOrders.length === 0
                ? 'Sin pedidos activos'
                : `${kitchenOrders.length} pedido${kitchenOrders.length !== 1 ? 's' : ''} en curso`}
            </div>
          </div>
        </div>
        <button
          onClick={fetchOrders}
          style={{ width: 34, height: 34, border: '1px solid #e5e7eb', background: '#fff', borderRadius: 8, cursor: 'pointer', color: '#64748b', display: 'grid', placeItems: 'center' }}
          title="Actualizar"
        >
          <RefreshCw size={15} />
        </button>
      </div>

      {/* Orders */}
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        {kitchenOrders.length === 0 ? (
          <div style={{ padding: 80, textAlign: 'center', color: '#94a3b8' }}>
            <UtensilsCrossed size={36} style={{ margin: '0 auto 14px', display: 'block', opacity: 0.25 }} />
            <div style={{ fontSize: 15, fontWeight: 600, color: '#64748b' }}>Sin pedidos de cocina</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>Los ítems enviados desde las mesas aparecerán aquí</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {kitchenOrders.map((order) => {
              const cfg = STATUS_CONFIG[order.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.pending
              const sentItems = order.order_items.filter((i) => i.sent_to_kitchen)
              const isAdvancing = advancingId === order.id

              return (
                <div key={order.id} style={{
                  background: '#fff', borderRadius: 14,
                  border: `2px solid ${cfg.border}`,
                  overflow: 'hidden',
                  boxShadow: '0 2px 8px rgba(0,0,0,.04)',
                }}>
                  {/* Card header */}
                  <div style={{
                    padding: '12px 16px', background: cfg.bg,
                    borderBottom: `1px solid ${cfg.border}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
                        {order.tables?.name ?? `Orden #${order.id.slice(-6).toUpperCase()}`}
                      </div>
                      <div style={{ fontSize: 11, color: cfg.fg, marginTop: 3, display: 'flex', alignItems: 'center', gap: 5 }}>
                        <div style={{ width: 7, height: 7, borderRadius: '50%', background: cfg.dot }} />
                        {cfg.label} · {formatElapsed(order.created_at)}
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace' }}>
                      #{order.id.slice(-6).toUpperCase()}
                    </div>
                  </div>

                  {/* Items */}
                  <div style={{ padding: '8px 0' }}>
                    {sentItems.map((item) => (
                      <div key={item.id} style={{ padding: '8px 16px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                        <div style={{
                          width: 28, height: 28, borderRadius: 7, background: '#f1f5f9',
                          display: 'grid', placeItems: 'center',
                          fontSize: 13, fontWeight: 700, color: '#334155', flexShrink: 0,
                          fontFamily: 'monospace',
                        }}>
                          {item.qty}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>
                            {item.products?.name ?? '—'}
                          </div>
                          {item.notes && (
                            <div style={{ fontSize: 11, color: '#854d0e', marginTop: 2 }}>
                              * {item.notes}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Action button */}
                  <div style={{ padding: '10px 16px 14px', borderTop: '1px solid #f1f5f9' }}>
                    {cfg.next ? (
                      <button
                        onClick={() => handleAdvance(order)}
                        disabled={isAdvancing}
                        style={{
                          width: '100%', padding: '11px', border: 'none',
                          background: cfg.next === 'ready' ? '#10b981' : '#7c3aed',
                          borderRadius: 9,
                          cursor: isAdvancing ? 'not-allowed' : 'pointer',
                          fontSize: 13.5, fontWeight: 600, color: '#fff',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                          opacity: isAdvancing ? 0.7 : 1,
                          boxShadow: cfg.next === 'ready' ? '0 4px 12px rgba(16,185,129,.3)' : '0 4px 12px rgba(124,58,237,.3)',
                        }}
                      >
                        {cfg.next === 'ready' ? (
                          <><Check size={15} strokeWidth={2.5} /> Marcar lista</>
                        ) : (
                          <><ChevronRight size={15} strokeWidth={2.5} /> En preparación</>
                        )}
                      </button>
                    ) : (
                      <div style={{
                        textAlign: 'center', fontSize: 13, fontWeight: 600,
                        color: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                      }}>
                        <Check size={14} strokeWidth={2.5} /> Lista para entregar
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
