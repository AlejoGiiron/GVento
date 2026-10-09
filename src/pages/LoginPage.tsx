import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ShoppingCart, LayoutGrid, BarChart3, User, Lock, Eye, EyeOff, Check, X, ChevronRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import './login.css'
import { esRutaMovil } from '@/lib/posMovil'
import { clasificarFalloLogin, conTiempoMaximo, MENSAJE_FALLO_LOGIN, TIEMPO_MAXIMO_LOGIN_MS, type FalloLogin } from '@/lib/falloLogin'

function Spinner() {
  return (
    <div
      className="rounded-full border-2 border-white/30 border-t-white animate-spin"
      style={{ width: 15, height: 15 }}
    />
  )
}

const FEATURES = [
  { Icon: ShoppingCart, text: 'Facturación rápida con inventario sincronizado' },
  { Icon: LayoutGrid,   text: 'Gestión de mesas y comandas en tiempo real' },
  { Icon: BarChart3,    text: 'Reportes de cierre y análisis por turno' },
]

export function LoginPage() {
  const { user, isLoading } = useAuth()
  const navigate = useNavigate()
  // /m/login (la app instalada) vuelve a /m SIN recargar: sigue en el documento de /m.
  // /login va a /ventas, y desde ahí un dueño o cajero en el celular sigue cayendo en /m.
  const destino = esRutaMovil(useLocation().pathname) ? '/m' : '/ventas'

  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [showPwd, setShowPwd]   = useState(false)
  const [submitting, setSubmitting] = useState(false)
  // null = sin error. El TIPO decide el mensaje: solo 'credenciales' culpa a la clave.
  const [error, setError]       = useState<FalloLogin | null>(null)
  const entrarRef = useRef<HTMLButtonElement>(null)

  // Celular: con el teclado abierto, "Ingresar" no puede quedar debajo. Al abrirse
  // el teclado se achica el viewport VISIBLE (visualViewport); si el botón quedó
  // fuera, se desplaza la página hasta él. Solo en anchos de celular (el mismo
  // corte que login.css): en el escritorio la página no se desplaza.
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const asegurarBoton = () => {
      if (!window.matchMedia('(max-width: 767px)').matches) return
      const activo = document.activeElement
      if (!(activo instanceof HTMLInputElement) || !activo.form) return
      const boton = entrarRef.current
      if (!boton) return
      const r = boton.getBoundingClientRect()
      if (r.bottom > vv.offsetTop + vv.height || r.top < vv.offsetTop) boton.scrollIntoView({ block: 'end' })
    }
    // focusin: el teclado tarda en abrirse; resize: cuando termina de abrirse.
    const alEnfocar = () => window.setTimeout(asegurarBoton, 350)
    vv.addEventListener('resize', asegurarBoton)
    document.addEventListener('focusin', alEnfocar)
    return () => {
      vv.removeEventListener('resize', asegurarBoton)
      document.removeEventListener('focusin', alEnfocar)
    }
  }, [])

  useEffect(() => {
    if (!isLoading && user) navigate(destino, { replace: true })
  }, [user, isLoading, navigate, destino])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    let authError: unknown = null
    try {
      // Tope de 15 s: sin respuesta, "No hay conexión…" y el botón vuelve a quedar disponible.
      authError = (await conTiempoMaximo(supabase.auth.signInWithPassword({ email, password }), TIEMPO_MAXIMO_LOGIN_MS)).error
    } catch (err) {
      authError = err   // un fetch que tiró, o TiempoAgotado: sin conexión
    }

    if (authError) {
      setError(clasificarFalloLogin(authError))
      setSubmitting(false)
      return
    }

    if (!remember) {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('sb-')) localStorage.removeItem(key)
      }
    }
    // Éxito: onAuthStateChange actualiza el user → useEffect redirige al destino (/ventas o /m)
  }

  if (isLoading) return null

  return (
    <div
      className="login-raiz flex overflow-hidden"
      style={{ width: '100vw', height: '100vh', fontFamily: 'Inter, system-ui, sans-serif', background: '#fff', color: '#0f172a' }}
    >
      {/* PANEL IZQUIERDO — 40% slate-900 */}
      <div
        className="login-marca flex flex-col"
        style={{
          flex: '0 0 40%',
          background: '#0f172a',
          color: '#f1f5f9',
          padding: '40px 44px',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Radial glows */}
        <div style={{ position: 'absolute', top: '-20%', left: '-10%', width: 460, height: 460, background: 'radial-gradient(circle, rgba(16,185,129,.18) 0%, transparent 60%)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: '-15%', right: '-10%', width: 380, height: 380, background: 'radial-gradient(circle, rgba(16,185,129,.10) 0%, transparent 60%)', pointerEvents: 'none' }} />

        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, position: 'relative', zIndex: 1 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 11,
            background: 'linear-gradient(135deg, #10b981, #059669)',
            display: 'grid', placeItems: 'center',
            color: '#fff', fontWeight: 800, fontSize: 20,
            boxShadow: '0 0 0 1px rgba(255,255,255,.08) inset, 0 8px 20px rgba(16,185,129,.25)',
          }}>G</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 18, color: '#f8fafc', letterSpacing: -0.3 }}>G-Vento</div>
            <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 1 }}>POS · Restaurantes</div>
          </div>
        </div>

        {/* Contenido central */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', position: 'relative', zIndex: 1 }}>
          <h1 style={{ fontSize: 38, fontWeight: 800, color: '#f8fafc', margin: 0, letterSpacing: -1.2, lineHeight: 1.05 }}>
            Bienvenido<br />
            <span style={{ color: '#10b981' }}>de vuelta.</span>
          </h1>
          <p style={{ fontSize: 14, color: '#94a3b8', marginTop: 14, marginBottom: 0, lineHeight: 1.55, maxWidth: 340 }}>
            Ingresa a tu turno y comienza a facturar. Todo lo que tu restaurante necesita, en un solo lugar.
          </p>

          {/* Features */}
          <div style={{ marginTop: 36, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {FEATURES.map(({ Icon, text }, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: 'rgba(16,185,129,.12)',
                  color: '#10b981',
                  display: 'grid', placeItems: 'center',
                  border: '1px solid rgba(16,185,129,.22)',
                  flexShrink: 0,
                }}>
                  <Icon size={15} />
                </div>
                <div style={{ fontSize: 13, color: '#cbd5e1' }}>{text}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11.5, color: '#64748b', position: 'relative', zIndex: 1 }}>
          <div>© 2026 G-Vento</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
            Sistema operativo · v2.4.1
          </div>
        </div>
      </div>

      {/* PANEL DERECHO — 60% blanco */}
      <div className="login-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '40px 48px', background: '#fff' }}>
        {/* Ayuda */}
        <div className="login-ayuda" style={{ display: 'flex', justifyContent: 'flex-end', fontSize: 12.5, color: '#64748b' }}>
          ¿Necesitas ayuda?
          <span style={{ color: '#10b981', fontWeight: 600, marginLeft: 6 }}>Contactar soporte</span>
        </div>

        {/* Formulario centrado */}
        <div className="login-form-caja" style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', maxWidth: 400, width: '100%', margin: '0 auto' }}>
          {/* Solo en el celular (login.css): el panel de marca no entra en 360–430 px. */}
          <div className="login-logo-movil" aria-hidden="true">
            <div style={{
              width: 40, height: 40, borderRadius: 10,
              background: 'linear-gradient(135deg, #10b981, #059669)',
              display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 800, fontSize: 18,
            }}>G</div>
            <div style={{ fontWeight: 700, fontSize: 18, color: '#0f172a', letterSpacing: -0.3 }}>G-Vento</div>
          </div>
          <form onSubmit={handleSubmit}>
            {/* Encabezado */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#10b981', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 8 }}>
                Iniciar sesión
              </div>
              <h2 style={{ fontSize: 26, fontWeight: 700, color: '#0f172a', margin: 0, letterSpacing: -0.8, lineHeight: 1.15 }}>
                Ingresa a tu cuenta
              </h2>
              <p style={{ fontSize: 13.5, color: '#64748b', marginTop: 8, marginBottom: 0, lineHeight: 1.5 }}>
                Usa el correo y contraseña que te asignó el administrador.
              </p>
            </div>

            {/* Banner de error */}
            {error && (
              <div className="login-error" role="alert" data-testid="login-error" data-tipo={error} style={{
                marginTop: 22, padding: '11px 13px',
                background: '#fef2f2', border: '1px solid #fecaca',
                borderRadius: 9, display: 'flex', alignItems: 'flex-start', gap: 10,
              }}>
                <div style={{ color: '#dc2626', marginTop: 1, flexShrink: 0 }}>
                  <X size={15} strokeWidth={2.5} />
                </div>
                <div>
                  <div className="login-error-titulo" style={{ fontSize: 12.5, fontWeight: 600, color: '#991b1b' }}>{MENSAJE_FALLO_LOGIN[error].titulo}</div>
                  <div className="login-error-detalle" style={{ fontSize: 11.5, color: '#b91c1c', marginTop: 2 }}>{MENSAJE_FALLO_LOGIN[error].detalle}</div>
                </div>
              </div>
            )}

            {/* Correo */}
            <div style={{ marginTop: 24 }}>
              <label htmlFor="login-correo" style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                Correo electrónico
              </label>
              <div
                className="login-campo"
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  border: `1.5px solid ${error ? '#ef4444' : '#e5e7eb'}`,
                  borderRadius: 10, padding: '11px 13px', background: '#fff', transition: 'border .12s',
                }}
                onFocus={e => { if (!error) e.currentTarget.style.borderColor = '#10b981' }}
                onBlur={e => { if (!error) e.currentTarget.style.borderColor = '#e5e7eb' }}
              >
                <User size={16} style={{ color: '#94a3b8', flexShrink: 0 }} />
                <input
                  id="login-correo"
                  name="email"
                  className="login-input"
                  type="email"
                  inputMode="email"
                  value={email}
                  onChange={e => { setEmail(e.target.value); setError(null) }}
                  placeholder="tu@restaurante.com"
                  autoFocus
                  // "username": así lo reconocen las contraseñas guardadas del iPhone y de Android.
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 14, color: '#0f172a' }}
                />
              </div>
            </div>

            {/* Contraseña */}
            <div style={{ marginTop: 16 }}>
              <label htmlFor="login-clave" style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                Contraseña
              </label>
              <div
                className="login-campo"
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  border: `1.5px solid ${error ? '#ef4444' : '#e5e7eb'}`,
                  borderRadius: 10, padding: '11px 13px', background: '#fff',
                }}
              >
                <Lock size={16} style={{ color: '#94a3b8', flexShrink: 0 }} />
                <input
                  id="login-clave"
                  name="password"
                  className="login-input"
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError(null) }}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 14, color: '#0f172a' }}
                />
                <button
                  type="button"
                  className="login-ojo"
                  data-testid="login-ver-clave"
                  aria-label={showPwd ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  aria-pressed={showPwd}
                  aria-controls="login-clave"
                  onClick={() => setShowPwd(p => !p)}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0, display: 'grid', placeItems: 'center' }}
                >
                  {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Recordarme */}
            <label className="login-recordar" style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 18, cursor: 'pointer', fontSize: 13, color: '#334155', fontWeight: 500 }}>
              <div
                onClick={() => setRemember(r => !r)}
                style={{
                  width: 18, height: 18, borderRadius: 5,
                  border: `1.5px solid ${remember ? '#10b981' : '#cbd5e1'}`,
                  background: remember ? '#10b981' : '#fff',
                  display: 'grid', placeItems: 'center',
                  color: '#fff', transition: 'all .12s', flexShrink: 0, cursor: 'pointer',
                }}
              >
                {remember && <Check size={12} strokeWidth={3} />}
              </div>
              Recordarme en este dispositivo
            </label>

            {/* Botón enviar */}
            <button
              ref={entrarRef}
              type="submit"
              className="login-entrar"
              data-testid="login-entrar"
              disabled={submitting || !email || !password}
              style={{
                marginTop: 24, width: '100%', padding: '13px 14px',
                background: (submitting || !email || !password) ? '#cbd5e1' : '#10b981',
                border: 'none', borderRadius: 10,
                cursor: (submitting || !email || !password) ? 'not-allowed' : 'pointer',
                fontSize: 14, fontWeight: 700, color: '#fff',
                fontFamily: 'Inter, system-ui, sans-serif',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                boxShadow: (submitting || !email || !password) ? 'none' : '0 6px 16px rgba(16,185,129,.35)',
                transition: 'all .15s',
              }}
            >
              {submitting ? (
                <><Spinner /> Autenticando...</>
              ) : (
                <>Ingresar <ChevronRight size={16} strokeWidth={2.5} /></>
              )}
            </button>
          </form>
        </div>

        {/* Footer */}
        <div style={{ fontSize: 11.5, color: '#94a3b8', textAlign: 'center' }}>
          ¿No tienes acceso? El administrador de tu restaurante crea las cuentas.
        </div>
      </div>
    </div>
  )
}
