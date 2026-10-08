import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import { Search, Minus, Plus, X, Banknote, Smartphone, CreditCard, Building2, Check, ChevronLeft, Star } from 'lucide-react'
import { useProducts } from '@/hooks/useProducts'
import { useCategories } from '@/hooks/useCategories'
import { useProductsWithExtras } from '@/hooks/useProductsWithExtras'
import { useRestaurantConfig } from '@/hooks/useRestaurantConfig'
import { useCashShift } from '@/hooks/useCashShift'
import { useSaleCheckout } from '@/hooks/useSaleCheckout'
import { useMasVendidos } from '@/hooks/usePosMovil'
import { useTecladoTapa } from '@/hooks/useDispositivoMovil'
import { useCartStore, cartItemTotal, type ProductWithCategory } from '@/stores/cartStore'
import { ExtrasMovil } from '@/components/movil/ExtrasMovil'
import { CapaMovil } from '@/components/movil/CapaMovil'
import { useShellMovil } from '@/components/movil/contextoShell'
import { M, botonGrande, formatCOP } from '@/components/movil/estilo'
import { leerPosMovil } from '@/lib/posMovil'
import { cashQuickAmounts } from '@/lib/cashRounding'
import { mensajeDeError } from '@/lib/errorMessage'
import { captureError } from '@/lib/sentry'
import type { Enums } from '@/types/database.types'

type Metodo = Enums<'payment_method'>
type Paso = 'carrito' | 'pagar' | 'exito'

const NOMBRE_METODO: Record<Metodo, string> = { cash: 'Efectivo', nequi: 'Nequi', card: 'Tarjeta', transfer: 'Transferencia' }

