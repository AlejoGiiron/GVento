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

  const { data: role, isLoading: roleLoading } = useQuery({
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
  })

  const permissions = useMemo<string[]>(() => {
    const p = role?.permissions
    return Array.isArray(p) ? (p as string[]) : []
  }, [role])

  const can = useCallback(
    (permission: string) => permissions.includes(permission),
    [permissions],
  )

  // isLoading: aún no sabemos los permisos. Si el usuario no tiene role_id,
  // no hay nada que cargar (permissions = []).
  const isLoading = authLoading || (!!roleId && roleLoading)

  return {
    can,
    isOwner: role?.name === 'owner',
    roleName: role?.name ?? null,
    permissions,
    isLoading,
  }
}
