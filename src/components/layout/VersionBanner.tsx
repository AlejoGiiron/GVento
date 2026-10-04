import { RefreshCw } from 'lucide-react'
import { useVersionCheck } from '@/hooks/useVersionCheck'
import { useMarcarVersion } from '@/hooks/useMarcarVersion'

/**
 * Aviso de versión nueva. No recarga solo: el cajero puede estar en medio de una
 * venta. Tampoco se puede cerrar: mientras no recargue, sigue a la vista.
 * Montado una sola vez en App, así cubre todas las pantallas (POS, Cocina, login).
 */
export function VersionBanner() {
  const { hayNueva } = useVersionCheck()
  // Y reporta a la base qué versión tiene este equipo (supabase/app-version.sql).
  useMarcarVersion()
  if (!hayNueva) return null

  return (
    <div
      data-testid="version-nueva"
      role="status"
      style={{
        position: 'fixed', left: '50%', bottom: 16, transform: 'translateX(-50%)', zIndex: 9999,
        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px 10px 16px',
        background: '#0f172a', color: '#f8fafc', borderRadius: 12,
        boxShadow: '0 10px 30px rgba(15,23,42,.35)', fontSize: 14, fontWeight: 600,
        maxWidth: 'calc(100vw - 32px)',
      }}
    >
      <span>Hay una versión nueva</span>
      <button
        type="button"
        data-testid="version-recargar"
        onClick={() => window.location.reload()}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px',
          border: 'none', borderRadius: 10, background: '#10b981', color: '#fff',
          fontSize: 14, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 12px rgba(16,185,129,.35)',
        }}
      >
        <RefreshCw size={15} /> Recargar
      </button>
    </div>
  )
}
