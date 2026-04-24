import { supabase } from './supabase'
import type { Tables, TablesInsert, TablesUpdate } from '@/types/database.types'

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

export const getActiveOrderByTable = (tableId: string) =>
  supabase
    .from('orders')
    .select(`
      *,
      order_items(
        id, qty, unit_price, notes, sent_to_kitchen,
        products(id, name, price)
      )
    `)
    .eq('table_id', tableId)
    .in('status', ['pending', 'preparing', 'ready'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

export const getActiveOrdersForTables = (tableIds: string[]) =>
  supabase
    .from('orders')
    .select(`
      *,
      order_items(
        id, qty, unit_price, notes, sent_to_kitchen,
        products(id, name, price)
      )
    `)
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

export const getShiftPayments = (restaurantId: string, from: string, to: string) =>
  supabase
    .from('payments')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .gte('created_at', from)
    .lte('created_at', to)

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
  data: Pick<TablesUpdate<'cash_shifts'>, 'closing_amount' | 'closed_by' | 'closed_at'>,
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
