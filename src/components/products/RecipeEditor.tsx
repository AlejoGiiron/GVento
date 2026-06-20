import { useState } from 'react'
import { Plus, X, AlertTriangle, Package } from 'lucide-react'
import type { ProductWithCategory } from '@/stores/cartStore'
import type { RecipeRow } from '@/hooks/useProductComponents'

interface RecipeEditorProps {
  /** Producto en edición (para excluirlo de los candidatos). null si es nuevo. */
  selfId: string | null
  /** Todos los productos de la sede (se filtran los candidatos a insumo). */
  products: ProductWithCategory[]
  rows: RecipeRow[]
  onChange: (rows: RecipeRow[]) => void
}

const fieldLabel: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 6,
}

/**
 * Editor de receta (BOM de un nivel) para productos compuestos.
 * Candidatos a insumo: productos SIMPLE con control de inventario, distintos
 * del propio producto. La cantidad es un entero > 0 por unidad del compuesto.
 */
export function RecipeEditor({ selfId, products, rows, onChange }: RecipeEditorProps) {
  const [pickId, setPickId] = useState('')
  const [pickQty, setPickQty] = useState('1')

  const usedIds = new Set(rows.map(r => r.component_id))
  const candidates = products.filter(
    p => p.kind === 'simple' && p.stock_tracking && p.id !== selfId && !usedIds.has(p.id),
  )
  const byId = new Map(products.map(p => [p.id, p]))

  const addRow = () => {
    const qty = parseInt(pickQty, 10)
    if (!pickId || !qty || qty <= 0) return
    onChange([...rows, { component_id: pickId, qty }])
    setPickId('')
    setPickQty('1')
  }

  const removeRow = (componentId: string) =>
    onChange(rows.filter(r => r.component_id !== componentId))

  const setRowQty = (componentId: string, qty: number) =>
    onChange(rows.map(r => (r.component_id === componentId ? { ...r, qty } : r)))

  return (
    <div data-testid="recipe-editor">
      <label style={fieldLabel}>Receta / Insumos</label>

      {rows.length === 0 ? (
        <div
          data-testid="recipe-empty-warning"
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 12.5, color: '#92400e', lineHeight: 1.5,
            border: '1px solid #fde68a', background: '#fffbeb',
            borderRadius: 9, padding: '10px 12px', marginBottom: 10,
          }}
        >
          <AlertTriangle size={15} style={{ flexShrink: 0 }} />
          Un producto compuesto debería tener al menos un insumo. Agrega los que descuenta cada venta.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
          {rows.map(row => {
            const prod = byId.get(row.component_id)
            return (
              <div
                key={row.component_id}
                data-testid="recipe-row"
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  border: '1.5px solid #e5e7eb', borderRadius: 9,
                  padding: '8px 10px', background: '#fff',
                }}
              >
                <Package size={14} color="#94a3b8" style={{ flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: '#0f172a', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {prod?.name ?? 'Insumo'}
                </span>
                <span style={{ fontSize: 11.5, color: '#94a3b8' }}>×</span>
                <input
                  type="number"
                  min={1}
                  data-testid="recipe-row-qty"
                  value={row.qty}
                  onChange={(e) => setRowQty(row.component_id, Math.max(1, parseInt(e.target.value, 10) || 1))}
                  style={{
                    width: 64, padding: '6px 8px', textAlign: 'center',
                    border: '1.5px solid #e5e7eb', borderRadius: 8,
                    fontSize: 13, color: '#0f172a', outline: 'none',
                    fontFamily: 'monospace',
                  }}
                />
                <button
                  type="button"
                  onClick={() => removeRow(row.component_id)}
                  title="Quitar insumo"
                  style={{ width: 26, height: 26, border: 'none', background: 'transparent', cursor: 'pointer', color: '#dc2626', display: 'grid', placeItems: 'center', flexShrink: 0 }}
                >
                  <X size={14} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Agregar insumo */}
      {candidates.length === 0 && rows.length === 0 ? (
        <div style={{
          fontSize: 12, color: '#94a3b8', lineHeight: 1.5,
          border: '1px dashed #e2e8f0', borderRadius: 9, padding: '10px 12px',
        }}>
          No hay productos simples con control de inventario para usar como insumo.
          Crea insumos (productos simples con inventario) primero.
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8 }}>
          <select
            data-testid="recipe-add-product"
            value={pickId}
            onChange={(e) => setPickId(e.target.value)}
            style={{
              flex: 1, padding: '9px 11px', border: '1.5px solid #e5e7eb',
              borderRadius: 9, fontSize: 13.5, color: '#0f172a', outline: 'none',
              background: '#fff', cursor: 'pointer', minWidth: 0,
            }}
          >
            <option value="">Agregar insumo...</option>
            {candidates.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <input
            type="number"
            min={1}
            data-testid="recipe-add-qty"
            value={pickQty}
            onChange={(e) => setPickQty(e.target.value)}
            style={{
              width: 64, padding: '9px 8px', textAlign: 'center',
              border: '1.5px solid #e5e7eb', borderRadius: 9,
              fontSize: 13, color: '#0f172a', outline: 'none', fontFamily: 'monospace',
            }}
          />
          <button
            type="button"
            data-testid="recipe-add-confirm"
            onClick={addRow}
            disabled={!pickId}
            style={{
              padding: '0 12px', border: 'none', borderRadius: 9,
              background: pickId ? '#10b981' : '#cbd5e1',
              cursor: pickId ? 'pointer' : 'not-allowed', color: '#fff',
              display: 'grid', placeItems: 'center', flexShrink: 0,
            }}
          >
            <Plus size={16} strokeWidth={2.5} />
          </button>
        </div>
      )}
    </div>
  )
}
