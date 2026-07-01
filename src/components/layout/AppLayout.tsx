import { useState } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import {
  ShoppingCart,
  LayoutGrid,
  ChefHat,
  Package,
  Boxes,
  BarChart3,
  Receipt,
  Settings,
  LogOut,
  Truck,
  Wallet,
  ShoppingBag,
  HandCoins,
  ChevronDown,
  X,
} from 'lucide-react'
import { toast } from 'react-hot-toast'
import { useAuth } from '@/hooks/useAuth'
import { usePermissions } from '@/hooks/usePermissions'
import { useRestaurantConfig } from '@/hooks/useRestaurantConfig'
import { useCashShift } from '@/hooks/useCashShift'
import { useDeliveryCount } from '@/hooks/useDeliveryCount'
import { useCollapsedGroups } from '@/hooks/useCollapsedGroups'
import { ShiftBanner } from '@/components/shift/ShiftBanner'
import { OpenShiftModal } from '@/components/shift/OpenShiftModal'
import { StoreSelector } from '@/components/layout/StoreSelector'
import type { Enums } from '@/types/database.types'

type UserRole = Enums<'user_role'>

interface NavItem {
  to: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  /** Permiso RBAC requerido para mostrar el item. Sin él, siempre visible. */
  permission?: string
}

interface NavGroup {
  /** ID estable (kebab-case): clave de persistencia de colapso y de data-testid. */
  id: string
  label: string
  items: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    id: 'operacion',
    label: 'Operación',
    // Cocina va al FINAL: si se oculta por uses_kitchen=false no deja hueco.
    items: [
      { to: '/ventas', label: 'Ventas', icon: ShoppingCart },
      { to: '/mesas', label: 'Mesas', icon: LayoutGrid },
      { to: '/delivery', label: 'Delivery', icon: Truck, permission: 'delivery.gestionar' },
      { to: '/cocina', label: 'Cocina', icon: ChefHat, permission: 'cocina.acceder' },
    ],
  },
  {
    id: 'catalogo',
    label: 'Catálogo e inventario',
    items: [
      { to: '/productos', label: 'Productos', icon: Package, permission: 'productos.editar' },
      { to: '/inventario', label: 'Inventario', icon: Boxes, permission: 'productos.editar' },
      { to: '/compras', label: 'Compras', icon: ShoppingBag, permission: 'compras.gestionar' },
    ],
  },
  {
    id: 'clientes',
    label: 'Clientes y cobros',
    items: [
      { to: '/fiado', label: 'Fiado', icon: HandCoins, permission: 'fiado.gestionar' },
      { to: '/historial', label: 'Historial', icon: Receipt, permission: 'ventas.historial' },
    ],
  },
  {
    id: 'admin',
    label: 'Análisis y admin',
    items: [
      { to: '/reportes', label: 'Reportes', icon: BarChart3, permission: 'reportes.financiero' },
      { to: '/configuracion', label: 'Configuración', icon: Settings, permission: 'config.acceder' },
    ],
  },
]

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador',
  cashier: 'Cajero',
  waiter: 'Mesero',
}

