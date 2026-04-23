import type { Tables } from '@/types/database.types'

interface CategoryTabsProps {
  categories: Tables<'categories'>[]
  activeId: string | null
  productCounts: Record<string, number>
  onSelect: (id: string | null) => void
}

export function CategoryTabs({ categories, activeId, productCounts, onSelect }: CategoryTabsProps) {
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
      }}
    >
      {tabs.map((tab) => {
        const isActive = activeId === tab.id
        const count = tab.id === null ? totalCount : (productCounts[tab.id] ?? 0)
        return (
          <button
            key={String(tab.id)}
            onClick={() => onSelect(tab.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              padding: '10px 16px 12px',
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
          </button>
        )
      })}
    </div>
  )
}
