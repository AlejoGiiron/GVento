import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { usePermissions } from '@/hooks/usePermissions'

interface ProtectedRouteProps {
  /** Permiso RBAC requerido para acceder. Sin él, cualquier autenticado pasa. */
  permission?: string
}

export function ProtectedRoute({ permission }: ProtectedRouteProps) {
  const { user, isLoading } = useAuth()
  const { can, isLoading: permsLoading } = usePermissions()

  if (isLoading || (permission && permsLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="w-6 h-6 border-2 border-slate-200 border-t-slate-700 rounded-full animate-spin" />
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  if (permission && !can(permission)) {
    return <Navigate to="/ventas" replace />
  }

  return <Outlet />
}
