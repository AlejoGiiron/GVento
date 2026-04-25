import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  ShoppingCart,
  LayoutGrid,
  ChefHat,
  Package,
  BarChart3,
  Settings,
  LogOut,
  Truck,
} from 'lucide-react'
import { toast } from 'react-hot-toast'
import { useAuth } from '@/hooks/useAuth'
import { useCashShift } from '@/hooks/useCashShift'
import { useDeliveryCount } from '@/hooks/useDeliveryCount'
import { ShiftBanner } from '@/components/shift/ShiftBanner'
import { OpenShiftModal } from '@/components/shift/OpenShiftModal'
import type { Enums } from '@/types/database.types'

type UserRole = Enums<'user_role'>

interface NavItem {
  to: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  roles?: UserRole[]
}

const NAV_ITEMS: NavItem[] = [
  { to: '/ventas', label: 'Ventas', icon: ShoppingCart },
  { to: '/mesas', label: 'Mesas', icon: LayoutGrid },
  { to: '/cocina', label: 'Cocina', icon: ChefHat },
  { to: '/delivery', label: 'Delivery', icon: Truck },
  { to: '/productos', label: 'Productos', icon: Package, roles: ['admin'] },
  { to: '/reportes', label: 'Reportes', icon: BarChart3, roles: ['admin'] },
  { to: '/config', label: 'Configuración', icon: Settings, roles: ['admin'] },
]

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador',
  cashier: 'Cajero',
  waiter: 'Mesero',
}

export function AppLayout() {
  const { profile, signOut } = useAuth()
  const { isOpen, isLoadingShift } = useCashShift()
  const deliveryCount = useDeliveryCount()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await signOut()
    toast.success('Sesión cerrada')
    navigate('/login', { replace: true })
  }

  const visibleItems = NAV_ITEMS.filter(
    item => !item.roles || (profile && item.roles.includes(profile.role)),
  )

  const initials = profile?.full_name
    ?.split(' ')
    .slice(0, 2)
    .map(n => n[0])
    .join('')
    .toUpperCase()

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 bg-slate-900 flex flex-col">
        <div className="px-5 py-4 border-b border-slate-700/60">
          <span className="text-white font-bold text-lg tracking-tight">G-Vento</span>
          <span className="block text-slate-400 text-xs mt-0.5">Sistema POS</span>
        </div>

        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {visibleItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
                }`
              }
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span className="flex-1">{label}</span>
              {to === '/delivery' && deliveryCount > 0 && (
                <span
                  className="ml-auto text-xs font-bold rounded-full px-1.5 py-0.5 min-w-[18px] text-center leading-none"
                  style={{ background: '#f59e0b', color: '#fff' }}
                >
                  {deliveryCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="p-2 border-t border-slate-700/60">
          <button
            onClick={handleSignOut}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:bg-slate-800 hover:text-slate-100 transition-colors"
          >
            <LogOut className="w-4 h-4 flex-shrink-0" />
            Cerrar sesión
          </button>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-14 flex-shrink-0 flex items-center justify-between px-6 border-b border-slate-200 bg-white">
          {/* Left: shift banner */}
          <ShiftBanner />

          {/* Right: user info */}
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-sm font-medium text-slate-900 leading-tight">
                {profile?.full_name ?? '—'}
              </p>
              <p className="text-xs text-slate-500">
                {profile ? ROLE_LABELS[profile.role] : ''}
              </p>
            </div>
            <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-semibold text-slate-600 select-none">
              {initials ?? '?'}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-hidden bg-white">
          <Outlet />
        </main>
      </div>

      {/* Blocking open-shift modal — shown when no active shift */}
      {!isLoadingShift && !isOpen && <OpenShiftModal />}
    </div>
  )
}
