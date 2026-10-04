import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import path from 'path'

// La subida de source maps solo corre si hay token: el build local, y el de
// cualquiera sin credenciales de Sentry, sigue funcionando igual.
// SENTRY_AUTH_TOKEN va como variable de entorno en Vercel — NUNCA al repo.
const SENTRY_AUTH_TOKEN = process.env.SENTRY_AUTH_TOKEN
const subeSourceMaps = !!SENTRY_AUTH_TOKEN

// ── Versión de la app (aviso de versión nueva) ─────────────────────────────────
// Vercel expone el commit que despliega en VERCEL_GIT_COMMIT_SHA durante el build.
// Fuera de Vercel (dev, E2E) la versión es 'dev'. La misma cadena va incrustada en
// el bundle (__APP_VERSION__) y publicada en /version.json: la app compara las dos
// y, si difieren, avisa que hay una versión nueva (src/hooks/useVersionCheck.ts).
const APP_VERSION = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev'

function versionJson(): Plugin {
  const cuerpo = JSON.stringify({ version: APP_VERSION })
  return {
    name: 'gvento-version-json',
    // Dev/E2E: servido por el dev server, sin caché.
    configureServer(server) {
      server.middlewares.use('/version.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', 'no-store')
        res.end(cuerpo)
      })
    },
    // Build: archivo estático en dist/ (vercel.json lo sirve con no-store).
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: cuerpo })
    },
  }
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  plugins: [
    react(),
    versionJson(),
    // ⚠️ SIEMPRE al final del array: necesita ver el bundle ya generado.
    ...(subeSourceMaps
      ? [
          sentryVitePlugin({
            authToken: SENTRY_AUTH_TOKEN,
            org: process.env.SENTRY_ORG,
            project: process.env.SENTRY_PROJECT,
            // Borra los .map del build DESPUÉS de subirlos: quedan en Sentry y
            // no en el hosting público. Es lo que hace que `sourcemap: 'hidden'`
            // sirva de algo sin exponer el código fuente.
            sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
            telemetry: false,
          }),
        ]
      : []),
  ],
  build: {
    // 'hidden' genera los .map PERO no escribe el comentario
    // `//# sourceMappingURL=` en los bundles: el navegador no los pide (nadie
    // lee el código fuente desde devtools) y Sentry los usa igual, porque los
    // asocia por debug id inyectado, no por la URL.
    sourcemap: 'hidden',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
