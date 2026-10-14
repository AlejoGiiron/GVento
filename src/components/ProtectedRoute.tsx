import { useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { usePermissions } from '@/hooks/usePermissions'
import { debeIrAMovil, cargarDocumento, esRutaMovil } from '@/lib/posMovil'

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

  // Sin sesión (nunca entró, cerró sesión o la sesión venció): desde /m, al login
  // de /m, que está dentro del alcance de la app instalada; desde el resto, al de siempre.
  if (!user) return <Navigate to={esRutaMovil(location.pathname) ? '/m/login' : '/login'} replace />

  // En un CELULAR, dueño, admin y cajero van al POS móvil (/m) — y solo si tienen
  // pos.vender (A): nunca se manda a /m a quien el servidor no deja vender. El mozo
  // no se redirige hasta M2 (entra a /m por URL). Solo en el nivel de arriba (sin
  // permiso): los ProtectedRoute anidados ya pasaron por acá. Cocina está fuera.
  if (!permission && debeIrAMovil(profile?.role, location.pathname)) {
    if (permsLoading) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-white">
          <div className="w-6 h-6 border-2 border-slate-200 border-t-slate-700 rounded-full animate-spin" />
        </div>
      )
    }
    if (can('pos.vender')) return <CargarMovil />
  }

  if (permission && !can(permission)) {
    return <Navigate to="/ventas" replace />
  }

  return <Outlet />
}

// Carga COMPLETA de /m (no <Navigate>): el documento de /m trae su manifest
// escrito, que es lo que Safari de iPhone usa al "Agregar a inicio".
function CargarMovil() {
  useEffect(() => { cargarDocumento('/m', true) }, [])
  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="w-6 h-6 border-2 border-slate-200 border-t-slate-700 rounded-full animate-spin" />
    </div>
  )
}
