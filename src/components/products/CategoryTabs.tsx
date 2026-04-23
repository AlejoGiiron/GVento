import { useState } from 'react'
import { Pencil, Plus } from 'lucide-react'
import type { Tables } from '@/types/database.types'

interface CategoryTabsProps {
  categories: Tables<'categories'>[]
  activeId: string | null
  productCounts: Record<string, number>
  onSelect: (id: string | null) => void
  onEdit: (category: Tables<'categories'>) => void
  onNew: () => void
}

export function CategoryTabs({ categories, activeId, productCounts, onSelect, onEdit, onNew }: CategoryTabsProps) {
  const [hoveredId, setHoveredId] = useState<string | null | 'new'>('_none')
  const tabs = [{ id: null, name: 'Todos', color: '#64748b' }, ...categories.map(c => ({ id: c.id, name: c.name, color: c.color }))]
  const totalCount = Object.values(productCounts).reduce((a, b) => a + b, 0)

  return (
    <div
      style={{
        display: 'flex',
        gap: 4,
        overflowX: 'auto',
        scrollbarWidth: 'none',
        paddingBottom: 2,
        alignItems: 'flex-end',
      }}
    >
      {tabs.map((tab) => {
        const isActive = activeId === tab.id
        const isHovered = hoveredId === tab.id
        const count = tab.id === null ? totalCount : (productCounts[tab.id] ?? 0)
        const category = tab.id ? categories.find(c => c.id === tab.id) : undefined

        return (
          <button
            key={String(tab.id)}
            onClick={() => onSelect(tab.id)}
            onMouseEnter={() => setHoveredId(tab.id)}
            onMouseLeave={() => setHoveredId('_none')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              padding: '10px 14px 12px',
              border: 'none',
              background: 'transparent',
              borderBottom: isActive ? `3px solid ${tab.color}` : '3px solid transparent',
              color: isActive ? tab.color : '#64748b',
              fontWeight: isActive ? 700 : 500,
              fontSize: 14,
              fontFamily: 'Inter, system-ui, sans-serif',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              letterSpacing: -0.2,
              transition: 'color .12s',
              flexShrink: 0,
            }}
          >
            {tab.name}
            <span style={{
              fontSize: 11,
              fontWeight: 600,
              padding: '1px 6px',
              borderRadius: 10,
              background: isActive ? `${tab.color}18` : '#f1f5f9',
              color: isActive ? tab.color : '#94a3b8',
              fontFamily: 'monospace',
              transition: 'all .12s',
            }}>
              {count}
            </span>

            {/* Edit pencil — always rendered for category tabs, visible on hover */}
            {category && (
              <span
                onClick={(e) => { e.stopPropagation(); onEdit(category) }}
                title="Editar categoría"
                style={{
                  width: 18, height: 18, borderRadius: 5,
                  background: isHovered ? `${tab.color}22` : 'transparent',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  color: isHovered ? tab.color : 'transparent',
                  flexShrink: 0, cursor: 'pointer',
                  transition: 'all .15s',
                }}
              >
                <Pencil size={10} strokeWidth={2.5} />
              </span>
            )}
          </button>
        )
      })}

      {/* Nueva categoría */}
      <button
        onClick={onNew}
        onMouseEnter={() => setHoveredId('new')}
        onMouseLeave={() => setHoveredId('_none')}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '10px 12px 12px',
          border: 'none', background: 'transparent',
          borderBottom: '3px solid transparent',
          color: hoveredId === 'new' ? '#10b981' : '#94a3b8',
          fontSize: 13, fontWeight: 500,
          fontFamily: 'Inter, system-ui, sans-serif',
          cursor: 'pointer', whiteSpace: 'nowrap',
          transition: 'color .12s', flexShrink: 0,
        }}
      >
        <Plus size={13} strokeWidth={2.5} />
        Nueva categoría
      </button>
    </div>
  )
}
