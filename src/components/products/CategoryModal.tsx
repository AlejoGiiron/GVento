import { useState, useEffect, useId } from 'react'
import { X, ChevronRight } from 'lucide-react'
import { useCategoryMutations } from '@/hooks/useProductMutations'
import { useAuth } from '@/hooks/useAuth'
import type { Tables } from '@/types/database.types'

const CATEGORY_COLORS = [
  '#10b981',
  '#059669',
  '#2563eb',
  '#7c3aed',
  '#db2777',
  '#d97706',
  '#0891b2',
  '#64748b',
]

interface CategoryModalProps {
  category: Tables<'categories'> | null
  onClose: () => void
}

export function CategoryModal({ category, onClose }: CategoryModalProps) {
  const { profile } = useAuth()
  const { saveCategory } = useCategoryMutations()
  const formId = useId()

  const isEditing = !!category

  const [name, setName] = useState(category?.name ?? '')
  const [description, setDescription] = useState(category?.description ?? '')
  const [color, setColor] = useState(category?.color ?? CATEGORY_COLORS[0])
  const [isActive, setIsActive] = useState(category?.is_active ?? true)
  const [saving, setSaving] = useState(false)

  const isValid = name.trim().length > 0

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!profile || !isValid) return
    setSaving(true)
    try {
      await saveCategory.mutateAsync({
        ...(category?.id ? { id: category.id } : {}),
        name: name.trim(),
        description: description.trim() || null,
        color,
        is_active: isActive,
        restaurant_id: profile.restaurant_id,
        sort_order: category?.sort_order ?? 0,
      })
      onClose()
    } catch {
      // error toast handled in hook
    } finally {
      setSaving(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 13px',
    border: '1.5px solid #e5e7eb', borderRadius: 9,
    fontSize: 14, color: '#0f172a', outline: 'none',
    fontFamily: 'Inter, system-ui, sans-serif',
    boxSizing: 'border-box', background: '#fff',
    transition: 'border .12s',
  }

  const fieldLabel: React.CSSProperties = {
    display: 'block', fontSize: 12, fontWeight: 600,
    color: '#334155', marginBottom: 6,
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(15,23,42,.55)',
        display: 'grid', placeItems: 'center',
        zIndex: 60, fontFamily: 'Inter, system-ui, sans-serif',
        padding: '20px',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: '#fff', borderRadius: 14,
        width: 480, maxWidth: '100%',
        boxShadow: '0 25px 50px -12px rgba(0,0,0,.25)',
        overflow: 'hidden',
        maxHeight: '90vh',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          padding: '18px 22px', borderBottom: '1px solid #f1f5f9',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#10b981', textTransform: 'uppercase', letterSpacing: 1 }}>
              {isEditing ? 'Editar categoría' : 'Nueva categoría'}
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', letterSpacing: -0.3, marginTop: 1 }}>
              {isEditing ? category.name : 'Organizar el catálogo'}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 32, height: 32, borderRadius: 8,
              background: '#f1f5f9', border: 'none',
              cursor: 'pointer', color: '#64748b',
              display: 'grid', placeItems: 'center', flexShrink: 0,
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <form id={formId} onSubmit={handleSubmit} style={{ overflow: 'auto', flex: 1 }}>
          <div style={{ padding: '22px', display: 'flex', flexDirection: 'column', gap: 18 }}>

            {/* Name */}
            <div>
              <label style={fieldLabel}>Nombre <span style={{ color: '#dc2626' }}>*</span></label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej: Cocteles clásicos"
                required
                style={inputStyle}
                onFocus={(e) => { e.currentTarget.style.borderColor = '#10b981' }}
                onBlur={(e) => { e.currentTarget.style.borderColor = '#e5e7eb' }}
              />
            </div>

            {/* Description */}
            <div>
              <label style={fieldLabel}>Descripción <span style={{ color: '#94a3b8', fontWeight: 400 }}>(opcional)</span></label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Breve descripción de la categoría..."
                rows={2}
                style={{ ...inputStyle, resize: 'none', lineHeight: 1.5 }}
                onFocus={(e) => { e.currentTarget.style.borderColor = '#10b981' }}
                onBlur={(e) => { e.currentTarget.style.borderColor = '#e5e7eb' }}
              />
            </div>

            {/* Color picker */}
            <div>
              <label style={fieldLabel}>Color del tab</label>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {CATEGORY_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    title={c}
                    style={{
                      width: 32, height: 32, borderRadius: '50%',
                      background: c, border: 'none', cursor: 'pointer',
                      boxShadow: color === c
                        ? `0 0 0 3px #fff, 0 0 0 5px ${c}`
                        : '0 1px 3px rgba(0,0,0,.15)',
                      transition: 'box-shadow .12s',
                      flexShrink: 0,
                    }}
                  />
                ))}
              </div>
              {/* Preview */}
              <div style={{ marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, color: '#94a3b8' }}>Vista previa:</span>
                <span style={{
                  padding: '4px 12px',
                  borderBottom: `3px solid ${color}`,
                  color,
                  fontSize: 13, fontWeight: 700,
                  fontFamily: 'Inter, system-ui, sans-serif',
                }}>
                  {name || 'Categoría'}
                </span>
              </div>
            </div>

            {/* Active toggle — only when editing */}
            {isEditing && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>Categoría activa</div>
                    <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 2 }}>
                      Las inactivas no aparecen en el POS ni en los tabs
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsActive(!isActive)}
                    style={{
                      width: 44, height: 24, borderRadius: 12,
                      background: isActive ? '#10b981' : '#e2e8f0',
                      border: 'none', cursor: 'pointer',
                      position: 'relative', transition: 'background .15s', flexShrink: 0,
                    }}
                    aria-checked={isActive}
                    role="switch"
                  >
                    <span style={{
                      position: 'absolute', top: 2,
                      left: isActive ? 22 : 2,
                      width: 20, height: 20, borderRadius: '50%',
                      background: '#fff',
                      boxShadow: '0 1px 3px rgba(0,0,0,.2)',
                      transition: 'left .15s',
                    }} />
                  </button>
                </div>
                {!isActive && (
                  <div style={{
                    marginTop: 10, padding: '9px 12px',
                    background: '#fef2f2', border: '1px solid #fecaca',
                    borderRadius: 8, fontSize: 12, color: '#b91c1c',
                  }}>
                    Si la categoría tiene productos activos, no podrás desactivarla.
                  </div>
                )}
              </div>
            )}
          </div>
        </form>

        {/* Footer */}
        <div style={{
          padding: '16px 22px',
          borderTop: '1px solid #f1f5f9',
          display: 'flex', gap: 10, flexShrink: 0,
          background: 'linear-gradient(180deg, #f8fafc 0%, #fff 100%)',
        }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              flex: 1, padding: '11px 16px',
              border: '1.5px solid #e5e7eb', background: '#fff',
              borderRadius: 9, cursor: 'pointer',
              fontSize: 13.5, fontWeight: 600, color: '#334155',
            }}
          >
            Cancelar
          </button>
          <button
            type="submit"
            form={formId}
            disabled={!isValid || saving}
            style={{
              flex: 2, padding: '11px 16px',
              border: 'none',
              background: !isValid || saving ? '#cbd5e1' : '#10b981',
              borderRadius: 9,
              cursor: !isValid || saving ? 'not-allowed' : 'pointer',
              fontSize: 13.5, fontWeight: 700, color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              boxShadow: !isValid || saving ? 'none' : '0 6px 16px rgba(16,185,129,.35)',
              transition: 'all .15s',
            }}
          >
            {saving
              ? 'Guardando...'
              : <><span>{isEditing ? 'Guardar cambios' : 'Crear categoría'}</span><ChevronRight size={15} /></>
            }
          </button>
        </div>
      </div>
    </div>
  )
}
