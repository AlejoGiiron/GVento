import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShoppingCart, LayoutGrid, BarChart3, User, Lock, Eye, EyeOff, Check, X, ChevronRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'

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

  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [showPwd, setShowPwd]   = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]       = useState(false)

  useEffect(() => {
    if (!isLoading && user) navigate('/ventas', { replace: true })
  }, [user, isLoading, navigate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(false)
    setSubmitting(true)

    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })

    if (authError) {
      setError(true)
      setSubmitting(false)
      return
    }

    if (!remember) {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('sb-')) localStorage.removeItem(key)
      }
    }
    // Éxito: onAuthStateChange actualiza el user → useEffect redirige a /ventas
  }

  if (isLoading) return null

  return (
    <div
      className="flex overflow-hidden"
      style={{ width: '100vw', height: '100vh', fontFamily: 'Inter, system-ui, sans-serif', background: '#fff', color: '#0f172a' }}
    >
      {/* PANEL IZQUIERDO — 40% slate-900 */}
      <div
        className="flex flex-col"
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
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '40px 48px', background: '#fff' }}>
        {/* Ayuda */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: 12.5, color: '#64748b' }}>
          ¿Necesitas ayuda?
          <span style={{ color: '#10b981', fontWeight: 600, marginLeft: 6 }}>Contactar soporte</span>
        </div>

        {/* Formulario centrado */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', maxWidth: 400, width: '100%', margin: '0 auto' }}>
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
              <div style={{
                marginTop: 22, padding: '11px 13px',
                background: '#fef2f2', border: '1px solid #fecaca',
                borderRadius: 9, display: 'flex', alignItems: 'flex-start', gap: 10,
              }}>
                <div style={{ color: '#dc2626', marginTop: 1, flexShrink: 0 }}>
                  <X size={15} strokeWidth={2.5} />
                </div>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: '#991b1b' }}>Credenciales incorrectas</div>
                  <div style={{ fontSize: 11.5, color: '#b91c1c', marginTop: 2 }}>Verifica tu correo y contraseña e intenta de nuevo.</div>
                </div>
              </div>
            )}

            {/* Correo */}
            <div style={{ marginTop: 24 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                Correo electrónico
              </label>
              <div
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
                  type="email"
                  value={email}
                  onChange={e => { setEmail(e.target.value); setError(false) }}
                  placeholder="tu@restaurante.com"
                  autoFocus
                  autoComplete="email"
                  style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 14, color: '#0f172a' }}
                />
              </div>
            </div>

            {/* Contraseña */}
            <div style={{ marginTop: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
                Contraseña
              </label>
              <div
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  border: `1.5px solid ${error ? '#ef4444' : '#e5e7eb'}`,
                  borderRadius: 10, padding: '11px 13px', background: '#fff',
                }}
              >
                <Lock size={16} style={{ color: '#94a3b8', flexShrink: 0 }} />
                <input
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError(false) }}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 14, color: '#0f172a' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(p => !p)}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0, display: 'grid', placeItems: 'center' }}
                >
                  {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Recordarme */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 18, cursor: 'pointer', fontSize: 13, color: '#334155', fontWeight: 500 }}>
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
              type="submit"
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
