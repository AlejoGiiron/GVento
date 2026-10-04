// Paleta y botones del POS móvil (/m): fondo oscuro y contraste alto para una
// barra con poca luz; blancos de al menos 56–60 px para el pulgar.

export const M = {
  fondo: '#0f172a',
  panel: '#1e293b',
  borde: '#334155',
  texto: '#f1f5f9',
  suave: '#94a3b8',
  verde: '#10b981',
  verdeOscuro: '#059669',
  ambar: '#f59e0b',
  rojo: '#ef4444',
  nequi: '#da0081',
} as const

export const botonGrande = (fondo: string): React.CSSProperties => ({
  minHeight: 60, padding: '0 20px', border: 'none', borderRadius: 14, background: fondo, color: '#fff',
  fontSize: 18, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
})

export const formatCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n)
