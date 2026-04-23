import { useState } from 'react'
import { Pencil, Archive, ImageIcon, Package } from 'lucide-react'
import type { ProductWithCategory } from '@/stores/cartStore'

const formatCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n)

interface ProductCardProps {
  product: ProductWithCategory
  onEdit: () => void
  onDeactivate: () => void
}

export function ProductCard({ product, onEdit, onDeactivate }: ProductCardProps) {
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false)
  const color = product.categories?.color ?? '#94a3b8'

  return (
    <div style={{
      background: '#fff',
      border: '1px solid #e5e7eb',
      borderRadius: 14,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      transition: 'box-shadow .15s',
    }}
      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 8px 20px rgba(0,0,0,.06)' }}
      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none' }}
    >
      {/* Image / placeholder */}
      <div style={{ position: 'relative', height: 148, background: `${color}15`, flexShrink: 0 }}>
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: 6,
          }}>
            <ImageIcon size={28} color={`${color}80`} strokeWidth={1.5} />
            <span style={{ fontSize: 10.5, color: `${color}90`, fontFamily: 'monospace', letterSpacing: -0.2 }}>
              {product.name.substring(0, 12).toUpperCase()}
            </span>
          </div>
        )}

        {/* Category color bar */}
        <div style={{
          position: 'absolute', top: 0, left: 0,
          width: '100%', height: 3,
          background: color,
        }} />

        {/* Stock badge */}
        {product.stock_tracking && (
          <div style={{
            position: 'absolute', top: 10, right: 8,
            padding: '2px 7px', borderRadius: 8,
            background: 'rgba(15,23,42,.65)',
            fontSize: 10.5, fontWeight: 600,
            color: '#fff', fontFamily: 'monospace',
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <Package size={10} />
            {product.stock_qty ?? 0}
          </div>
        )}

        {/* Inactive overlay */}
        {!product.is_active && (
          <div style={{
            position: 'absolute', inset: 0,
            background: 'rgba(15,23,42,.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{
              padding: '4px 10px', borderRadius: 8,
              background: 'rgba(15,23,42,.8)', color: '#f1f5f9',
              fontSize: 11, fontWeight: 600, letterSpacing: 0.5,
              textTransform: 'uppercase',
            }}>Inactivo</span>
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: '12px 14px 14px', flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {/* Category chip */}
        {product.categories && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '2px 7px', borderRadius: 8,
            background: `${color}15`, color,
            fontSize: 10.5, fontWeight: 600,
            width: 'fit-content',
          }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: color, flexShrink: 0 }} />
            {product.categories.name}
          </div>
        )}

        <div style={{ fontSize: 14.5, fontWeight: 600, color: '#0f172a', letterSpacing: -0.2, lineHeight: 1.25, marginTop: 2 }}>
          {product.name}
        </div>

        {product.description && (
          <div style={{
            fontSize: 12, color: '#94a3b8', lineHeight: 1.35,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {product.description}
          </div>
        )}

        <div style={{ marginTop: 'auto', paddingTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', fontFamily: 'monospace', letterSpacing: -0.4 }}>
            {formatCOP(product.price)}
          </span>

          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={onEdit}
              title="Editar"
              style={{
                width: 30, height: 30, borderRadius: 8,
                border: '1px solid #e5e7eb', background: '#fff',
                cursor: 'pointer', color: '#64748b',
                display: 'grid', placeItems: 'center',
                transition: 'all .12s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#10b981'; e.currentTarget.style.color = '#10b981' }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.color = '#64748b' }}
            >
              <Pencil size={13} />
            </button>

            {!confirmingDeactivate ? (
              <button
                onClick={() => setConfirmingDeactivate(true)}
                title="Desactivar"
                style={{
                  width: 30, height: 30, borderRadius: 8,
                  border: '1px solid #e5e7eb', background: '#fff',
                  cursor: 'pointer', color: '#64748b',
                  display: 'grid', placeItems: 'center',
                  transition: 'all .12s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#fecaca'; e.currentTarget.style.color = '#dc2626' }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.color = '#64748b' }}
              >
                <Archive size={13} />
              </button>
            ) : (
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  onClick={() => setConfirmingDeactivate(false)}
                  style={{
                    height: 30, padding: '0 8px', borderRadius: 8,
                    border: '1px solid #e5e7eb', background: '#fff',
                    cursor: 'pointer', color: '#64748b', fontSize: 11.5, fontWeight: 600,
                  }}
                >
                  No
                </button>
                <button
                  onClick={() => { setConfirmingDeactivate(false); onDeactivate() }}
                  style={{
                    height: 30, padding: '0 8px', borderRadius: 8,
                    border: 'none', background: '#fef2f2',
                    cursor: 'pointer', color: '#dc2626', fontSize: 11.5, fontWeight: 700,
                  }}
                >
                  Sí, desactivar
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
