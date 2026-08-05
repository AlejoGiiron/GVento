import { AlertTriangle, RotateCw } from 'lucide-react'

interface ErrorFallbackProps {
  /** ID del evento en Sentry — el cajero nos lo dicta por teléfono. */
  eventId: string | null
}

/**
 * Pantalla de recuperación del ErrorBoundary.
 *
 * Sin esto, un error de render desmonta el árbol y deja la PANTALLA EN BLANCO:
 * en un POS a mitad de servicio el cajero no sabe si recargar, si la venta se
 * grabó, ni qué decirnos.
 *
 * Advierte explícitamente sobre el carrito porque el estado de venta vive en
 * memoria (`cartStore`, sin persistencia): recargar lo pierde. Es preferible
 * que el cajero lo sepa ANTES de tocar el botón y no después.
 */
export function ErrorFallback({ eventId }: ErrorFallbackProps) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: '#f8fafc',
        display: 'grid', placeItems: 'center', padding: 24,
        fontFamily: 'Inter, sans-serif', zIndex: 9999,
      }}
    >
      <div style={{ maxWidth: 420, textAlign: 'center' }}>
        <div
          style={{
            width: 56, height: 56, borderRadius: '50%', background: '#fef3c7',
            display: 'grid', placeItems: 'center', margin: '0 auto 20px',
          }}
        >
          <AlertTriangle size={28} color="#d97706" />
        </div>

        <h1 style={{ fontSize: 20, fontWeight: 600, color: '#0f172a', margin: '0 0 8px' }}>
          Algo falló en la aplicación
        </h1>

        <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.6, margin: '0 0 20px' }}>
          El error ya se reportó al equipo. Recargá la página para seguir trabajando.
        </p>

        <div
          style={{
            background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8,
            padding: '12px 14px', margin: '0 0 24px',
            fontSize: 13, color: '#92400e', lineHeight: 1.5, textAlign: 'left',
          }}
        >
          Si había una venta sin cobrar en el carrito, se va a perder al recargar.
          Las ventas ya cobradas están guardadas.
        </div>

        <button
          onClick={() => window.location.reload()}
          data-testid="error-boundary-reload"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: '#10b981', color: '#fff', border: 'none',
            borderRadius: 10, padding: '12px 28px',
            fontSize: 15, fontWeight: 600, cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(16,185,129,.35)',
          }}
        >
          <RotateCw size={17} />
          Recargar
        </button>

        {eventId && (
          <p style={{ fontSize: 12, color: '#94a3b8', margin: '20px 0 0' }}>
            Código del error:{' '}
            <span
              style={{ fontFamily: 'monospace', color: '#64748b' }}
              data-testid="error-boundary-event-id"
            >
              {eventId.slice(0, 8)}
            </span>
          </p>
        )}
      </div>
    </div>
  )
}
