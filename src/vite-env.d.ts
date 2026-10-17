/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GVENTO_SUPABASE_URL: string
  readonly VITE_GVENTO_SUPABASE_ANON_KEY: string
  /** Portal del cliente: el .pmtiles de Cali (R2). Sin ella, el mapa es un fondo liso. */
  readonly VITE_PORTAL_MAPA_URL?: string
  /** Portal del cliente: las fuentes de las etiquetas del mapa ({fontstack}/{range}.pbf). */
  readonly VITE_PORTAL_MAPA_GLIFOS?: string
  /** Portal del cliente: los íconos de lugares del mapa. */
  readonly VITE_PORTAL_MAPA_SPRITE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** Versión de la app incrustada en el build (vite.config.ts → define). 'dev' fuera de Vercel. */
declare const __APP_VERSION__: string
