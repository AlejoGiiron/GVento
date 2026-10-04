import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { ShoppingBag, ReceiptText, Menu, X, Monitor, LogOut, Download, Share, MoonStar } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useCashShift } from '@/hooks/useCashShift'
import { useRestaurantConfig } from '@/hooks/useRestaurantConfig'
import { usePantallaEncendida, useInstalacion } from '@/hooks/useDispositivoMovil'
import { aplicarIdentidadMovil, pedirVersionCompleta, puedeCobrar } from '@/lib/posMovil'
import { M, botonGrande } from '@/components/movil/estilo'

// ============================================================================
// Caparazón del POS móvil (/m). Dentro de ProtectedRoute y FUERA de AppLayout:
// sin sidebar, navegación abajo, pensado para el pulgar en una barra con poca
// luz (fondo oscuro, contraste alto, blancos grandes).
//
// Zonas seguras (viewport-fit=cover en index.html): arriba y abajo se suman
// env(safe-area-inset-*) para que nada quede bajo la isla/notch ni bajo la
// barra de inicio del iPhone. 100dvh: en Safari, 100vh incluye la barra de
// direcciones y empuja el pie fuera de la pantalla.
// ============================================================================


export function MobileShell() {
  const { profile, signOut } = useAuth()
  const { restaurant } = useRestaurantConfig()
  const { isOpen, isLoadingShift } = useCashShift()
  const pantalla = usePantallaEncendida()
  const instalacion = useInstalacion()
  const navigate = useNavigate()
  const [menu, setMenu] = useState(false)

  useEffect(() => {
    aplicarIdentidadMovil(true)
    return () => aplicarIdentidadMovil(false)
  }, [])

  const irAVersionCompleta = (ruta: string) => {
    pedirVersionCompleta(true)
    navigate(ruta)
  }

  // /m solo cobra. Un rol que el servidor rechaza (register_pos_sale) no tiene
  // nada que hacer acá: se le dice y se le ofrece la versión completa.
  if (profile && !puedeCobrar(profile.role)) {
    return (
      <div data-testid="m-sin-permiso" style={{ ...pantallaCompleta, justifyContent: 'center', padding: 24, textAlign: 'center', gap: 16 }}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>Tu usuario no puede cobrar</div>
        <div style={{ color: M.suave, fontSize: 15 }}>Para vender desde el celular hace falta un usuario de caja.</div>
        <button type="button" onClick={() => irAVersionCompleta('/mesas')} style={botonGrande(M.verde)}>
          Ir a la versión completa
        </button>
      </div>
    )
  }

  return (
    <div data-testid="m-shell" style={pantallaCompleta}>
      <header style={{
        paddingTop: 'calc(env(safe-area-inset-top) + 10px)', paddingLeft: 16, paddingRight: 16, paddingBottom: 10,
        borderBottom: `1px solid ${M.borde}`, display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {restaurant?.name ?? 'G-Vento'}
          </div>
          <div style={{ fontSize: 12, color: M.suave }}>{profile?.full_name}</div>
        </div>
        {!isLoadingShift && (
          <span data-testid="m-turno" data-abierto={isOpen ? 'si' : 'no'} style={{
            fontSize: 12, fontWeight: 700, padding: '5px 10px', borderRadius: 999,
            background: isOpen ? 'rgba(16,185,129,.15)' : 'rgba(239,68,68,.15)',
            color: isOpen ? '#6ee7b7' : '#fca5a5',
          }}>
            {isOpen ? 'Turno abierto' : 'Sin turno'}
          </span>
        )}
      </header>

      {pantalla !== 'activa' && (
        <div data-testid="m-pantalla-aviso" data-estado={pantalla} style={avisoFranja}>
          <MoonStar size={16} /> La pantalla se puede apagar sola en este equipo.
        </div>
      )}
      {instalacion.puedeInstalar && (
        <div style={avisoFranja}>
          <span style={{ flex: 1 }}>Instalá Vender en la pantalla de inicio.</span>
          <button type="button" data-testid="m-instalar" onClick={() => void instalacion.instalar()} style={botonChico}>
            <Download size={15} /> Instalar
          </button>
        </div>
      )}
      {instalacion.ayudaIOS && (
        <div data-testid="m-ayuda-ios" style={avisoFranja}>
          <Share size={16} />
          <span style={{ flex: 1 }}>Para instalarla: <b>Compartir</b> → <b>Agregar a inicio</b>.</span>
          <button type="button" aria-label="Cerrar" data-testid="m-ayuda-ios-cerrar" onClick={instalacion.cerrarAyudaIOS} style={botonIcono}>
            <X size={18} />
          </button>
        </div>
      )}

      <main style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <Outlet />
      </main>

      <nav style={{
        display: 'flex', borderTop: `1px solid ${M.borde}`, background: M.fondo,
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}>
        <Pestana to="/m" end icono={<ShoppingBag size={22} />} texto="Vender" testid="m-nav-vender" />
        <Pestana to="/m/ventas" icono={<ReceiptText size={22} />} texto="Mis ventas" testid="m-nav-ventas" />
        <button type="button" data-testid="m-nav-menu" onClick={() => setMenu(true)} style={estiloPestana(false)}>
          <Menu size={22} /><span>Menú</span>
        </button>
      </nav>

      {menu && (
        <div onClick={() => setMenu(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 60, display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: '100%', background: M.panel, borderRadius: '18px 18px 0 0',
            padding: '16px 16px calc(env(safe-area-inset-bottom) + 16px)', display: 'grid', gap: 10,
          }}>
            <button type="button" data-testid="m-version-completa" onClick={() => irAVersionCompleta('/ventas')} style={botonMenu}>
              <Monitor size={20} /> Versión completa
            </button>
            <button type="button" data-testid="m-salir" onClick={() => void signOut()} style={botonMenu}>
              <LogOut size={20} /> Cerrar sesión
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Pestana({ to, end, icono, texto, testid }: { to: string; end?: boolean; icono: React.ReactNode; texto: string; testid: string }) {
  return (
    <NavLink to={to} end={end} data-testid={testid} style={({ isActive }) => estiloPestana(isActive)}>
      {icono}<span>{texto}</span>
    </NavLink>
  )
}

const pantallaCompleta: React.CSSProperties = {
  height: '100dvh', display: 'flex', flexDirection: 'column', background: M.fondo, color: M.texto,
  fontFamily: 'Inter, system-ui, sans-serif', overflow: 'hidden',
}

const estiloPestana = (activa: boolean): React.CSSProperties => ({
  flex: 1, minHeight: 60, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
  fontSize: 12, fontWeight: 600, textDecoration: 'none', border: 'none', background: 'transparent',
  color: activa ? M.verde : M.suave, cursor: 'pointer',
})

const avisoFranja: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', fontSize: 13,
  background: 'rgba(245,158,11,.12)', color: '#fcd34d', borderBottom: `1px solid ${M.borde}`,
}


const botonChico: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', border: 'none', borderRadius: 10,
  background: M.verde, color: '#fff', fontWeight: 700, fontSize: 13,
}

const botonIcono: React.CSSProperties = {
  width: 40, height: 40, display: 'grid', placeItems: 'center', border: 'none', background: 'transparent', color: 'inherit',
}

const botonMenu: React.CSSProperties = {
  minHeight: 56, display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px', border: `1px solid ${M.borde}`,
  borderRadius: 12, background: M.fondo, color: M.texto, fontSize: 16, fontWeight: 600,
}
