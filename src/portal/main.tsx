import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PortalApp } from './PortalApp'

// Entrada del portal del cliente (pedido.html): un paquete aparte del POS. No carga la app, ni la
// sesión, ni supabase-js, ni Sentry del POS: solo lo que el cliente necesita para pedir.
createRoot(document.getElementById('portal')!).render(
  <StrictMode>
    <PortalApp />
  </StrictMode>,
)
