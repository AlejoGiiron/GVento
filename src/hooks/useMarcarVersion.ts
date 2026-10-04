import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'

const CLAVE_EQUIPO = 'gvento.equipo'
/** Como mucho una marca cada 30 min por pestaña (más es ruido en la base). */
const CADA_MS = 30 * 60 * 1000

/** Id aleatorio y estable de este navegador. Sin localStorage, uno por pestaña. */
function idDeEquipo(): string {
  try {
    const guardado = window.localStorage.getItem(CLAVE_EQUIPO)
    if (guardado) return guardado
    const nuevo = crypto.randomUUID()
    window.localStorage.setItem(CLAVE_EQUIPO, nuevo)
    return nuevo
  } catch {
    return crypto.randomUUID()
  }
}

/**
 * Reporta a la base qué versión tiene cargada este equipo
 * (supabase/app-version.sql → marcar_version). Es lo que permite saber desde el
 * SQL Editor qué equipo sigue con una versión vieja.
 *
 * Telemetría: si la RPC falla (o todavía no existe en la base), la app sigue
 * igual. Por eso el error se ignora a propósito: no hay nada que el usuario
 * pueda hacer con él.
 */
export function useMarcarVersion(): void {
  const { user } = useAuth()
  const userId = user?.id ?? null

  useEffect(() => {
    if (!userId) return
    let ultima = 0

    const marcar = () => {
      if (Date.now() - ultima < CADA_MS) return
      ultima = Date.now()
      // `.then(...)` NO es decorativo: el builder de supabase-js es perezoso y el
      // pedido sale recién cuando alguien lo consume. Con `void supabase.rpc(...)`
      // no salía nunca (medido: el spec no encontraba la fila).
      supabase.rpc('marcar_version', {
        p_version: __APP_VERSION__,
        p_equipo: idDeEquipo(),
        p_user_agent: navigator.userAgent.slice(0, 300),
      }).then(() => undefined, () => undefined)
    }
    const alVolver = () => { if (document.visibilityState === 'visible') marcar() }

    marcar()
    document.addEventListener('visibilitychange', alVolver)
    return () => document.removeEventListener('visibilitychange', alVolver)
  }, [userId])
}
