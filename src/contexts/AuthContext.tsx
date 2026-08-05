import { createContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { toast } from 'react-hot-toast'
import { supabase } from '@/lib/supabase'
import { useCartStore } from '@/stores/cartStore'
import {
  sentryEnabled,
  setSentryUserContext,
  clearSentryUserContext,
  captureError,
} from '@/lib/sentry'
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

  /**
   * Resuelve los NOMBRES (no los UUID) de organización, sede y rol para
   * etiquetar los errores. Un tag con UUID obliga a ir a la BD para entender
   * de quién es el error; con nombres, "el cajero de Salchimelo no puede
   * cobrar" se lee directo en Sentry.
   *
   * Deliberadamente fuera del camino crítico de `fetchProfile`: es telemetría.
   * Si falla, se traga (no vale romper el login por no poder etiquetar) y los
   * tags quedan en 'desconocida' — el error igual llega.
   */
  const applySentryTags = useCallback(async (userId: string) => {
    if (!sentryEnabled) return
    try {
      const { data } = await supabase
        .from('profiles')
        .select('organizations(name), restaurants(name), roles(name)')
        .eq('id', userId)
        .single()
      setSentryUserContext({
        userId,
        organizacion: data?.organizations?.name ?? null,
        sede: data?.restaurants?.name ?? null,
        rol: data?.roles?.name ?? null,
      })
    } catch {
      // Sin nombres, pero con el id: el error sigue siendo atribuible.
      setSentryUserContext({ userId, organizacion: null, sede: null, rol: null })
    }
  }, [])

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
      // Se reporta igual: en producción nadie mira la consola. Si esto falla en
      // el PRIMER fetch no hay profile previo que conservar → el usuario queda
      // sin sede activa y la app inutilizable, sin ninguna señal para nosotros.
      captureError(error, 'auth', { paso: 'fetchProfile' })
      return
    }

    // Usuario desactivado: se corta la sesión con un mensaje. Sin esto entraba
    // igual y veía la app EN BLANCO — tras el endurecimiento de is_active,
    // get_my_restaurant_id() devuelve null y la RLS no le da ni una fila, sin
    // ninguna explicación. El acceso a datos ya está cerrado server-side; esto
    // es la capa de UX. (El baneo en auth.users sigue pendiente: ver deuda.)
    if (!data.is_active) {
      await supabase.auth.signOut()
      setProfile(null)
      setUser(null)
      clearSentryUserContext()
      toast.error('Tu usuario está desactivado. Contactá al administrador.')
      return
    }

    setProfile(data)
    // Fire-and-forget: no bloquea el login (ver applySentryTags).
    void applySentryTags(userId)
  }, [applySentryTags])

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
        // El POS lo comparten varios cajeros en la misma pestaña: sin esto, los
        // errores del siguiente turno se atribuirían al usuario anterior.
        clearSentryUserContext()
      }
    })

    return () => subscription.unsubscribe()
  }, [fetchProfile])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
    clearSentryUserContext()
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
