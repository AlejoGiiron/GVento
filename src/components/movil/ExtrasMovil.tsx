import { X, Plus, Minus, Package } from 'lucide-react'
import { useConfigExtras } from '@/hooks/useConfigExtras'
import { M, botonGrande, formatCOP } from '@/components/movil/estilo'
import type { CartExtra, ProductWithCategory } from '@/stores/cartStore'

/**
 * Elegir extras en el POS móvil: hoja que sube desde abajo, FIJA a la pantalla
 * (no a la página que se desplaza), con botones de 48 px y el de agregar sobre la
 * barra de inicio. La lógica es la del escritorio (useConfigExtras).
 */
export function ExtrasMovil({
  product,
  onConfirm,
  onClose,
}: {
  product: ProductWithCategory
  onConfirm: (extras: CartExtra[]) => void
  onClose: () => void
}) {
  const { disponibles, isLoading, cantidad, setCantidad, subtotalUnidad, elegidos } = useConfigExtras(product)

  return (
    <div
      data-testid="m-extras"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'flex-end' }}
    >
      <div style={{
        width: '100%', maxHeight: '85dvh', display: 'flex', flexDirection: 'column', background: M.panel, color: M.texto,
        borderRadius: '18px 18px 0 0', fontFamily: 'Inter, system-ui, sans-serif',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: `1px solid ${M.borde}` }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: M.verde, textTransform: 'uppercase', letterSpacing: 0.6 }}>Extras</div>
            <div style={{ fontSize: 18, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{product.name}</div>
          </div>
          <button type="button" aria-label="Cerrar" data-testid="m-extras-cerrar" onClick={onClose} style={{
            width: 48, height: 48, display: 'grid', placeItems: 'center', border: 'none', borderRadius: 12, background: M.fondo, color: M.texto,
          }}>
            <X size={22} />
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 16px' }}>
          {isLoading && <div style={{ padding: 24, textAlign: 'center', color: M.suave }}>Cargando extras…</div>}
          {!isLoading && disponibles.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: M.suave }}>Este producto no tiene extras.</div>
          )}
          {disponibles.map((e) => {
            const qty = cantidad(e.id)
            return (
              <div key={e.id} data-testid="m-extra" style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0', borderBottom: `1px solid ${M.borde}`,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, color: qty > 0 ? '#6ee7b7' : M.texto }}>
                    {e.name}
                    {e.linked_product_id && <Package size={13} color={M.suave} />}
                  </div>
                  <div style={{ fontSize: 14, color: M.suave, fontFamily: 'monospace' }}>+{formatCOP(Number(e.price))}</div>
                </div>
                <button type="button" aria-label={`Quitar ${e.name}`} data-testid="m-extra-menos" disabled={qty === 0} onClick={() => setCantidad(e.id, qty - 1)} style={{ ...botonCantidad, opacity: qty === 0 ? 0.35 : 1 }}>
                  <Minus size={20} />
                </button>
                <div data-testid="m-extra-qty" style={{ width: 28, textAlign: 'center', fontSize: 18, fontWeight: 700 }}>{qty}</div>
                <button type="button" aria-label={`Agregar ${e.name}`} data-testid="m-extra-mas" onClick={() => setCantidad(e.id, qty + 1)} style={botonCantidad}>
                  <Plus size={20} />
                </button>
              </div>
            )
          })}
        </div>

        <div style={{ padding: '12px 16px calc(env(safe-area-inset-bottom) + 12px)', borderTop: `1px solid ${M.borde}` }}>
          <button type="button" data-testid="m-extras-confirmar" onClick={() => onConfirm(elegidos())} style={{ ...botonGrande(M.verde), width: '100%', minHeight: 64, justifyContent: 'space-between' }}>
            <span>Agregar</span>
            <span data-testid="m-extras-subtotal" style={{ fontFamily: 'monospace' }}>{formatCOP(subtotalUnidad)}</span>
          </button>
        </div>
      </div>
    </div>
  )
}

const botonCantidad: React.CSSProperties = {
  width: 48, height: 48, display: 'grid', placeItems: 'center', borderRadius: 12, border: `1px solid ${M.borde}`,
  background: M.fondo, color: M.texto,
}
