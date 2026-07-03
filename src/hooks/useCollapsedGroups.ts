import { useCallback, useState } from 'react'

const STORAGE_KEY = 'gvento:sidebar:collapsed-groups'

function read(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    return new Set(Array.isArray(parsed) ? (parsed as string[]) : [])
  } catch {
    return new Set()
  }
}

/**
 * Persiste qué grupos del sidebar están COLAPSADOS, por ID, en localStorage.
 *
 * Guarda los IDs colapsados (no los expandidos): así el default —sin clave, o
 * un grupo nuevo que aún no figura— es "expandido", y la persistencia tolera
 * grupos ausentes o desconocidos sin necesidad de configurarlos.
 *
 * AppLayout es la app real (no un artifact), así que localStorage funciona; si
 * estuviera bloqueado (modo privado / políticas) el hook degrada en silencio.
 */
export function useCollapsedGroups() {
  const [collapsed, setCollapsed] = useState<Set<string>>(read)

  const toggle = useCallback((id: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]))
      } catch {
        /* localStorage no disponible: degradar en silencio */
      }
      return next
    })
  }, [])

  return { collapsed, toggle }
}
