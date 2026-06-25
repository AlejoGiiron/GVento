import { supabase } from './supabase'
import type { Enums, Json, Tables, TablesInsert, TablesUpdate } from '@/types/database.types'

// --- Profiles ---

export const getProfile = (userId: string) =>
  supabase.from('profiles').select('*').eq('id', userId).single()

export const upsertProfile = (profile: TablesInsert<'profiles'>) =>
  supabase.from('profiles').upsert(profile).select().single()

// --- Restaurants ---

export const getRestaurant = (restaurantId: string) =>
  supabase.from('restaurants').select('*').eq('id', restaurantId).single()

export const updateRestaurant = (restaurantId: string, data: TablesUpdate<'restaurants'>) =>
  supabase.from('restaurants').update(data).eq('id', restaurantId).select().single()

// --- Categories ---

export const getCategories = (restaurantId: string) =>
  supabase
    .from('categories')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('is_active', true)
    .order('sort_order')

export const upsertCategory = (category: TablesInsert<'categories'>) =>
  supabase.from('categories').upsert(category).select().single()

export const deleteCategory = (categoryId: string) =>
  supabase.from('categories').update({ is_active: false }).eq('id', categoryId)

export const countActiveProductsByCategory = (categoryId: string) =>
  supabase
    .from('products')
    .select('*', { count: 'exact', head: true })
    .eq('category_id', categoryId)
    .eq('is_active', true)

// --- Products ---

export const getProducts = (restaurantId: string, categoryId?: string) => {
  const base = supabase
    .from('products')
    .select('*, categories(id, name, color)')
    .eq('restaurant_id', restaurantId)
    .eq('is_active', true)
    .order('name')

  return categoryId ? base.eq('category_id', categoryId) : base
}

export const upsertProduct = (product: TablesInsert<'products'>) =>
  supabase.from('products').upsert(product).select().single()

export const archiveProduct = (productId: string) =>
  supabase.from('products').update({ is_active: false }).eq('id', productId)

export const updateProductStock = (productId: string, stock_qty: number) =>
  supabase.from('products').update({ stock_qty }).eq('id', productId)

// --- Extras (catálogo de subproductos reutilizables) ---

// Solo activos: para asignación a productos y selección en POS (prompt 2).
export const getExtras = (restaurantId: string) =>
  supabase
    .from('extras')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('is_active', true)
    .order('name')

// Incluye inactivos: para el catálogo de configuración.
export const getAllExtras = (restaurantId: string) =>
  supabase
    .from('extras')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('is_active', { ascending: false })
    .order('name')

export const upsertExtra = (extra: TablesInsert<'extras'>) =>
  supabase.from('extras').upsert(extra).select().single()

export const deactivateExtra = (extraId: string) =>
  supabase.from('extras').update({ is_active: false }).eq('id', extraId)

// Cuántas líneas de venta usan este extra (para impedir su borrado).
export const countOrderItemsUsingExtra = (extraId: string) =>
  supabase
    .from('order_item_extras')
    .select('*', { count: 'exact', head: true })
    .eq('extra_id', extraId)

// --- product_extras (qué extras aplican a cada producto) ---

export const getProductExtras = (productId: string) =>
  supabase
    .from('product_extras')
    .select('*, extras(*)')
    .eq('product_id', productId)

export const addProductExtra = (productId: string, extraId: string) =>
  supabase
    .from('product_extras')
    .insert({ product_id: productId, extra_id: extraId })
    .select()
    .single()

export const removeProductExtra = (productId: string, extraId: string) =>
  supabase
    .from('product_extras')
    .delete()
    .eq('product_id', productId)
    .eq('extra_id', extraId)

// IDs de productos de la sede que tienen al menos un extra ACTIVO asignado.
// Se usa en POS/Mesas para decidir si abrir el modal de configuración.
export const getProductsWithActiveExtras = (restaurantId: string) =>
  supabase
    .from('product_extras')
    .select('product_id, products!inner(restaurant_id), extras!inner(is_active)')
    .eq('products.restaurant_id', restaurantId)
    .eq('extras.is_active', true)

