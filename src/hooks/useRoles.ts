import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import type { Tables } from '@/types/database.types'

export type RoleRow = Tables<'roles'>

/** Lee el array de permisos de un rol (jsonb) de forma segura. */
export function rolePermissions(role: Pick<RoleRow, 'permissions'>): string[] {
  const p = role.permissions
  return Array.isArray(p) ? (p as string[]) : []
}

/**
 * CRUD de roles RBAC de la organización. Los roles is_system no se editan ni
 * eliminan. No se permite eliminar un rol con usuarios asignados (roleCounts).
 */
export function useRoles() {
  const { organizationId } = useAuth()
  const queryClient = useQueryClient()

  const { data: roles = [], isLoading } = useQuery({
    queryKey: ['org_roles', organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roles')
        .select('*')
        .eq('organization_id', organizationId!)
        .order('is_system', { ascending: false })
        .order('name')
      if (error) throw error
      return data ?? []
    },
    enabled: !!organizationId,
    staleTime: 5 * 60_000,
  })

  // Conteo de usuarios por role_id (impide borrar roles asignados).
  const { data: roleCounts = {} } = useQuery({
    queryKey: ['org_role_counts', organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('role_id')
        .eq('organization_id', organizationId!)
      if (error) throw error
      const counts: Record<string, number> = {}
      for (const p of data ?? []) {
        if (p.role_id) counts[p.role_id] = (counts[p.role_id] ?? 0) + 1
      }
      return counts
    },
    enabled: !!organizationId,
    staleTime: 60_000,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['org_roles', organizationId] })
    queryClient.invalidateQueries({ queryKey: ['org_role_counts', organizationId] })
  }

  const createRoleMut = useMutation({
    mutationFn: async ({ name, permissions }: { name: string; permissions: string[] }) => {
      const { error } = await supabase.from('roles').insert({
        organization_id: organizationId!,
        name,
        is_system: false,
        permissions,
      })
      if (error) throw error
    },
    onSuccess: () => { invalidate(); toast.success('Rol creado') },
    onError: () => toast.error('Error al crear el rol'),
  })

  const updateRoleMut = useMutation({
    mutationFn: async ({ id, name, permissions }: { id: string; name?: string; permissions?: string[] }) => {
      const patch: { name?: string; permissions?: string[] } = {}
      if (name !== undefined) patch.name = name
      if (permissions !== undefined) patch.permissions = permissions
      const { error } = await supabase.from('roles').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { invalidate(); toast.success('Rol actualizado') },
    onError: () => toast.error('Error al actualizar el rol'),
  })

  const deleteRoleMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('roles').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { invalidate(); toast.success('Rol eliminado') },
    onError: () => toast.error('Error al eliminar el rol'),
  })

  return {
    roles,
    roleCounts,
    isLoading,
    createRole: createRoleMut.mutateAsync,
    updateRole: updateRoleMut.mutateAsync,
    deleteRole: deleteRoleMut.mutateAsync,
    isMutating: createRoleMut.isPending || updateRoleMut.isPending || deleteRoleMut.isPending,
  }
}