export function VenderMovil() {
  const { data: productos = [], isLoading } = useProducts()
  const { data: categorias = [] } = useCategories()
  const { requiereConfig } = useProductsWithExtras()
  const { config } = useRestaurantConfig()
  const posMovil = leerPosMovil(config.pos_movil)
  const { data: masVendidos = [] } = useMasVendidos(posMovil.mas_vendidos.dias)

  const items = useCartStore((s) => s.items)
  const add = useCartStore((s) => s.add)
  const addItem = useCartStore((s) => s.addItem)

  const [busqueda, setBusqueda] = useState('')
  const [categoria, setCategoria] = useState<string | null>(null)
  const [configurando, setConfigurando] = useState<ProductWithCategory | null>(null)
  const [hoja, setHoja] = useState<Paso | null>(null)
  const { slotAccion } = useShellMovil()

  const porId = useMemo(() => new Map(productos.map((p) => [p.id, p])), [productos])

  // Arriba: primero los FIJADOS (en su orden), después los más vendidos que no
  // estén fijados, hasta `cantidad`. Solo productos activos de la sede (porId).
  const destacados = useMemo(() => {
    const ids = [...posMovil.fijados]
    for (const id of masVendidos) {
      if (ids.length >= posMovil.fijados.length + posMovil.mas_vendidos.cantidad) break
      if (!ids.includes(id)) ids.push(id)
    }
    return ids.map((id) => porId.get(id)).filter((p): p is ProductWithCategory => !!p)
  }, [posMovil.fijados, posMovil.mas_vendidos.cantidad, masVendidos, porId])
  const fijados = new Set(posMovil.fijados)

  const catActiva = categoria ?? categorias[0]?.id ?? null
  const lista = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (q) return productos.filter((p) => p.name.toLowerCase().includes(q))
    return productos.filter((p) => p.category_id === catActiva)
  }, [productos, busqueda, catActiva])

  const tocar = (p: ProductWithCategory) => {
    if (requiereConfig(p.id)) { setConfigurando(p); return }
    add(p)
    navigator.vibrate?.(15)
  }

  const cantidad = items.reduce((s, i) => s + i.qty, 0)
  const total = items.reduce((s, i) => s + cartItemTotal(i), 0)

  return (
    <div style={{ padding: 12 }}>
      <label style={{
        display: 'flex', alignItems: 'center', gap: 10, background: M.panel, borderRadius: 12,
        padding: '0 14px', minHeight: 50, border: `1px solid ${M.borde}`,
      }}>
        <Search size={18} color={M.suave} />
        <input
          data-testid="m-buscar"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar producto"
          enterKeyHint="search"
          style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: M.texto, fontSize: 16 }}
        />
        {busqueda && (
          <button type="button" aria-label="Borrar búsqueda" onClick={() => setBusqueda('')} style={{ background: 'none', border: 'none', color: M.suave, padding: 6 }}>
            <X size={18} />
          </button>
        )}
      </label>

      {isLoading && <div style={{ color: M.suave, padding: 24, textAlign: 'center' }}>Cargando productos…</div>}

      {!busqueda && destacados.length > 0 && (
        <section style={{ marginTop: 14 }}>
          <Titulo>Más vendidos</Titulo>
          <div data-testid="m-destacados" style={grilla}>
            {destacados.map((p) => <Tile key={p.id} p={p} fijado={fijados.has(p.id)} onTap={() => tocar(p)} />)}
          </div>
        </section>
      )}

      {!busqueda && (
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', margin: '16px -12px 10px', padding: '0 12px', scrollbarWidth: 'none' }}>
          {categorias.map((c) => (
            <button
              key={c.id}
              type="button"
              data-testid="m-categoria"
              onClick={() => setCategoria(c.id)}
              style={{
                flex: '0 0 auto', minHeight: 42, padding: '0 16px', borderRadius: 999, fontSize: 14, fontWeight: 600,
                border: `1px solid ${c.id === catActiva ? M.verde : M.borde}`,
                background: c.id === catActiva ? 'rgba(16,185,129,.15)' : M.panel,
                color: c.id === catActiva ? '#6ee7b7' : M.texto,
              }}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      <div data-testid="m-productos" style={{ ...grilla, marginTop: busqueda ? 14 : 0 }}>
        {lista.map((p) => <Tile key={p.id} p={p} onTap={() => tocar(p)} />)}
      </div>
      {!isLoading && lista.length === 0 && (
        <div style={{ color: M.suave, padding: 24, textAlign: 'center' }}>Sin productos</div>
      )}

      {/* "Cobrar" en el lugar del caparazón (en el flujo, sobre la barra inferior):
          nunca fixed dentro del contenido que se desplaza. */}
      {cantidad > 0 && hoja === null && slotAccion && createPortal(
        <button
          type="button"
          data-testid="m-carrito-abrir"
          onClick={() => setHoja('carrito')}
          style={{
            ...botonGrande(M.verde), width: 'calc(100% - 24px)', margin: '8px 12px',
            justifyContent: 'space-between', boxShadow: '0 6px 18px rgba(16,185,129,.30)',
          }}
        >
          <span>Cobrar · {cantidad}</span>
          <span data-testid="m-carrito-total" style={{ fontFamily: 'monospace' }}>{formatCOP(total)}</span>
        </button>,
        slotAccion,
      )}

      {hoja !== null && <CapaMovil><HojaCobro paso={hoja} setPaso={setHoja} /></CapaMovil>}

      {configurando && (
        <CapaMovil>
          <ExtrasMovil
            product={configurando}
            onConfirm={(extras) => { addItem(configurando, extras); setConfigurando(null) }}
            onClose={() => setConfigurando(null)}
          />
        </CapaMovil>
      )}
    </div>
  )
}

// ── Cobro ───────────────────────────────────────────────────────────────────

function HojaCobro({ paso, setPaso }: { paso: Paso; setPaso: (p: Paso | null) => void }) {
  const items = useCartStore((s) => s.items)
  const setQty = useCartStore((s) => s.setQty)
  const clear = useCartStore((s) => s.clear)
  const { isOpen, refetchSales } = useCashShift()
  const { config } = useRestaurantConfig()
  const { cobrar } = useSaleCheckout()
  const queryClient = useQueryClient()
  const tapa = useTecladoTapa()

  const [metodo, setMetodo] = useState<Metodo>('cash')
  const [mas, setMas] = useState(false)
  const [recibido, setRecibido] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [venta, setVenta] = useState<{ numero: number; total: number; metodo: Metodo; yaExistia: boolean; vuelto: number } | null>(null)

  const total = items.reduce((s, i) => s + cartItemTotal(i), 0)
  const recibidoNum = parseInt(recibido.replace(/\D/g, ''), 10) || 0
  const falta = metodo === 'cash' && recibidoNum > 0 && recibidoNum < total

  const elegir = (m: Metodo) => { setMetodo(m); setRecibido(''); setPaso('pagar') }

  const confirmar = async () => {
    if (enviando || falta) return
    setEnviando(true)
    try {
      const r = await cobrar({
        type: 'takeaway',
        total,
        discount_amount: 0,
        discount_type: null,
        discount_kind: 'normal',
        discount_reason: null,
        fiado: false,
        customer_id: null,
        customer_name: null,
        items: items.map((i) => ({
          product_id: i.product.id,
          qty: i.qty,
          unit_price: i.product.price,
          notes: i.note || null,
          extras: i.extras.map((e) => ({ extra_id: e.extra_id, qty: e.qty })),
        })),
        payments: total > 0 ? [{ method: metodo, amount: total }] : [],
      })
      setVenta({ numero: r.order_number, total: r.total, metodo, yaExistia: r.ya_existia, vuelto: recibidoNum > total ? recibidoNum - total : 0 })
      clear()
      refetchSales()
      void queryClient.invalidateQueries({ queryKey: ['mis_ventas'] })
      navigator.vibrate?.([30, 40, 30])
      setPaso('exito')
    } catch (err) {
      toast.error(`No se cobró: ${mensajeDeError(err, 'error desconocido')}`)
      captureError(err, 'cobro', { origen: 'POS móvil', metodo, cantidadItems: items.length })
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div
      data-testid="m-hoja"
      data-paso={paso}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: tapa, zIndex: 50, background: M.fondo, color: M.texto,
        fontFamily: 'Inter, system-ui, sans-serif',
        display: 'flex', flexDirection: 'column', paddingTop: 'env(safe-area-inset-top)',
      }}
    >
      {paso !== 'exito' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: `1px solid ${M.borde}` }}>
          <button
            type="button"
            data-testid="m-hoja-volver"
            aria-label="Volver"
            onClick={() => setPaso(paso === 'pagar' ? 'carrito' : null)}
            style={{ width: 48, height: 48, display: 'grid', placeItems: 'center', background: M.panel, border: 'none', borderRadius: 12, color: M.texto }}
          >
            <ChevronLeft size={24} />
          </button>
          <div style={{ flex: 1, fontSize: 17, fontWeight: 700 }}>
            {paso === 'carrito' ? 'Carrito' : NOMBRE_METODO[metodo]}
          </div>
          <div data-testid="m-total" style={{ fontSize: 22, fontWeight: 800, fontFamily: 'monospace' }}>{formatCOP(total)}</div>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 12 }}>
        {paso === 'carrito' && (
          <>
            {items.map((i, idx) => (
              <div key={i.id} data-testid="m-item" style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: `1px solid ${M.borde}`,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>{i.product.name}</div>
                  {i.extras.length > 0 && (
                    <div style={{ fontSize: 12, color: M.suave }}>{i.extras.map((e) => `${e.name}${e.qty > 1 ? ` ×${e.qty}` : ''}`).join(', ')}</div>
                  )}
                  <div style={{ fontSize: 14, color: M.suave, fontFamily: 'monospace' }}>{formatCOP(cartItemTotal(i))}</div>
                </div>
                <button type="button" aria-label="Quitar uno" data-testid="m-item-menos" onClick={() => setQty(idx, i.qty - 1)} style={botonCantidad}>
                  <Minus size={20} />
                </button>
                <div data-testid="m-item-qty" style={{ width: 28, textAlign: 'center', fontSize: 18, fontWeight: 700 }}>{i.qty}</div>
                <button type="button" aria-label="Agregar uno" data-testid="m-item-mas" onClick={() => setQty(idx, i.qty + 1)} style={botonCantidad}>
                  <Plus size={20} />
                </button>
              </div>
            ))}
            {items.length === 0 && <div style={{ color: M.suave, padding: 24, textAlign: 'center' }}>El carrito está vacío</div>}
          </>
        )}

        {paso === 'pagar' && metodo === 'cash' && (
          <div style={{ display: 'grid', gap: 14 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 14, color: M.suave }}>¿Con cuánto paga? (opcional, para el vuelto)</span>
              <input
                data-testid="m-recibido"
                inputMode="decimal"
                autoComplete="off"
                value={recibido ? formatCOP(recibidoNum) : ''}
                onChange={(e) => setRecibido(e.target.value.replace(/\D/g, ''))}
                placeholder={formatCOP(total)}
                style={{
                  minHeight: 60, borderRadius: 14, border: `2px solid ${falta ? M.rojo : M.borde}`, background: M.panel,
                  color: M.texto, fontSize: 26, fontWeight: 700, padding: '0 16px', fontFamily: 'monospace', outline: 'none',
                }}
              />
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {cashQuickAmounts(total).map((c) => (
                <button
                  key={c.amount}
                  type="button"
                  data-testid="m-monto-rapido"
                  onClick={() => setRecibido(String(c.amount))}
                  style={{ minHeight: 48, padding: '0 14px', borderRadius: 12, border: `1px solid ${M.borde}`, background: M.panel, color: M.texto, fontSize: 15, fontWeight: 600 }}
                >
                  {c.exact ? 'Exacto' : formatCOP(c.amount)}
                </button>
              ))}
            </div>
            {recibidoNum > 0 && (
              <div data-testid="m-vuelto" style={{ fontSize: 20, fontWeight: 700, color: falta ? '#fca5a5' : '#6ee7b7' }}>
                {falta ? `Faltan ${formatCOP(total - recibidoNum)}` : `Vuelto: ${formatCOP(recibidoNum - total)}`}
              </div>
            )}
          </div>
        )}

        {paso === 'pagar' && metodo === 'nequi' && (
          <div style={{ display: 'grid', gap: 12, justifyItems: 'center', textAlign: 'center' }}>
            {config.nequi_qr_url ? (
              <img
                data-testid="m-nequi-qr"
                src={config.nequi_qr_url}
                alt="QR de Nequi del local"
                style={{ width: '100%', maxWidth: 420, aspectRatio: '1', objectFit: 'contain', background: '#fff', borderRadius: 16, padding: 12 }}
              />
            ) : (
              <div data-testid="m-nequi-sin-qr" style={{ color: M.suave, padding: 24 }}>
                No hay QR de Nequi configurado. Cobrá al número del local y confirmá cuando llegue el pago.
              </div>
            )}
            <div style={{ fontSize: 34, fontWeight: 800, fontFamily: 'monospace' }}>{formatCOP(total)}</div>
          </div>
        )}

        {paso === 'pagar' && (metodo === 'card' || metodo === 'transfer') && (
          <div style={{ color: M.suave, padding: 24, textAlign: 'center', fontSize: 16 }}>
            Cobrá {formatCOP(total)} con {NOMBRE_METODO[metodo].toLowerCase()} y confirmá.
          </div>
        )}

        {paso === 'exito' && venta && (
          <div data-testid="m-exito" style={{ display: 'grid', gap: 14, justifyItems: 'center', textAlign: 'center', paddingTop: 48 }}>
            <div data-testid="m-exito-icono" style={{ width: 88, height: 88, borderRadius: '50%', background: 'rgba(16,185,129,.18)', display: 'grid', placeItems: 'center', color: M.verde }}>
              <Check size={48} strokeWidth={3} />
            </div>
            <div data-testid="m-exito-numero" style={{ fontSize: 26, fontWeight: 800 }}>Venta #{venta.numero}</div>
            <div style={{ fontSize: 18, color: M.suave }}>{formatCOP(venta.total)} · {NOMBRE_METODO[venta.metodo]}</div>
            {venta.vuelto > 0 && (
              <div data-testid="m-exito-vuelto" style={{ fontSize: 24, fontWeight: 800, color: '#6ee7b7' }}>Vuelto: {formatCOP(venta.vuelto)}</div>
            )}
            {venta.yaExistia && (
              <div data-testid="m-ya-existia" style={{ fontSize: 14, color: '#93c5fd', background: 'rgba(59,130,246,.12)', padding: '10px 14px', borderRadius: 10 }}>
                Esta venta ya se había registrado en el intento anterior. No se cobró dos veces.
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ padding: 12, paddingBottom: tapa > 0 ? 12 : 'calc(env(safe-area-inset-bottom) + 12px)', borderTop: `1px solid ${M.borde}`, display: 'grid', gap: 10 }}>
        {paso !== 'exito' && !isOpen && (
          <div data-testid="m-sin-turno" style={{ color: '#fca5a5', fontSize: 14, textAlign: 'center' }}>
            No hay turno abierto. Pedile al encargado que abra la caja para poder cobrar.
          </div>
        )}

        {paso === 'carrito' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <button type="button" data-testid="m-pagar-cash" disabled={!isOpen || items.length === 0} onClick={() => elegir('cash')} style={{ ...botonGrande(M.verde), minHeight: 72, opacity: !isOpen || items.length === 0 ? 0.4 : 1 }}>
                <Banknote size={24} /> Efectivo
              </button>
              <button type="button" data-testid="m-pagar-nequi" disabled={!isOpen || items.length === 0} onClick={() => elegir('nequi')} style={{ ...botonGrande(M.nequi), minHeight: 72, opacity: !isOpen || items.length === 0 ? 0.4 : 1 }}>
                <Smartphone size={24} /> Nequi
              </button>
            </div>
            {mas ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <button type="button" data-testid="m-pagar-card" disabled={!isOpen || items.length === 0} onClick={() => elegir('card')} style={{ ...botonGrande(M.panel), fontSize: 16, opacity: !isOpen ? 0.4 : 1 }}>
                  <CreditCard size={20} /> Tarjeta
                </button>
                <button type="button" data-testid="m-pagar-transfer" disabled={!isOpen || items.length === 0} onClick={() => elegir('transfer')} style={{ ...botonGrande(M.panel), fontSize: 16, opacity: !isOpen ? 0.4 : 1 }}>
                  <Building2 size={20} /> Transferencia
                </button>
              </div>
            ) : (
              <button type="button" data-testid="m-pagar-mas" onClick={() => setMas(true)} style={{ minHeight: 48, background: 'transparent', border: `1px solid ${M.borde}`, borderRadius: 12, color: M.suave, fontSize: 15, fontWeight: 600 }}>
                Otros métodos
              </button>
            )}
          </>
        )}

        {paso === 'pagar' && (
          <button
            type="button"
            data-testid="m-confirmar"
            disabled={enviando || falta || !isOpen}
            onClick={() => void confirmar()}
            style={{ ...botonGrande(metodo === 'nequi' ? M.nequi : M.verde), minHeight: 68, fontSize: 20, opacity: enviando || falta || !isOpen ? 0.5 : 1 }}
          >
            {enviando ? 'Cobrando…' : metodo === 'nequi' ? 'Ya pagó — registrar' : `Cobrar ${formatCOP(total)}`}
          </button>
        )}

        {paso === 'exito' && (
          <button type="button" data-testid="m-nueva-venta" onClick={() => { setVenta(null); setPaso(null) }} style={{ ...botonGrande(M.verde), minHeight: 68, fontSize: 20 }}>
            Nueva venta
          </button>
        )}
      </div>
    </div>
  )
}