// --- Venta con extras (RPC atómica) ---

// La RPC lee precio y producto vinculado de la BD (datos de confianza); el
// cliente solo aporta extra_id y qty (por unidad del ítem).
export type OrderItemExtraPayload = {
  extra_id: string
  qty: number
}

export type OrderItemPayload = {
  product_id: string
  qty: number
  unit_price: number
  notes: string | null
  extras: OrderItemExtraPayload[]
}

// Inserta order_items + order_item_extras y descuenta stock vinculado, atómico.
export const addOrderItemsWithExtras = (orderId: string, items: OrderItemPayload[]) =>
  supabase.rpc('add_order_items_with_extras', {
    p_order_id: orderId,
    p_items: items as unknown as Json,
  })

// --- Inventario por recetas: product_components (receta / BOM) ---

// Insumo de una receta, con datos del producto componente para mostrarlo.
export type ProductComponentRow = Tables<'product_components'> & {
  component: Pick<Tables<'products'>, 'id' | 'name' | 'stock_qty' | 'stock_tracking' | 'kind'> | null
}

export const getProductComponents = (parentId: string) =>
  supabase
    .from('product_components')
    .select(
      '*, component:products!product_components_component_id_fkey(id, name, stock_qty, stock_tracking, kind)',
    )
    .eq('parent_id', parentId)
    .order('created_at')

export const addProductComponent = (row: TablesInsert<'product_components'>) =>
  supabase.from('product_components').insert(row).select().single()

export const updateProductComponentQty = (id: string, qty: number) =>
  supabase.from('product_components').update({ qty }).eq('id', id)

export const removeProductComponent = (id: string) =>
  supabase.from('product_components').delete().eq('id', id)

// --- Inventario: ajuste manual de stock (RPC atómica SECURITY DEFINER) ---

// qty CON SIGNO (+entrada / -salida). La RPC valida sede + permiso
// productos.editar, actualiza stock e inserta el movimiento en una transacción.
export const adjustStock = (productId: string, qty: number, reason: string) =>
  supabase.rpc('adjust_stock', {
    p_product_id: productId,
    p_qty: qty,
    p_reason: reason,
  })

// --- Inventario: movimientos de stock (auditoría append-only, paginada) ---

export type StockMovementType = 'sale' | 'adjustment' | 'return' | 'purchase'

export interface StockMovementsFilters {
  restaurantId: string
  type?: StockMovementType | null
  from?: string        // ISO inicio (createdAt >=)
  to?: string          // ISO fin (createdAt <=)
  page: number         // 0-based
  pageSize: number
}

export interface StockMovementRow {
  id: string
  created_at: string
  type: string
  qty: number
  reference_id: string | null
  notes: string | null
  product_id: string
  products: { name: string } | null
  profiles: { full_name: string | null } | null
}

export const getStockMovements = ({
  restaurantId, type, from, to, page, pageSize,
}: StockMovementsFilters) => {
  let q = supabase
    .from('stock_movements')
    .select(
      'id, created_at, type, qty, reference_id, notes, product_id, products(name), profiles(full_name)',
      { count: 'exact' },
    )
    .eq('restaurant_id', restaurantId)

  if (type) q = q.eq('type', type)
  if (from) q = q.gte('created_at', from)
  if (to) q = q.lte('created_at', to)

  const fromIdx = page * pageSize
  return q
    .order('created_at', { ascending: false })
    .range(fromIdx, fromIdx + pageSize - 1)
}

// --- Storage: product-images ---

export const uploadProductImage = async (
  restaurantId: string,
  productId: string,
  file: File,
): Promise<string | null> => {
  const ext = file.name.split('.').pop() ?? 'jpg'
  const path = `${restaurantId}/${productId}.${ext}`
  const { data, error } = await supabase.storage
    .from('product-images')
    .upload(path, file, { upsert: true })
  if (error || !data) return null
  const { data: { publicUrl } } = supabase.storage
    .from('product-images')
    .getPublicUrl(data.path)
  return publicUrl
}