export function AppLayout() {
  const { profile, signOut } = useAuth()
  const { can } = usePermissions()
  const { restaurant } = useRestaurantConfig()
  const { isOpen, isLoadingShift } = useCashShift()

  // Branding de la SEDE activa (restaurants): nombre + logo capturados en Config.
  const brandName = restaurant?.name ?? 'G-Vento'
  const brandLogo = restaurant?.logo_url ?? null
  const deliveryCount = useDeliveryCount()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { collapsed, toggle } = useCollapsedGroups()

  const [bannerDismissed, setBannerDismissed] = useState(false)
  const [showOpenShift, setShowOpenShift] = useState(false)

  const showShiftBanner = !isLoadingShift && !isOpen && !bannerDismissed

  const handleSignOut = async () => {
    await signOut()
    toast.success('Sesión cerrada')
    navigate('/login', { replace: true })
  }

  // Cocina depende de la sede: además del permiso, exige que la sede use cocina.
  // Default true mientras carga el restaurant (evita que el item parpadee).
  const sedeUsesKitchen = restaurant?.uses_kitchen ?? true

  // Gating por item (idéntico al de antes): permiso RBAC + cocina por sede.
  const isItemVisible = (item: NavItem) =>
    (!item.permission || can(item.permission))
    && (item.to !== '/cocina' || sedeUsesKitchen)

  // Grupos con sus items visibles; un grupo sin items visibles no se renderiza.
  const visibleGroups = NAV_GROUPS
    .map(group => ({ ...group, items: group.items.filter(isItemVisible) }))
    .filter(group => group.items.length > 0)

  // Ruta activa: match exacto o subruta (evita falsos positivos /venta vs /ventas).
  const isRouteActive = (to: string) =>
    pathname === to || pathname.startsWith(to + '/')

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
        <div className="px-5 py-4 border-b border-slate-700/60 flex items-center gap-2.5">
          {brandLogo && (
            <img
              src={brandLogo}
              alt={brandName}
              data-testid="sidebar-brand-logo"
              className="w-9 h-9 rounded-lg object-cover flex-shrink-0"
            />
          )}
          <div className="min-w-0">
            <span
              data-testid="sidebar-brand-name"
              className="block text-white font-bold text-lg tracking-tight truncate"
            >
              {brandName}
            </span>
            <span className="block text-slate-400 text-xs mt-0.5">Sistema POS</span>
          </div>
        </div>

        <nav className="sidebar-scroll flex-1 px-2 py-3 space-y-1 overflow-y-auto">
          {visibleGroups.map(group => {
            // El grupo con la ruta activa se fuerza expandido (auto-expand),
            // aunque el usuario lo hubiera colapsado — nunca se pierde el contexto.
            const hasActive = group.items.some(item => isRouteActive(item.to))
            const expanded = hasActive || !collapsed.has(group.id)
            return (
              <div key={group.id} data-testid={`group-${group.id}`}>
                <button
                  type="button"
                  onClick={() => toggle(group.id)}
                  aria-expanded={expanded}
                  data-testid={`group-header-${group.id}`}
                  className="flex items-center gap-2 w-full px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-300 transition-colors"
                >
                  <ChevronDown
                    className={`w-3.5 h-3.5 flex-shrink-0 transition-transform ${expanded ? '' : '-rotate-90'}`}
                  />
                  <span className="flex-1 text-left">{group.label}</span>
                </button>

                {expanded && (
                  <div className="mt-0.5 space-y-0.5">
                    {group.items.map(({ to, label, icon: Icon }) => (
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
                  </div>
                )}
              </div>
            )
          })}
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

          {/* Right: store selector + user info */}
          <div className="flex items-center gap-3">
            <StoreSelector />
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

        {/* Dismissible banner — no hay turno abierto (no bloquea la navegación) */}
        {showShiftBanner && (
          <div
            className="flex-shrink-0 flex items-center gap-3 px-6 py-2.5 border-b"
            style={{ background: '#fffbeb', borderColor: '#fde68a' }}
          >
            <Wallet size={16} color="#b45309" />
            <span className="text-sm font-medium" style={{ color: '#92400e' }}>
              No hay turno de caja abierto.
            </span>
            <button
              onClick={() => setShowOpenShift(true)}
              className="text-sm font-semibold px-3 py-1 rounded-md"
              style={{ background: '#10b981', color: '#fff' }}
            >
              Abrir turno
            </button>
            <button
              onClick={() => setBannerDismissed(true)}
              className="ml-auto"
              style={{ color: '#b45309', display: 'grid', placeItems: 'center' }}
              title="Descartar"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Page content */}
        <main className="flex-1 overflow-hidden bg-white">
          <Outlet />
        </main>
      </div>

      {/* Open-shift modal — no bloqueante, se abre desde el banner */}
      {showOpenShift && (
        <OpenShiftModal
          onClose={() => setShowOpenShift(false)}
          onOpened={() => setShowOpenShift(false)}
        />
      )}
    </div>
  )
}
