import { useState, useEffect, useId } from 'react'
import { X, ChevronRight, Package, AlertTriangle } from 'lucide-react'
import { ImageUpload } from './ImageUpload'
import { RecipeEditor } from './RecipeEditor'
import { useProductMutations } from '@/hooks/useProductMutations'
import { useProducts } from '@/hooks/useProducts'
import { useExtras } from '@/hooks/useExtras'
import { useProductExtras } from '@/hooks/useProductExtras'
import { useProductComponents, type RecipeRow } from '@/hooks/useProductComponents'
import { useAuth } from '@/hooks/useAuth'
import { useRestaurantConfig } from '@/hooks/useRestaurantConfig'
import type { ProductWithCategory } from '@/stores/cartStore'
import type { Tables, TablesInsert } from '@/types/database.types'

type ProductKind = 'simple' | 'composite'

const formatCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n)

interface ProductModalProps {
  product: ProductWithCategory | null
  categories: Tables<'categories'>[]
  onClose: () => void
}

export function ProductModal({ product, categories, onClose }: ProductModalProps) {
  const { profile } = useAuth()
  const { restaurant } = useRestaurantConfig()
  const { saveProduct, uploadImage, removeImage } = useProductMutations()
  const { data: allProducts = [] } = useProducts()
  const { extras } = useExtras()
  const { assignedIds, reconcile } = useProductExtras(product?.id ?? null)
  const { initialRows, reconcile: reconcileRecipe } = useProductComponents(product?.id ?? null)
  const formId = useId()

  const isEditing = !!product

  // Extras del catálogo asignables a este producto (solo activos).
  const activeExtras = extras.filter(e => e.is_active)
  const [selectedExtras, setSelectedExtras] = useState<Set<string>>(new Set())
  const [extrasInit, setExtrasInit] = useState(false)

  // Inicializa la selección desde lo ya asignado en BD (modo edición).
  useEffect(() => {
    if (!extrasInit && product && assignedIds.size > 0) {
      setSelectedExtras(new Set(assignedIds))
      setExtrasInit(true)
    }
  }, [assignedIds, product, extrasInit])

  const toggleExtra = (id: string) => {
    setSelectedExtras(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const [name, setName] = useState(product?.name ?? '')
  const [description, setDescription] = useState(product?.description ?? '')
  const [price, setPrice] = useState(product ? String(product.price) : '')
  const [categoryId, setCategoryId] = useState(product?.category_id ?? categories[0]?.id ?? '')
  const [imageUrl, setImageUrl] = useState<string | null>(product?.image_url ?? null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [kind, setKind] = useState<ProductKind>((product?.kind as ProductKind) ?? 'simple')
  const [stockTracking, setStockTracking] = useState(product?.stock_tracking ?? false)
  const [minStock, setMinStock] = useState(product?.min_stock != null ? String(product.min_stock) : '0')
  const [routesToKitchen, setRoutesToKitchen] = useState(product?.routes_to_kitchen ?? true)
  const [saving, setSaving] = useState(false)

  // El control "Va a cocina" solo aplica si la sede usa cocina. Default true
  // mientras carga el restaurant (no condiciona el guardado, solo el render).
  const sedeUsesKitchen = restaurant?.uses_kitchen ?? true

  // Receta (solo para compuestos). Se inicializa desde BD en modo edición.
  const [recipeRows, setRecipeRows] = useState<RecipeRow[]>([])
  const [recipeInit, setRecipeInit] = useState(false)
  useEffect(() => {
    if (!recipeInit && product && initialRows.length > 0) {
      setRecipeRows(initialRows)
      setRecipeInit(true)
    }
  }, [initialRows, product, recipeInit])

  // Stock actual (persistido): solo lectura aquí — se mueve por ventas/ajustes.
  const currentStock = product?.stock_qty ?? 0

  const priceNum = parseInt(price.replace(/\D/g, ''), 10) || 0
  const isValid = name.trim().length > 0 && priceNum > 0 && categoryId

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const handleImageChange = (file: File | null) => {
    if (!file) return
    setPendingFile(file)
    setImageUrl(URL.createObjectURL(file))
  }

  const handleImageRemove = async () => {
    if (product?.image_url) await removeImage(product.image_url)
    setImageUrl(null)
    setPendingFile(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!profile || !isValid) return
    setSaving(true)

    try {
      // Determine final image URL
      let finalImageUrl = imageUrl

      // If there's a pending file, we need a product ID to store the image
      // We upsert first (with existing or temp URL), then upload with the real ID
      const productId = product?.id ?? crypto.randomUUID()

      if (pendingFile) {
        const uploaded = await uploadImage(productId, pendingFile)
        finalImageUrl = uploaded // null if upload failed — product saves without image
      } else if (imageUrl === null && product?.image_url) {
        // Image was removed
        finalImageUrl = null
      }

      // Un compuesto NO tiene stock propio: stock_tracking off, sin stock_qty.
      const isComposite = kind === 'composite'
      const tracking = isComposite ? false : stockTracking

      const payload: TablesInsert<'products'> = {
        id: productId,
        name: name.trim(),
        description: description.trim() || null,
        price: priceNum,
        category_id: categoryId,
        restaurant_id: profile.restaurant_id,
        image_url: finalImageUrl,
        is_active: true,
        kind,
        stock_tracking: tracking,
        min_stock: tracking ? (parseInt(minStock, 10) || 0) : 0,
        // Si la sede no usa cocina el control no se muestra; persistimos true
        // (neutro: solo importa cuando la sede tiene cocina).
        routes_to_kitchen: sedeUsesKitchen ? routesToKitchen : true,
      }
      // El stock no se edita a mano: al CREAR arranca en 0 (o null sin tracking);
      // al EDITAR se PRESERVA el valor de BD (se mueve por ventas/ajustes) — no
      // se reescribe para no pisar un descuento concurrente. Si se apaga el
      // tracking, se limpia a null.
      if (!isEditing) payload.stock_qty = tracking ? 0 : null
      else if (!tracking) payload.stock_qty = null

      await saveProduct.mutateAsync(payload)

      // Sincroniza los extras asignados (product_extras) con la selección.
      await reconcile.mutateAsync({ productId, extraIds: [...selectedExtras] })

      // Sincroniza la receta (product_components) si es compuesto; si pasó a
      // simple, vacía la receta para no dejar insumos huérfanos.
      await reconcileRecipe.mutateAsync({
        parentId: productId,
        rows: isComposite ? recipeRows : [],
      })

      onClose()
    } finally {
      setSaving(false)
    }
  }

  const fieldLabel: React.CSSProperties = {
    display: 'block', fontSize: 12, fontWeight: 600,
    color: '#334155', marginBottom: 6,
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 13px',
    border: '1.5px solid #e5e7eb', borderRadius: 9,
    fontSize: 14, color: '#0f172a', outline: 'none',
    fontFamily: 'Inter, system-ui, sans-serif',
    boxSizing: 'border-box', background: '#fff',
    transition: 'border .12s',
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(15,23,42,.55)',
        display: 'grid', placeItems: 'center',
        zIndex: 50, fontFamily: 'Inter, system-ui, sans-serif',
        padding: '20px',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: '#fff', borderRadius: 14,
        width: 560, maxWidth: '100%',
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
              {isEditing ? 'Editar producto' : 'Nuevo producto'}
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', letterSpacing: -0.3, marginTop: 1 }}>
              {isEditing ? product.name : 'Agregar al catálogo'}
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

        {/* Scrollable body */}
        <form id={formId} onSubmit={handleSubmit} style={{ overflow: 'auto', flex: 1 }}>
          <div style={{ padding: '22px', display: 'flex', flexDirection: 'column', gap: 18 }}>

            {/* Image */}
            <div>
              <label style={fieldLabel}>Imagen</label>
              <ImageUpload
                value={imageUrl}
                onChange={handleImageChange}
                onRemove={handleImageRemove}
              />
            </div>

            {/* Name */}
            <div>
              <label style={fieldLabel}>Nombre <span style={{ color: '#dc2626' }}>*</span></label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej: Mojito Cubano"
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
                placeholder="Ron, menta, limón, soda..."
                rows={2}
                style={{ ...inputStyle, resize: 'none', lineHeight: 1.5 }}
                onFocus={(e) => { e.currentTarget.style.borderColor = '#10b981' }}
                onBlur={(e) => { e.currentTarget.style.borderColor = '#e5e7eb' }}
              />
            </div>

            {/* Price + Category — 2 col */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <label style={fieldLabel}>Precio (COP) <span style={{ color: '#dc2626' }}>*</span></label>
                <div style={{ position: 'relative' }}>
                  <span style={{
                    position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)',
                    fontSize: 13, color: '#94a3b8', fontFamily: 'monospace', pointerEvents: 'none',
                  }}>$</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={price ? formatCOP(priceNum).replace('$', '').trim() : ''}
                    onChange={(e) => setPrice(e.target.value.replace(/\D/g, ''))}
                    placeholder="0"
                    required
                    style={{ ...inputStyle, paddingLeft: 24 }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = '#10b981' }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = '#e5e7eb' }}
                  />
                </div>
              </div>

              <div>
                <label style={fieldLabel}>Categoría <span style={{ color: '#dc2626' }}>*</span></label>
                <select
                  data-testid="product-category-select"
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  required
                  style={{ ...inputStyle, cursor: 'pointer', appearance: 'none' }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = '#10b981' }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = '#e5e7eb' }}
                >
                  <option value="" disabled>Seleccionar...</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Tipo de producto */}
            <div>
              <label style={fieldLabel}>Tipo de producto</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {([
                  { value: 'simple' as const, title: 'Simple', desc: 'Tiene su propio stock' },
                  { value: 'composite' as const, title: 'Compuesto', desc: 'Receta con insumos' },
                ]).map(opt => {
                  const active = kind === opt.value
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      data-testid={`product-kind-${opt.value}`}
                      onClick={() => setKind(opt.value)}
                      style={{
                        flex: 1, textAlign: 'left', cursor: 'pointer',
                        border: `1.5px solid ${active ? '#10b981' : '#e5e7eb'}`,
                        background: active ? '#ecfdf5' : '#fff',
                        borderRadius: 9, padding: '10px 12px', transition: 'all .12s',
                      }}
                    >
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: active ? '#065f46' : '#0f172a' }}>{opt.title}</div>
                      <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 2 }}>{opt.desc}</div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Va a cocina — solo si la sede usa cocina */}
            {sedeUsesKitchen && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>Va a cocina</div>
                  <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 2 }}>
                    Al enviar la comanda desde una mesa, este producto pasa al KDS
                  </div>
                </div>
                <button
                  type="button"
                  data-testid="product-routes-to-kitchen"
                  onClick={() => setRoutesToKitchen(!routesToKitchen)}
                  aria-checked={routesToKitchen}
                  role="switch"
                  style={{
                    width: 44, height: 24, borderRadius: 12,
                    background: routesToKitchen ? '#10b981' : '#e2e8f0',
                    border: 'none', cursor: 'pointer',
                    position: 'relative', transition: 'background .15s', flexShrink: 0,
                  }}
                >
                  <span style={{
                    position: 'absolute', top: 2,
                    left: routesToKitchen ? 22 : 2,
                    width: 20, height: 20, borderRadius: '50%',
                    background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.2)',
                    transition: 'left .15s',
                  }} />
                </button>
              </div>
            )}

            {/* Inventario (solo producto simple) */}
            {kind === 'simple' && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>Control de inventario</div>
                    <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 2 }}>
                      Lleva la cuenta de unidades disponibles
                    </div>
                  </div>
                  {/* Toggle */}
                  <button
                    type="button"
                    onClick={() => setStockTracking(!stockTracking)}
                    style={{
                      width: 44, height: 24, borderRadius: 12,
                      background: stockTracking ? '#10b981' : '#e2e8f0',
                      border: 'none', cursor: 'pointer',
                      position: 'relative', transition: 'background .15s', flexShrink: 0,
                    }}
                    aria-checked={stockTracking}
                    role="switch"
                  >
                    <span style={{
                      position: 'absolute', top: 2,
                      left: stockTracking ? 22 : 2,
                      width: 20, height: 20, borderRadius: '50%',
                      background: '#fff',
                      boxShadow: '0 1px 3px rgba(0,0,0,.2)',
                      transition: 'left .15s',
                    }} />
                  </button>
                </div>

                {stockTracking && (
                  <div style={{ marginTop: 12, display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                    {/* Stock actual — solo lectura (se mueve por ventas/ajustes) */}
                    <div>
                      <label style={fieldLabel}>Stock actual</label>
                      {isEditing ? (
                        <div
                          data-testid="stock-current"
                          style={{
                            width: 120, padding: '10px 13px', borderRadius: 9,
                            border: '1.5px solid #e5e7eb', background: '#f8fafc',
                            fontSize: 14, fontWeight: 700, fontFamily: 'monospace',
                            color: currentStock < 0 ? '#b91c1c' : '#0f172a',
                          }}
                        >
                          {currentStock}
                        </div>
                      ) : (
                        <div style={{
                          width: 220, padding: '10px 13px', borderRadius: 9,
                          border: '1px dashed #e2e8f0', background: '#f8fafc',
                          fontSize: 12, color: '#94a3b8', lineHeight: 1.4,
                        }}>
                          Arranca en 0 — cárgalo desde <strong style={{ color: '#64748b' }}>Inventario → Ajuste manual</strong>.
                        </div>
                      )}
                    </div>

                    {/* Stock mínimo — editable (umbral de alerta) */}
                    <div>
                      <label style={fieldLabel}>Stock mínimo</label>
                      <input
                        type="number"
                        min={0}
                        data-testid="product-min-stock"
                        value={minStock}
                        onChange={(e) => setMinStock(e.target.value)}
                        placeholder="0"
                        style={{ ...inputStyle, width: 120 }}
                        onFocus={(e) => { e.currentTarget.style.borderColor = '#10b981' }}
                        onBlur={(e) => { e.currentTarget.style.borderColor = '#e5e7eb' }}
                      />
                    </div>
                  </div>
                )}

                {isEditing && stockTracking && currentStock < 0 && (
                  <div
                    data-testid="oversold-alert"
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      marginTop: 10, padding: '6px 10px', borderRadius: 8,
                      background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c',
                      fontSize: 12, fontWeight: 600,
                    }}
                  >
                    <AlertTriangle size={13} />
                    Sobreventa: reponer {Math.abs(currentStock)} unidades del insumo
                  </div>
                )}
              </div>
            )}

            {/* Receta (solo producto compuesto) */}
            {kind === 'composite' && (
              <RecipeEditor
                selfId={product?.id ?? null}
                products={allProducts}
                rows={recipeRows}
                onChange={setRecipeRows}
              />
            )}

            {/* Extras disponibles */}
            <div>
              <label style={fieldLabel}>Extras disponibles</label>
              {activeExtras.length === 0 ? (
                <div style={{
                  fontSize: 12.5, color: '#94a3b8', lineHeight: 1.5,
                  border: '1px dashed #e2e8f0', borderRadius: 9, padding: '12px 14px',
                }}>
                  No hay extras en el catálogo. Créalos en{' '}
                  <strong style={{ color: '#64748b' }}>Configuración → Extras</strong>{' '}
                  y vuelve a marcar los que apliquen a este producto.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {activeExtras.map(extra => {
                    const checked = selectedExtras.has(extra.id)
                    return (
                      <button
                        type="button"
                        key={extra.id}
                        data-testid="product-extra-option"
                        onClick={() => toggleExtra(extra.id)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '10px 12px', textAlign: 'left',
                          border: `1.5px solid ${checked ? '#10b981' : '#e5e7eb'}`,
                          background: checked ? '#ecfdf5' : '#fff',
                          borderRadius: 9, cursor: 'pointer', width: '100%',
                          transition: 'all .12s',
                        }}
                      >
                        <span style={{
                          width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                          border: `1.5px solid ${checked ? '#10b981' : '#cbd5e1'}`,
                          background: checked ? '#10b981' : '#fff',
                          display: 'grid', placeItems: 'center',
                        }}>
                          {checked && (
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                          )}
                        </span>
                        <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: '#0f172a' }}>
                          {extra.name}
                        </span>
                        {extra.linked_product_id && (
                          <Package size={13} color="#94a3b8" />
                        )}
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: '#64748b', fontFamily: 'monospace' }}>
                          {formatCOP(Number(extra.price))}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
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
            {saving ? 'Guardando...' : <><span>{isEditing ? 'Guardar cambios' : 'Crear producto'}</span><ChevronRight size={15} /></>}
          </button>
        </div>
      </div>
    </div>
  )
}
