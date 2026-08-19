import { useCallback, useEffect, useState } from 'react'

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
 *
 * ── POR QUÉ `ref` ES UN CALLBACK Y NO UN useRef ─────────────────────────────
 * 🔴 Con `useRef` el hook quedaba MUDO cuando el consumidor tiene un return
 * temprano de carga: el efecto corría en un render donde el nodo todavía no
 * estaba montado (`ref.current === null`), salía sin montar nada, y al montarse
 * el nodo el efecto NO volvía a correr porque `deps` no había cambiado.
 * `hasMore` se congelaba en `false` PARA SIEMPRE.
 *
 * Medido en el POS (sonda con console.log dentro del hook): la secuencia real
 * era `efecto corre, el=NULL` repetido, y la máscara no aparecía nunca aunque el
 * strip desbordara de verdad (scrollWidth 666 vs clientWidth 432). El POS lo
 * destapó porque su return de carga lo gobierna otra query distinta de la que
 * viaja en `deps`; Productos y Delivery tenían la misma fragilidad latente y
 * funcionaban por casualidad de timing.
 *
 * Con callback ref el montaje de los observers se ata a que el NODO aparezca,
 * que es la condición real, y deja de depender del orden de los renders.
 */
export function useScrollOverflow<T extends HTMLElement>(axis: 'x' | 'y', deps: unknown) {
  const [node, setNode] = useState<T | null>(null)
  const [hasMore, setHasMore] = useState(false)

  // Identidad estable: si cambiara en cada render, React lo llamaría con null y
  // con el nodo en cada pasada y el efecto se remontaría sin parar.
  const ref = useCallback((n: T | null) => setNode(n), [])

  useEffect(() => {
    const el = node
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

    // Observar TAMBIÉN los hijos. El contenedor puede conservar su tamaño
    // mientras su CONTENIDO crece (p. ej. entran más tabs de categoría): ahí el
    // observer sobre el contenedor solo no dispara nunca.
    for (const hijo of Array.from(el.children)) ro.observe(hijo)

    // Un frame después: en el primer paso del efecto el layout del contenido
    // recién insertado puede no estar resuelto todavía.
    const raf = requestAnimationFrame(check)

    // Y cuando terminen de cargar las fuentes: un cambio de tipografía cambia el
    // ancho de los hijos SIN cambiar el del contenedor.
    let vivo = true
    document.fonts?.ready.then(() => { if (vivo) check() }).catch(() => {})

    return () => {
      vivo = false
      cancelAnimationFrame(raf)
      el.removeEventListener('scroll', check)
      ro.disconnect()
    }
  }, [axis, deps, node])

  return { ref, hasMore }
}
