import { useEffect, useRef, useState } from 'react'

/**
 * Detecta si un contenedor con scroll tiene contenido MÁS ALLÁ del borde visible.
 *
 * Sirve para mostrar una máscara de continuación (degradado al pie o al borde
 * derecho) SOLO cuando de verdad queda algo por ver. Un degradado permanente
 * miente igual que no tener ninguno: si aparece siempre, deja de significar
 * "hay más" y pasa a ser decoración — y sobre un contenedor vacío tapa el
 * estado vacío.
 *
 * Nace de dos síntomas del mismo origen: el kanban de Delivery y los tabs de
 * categorías en Productos scrolleaban de verdad, pero con `scrollbarWidth: none`
 * y sin ninguna señal visual el corte se leía como desbordamiento roto.
 *
 * `deps` re-mide cuando cambia el CONTENIDO (el ResizeObserver solo ve cambios
 * de tamaño del contenedor, no de su contenido).
 */
export function useScrollOverflow<T extends HTMLElement>(axis: 'x' | 'y', deps: unknown) {
  const ref = useRef<T>(null)
  const [hasMore, setHasMore] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    // 4px de tolerancia: el redondeo subpíxel del scroll no debe encender la máscara.
    const check = () =>
      setHasMore(
        axis === 'x'
          ? el.scrollWidth - el.scrollLeft - el.clientWidth > 4
          : el.scrollHeight - el.scrollTop - el.clientHeight > 4,
      )

    check()
    el.addEventListener('scroll', check, { passive: true })
    const ro = new ResizeObserver(check)
    ro.observe(el)

    return () => {
      el.removeEventListener('scroll', check)
      ro.disconnect()
    }
  }, [axis, deps])

  return { ref, hasMore }
}
