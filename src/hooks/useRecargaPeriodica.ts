import { useEffect, useRef } from 'react'

// ============================================================================
// Recarga de fondo para las pantallas que comparten datos entre equipos (Cocina,
// Mesas, Delivery). Realtime no entrega nada en producción (la publicación
// supabase_realtime está vacía: docs/DEUDAS.md → "Realtime"), así que sin esto un
// equipo solo ve lo que hizo otro cuando recarga a mano.
//
// - Cada `cadaMs` mientras la pestaña está VISIBLE (una pestaña oculta no consulta).
// - Al volver a la pestaña, recarga en el acto.
// - `pausada`: no recarga nada (ni por tiempo ni al volver). Se usa mientras hay un
//   modal abierto: una recarga de fondo no puede cambiar ni cerrar lo que el usuario
//   está haciendo (el cobro de mesa, sobre todo).
// Mismo patrón que useVersionCheck.
// ============================================================================

export function useRecargaPeriodica(
  recargar: () => unknown,
  { cadaMs, pausada = false }: { cadaMs: number; pausada?: boolean },
) {
  // La función más reciente sin reiniciar el intervalo en cada render.
  const ref = useRef(recargar)
  ref.current = recargar

  useEffect(() => {
    if (pausada) return
    let id: number | null = null
    const arrancar = () => { if (id === null) id = window.setInterval(() => { void ref.current() }, cadaMs) }
    const parar = () => { if (id !== null) { window.clearInterval(id); id = null } }
    const alCambiar = () => {
      if (document.visibilityState === 'visible') { void ref.current(); arrancar() } else parar()
    }
    if (document.visibilityState === 'visible') arrancar()
    document.addEventListener('visibilitychange', alCambiar)
    return () => { parar(); document.removeEventListener('visibilitychange', alCambiar) }
  }, [cadaMs, pausada])
}
