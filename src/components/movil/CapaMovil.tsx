import { createPortal } from 'react-dom'
import { useCapaAbierta } from '@/components/movil/contextoShell'

/**
 * Una pantalla que tapa todo en /m (cobro, extras, menú).
 *
 * · Se monta con un PORTAL directo en <body>: fuera del <main> que se desplaza.
 *   Un `position: fixed` adentro de un contenedor con scroll queda a merced de
 *   cómo cada navegador apila y recorta ese contenedor; en el iPhone, la barra
 *   inferior le quedaba por encima.
 * · Mientras está abierta, el caparazón saca la barra inferior y los avisos
 *   (useCapaAbierta): nada nuestro se cruza con su botón principal.
 */
export function CapaMovil({ children }: { children: React.ReactNode }) {
  useCapaAbierta()
  return createPortal(children, document.body)
}
