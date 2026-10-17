import { Component, type ReactNode } from 'react'

// Una barrera de errores: si lo de adentro revienta (por ejemplo, el paquete del mapa que ya no
// existe después de un deploy: Vercel Hobby no guarda versiones viejas), se muestra `fallback` en vez
// de dejar la página en blanco. El resto del portal, con el carrito, sigue vivo.

export class Barrera extends Component<{ fallback: ReactNode; children: ReactNode }, { fallo: boolean }> {
  state = { fallo: false }

  static getDerivedStateFromError() {
    return { fallo: true }
  }

  componentDidCatch(error: unknown) {
    console.error('[portal]', error)
  }

  render() {
    return this.state.fallo ? this.props.fallback : this.props.children
  }
}
