import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import path from 'path'

// La subida de source maps solo corre si hay token: el build local, y el de
// cualquiera sin credenciales de Sentry, sigue funcionando igual.
// SENTRY_AUTH_TOKEN va como variable de entorno en Vercel — NUNCA al repo.
const SENTRY_AUTH_TOKEN = process.env.SENTRY_AUTH_TOKEN
const subeSourceMaps = !!SENTRY_AUTH_TOKEN

export default defineConfig({
  plugins: [
    react(),
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
