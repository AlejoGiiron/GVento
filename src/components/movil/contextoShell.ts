import { createContext, useContext, useEffect } from 'react'

// ============================================================================
// Contrato entre el caparazón de /m (MobileShell) y sus pantallas.
//
//   · abrirCapa: una pantalla que tapa todo (cobro, extras, menú) se REGISTRA
//     mientras está abierta. Con alguna capa abierta, el caparazón saca de la
//     pantalla su barra inferior y los avisos de instalación: el botón principal
//     de la capa ocupa ese lugar y no puede quedar debajo de nada nuestro
//     (medido en un iPhone 16 Pro Max el 2026-10-05: la barra tapaba "Cobrar",
//     "Confirmar" y "Agregar").
//   · slotAccion: lugar EN EL FLUJO, entre el contenido y la barra inferior,
//     para el botón de acción de una pantalla (el "Cobrar" de Vender). Nunca
//     `position: fixed` dentro del contenedor con scroll.
// ============================================================================

export interface ShellMovil {
  abrirCapa: () => () => void
  slotAccion: HTMLElement | null
}

export const ContextoShellMovil = createContext<ShellMovil | null>(null)

export function useShellMovil(): ShellMovil {
  const ctx = useContext(ContextoShellMovil)
  if (!ctx) throw new Error('useShellMovil fuera de MobileShell')
  return ctx
}

/** Registra una capa abierta mientras el componente esté montado. */
export function useCapaAbierta(): void {
  const { abrirCapa } = useShellMovil()
  useEffect(() => abrirCapa(), [abrirCapa])
}
