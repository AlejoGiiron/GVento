import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import {
  upsertProduct,
  archiveProduct,
  upsertCategory,
  deleteCategory,
  uploadProductImage,
  deleteProductImage,
} from '@/lib/supabase-helpers'
import { useAuth } from '@/hooks/useAuth'
import type { TablesInsert } from '@/types/database.types'

export function useProductMutations() {
  const queryClient = useQueryClient()
  const { profile } = useAuth()

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['products', profile?.restaurant_id] })

  const saveProduct = useMutation({
    mutationFn: async (data: TablesInsert<'products'>) => {
      const { data: result, error } = await upsertProduct(data)
      if (error) throw error
      return result!
    },
    onSuccess: () => { invalidate(); toast.success('Producto guardado') },
    onError: () => toast.error('Error al guardar producto'),
  })

  const deactivateProduct = useMutation({
    mutationFn: async (productId: string) => {
      const { error } = await archiveProduct(productId)
      if (error) throw error
    },
    onSuccess: () => { invalidate(); toast.success('Producto desactivado') },
    onError: () => toast.error('Error al desactivar producto'),
  })

  const uploadImage = async (productId: string, file: File): Promise<string | null> => {
    if (!profile) return null
    const url = await uploadProductImage(profile.restaurant_id, productId, file)
    if (!url) toast.error('No se pudo subir la imagen — el producto se guardará sin ella')
    return url
  }

  const removeImage = async (imageUrl: string): Promise<void> => {
    await deleteProductImage(imageUrl)
  }

  return { saveProduct, deactivateProduct, uploadImage, removeImage }
}

export function useCategoryMutations() {
  const queryClient = useQueryClient()
  const { profile } = useAuth()

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['categories', profile?.restaurant_id] })
    queryClient.invalidateQueries({ queryKey: ['products', profile?.restaurant_id] })
  }

  const saveCategory = useMutation({
    mutationFn: async (data: TablesInsert<'categories'>) => {
      const { data: result, error } = await upsertCategory(data)
      if (error) throw error
      return result!
    },
    onSuccess: () => { invalidate(); toast.success('Categoría guardada') },
    onError: () => toast.error('Error al guardar categoría'),
  })

  const deactivateCategory = useMutation({
    mutationFn: async (categoryId: string) => {
      const { error } = await deleteCategory(categoryId)
      if (error) throw error
    },
    onSuccess: () => { invalidate(); toast.success('Categoría desactivada') },
    onError: () => toast.error('Error al desactivar categoría'),
  })

  return { saveCategory, deactivateCategory }
}
