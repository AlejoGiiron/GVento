// ============================================================================
// Qué IDENTIDAD INSTALABLE (manifest, ícono, nombre) tiene el documento de cada
// ruta. Módulo puro: lo usan vite.config.ts (dev server y build) y el test que
// compara con vercel.json (producción).
//
// POR QUÉ HTML DISTINTO Y NO JS: Safari de iPhone toma el manifest y la URL de
// inicio del documento al "Agregar a inicio", y cambiar el <link> por JS después
// de cargar NO alcanzó (medido en un iPhone 16 Pro Max el 2026-10-05: el ícono
// agregado desde /m abría Cocina). Por eso cada identidad es un HTML con su
// manifest ESCRITO, y la app entra y sale de /m con una carga completa de página.
//
// UNA fuente: index.html trae el marcador MARCADOR_IDENTIDAD; el plugin de Vite
// lo reemplaza por el bloque de cada identidad (o por nada, en el resto).
// ============================================================================

export const MARCADOR_IDENTIDAD = '<!-- gvento:identidad -->'

export interface Identidad {
  /** Archivo HTML que se genera en dist/ y al que reescribe vercel.json. */
  archivo: string
  /** Lo que reemplaza al marcador en el <head>. */
  head: string
}

export const IDENTIDADES: Record<'movil' | 'cocina', Identidad> = {
  // POS móvil: SOLO su manifest (start_url y scope en /m).
  movil: {
    archivo: 'movil.html',
    head: [
      '<link rel="manifest" href="/movil/manifest.webmanifest" />',
      '<link rel="apple-touch-icon" href="/movil/apple-touch-icon-180.png" />',
      '<meta name="apple-mobile-web-app-title" content="G-Vento" />',
    ].join('\n    '),
  },
  // Cocina (KDS): SOLO el suyo.
  cocina: {
    archivo: 'cocina.html',
    head: '<link rel="manifest" href="/manifest.json" />',
  },
}

/** La identidad del documento para una ruta; null = sin manifest (index.html). */
export function identidadDeRuta(ruta: string): keyof typeof IDENTIDADES | null {
  const p = ruta.split('?')[0].split('#')[0]
  if (p === '/m' || p.startsWith('/m/')) return 'movil'
  if (p === '/cocina') return 'cocina'
  return null
}

/** El HTML de una identidad a partir del index.html (con su marcador). */
export function htmlConIdentidad(indexHtml: string, id: keyof typeof IDENTIDADES | null): string {
  if (!indexHtml.includes(MARCADOR_IDENTIDAD)) {
    throw new Error(`index.html no tiene el marcador ${MARCADOR_IDENTIDAD}: no se puede armar la identidad`)
  }
  return indexHtml.replace(MARCADOR_IDENTIDAD, id ? IDENTIDADES[id].head : '')
}