export const deleteProductImage = async (imageUrl: string): Promise<void> => {
  try {
    const path = new URL(imageUrl).pathname.split('/product-images/')[1]
    if (path) await supabase.storage.from('product-images').remove([path])
  } catch {
    // URL inválida — ignorar silenciosamente
  }
}

// --- Tables ---

export const getTables = (restaurantId: string) =>
  supabase.from('tables').select('*').eq('restaurant_id', restaurantId).order('name')

export const createTable = (table: TablesInsert<'tables'>) =>
  supabase.from('tables').insert(table).select().single()

export const updateTable = (tableId: string, data: TablesUpdate<'tables'>) =>
  supabase.from('tables').update(data).eq('id', tableId).select().single()

export const deleteTable = (tableId: string) =>
  supabase.from('tables').delete().eq('id', tableId)

export const updateTableStatus = (
  tableId: string,
  status: Tables<'tables'>['status'],
) => supabase.from('tables').update({ status }).eq('id', tableId).select().single()

export const getTableActiveOrderCount = (tableId: string) =>
  supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .eq('table_id', tableId)
    .in('status', ['pending', 'preparing', 'ready'])

const ORDER_ITEMS_WITH_EXTRAS = `
  id, qty, unit_price, notes, sent_to_kitchen,
  products(id, name, price),
  order_item_extras(id, qty, unit_price, extras(id, name))
` as const

