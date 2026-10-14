import { useMemo, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'

/**
 * Capa de permisos RBAC en el frontend.
 *
 * Carga el rol del usuario (profiles.role_id → roles) con su array de
 * permisos y expone `can(permiso)` para gatear UI y rutas.
 *
 * El array `permissions` se lee directo de la tabla `roles` (más rápido que
 * llamar al RPC has_permission por cada check). La función SQL has_permission
 * sigue siendo la que aplica el RLS del lado del servidor.
 */
export function usePermissions() {
  const { profile, isLoading: authLoading } = useAuth()
  const roleId = profile?.role_id ?? null

  const { data: role, isLoading: roleLoading, isError: roleError, isFetching: roleFetching, refetch } = useQuery({
    queryKey: ['my_role', roleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roles')
        .select('name, permissions')
        .eq('id', roleId!)
        .single()
      if (error) throw error
      return data
    },
    enabled: !!roleId,
    staleTime: 30 * 60_000, // 30 min — los permisos cambian poco
    // Sin reintentos de React Query: postgrest-js 2.104 YA reintenta cada GET que falla por
    // red (3 veces: 1 s, 2 s, 4 s). Con los dos encadenados, sin red esto tardaba ~35 s en
    // dar error, y /m quedaba en "Cargando…" todo ese rato (medido el 2026-10-08). Así da
    // el error en ~7 s y la pantalla ofrece Reintentar. DEUDAS → "Doble reintento".
    retry: false,
  })

  const permissions = useMemo<string[]>(() => {
    const p = role?.permissions
    return Array.isArray(p) ? (p as string[]) : []
  }, [role])

  // El comodín "*" (solo el rol owner) concede cualquier permiso: así el owner
  // hereda automáticamente los permisos nuevos sin sembrarlos en cada org.
  const can = useCallback(
    (permission: string) =>
      permissions.includes(permission) || permissions.includes('*'),
    [permissions],
  )

  // isLoading: aún no sabemos los permisos. Si el usuario no tiene role_id,
  // no hay nada que cargar (permissions = []).
  const isLoading = authLoading || (!!roleId && roleLoading)

  return {
    can,
    isOwner: permissions.includes('*'),
    roleName: role?.name ?? null,
    permissions,
    isLoading,
    // La carga del rol FALLÓ (sin red, timeout, error) después de los reintentos de
    // React Query. Con esto, `permissions` vacío NO significa "no tiene permisos": quien
    // decide con can() tiene que mostrar el error, no un "no puedes" falso.
    isError: !!roleId && roleError,
    reintentando: roleFetching,
    reintentar: refetch,
  }
}
