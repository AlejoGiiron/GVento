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

interface CartStore {
  items: CartItem[]
  discount: number
  discountType: DiscountType
  add: (product: ProductWithCategory) => void
  setQty: (index: number, qty: number) => void
  setNote: (index: number, note: string) => void
  remove: (index: number) => void
  clear: () => void
  setDiscount: (discount: number, type?: DiscountType) => void
}

export const useCartStore = create<CartStore>((set) => ({
  items: [],
  discount: 0,
  discountType: 'pct',

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
    set((state) => ({
      discount,
      discountType: type ?? state.discountType,
    })),
}))
