import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { usePermissions } from '@/hooks/usePermissions'
import { debeIrAMovil } from '@/lib/posMovil'

interface ProtectedRouteProps {
  /** Permiso RBAC requerido para acceder. Sin él, cualquier autenticado pasa. */
  permission?: string
}

export function ProtectedRoute({ permission }: ProtectedRouteProps) {
  const { user, profile, isLoading } = useAuth()
  const { can, isLoading: permsLoading } = usePermissions()
  const location = useLocation()

  if (isLoading || (permission && permsLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="w-6 h-6 border-2 border-slate-200 border-t-slate-700 rounded-full animate-spin" />
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  // En un CELULAR, quien cobra va al POS móvil (/m). Solo en el nivel de arriba
  // (sin permiso): los ProtectedRoute anidados ya pasaron por acá. Un mozo no se
  // redirige (/m solo cobra y él no puede); Cocina está fuera de ProtectedRoute.
  if (!permission && debeIrAMovil(profile?.role, location.pathname)) {
    return <Navigate to="/m" replace />
  }

  if (permission && !can(permission)) {
    return <Navigate to="/ventas" replace />
  }

  return <Outlet />
}
