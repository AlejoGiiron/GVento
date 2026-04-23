import { useState, useMemo } from 'react'
import { Search, X, Plus, Package } from 'lucide-react'
import { useProducts } from '@/hooks/useProducts'
import { useCategories } from '@/hooks/useCategories'
import { useProductMutations } from '@/hooks/useProductMutations'
import { ProductCard } from '@/components/products/ProductCard'
import { ProductModal } from '@/components/products/ProductModal'
import { CategoryTabs } from '@/components/products/CategoryTabs'
import type { ProductWithCategory } from '@/stores/cartStore'

// ─── Skeleton ────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div style={{
      background: '#fff', border: '1px solid #e5e7eb',
      borderRadius: 14, overflow: 'hidden',
    }}>
      <div style={{ height: 148, background: 'linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%)', backgroundSize: '200% 100%', animation: 'gv-shimmer 1.4s infinite' }} />
      <div style={{ padding: '12px 14px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ height: 10, width: '40%', background: '#f1f5f9', borderRadius: 6 }} />
        <div style={{ height: 14, width: '80%', background: '#f1f5f9', borderRadius: 6 }} />
        <div style={{ height: 11, width: '60%', background: '#f1f5f9', borderRadius: 6 }} />
        <div style={{ height: 16, width: '35%', background: '#f1f5f9', borderRadius: 6, marginTop: 4 }} />
      </div>
    </div>
  )
}

// ─── Empty state ─────────────────────────────────────────────────
function EmptyState({ query, onNew }: { query: string; onNew: () => void }) {
  if (query) {
    return (
      <div style={{ gridColumn: '1 / -1', padding: '60px 20px', textAlign: 'center' }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>🔍</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
          Sin resultados para "{query}"
        </div>
        <div style={{ fontSize: 13, color: '#94a3b8' }}>
          Intenta con otro nombre o revisa la categoría seleccionada
        </div>
      </div>
    )
  }

  return (
    <div style={{ gridColumn: '1 / -1', padding: '60px 20px', textAlign: 'center' }}>
      <div style={{
        width: 64, height: 64, borderRadius: '50%',
        background: '#ecfdf5', margin: '0 auto 16px',
        display: 'grid', placeItems: 'center', color: '#10b981',
      }}>
        <Package size={28} strokeWidth={1.5} />
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
        No hay productos en esta categoría
      </div>
      <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 20 }}>
        Agrega el primero para que aparezca en el POS
      </div>
      <button
        onClick={onNew}
        style={{
          padding: '10px 20px', border: 'none',
          background: '#10b981', borderRadius: 9,
          cursor: 'pointer', fontSize: 13, fontWeight: 700, color: '#fff',
          display: 'inline-flex', alignItems: 'center', gap: 6,
          boxShadow: '0 6px 16px rgba(16,185,129,.35)',
        }}
      >
        <Plus size={15} /> Crear primer producto
      </button>
    </div>
  )
}

// ─── Main page ───────────────────────────────────────────────────
export function ProductsPage() {
  const [activeCat, setActiveCat] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [modalProduct, setModalProduct] = useState<ProductWithCategory | 'new' | null>(null)

  const { data: categories = [], isLoading: catsLoading } = useCategories()
  const { data: products = [], isLoading: prodsLoading } = useProducts()
  const { deactivateProduct } = useProductMutations()

  const isLoading = catsLoading || prodsLoading

  const productCounts = useMemo(() =>
    categories.reduce<Record<string, number>>((acc, c) => {
      acc[c.id] = products.filter(p => p.category_id === c.id).length
      return acc
    }, {}),
    [categories, products],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = activeCat ? products.filter(p => p.category_id === activeCat) : products
    if (q) list = list.filter(p => p.name.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q))
    return list
  }, [products, activeCat, query])

  // ── Shimmer keyframe injected once ──
  if (typeof document !== 'undefined' && !document.getElementById('gv-shimmer')) {
    const s = document.createElement('style')
    s.id = 'gv-shimmer'
    s.textContent = `@keyframes gv-shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`
    document.head.appendChild(s)
  }

  const modalProductData = modalProduct !== null && modalProduct !== 'new' ? modalProduct : null

  return (
    <div
      style={{
        height: '100%', overflow: 'auto',
        background: '#f8fafc',
        fontFamily: 'Inter, system-ui, sans-serif',
        color: '#0f172a',
      }}
    >
      {/* ── Page header ── */}
      <div style={{
        background: '#fff',
        borderBottom: '1px solid #e5e7eb',
        padding: '20px 28px 0',
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#10b981', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
              Administración
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', letterSpacing: -0.5, margin: 0 }}>
              Productos
            </h1>
            <p style={{ fontSize: 13, color: '#64748b', marginTop: 3, marginBottom: 0 }}>
              {isLoading ? 'Cargando...' : `${products.length} productos · ${categories.length} categorías`}
            </p>
          </div>

          <button
            onClick={() => setModalProduct('new')}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '10px 18px', border: 'none',
              background: '#10b981', borderRadius: 10,
              cursor: 'pointer', fontSize: 13.5, fontWeight: 700, color: '#fff',
              boxShadow: '0 6px 16px rgba(16,185,129,.35)',
              flexShrink: 0,
            }}
          >
            <Plus size={16} strokeWidth={2.5} /> Nuevo producto
          </button>
        </div>

        {/* Toolbar: tabs + search */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
          <CategoryTabs
            categories={categories}
            activeId={activeCat}
            productCounts={productCounts}
            onSelect={(id) => { setActiveCat(id); setQuery('') }}
          />

          {/* Search */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: '#f8fafc', border: '1px solid #e2e8f0',
            borderRadius: 9, padding: '8px 12px',
            marginBottom: 4, flexShrink: 0, width: 220,
          }}>
            <Search size={15} color="#94a3b8" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setQuery('') }}
              placeholder="Buscar producto..."
              style={{
                flex: 1, border: 'none', outline: 'none',
                background: 'transparent', fontSize: 13,
                color: '#0f172a', fontFamily: 'Inter, system-ui, sans-serif',
              }}
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0, display: 'grid', placeItems: 'center' }}
              >
                <X size={13} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Product grid ── */}
      <div style={{ padding: '24px 28px' }}>
        {isLoading ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
            {filtered.length === 0
              ? <EmptyState query={query} onNew={() => setModalProduct('new')} />
              : filtered.map(product => (
                <ProductCard
                  key={product.id}
                  product={product}
                  onEdit={() => setModalProduct(product)}
                  onDeactivate={() => deactivateProduct.mutate(product.id)}
                />
              ))
            }
          </div>
        )}
      </div>

      {/* ── Modal ── */}
      {modalProduct !== null && (
        <ProductModal
          product={modalProductData}
          categories={categories}
          onClose={() => setModalProduct(null)}
        />
      )}
    </div>
  )
}
