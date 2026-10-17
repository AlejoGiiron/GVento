import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Barrera } from './Barrera'
import { PortalApp } from './PortalApp'

// Entrada del portal del cliente (pedido.html): un paquete aparte del POS. No carga la app, ni la
// sesión, ni supabase-js, ni Sentry del POS: solo lo que el cliente necesita para pedir.
createRoot(document.getElementById('portal')!).render(
  <StrictMode>
    <Barrera fallback={
      <main style={{ maxWidth: 560, margin: '0 auto', padding: '48px 16px 0' }}>
        <p data-testid="pedido-mensaje" style={{ fontSize: 16, color: '#334155' }}>Algo falló al mostrar el menú. Recarga la página.</p>
      </main>}>
      <PortalApp />
    </Barrera>
  </StrictMode>,
)
