import { useEffect, useRef, useState } from 'react'
import { esSafariIOS, estaInstalada } from '@/lib/posMovil'

// ============================================================================
// Lo que /m necesita del EQUIPO: pantalla encendida, altura del teclado e
// instalación en la pantalla de inicio. Nada de esto puede romper la venta:
// si el navegador no lo soporta, se informa y se sigue.
// ============================================================================

export type EstadoPantalla = 'activa' | 'no-disponible' | 'rechazada'

/**
 * Wake Lock con el patrón de KitchenPage (pedir al montar y al volver a primer
 * plano: el navegador lo suelta al ocultarse) más un ESTADO para avisar. En
 * iPhone depende de la versión de iOS y puede fallar dentro de la app instalada:
 * ahí no rompe nada, solo dice que la pantalla se puede apagar.
 */
export function usePantallaEncendida(): EstadoPantalla {
  const [estado, setEstado] = useState<EstadoPantalla>(
    typeof navigator !== 'undefined' && 'wakeLock' in navigator ? 'activa' : 'no-disponible',
  )
  const lock = useRef<WakeLockSentinel | null>(null)

  useEffect(() => {
    if (!('wakeLock' in navigator)) return
    let vivo = true
    const pedir = async () => {
      try {
        lock.current = await navigator.wakeLock.request('screen')
        if (vivo) setEstado('activa')
        lock.current.addEventListener('release', () => {
          // Se suelta solo al ocultar la pestaña; al volver se pide de nuevo.
          if (vivo && document.visibilityState === 'visible') setEstado('rechazada')
        })
      } catch {
        if (vivo) setEstado('rechazada')
      }
    }
    void pedir()
    const alVolver = () => { if (document.visibilityState === 'visible') void pedir() }
    document.addEventListener('visibilitychange', alVolver)
    return () => {
      vivo = false
      document.removeEventListener('visibilitychange', alVolver)
      void lock.current?.release().catch(() => undefined)
    }
  }, [])

  return estado
}

/**
 * Alto que el TECLADO tapa del borde de abajo, en px. Safari de iPhone no achica
 * la ventana al abrir el teclado: lo pone encima. visualViewport sí se achica,
 * así que la diferencia es lo tapado. Con esto el botón de cobrar se sube por
 * encima del teclado.
 */
export function useTecladoTapa(): number {
  const [tapa, setTapa] = useState(0)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const medir = () => setTapa(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)))
    medir()
    vv.addEventListener('resize', medir)
    vv.addEventListener('scroll', medir)
    return () => {
      vv.removeEventListener('resize', medir)
      vv.removeEventListener('scroll', medir)
    }
  }, [])
  return tapa
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const CLAVE_AYUDA_IOS = 'gvento.m.ayudaInstalarVista'

/**
 * Instalar en la pantalla de inicio.
 *   · Android/Chrome: el navegador ofrece el evento beforeinstallprompt; se
 *     guarda y se expone `instalar()` para un botón propio.
 *   · iPhone/Safari: no hay aviso; se muestra UNA vez una instrucción corta
 *     ("Compartir → Agregar a inicio") si no está instalada. "Una vez" se
 *     recuerda en localStorage; si el storage no anda, se muestra cada vez (no
 *     rompe nada).
 */
export function useInstalacion() {
  const [evento, setEvento] = useState<BeforeInstallPromptEvent | null>(null)
  const [ayudaIOS, setAyudaIOS] = useState(() => {
    if (!esSafariIOS() || estaInstalada()) return false
    try { return localStorage.getItem(CLAVE_AYUDA_IOS) !== '1' } catch { return true }
  })

  useEffect(() => {
    const alOfrecer = (e: Event) => { e.preventDefault(); setEvento(e as BeforeInstallPromptEvent) }
    const alInstalar = () => setEvento(null)
    window.addEventListener('beforeinstallprompt', alOfrecer)
    window.addEventListener('appinstalled', alInstalar)
    return () => {
      window.removeEventListener('beforeinstallprompt', alOfrecer)
      window.removeEventListener('appinstalled', alInstalar)
    }
  }, [])

  return {
    puedeInstalar: !!evento,
    instalar: async () => {
      if (!evento) return
      await evento.prompt()
      await evento.userChoice.catch(() => undefined)
      setEvento(null)
    },
    ayudaIOS,
    cerrarAyudaIOS: () => {
      setAyudaIOS(false)
      try { localStorage.setItem(CLAVE_AYUDA_IOS, '1') } catch { /* se volverá a mostrar */ }
    },
  }
}
