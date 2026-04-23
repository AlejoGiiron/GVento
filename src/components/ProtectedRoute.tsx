import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import type { Enums } from '@/types/database.types'

interface ProtectedRouteProps {
  roles?: Enums<'user_role'>[]
}

export function ProtectedRoute({ roles }: ProtectedRouteProps) {
  const { user, profile, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="w-6 h-6 border-2 border-slate-200 border-t-slate-700 rounded-full animate-spin" />
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  if (roles && profile && !roles.includes(profile.role)) {
    return <Navigate to="/ventas" replace />
  }

  return <Outlet />
}
