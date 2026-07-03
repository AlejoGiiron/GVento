import { createContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { useCartStore } from '@/stores/cartStore'
import type { Tables } from '@/types/database.types'

type Profile = Tables<'profiles'>

interface AuthContextValue {
  user: User | null
  profile: Profile | null
  roleId: string | null
  organizationId: string | null
  isLoading: boolean
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const fetchProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()
    if (error) {
      // Hipo de red / RLS transitorio (p. ej. en un token refresh de fondo):
      // NO pisar el profile con null. Un profile nulo deja la app sin sede
      // activa y cuelga pantallas (mesas, branding). Se conserva el previo.
      // En el PRIMER fetch (login) no hay previo → queda null como antes y el
      // flujo de login continúa (isLoading se apaga en el .finally del caller).
      console.error('fetchProfile falló; se conserva el profile previo:', error.message)
      return
    }
    setProfile(data)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        fetchProfile(session.user.id).finally(() => setIsLoading(false))
      } else {
        setIsLoading(false)
      }
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      // El estado de venta (carrito + ventas en espera) es POR SESIÓN: no debe
      // sobrevivir a un cambio de usuario en la misma pestaña (POS compartido
      // entre cajeros). Se limpia al CERRAR sesión — cubre logout explícito y
      // expiración de sesión. NO en SIGNED_IN: ese evento puede re-dispararse en
      // focos/recargas de pestaña y borraría un carrito activo a mitad de venta.
      if (event === 'SIGNED_OUT') {
        useCartStore.getState().resetSession()
      }
      setUser(session?.user ?? null)
      if (session?.user) {
        fetchProfile(session.user.id)
      } else {
        setProfile(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [fetchProfile])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
  }, [])

  // Re-carga el profile del usuario actual (p. ej. tras cambiar de sede activa).
  const refreshProfile = useCallback(async () => {
    if (user) await fetchProfile(user.id)
  }, [user, fetchProfile])

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        roleId: profile?.role_id ?? null,
        organizationId: profile?.organization_id ?? null,
        isLoading,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