export const getActiveOrderByTable = (tableId: string) =>
  supabase
    .from('orders')
    .select(`*, order_items(${ORDER_ITEMS_WITH_EXTRAS})`)
    .eq('table_id', tableId)
    .in('status', ['pending', 'preparing', 'ready'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

export const getActiveOrdersForTables = (tableIds: string[]) =>
  supabase
    .from('orders')
    .select(`*, order_items(${ORDER_ITEMS_WITH_EXTRAS})`)
    .in('table_id', tableIds)
    .in('status', ['pending', 'preparing', 'ready'])

export const markItemsSentToKitchen = (itemIds: string[]) =>
  supabase
    .from('order_items')
    .update({ sent_to_kitchen: true })
    .in('id', itemIds)

// --- Orders ---

const ORDER_WITH_RELATIONS = `
  *,
  tables(id, name),
  order_items(
    id, qty, unit_price, modifiers, notes,
    products(id, name, price)
  )
` as const

export const getOrders = (restaurantId: string, status?: Tables<'orders'>['status']) => {
  const base = supabase
    .from('orders')
    .select(ORDER_WITH_RELATIONS)
    .eq('restaurant_id', restaurantId)
    .order('created_at', { ascending: false })

  return status ? base.eq('status', status) : base
}

export const getOrderById = (orderId: string) =>
  supabase.from('orders').select(ORDER_WITH_RELATIONS).eq('id', orderId).single()

export const createOrder = (order: TablesInsert<'orders'>) =>
  supabase.from('orders').insert(order).select().single()

export const updateOrderStatus = (orderId: string, status: Tables<'orders'>['status']) =>
  supabase.from('orders').update({ status }).eq('id', orderId).select().single()

export const updateOrderTotal = (orderId: string, total: number) =>
  supabase.from('orders').update({ total }).eq('id', orderId)

// --- Numeración secuencial de ventas (por sede) ---

// Devuelve el siguiente número correlativo de la sede (incremento atómico en
// la BD). Solo debe llamarse para una venta YA cobrada.
export const nextOrderNumber = (restaurantId: string) =>
  supabase.rpc('next_order_number', { p_restaurant_id: restaurantId })

// Graba el número correlativo en la orden ya cobrada.
export const setOrderNumber = (orderId: string, orderNumber: number) =>
  supabase.from('orders').update({ order_number: orderNumber }).eq('id', orderId)

// Asigna el número correlativo a una venta completada: pide el siguiente número
// a la sede y lo graba en la orden. Devuelve el número o null si algo falla
// (no debe tumbar el cobro: la venta ya quedó registrada con su pago).
export const assignOrderNumber = async (
  orderId: string,
  restaurantId: string,
): Promise<number | null> => {
  const { data, error } = await nextOrderNumber(restaurantId)
  if (error || typeof data !== 'number') return null
  const { error: setErr } = await setOrderNumber(orderId, data)
  if (setErr) return null
  return data
}

// --- Historial de ventas (ventas completadas, con número) ---

export interface SalesHistoryFilters {
  restaurantId: string
  from?: string        // ISO inicio (createdAt >=)
  to?: string          // ISO fin (createdAt <=)
  method?: Enums<'payment_method'> | null
  orderNumber?: number | null
  page: number         // 0-based
  pageSize: number
}

export interface SalesHistoryRow {
  id: string
  order_number: number | null
  created_at: string
  type: Enums<'order_type'>
  customer_name: string | null
  total: number
  payments: { method: Enums<'payment_method'>; amount: number }[]
  profiles: { full_name: string | null } | null
}

export const getSalesHistory = ({
  restaurantId, from, to, method, orderNumber, page, pageSize,
}: SalesHistoryFilters) => {
  const paymentsSel = method ? 'payments!inner(method, amount)' : 'payments(method, amount)'
  const select =
    `id, order_number, created_at, type, customer_name, total, ` +
    `${paymentsSel}, profiles!orders_created_by_fkey(full_name)`

  let q = supabase
    .from('orders')
    .select(select, { count: 'exact' })
    .eq('restaurant_id', restaurantId)
    .not('order_number', 'is', null)

  if (orderNumber != null) q = q.eq('order_number', orderNumber)
  if (from) q = q.gte('created_at', from)
  if (to) q = q.lte('created_at', to)
  if (method) q = q.eq('payments.method', method)

  const fromIdx = page * pageSize
  return q
    .order('order_number', { ascending: false })
    .range(fromIdx, fromIdx + pageSize - 1)
}

export interface SaleDetailRow {
  id: string
  order_number: number | null
  created_at: string
  type: Enums<'order_type'>
  customer_name: string | null
  customer_phone: string | null
  notes: string | null
  waiter_name: string | null
  total: number
  payments: { method: Enums<'payment_method'>; amount: number }[]
  profiles: { full_name: string | null } | null
  order_items: {
    id: string
    qty: number
    unit_price: number
    notes: string | null
    products: { name: string } | null
    order_item_extras: {
      id: string
      qty: number
      unit_price: number
      extras: { name: string } | null
    }[]
  }[]
}

export const getSaleDetail = (orderId: string) =>
  supabase
    .from('orders')
    .select(`
      id, order_number, created_at, type, customer_name, customer_phone, notes, waiter_name, total,
      payments(method, amount),
      profiles!orders_created_by_fkey(full_name),
      order_items(
        id, qty, unit_price, notes,
        products(name),
        order_item_extras(id, qty, unit_price, extras(name))
      )
    `)
    .eq('id', orderId)
    .single()

// --- Order Items ---

export const addOrderItems = (items: TablesInsert<'order_items'>[]) =>
  supabase.from('order_items').insert(items).select()

export const updateOrderItem = (itemId: string, data: TablesUpdate<'order_items'>) =>
  supabase.from('order_items').update(data).eq('id', itemId).select().single()

export const removeOrderItem = (itemId: string) =>
  supabase.from('order_items').delete().eq('id', itemId)

// --- Payments ---

export const createPayment = (payment: TablesInsert<'payments'>) =>
  supabase.from('payments').insert(payment).select().single()

export const getOrderPayments = (orderId: string) =>
  supabase.from('payments').select('*').eq('order_id', orderId)

export const getShiftPayments = (restaurantId: string, from: string) =>
  supabase
    .from('payments')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .gte('created_at', from)

// --- Cash Movements ---

export const getCashMovements = (shiftId: string) =>
  supabase
    .from('cash_movements')
    .select('*')
    .eq('shift_id', shiftId)
    .order('created_at', { ascending: false })

export const createCashMovement = (movement: TablesInsert<'cash_movements'>) =>
  supabase.from('cash_movements').insert(movement).select().single()

// --- Cash Shifts ---

export const getOpenShift = (restaurantId: string) =>
  supabase
    .from('cash_shifts')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .is('closed_at', null)
    .maybeSingle()

export const openShift = (shift: TablesInsert<'cash_shifts'>) =>
  supabase.from('cash_shifts').insert(shift).select().single()

export const closeShift = (
  shiftId: string,
  data: Pick<
    TablesUpdate<'cash_shifts'>,
    'closing_amount' | 'closed_by' | 'closed_at' | 'expected_amount' | 'difference'
  >,
) => supabase.from('cash_shifts').update(data).eq('id', shiftId).select().single()

// --- Couriers ---

export const getCouriers = (restaurantId: string) =>
  supabase
    .from('couriers')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('is_active', true)
    .order('name')

export const upsertCourier = (data: TablesInsert<'couriers'>) =>
  supabase.from('couriers').upsert(data).select().single()

export const deleteCourier = (courierId: string) =>
  supabase.from('couriers').update({ is_active: false }).eq('id', courierId)

// --- Delivery orders ---

export const getDeliveryOrders = (restaurantId: string) => {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayISO = todayStart.toISOString()

  return supabase
    .from('orders')
    .select(`
      *,
      order_items(id, qty, unit_price, notes, products(id, name, price)),
      couriers(id, name, phone)
    `)
    .eq('restaurant_id', restaurantId)
    .eq('type', 'delivery')
    .neq('status', 'cancelled')
    .or(`status.in.(pending,preparing,ready),created_at.gte.${todayISO}`)
    .order('created_at', { ascending: false })
}

export const assignOrderCourier = (
  orderId: string,
  courierId: string | null,
  estimatedMinutes: number | null,
) =>
  supabase
    .from('orders')
    .update({ courier_id: courierId, estimated_delivery_minutes: estimatedMinutes })
    .eq('id', orderId)
    .select()
    .single()

// --- All couriers (including inactive, for config panel) ---

export const getAllCouriers = (restaurantId: string) =>
  supabase
    .from('couriers')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('name')

// --- Profiles (restaurant users, for admin config) ---

export const getRestaurantProfiles = (restaurantId: string) =>
  supabase.from('profiles').select('*').eq('restaurant_id', restaurantId).order('full_name')

export const updateProfile = (userId: string, data: TablesUpdate<'profiles'>) =>
  supabase.from('profiles').update(data).eq('id', userId).select().single()

export const createUser = (params: {
  email: string
  password: string
  full_name: string
  role: 'admin' | 'cashier' | 'waiter'
  restaurant_id: string
}) => supabase.functions.invoke('create-user', { body: params })

// --- Storage: restaurant-logos (logo + nequi QR) ---

export const uploadRestaurantLogo = async (
  restaurantId: string,
  file: File,
): Promise<string | null> => {
  const ext = file.name.split('.').pop() ?? 'png'
  const path = `${restaurantId}/logo.${ext}`
  const { data, error } = await supabase.storage
    .from('restaurant-logos')
    .upload(path, file, { upsert: true })
  if (error || !data) return null
  const { data: { publicUrl } } = supabase.storage
    .from('restaurant-logos')
    .getPublicUrl(data.path)
  return publicUrl
}

export const uploadNequiQR = async (
  restaurantId: string,
  file: File,
): Promise<string | null> => {
  const ext = file.name.split('.').pop() ?? 'png'
  const path = `${restaurantId}/nequi-qr.${ext}`
  const { data, error } = await supabase.storage
    .from('restaurant-logos')
    .upload(path, file, { upsert: true })
  if (error || !data) return null
  const { data: { publicUrl } } = supabase.storage
    .from('restaurant-logos')
    .getPublicUrl(data.path)
  return publicUrl
}

// --- Compras / Proveedores (F5) ---

export type Supplier = Tables<'suppliers'>

// Proveedores ACTIVOS de la sede (borrado = soft-deactivate, ver deleteSupplier).
export const getSuppliers = (restaurantId: string) =>
  supabase
    .from('suppliers')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('is_active', true)
    .order('name')

export const upsertSupplier = (data: TablesInsert<'suppliers'>) =>
  supabase.from('suppliers').upsert(data).select().single()

// Soft delete: purchase_invoices.supplier_id es ON DELETE RESTRICT, así que un
// proveedor con facturas no se puede borrar. Se desactiva (patrón couriers).
export const deleteSupplier = (supplierId: string) =>
  supabase.from('suppliers').update({ is_active: false }).eq('id', supplierId)

// Payload de la compra. La RPC register_purchase DERIVA total/subtotales y el
// restaurant_id; del cliente solo se usan estos campos (unit_cost es el costo
// capturado del documento físico).
export type PurchaseInvoicePayload = {
  supplier_id: string
  invoice_number: string | null
  payment_method: string            // 'cash' | 'card' | 'transfer' | 'nequi'
  notes: string | null
}

export type PurchaseItemPayload = {
  product_id: string
  qty: number
  unit_cost: number
}

// Resultado de register_purchase (el jsonb que retorna la RPC).
export interface RegisterPurchaseResult {
  invoice_id: string
  total: number
  cash_movement_created: boolean
  shift_open: boolean
}

// Registra la compra de forma atómica (sube stock, actualiza cost_price y, si
// es efectivo con turno abierto, genera el egreso de caja). SECURITY DEFINER.
export const registerPurchase = (
  invoice: PurchaseInvoicePayload,
  items: PurchaseItemPayload[],
) =>
  supabase.rpc('register_purchase', {
    p_invoice: invoice as unknown as Json,
    p_items: items as unknown as Json,
  })

// Historial de compras (cabeceras), paginado y ordenado por fecha desc.
export interface PurchaseInvoicesFilters {
  restaurantId: string
  page: number
  pageSize: number
}

export interface PurchaseInvoiceListRow {
  id: string
  created_at: string
  invoice_number: string | null
  total: number
  payment_method: string
  suppliers: { name: string } | null
  profiles: { full_name: string | null } | null
}

export const getPurchaseInvoices = ({
  restaurantId, page, pageSize,
}: PurchaseInvoicesFilters) => {
  const fromIdx = page * pageSize
  return supabase
    .from('purchase_invoices')
    .select(
      'id, created_at, invoice_number, total, payment_method, ' +
        'suppliers(name), profiles!purchase_invoices_created_by_fkey(full_name)',
      { count: 'exact' },
    )
    .eq('restaurant_id', restaurantId)
    .order('created_at', { ascending: false })
    .range(fromIdx, fromIdx + pageSize - 1)
}

// Detalle de una factura: cabecera + ítems con nombre de producto.
export interface PurchaseInvoiceDetailRow {
  id: string
  created_at: string
  invoice_number: string | null
  total: number
  payment_method: string
  notes: string | null
  suppliers: { name: string; contact_name: string | null; phone: string | null } | null
  profiles: { full_name: string | null } | null
  purchase_invoice_items: {
    id: string
    qty: number
    unit_cost: number
    subtotal: number
    products: { name: string } | null
  }[]
}

export const getPurchaseInvoiceDetail = (invoiceId: string) =>
  supabase
    .from('purchase_invoices')
    .select(
      'id, created_at, invoice_number, total, payment_method, notes, ' +
        'suppliers(name, contact_name, phone), ' +
        'profiles!purchase_invoices_created_by_fkey(full_name), ' +
        'purchase_invoice_items(id, qty, unit_cost, subtotal, products(name))',
    )
    .eq('id', invoiceId)
    .single()
