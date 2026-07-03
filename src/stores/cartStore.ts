import { create } from 'zustand'
import type { Tables } from '@/types/database.types'

export type ProductWithCategory = Tables<'products'> & {
  categories: Pick<Tables<'categories'>, 'id' | 'name' | 'color'> | null
}

/**
 * Extra seleccionado en un ítem del carrito. `qty` es POR UNIDAD del producto:
 * el total consumido de la línea es `qty × item.qty` (así lo descuenta la RPC).
 * `price` y `name` son snapshots; `linked_product_id` decide si descuenta stock.
 */
export interface CartExtra {
  extra_id: string
  name: string
  price: number
  qty: number
  linked_product_id: string | null
}

export interface CartItem {
  id: string
  product: ProductWithCategory
  qty: number
  note: string
  extras: CartExtra[]
}

export type DiscountType = 'pct' | 'fixed'

/** Suma de extras de UNA unidad del ítem. */
export function cartItemExtrasUnit(item: Pick<CartItem, 'extras'>): number {
  return item.extras.reduce((a, e) => a + e.price * e.qty, 0)
}

/** Total de la línea: (precio producto + extras por unidad) × qty. */
export function cartItemTotal(item: Pick<CartItem, 'product' | 'qty' | 'extras'>): number {
  return (item.product.price + cartItemExtrasUnit(item)) * item.qty
}

/**
 * Venta pausada ("en espera"). Vive SOLO en memoria (Zustand); no se persiste
 * en Supabase ni en localStorage — son ventas efímeras que aún no se concretan.
 * Si se recarga la página se pierden (aceptable).
 */
export interface HeldOrder {
  id: string
  items: CartItem[]
  discount: number
  discountType: DiscountType
  customer: string | null
  label: string
  createdAt: number
}

function genId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function fallbackLabel(): string {
  const t = new Date().toLocaleTimeString('es-CO', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota',
  })
  return `Venta ${t}`
}

interface CartStore {
  items: CartItem[]
  discount: number
  discountType: DiscountType
  heldOrders: HeldOrder[]
  add: (product: ProductWithCategory) => void
  addItem: (product: ProductWithCategory, extras: CartExtra[]) => void
  setQty: (index: number, qty: number) => void
  setNote: (index: number, note: string) => void
  updateItemExtras: (id: string, extras: CartExtra[]) => void
  remove: (index: number) => void
  clear: () => void
  setDiscount: (discount: number, type?: DiscountType) => void
  holdCurrentOrder: (label: string) => void
  resumeHeldOrder: (id: string) => void
  discardHeldOrder: (id: string) => void
  /** Limpia TODO el estado de venta (carrito + descuento + ventas en espera).
   *  A diferencia de clear() (que deja vivas las ventas en espera), esto resetea
   *  la sesión completa. Se usa al cerrar sesión. */
  resetSession: () => void
}

export const useCartStore = create<CartStore>((set) => ({
  items: [],
  discount: 0,
  discountType: 'pct',
  heldOrders: [],

  // Alta rápida sin extras: fusiona con una línea existente del mismo producto
  // que no tenga nota NI extras (comportamiento original).
  add: (product) =>
    set((state) => {
      const idx = state.items.findIndex(
        (x) => x.product.id === product.id && !x.note && x.extras.length === 0,
      )
      if (idx >= 0) {
        const next = [...state.items]
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 }
        return { items: next }
      }
      return { items: [...state.items, { id: genId(), product, qty: 1, note: '', extras: [] }] }
    }),

  // Alta con extras: siempre crea una línea nueva (no fusiona) para no mezclar
  // configuraciones distintas del mismo producto.
  addItem: (product, extras) =>
    set((state) => {
      if (extras.length === 0) {
        const idx = state.items.findIndex(
          (x) => x.product.id === product.id && !x.note && x.extras.length === 0,
        )
        if (idx >= 0) {
          const next = [...state.items]
          next[idx] = { ...next[idx], qty: next[idx].qty + 1 }
          return { items: next }
        }
      }
      return { items: [...state.items, { id: genId(), product, qty: 1, note: '', extras }] }
    }),

  setQty: (index, qty) =>
    set((state) => {
      if (qty <= 0) return { items: state.items.filter((_, i) => i !== index) }
      const next = [...state.items]
      next[index] = { ...next[index], qty }
      return { items: next }
    }),

  setNote: (index, note) =>
    set((state) => {
      const next = [...state.items]
      next[index] = { ...next[index], note }
      return { items: next }
    }),

  updateItemExtras: (id, extras) =>
    set((state) => ({
      items: state.items.map((x) => (x.id === id ? { ...x, extras } : x)),
    })),

  remove: (index) =>
    set((state) => ({ items: state.items.filter((_, i) => i !== index) })),

  clear: () => set({ items: [], discount: 0, discountType: 'pct' }),

  setDiscount: (discount, type) =>
    set((state) => {
      const nextType = type ?? state.discountType
      // Endurecer: descartar NaN/Infinity, enteros, y clampear según el tipo.
      // Porcentaje: 0–100. Monto fijo: ≥ 0.
      let value = Number.isFinite(discount) ? Math.round(discount) : 0
      value = nextType === 'pct'
        ? Math.min(100, Math.max(0, value))
        : Math.max(0, value)
      return { discount: value, discountType: nextType }
    }),

  // Guarda el carrito activo en espera y lo limpia. No-op si está vacío.
  holdCurrentOrder: (label) =>
    set((state) => {
      if (state.items.length === 0) return {}
      const held: HeldOrder = {
        id: genId(),
        items: state.items,
        discount: state.discount,
        discountType: state.discountType,
        customer: null,
        label: label.trim() || fallbackLabel(),
        createdAt: Date.now(),
      }
      return {
        heldOrders: [...state.heldOrders, held],
        items: [],
        discount: 0,
        discountType: 'pct',
      }
    }),

  // Restaura una venta en espera al carrito (sobrescribe el actual) y la quita
  // de la lista. La decisión de qué hacer con el carrito actual la maneja la UI.
  resumeHeldOrder: (id) =>
    set((state) => {
      const held = state.heldOrders.find((h) => h.id === id)
      if (!held) return {}
      return {
        items: held.items,
        discount: held.discount,
        discountType: held.discountType,
        heldOrders: state.heldOrders.filter((h) => h.id !== id),
      }
    }),

  discardHeldOrder: (id) =>
    set((state) => ({
      heldOrders: state.heldOrders.filter((h) => h.id !== id),
    })),

  // Reset total de la sesión de venta. El estado del carrito y las ventas en
  // espera son del cajero actual: no deben sobrevivir a un cambio de usuario en
  // la misma pestaña (POS compartido). Se llama al cerrar sesión.
  resetSession: () =>
    set({ items: [], discount: 0, discountType: 'pct', heldOrders: [] }),
}))
