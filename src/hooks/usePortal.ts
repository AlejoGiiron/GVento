import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import type { Json } from '@/types/database.types'
import type {
  CambioProducto, EstadoPortal, PortalCambios, PortalConfigRespuesta, ProductoPortal,
} from '@/lib/portal'

// Pedidos en línea (P1). Todo pasa por las funciones de supabase/portal-config.sql: las tablas
// portal_sedes y portal_productos no se leen ni se escriben directo.

const mensaje = (err: unknown) => (err as { message?: string })?.message ?? 'Error desconocido'

export function usePortalConfig() {
  const { profile } = useAuth()
  const sede = profile?.restaurant_id
  return useQuery({
    queryKey: ['portal-config', sede],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('portal_config')
      if (error) throw error
      return data as unknown as PortalConfigRespuesta
    },
    enabled: !!sede,
    // El estado depende de la hora y del turno: se refresca solo.
    refetchInterval: 60_000,
  })
}

export function usePortalProductos() {
  const { profile } = useAuth()
  const sede = profile?.restaurant_id
  return useQuery({
    queryKey: ['portal-productos', sede],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('portal_productos_lista')
      if (error) throw error
      return (data ?? []) as ProductoPortal[]
    },
    enabled: !!sede,
  })
}

/** ¿El link está libre? (false también si el formato no es válido). */
export async function consultarSlugDisponible(slug: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('portal_slug_disponible', { p_slug: slug })
  if (error) throw error
  return data === true
}

export function usePortalMutations() {
  const { profile } = useAuth()
  const sede = profile?.restaurant_id
  const qc = useQueryClient()
  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ['portal-config', sede] })
    qc.invalidateQueries({ queryKey: ['portal-productos', sede] })
  }

  // Solo las claves que cambian; el servidor las fusiona con lo que hay (como update_restaurant_config).
  const actualizar = useMutation({
    mutationFn: async (cambios: PortalCambios) => {
      const { data, error } = await supabase.rpc('actualizar_portal', { p_cambios: cambios as unknown as Json })
      if (error) throw error
      return data as unknown as PortalConfigRespuesta
    },
    onSuccess: (data) => { qc.setQueryData(['portal-config', sede], data); refrescar(); toast.success('Cambios guardados') },
    onError: (err) => toast.error(mensaje(err)),
  })

  const pausar = useMutation({
    mutationFn: async (pausar: boolean) => {
      const { data, error } = await supabase.rpc('pausar_pedidos_online', { p_pausar: pausar })
      if (error) throw error
      return data as unknown as EstadoPortal
    },
    onSuccess: (_d, pausado) => { refrescar(); toast.success(pausado ? 'Pedidos en línea pausados' : 'Pedidos en línea reanudados') },
    onError: (err) => toast.error(mensaje(err)),
  })

  const guardarProductos = useMutation({
    mutationFn: async (cambios: CambioProducto[]) => {
      const { data, error } = await supabase.rpc('guardar_portal_productos', { p_cambios: cambios as unknown as Json })
      if (error) throw error
      return data as number
    },
    onSuccess: () => { refrescar(); toast.success('Productos del portal guardados') },
    onError: (err) => toast.error(mensaje(err)),
  })

  return {
    actualizar: actualizar.mutateAsync,
    pausar: pausar.mutateAsync,
    guardarProductos: guardarProductos.mutateAsync,
    guardando: actualizar.isPending || pausar.isPending || guardarProductos.isPending,
  }
}
