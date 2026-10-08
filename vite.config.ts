import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import path from 'path'
import fs from 'node:fs'
import { MARCADOR_IDENTIDAD, IDENTIDADES, identidadDeRuta, htmlConIdentidad } from './src/lib/identidadRutas'

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

// ── Identidad instalable por ruta (src/lib/identidadRutas.ts) ───────────────────
// /m y /cocina tienen su PROPIO documento con su manifest escrito en el HTML (Safari
// de iPhone lo toma del documento al "Agregar a inicio"; cambiarlo por JS no
// alcanzó). Un solo index.html con un marcador:
//   · dev/E2E: este middleware sirve el HTML de cada identidad para sus rutas;
//   · build: se generan movil.html y cocina.html desde el index.html construido
//     (mismos scripts con hash), y vercel.json reescribe /m y /cocina hacia ellos;
//   · el resto de las rutas: index.html SIN manifest.
function identidadPorRuta(): Plugin {
  let outDir = 'dist'
  const servir = (base: () => string) =>
    (req: { url?: string; method?: string; headers: Record<string, string | string[] | undefined> },
      res: { setHeader: (k: string, v: string) => void; end: (s: string) => void },
      next: () => void,
      transformar?: (url: string, html: string) => Promise<string>) => {
      const id = identidadDeRuta(req.url ?? '/')
      const aceptaHtml = String(req.headers.accept ?? '').includes('text/html')
      if (!id || req.method !== 'GET' || !aceptaHtml) return next()
      const html = htmlConIdentidad(base(), id)
      const listo = transformar ? transformar(req.url!, html) : Promise.resolve(html)
      listo.then((h) => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.setHeader('Cache-Control', 'no-cache')
        res.end(h)
      }, next)
    }
  return {
    name: 'gvento-identidad-por-ruta',
    configResolved(c) { outDir = path.resolve(c.root, c.build.outDir) },
    configureServer(server) {
      server.middlewares.use((req, res, next) =>
        servir(() => fs.readFileSync(path.resolve(server.config.root, 'index.html'), 'utf-8'))(
          req, res, next, (url, html) => server.transformIndexHtml(url, html)))
    },
    configurePreviewServer(server) {
      // vite preview: se arma desde el index.html del build (marcador neutralizado).
      server.middlewares.use((req, res, next) =>
        servir(() => fs.readFileSync(path.join(outDir, 'index.html'), 'utf-8').replace('<!-- gvento:identidad: sin -->', MARCADOR_IDENTIDAD))(req, res, next))
    },
    // El index.html del build queda SIN manifest. El marcador se conserva como un
    // comentario neutro para poder armar las variantes en writeBundle.
    transformIndexHtml: {
      order: 'post',
      handler(html) { return html.replace(MARCADOR_IDENTIDAD, '<!-- gvento:identidad: sin -->') },
    },
    writeBundle() {
      const indexPath = path.join(outDir, 'index.html')
      const base = fs.readFileSync(indexPath, 'utf-8').replace('<!-- gvento:identidad: sin -->', MARCADOR_IDENTIDAD)
      for (const id of Object.keys(IDENTIDADES) as (keyof typeof IDENTIDADES)[]) {
        fs.writeFileSync(path.join(outDir, IDENTIDADES[id].archivo), htmlConIdentidad(base, id))
      }
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
    identidadPorRuta(),
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
