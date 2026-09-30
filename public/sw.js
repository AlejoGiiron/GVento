const CACHE = 'gvento-kds-v1'

self.addEventListener('install', (e) => {
  self.skipWaiting()
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(['/', '/cocina']))
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (e) => {
  // Solo se cachean los ASSETS de la propia app: GET y mismo origen. Todo lo
  // demás (la API de Supabase, cualquier POST) va directo a la red, sin pasar
  // por acá.
  //
  // Antes el criterio era `url.includes('supabase')`: enumeraba el hostname
  // de la nube en vez de describir lo que el SW debe tocar (allowlist vs
  // deny-list, R2). Contra el Supabase LOCAL (127.0.0.1:54331, sin "supabase"
  // en la URL) el SW interceptaba la API: cacheaba respuestas, servía datos
  // viejos si la red fallaba, y `page.route` de Playwright no veía esas
  // requests (numeracion-fallo.spec no podía inyectar su falla). Lo mismo
  // pasaría en producción el día que la API se sirva desde un dominio propio.
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return

  // Network-first: serve fresh content, fall back to cache when offline
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const clone = res.clone()
        caches.open(CACHE).then((c) => c.put(e.request, clone))
        return res
      })
      .catch(() => caches.match(e.request))
  )
})
