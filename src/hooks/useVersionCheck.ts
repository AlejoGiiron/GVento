import { useEffect, useState } from 'react'

/** Cada cuánto se consulta /version.json mientras la pestaña está abierta. */
const INTERVALO_MS = 5 * 60 * 1000

/**
 * ¿Hay una versión nueva publicada? Compara la versión incrustada en el bundle
 * (`__APP_VERSION__`, vite.config.ts) con la de /version.json, que sale de la
 * MISMA fuente en cada build.
 *
 * Consulta al montar, cada 5 minutos y cada vez que la pestaña vuelve a primer
 * plano (un celular que estuvo bloqueado, un equipo que volvió del descanso).
 * `cache: 'no-store'` y el service worker no la guarda (public/sw.js): una copia
 * vieja haría saltar el aviso al revés.
 *
 * Un fallo de red o una respuesta rara NO avisa: es telemetría, no una barrera.
 * Una vez que detecta la versión nueva deja de consultar.
 */
export function useVersionCheck(): { hayNueva: boolean; publicada: string | null } {
  const [publicada, setPublicada] = useState<string | null>(null)
  const [moduloFallido, setModuloFallido] = useState(false)
  const hayNueva = moduloFallido || (publicada !== null && publicada !== __APP_VERSION__)

  // Un import() diferido que falla (hoy: exceljs en Reportes) es casi siempre una
  // pestaña VIEJA pidiendo un archivo que el deploy nuevo ya no tiene: Vercel
  // responde index.html (la rewrite de vercel.json) y el navegador rechaza el
  // módulo. Vite emite `vite:preloadError` también cuando falla el import en sí
  // (5.4: `baseModule().catch(handlePreloadError)`). NO se llama a
  // preventDefault: el error sigue llegando al catch de quien importó (su toast),
  // y además se muestra el aviso para recargar.
  useEffect(() => {
    const alFallar = () => setModuloFallido(true)
    window.addEventListener('vite:preloadError', alFallar)
    return () => window.removeEventListener('vite:preloadError', alFallar)
  }, [])

  useEffect(() => {
    if (hayNueva) return
    let cancelado = false

    const consultar = async () => {
      try {
        const res = await fetch('/version.json', { cache: 'no-store' })
        if (!res.ok) return
        const json: unknown = await res.json()
        const version = (json as { version?: unknown } | null)?.version
        if (!cancelado && typeof version === 'string' && version) setPublicada(version)
      } catch {
        // Sin red: se reintenta en la próxima consulta.
      }
    }

    const alVolver = () => { if (document.visibilityState === 'visible') void consultar() }

    void consultar()
    const id = window.setInterval(consultar, INTERVALO_MS)
    document.addEventListener('visibilitychange', alVolver)
    window.addEventListener('focus', alVolver)
    return () => {
      cancelado = true
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', alVolver)
      window.removeEventListener('focus', alVolver)
    }
  }, [hayNueva])

  return { hayNueva, publicada }
}