// ── Piezas ──────────────────────────────────────────────────────────────────

function Titulo({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 13, fontWeight: 700, color: M.suave, textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 2px 8px' }}>{children}</div>
}

function Tile({ p, fijado, onTap }: { p: ProductWithCategory; fijado?: boolean; onTap: () => void }) {
  return (
    <button
      type="button"
      data-testid="m-producto"
      data-producto-id={p.id}
      onClick={onTap}
      style={{
        minHeight: 84, padding: '10px 12px', borderRadius: 14, border: `1px solid ${M.borde}`, background: M.panel,
        color: M.texto, textAlign: 'left', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 6,
        borderLeft: `4px solid ${p.categories?.color ?? M.borde}`, position: 'relative',
      }}
    >
      <span style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.25, paddingRight: fijado ? 18 : 0 }}>{p.name}</span>
      <span style={{ fontSize: 15, fontFamily: 'monospace', color: '#6ee7b7' }}>{formatCOP(p.price)}</span>
      {fijado && <Star size={14} fill={M.ambar} color={M.ambar} style={{ position: 'absolute', top: 10, right: 10 }} aria-label="Fijado" />}
    </button>
  )
}

const grilla: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }

const botonCantidad: React.CSSProperties = {
  width: 48, height: 48, display: 'grid', placeItems: 'center', borderRadius: 12, border: `1px solid ${M.borde}`,
  background: M.panel, color: M.texto,
}
