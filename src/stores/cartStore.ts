import { create } from 'zustand'
import type { Tables } from '@/types/database.types'

export type ProductWithCategory = Tables<'products'> & {
  categories: Pick<Tables<'categories'>, 'id' | 'name' | 'color'> | null
}

export interface CartItem {
  product: ProductWithCategory
  qty: number
  note: string
}

export type DiscountType = 'pct' | 'fixed'

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
  setQty: (index: number, qty: number) => void
  setNote: (index: number, note: string) => void
  remove: (index: number) => void
  clear: () => void
  setDiscount: (discount: number, type?: DiscountType) => void
  holdCurrentOrder: (label: string) => void
  resumeHeldOrder: (id: string) => void
  discardHeldOrder: (id: string) => void
}

export const useCartStore = create<CartStore>((set) => ({
  items: [],
  discount: 0,
  discountType: 'pct',
  heldOrders: [],

  add: (product) =>
    set((state) => {
      const idx = state.items.findIndex((x) => x.product.id === product.id && !x.note)
      if (idx >= 0) {
        const next = [...state.items]
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 }
        return { items: next }
      }
      return { items: [...state.items, { product, qty: 1, note: '' }] }
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
}))
