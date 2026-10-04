/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GVENTO_SUPABASE_URL: string
  readonly VITE_GVENTO_SUPABASE_ANON_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** Versión de la app incrustada en el build (vite.config.ts → define). 'dev' fuera de Vercel. */
declare const __APP_VERSION__: string
