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

export const updateProductStock = (productId: string, stock_qty: number) =>
  supabase.from('products').update({ stock_qty }).eq('id', productId)

// --- Tables ---

export const getTables = (restaurantId: string) =>
  supabase.from('tables').select('*').eq('restaurant_id', restaurantId).order('name')

export const updateTableStatus = (
  tableId: string,
  status: Tables<'tables'>['status'],
) => supabase.from('tables').update({ status }).eq('id', tableId).select().single()

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
