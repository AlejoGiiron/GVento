// Dirección → coordenadas con Nominatim (OpenStreetMap). Solo al CONFIGURAR (botón "Ubicar con la
// dirección de la sede"), nunca desde el portal del cliente: el mapa del portal se decide en P2.
//
// Política de uso (https://operations.osmfoundation.org/policies/nominatim/, leída el 2026-10-14):
//   · máximo 1 consulta por segundo en TOTAL → `esperarTurno` separa las consultas ≥ 1,1 s;
//   · identificarse con un Referer o User-Agent válido → el navegador manda el Referer (el origen de
//     la app) con la política explícita de abajo; no hay ningún Referrer-Policy que lo quite;
//   · guardar los resultados → la ubicación queda en portal_sedes al guardar la zona, y en esta
//     sesión no se repite una consulta igual (`cache`);
//   · nada de autocompletar → una consulta por clic, nunca mientras se escribe;
//   · atribución → el mapa la muestra (Leaflet) y la pantalla dice de dónde sale la ubicación.

import type { Punto } from '@/lib/portal'

export const URL_NOMINATIM = 'https://nominatim.openstreetmap.org/search'
export const MS_ENTRE_CONSULTAS = 1100

const cache = new Map<string, Punto | null>()
let ultima: number | null = null   // null = todavía no se ha consultado

/**
 * Reserva el próximo turno ANTES de esperar (así dos consultas que llegan juntas no calculan la
 * espera con la misma hora) y espera hasta él.
 */
async function esperarTurno(ahora: () => number, dormir: (ms: number) => Promise<void>) {
  const t = ahora()
  const turno = ultima === null ? t : Math.max(t, ultima + MS_ENTRE_CONSULTAS)
  ultima = turno
  if (turno > t) await dormir(turno - t)
}

/** Para las pruebas: el reloj, la espera y el fetch se pueden reemplazar. */
export interface DependenciasNominatim {
  fetch: typeof fetch
  ahora: () => number
  dormir: (ms: number) => Promise<void>
}
const reales: DependenciasNominatim = {
  fetch: (...a) => fetch(...a),
  ahora: () => Date.now(),
  dormir: (ms) => new Promise((r) => setTimeout(r, ms)),
}

export async function ubicarDireccion(direccion: string, dep: DependenciasNominatim = reales): Promise<Punto | null> {
  const q = direccion.trim().replace(/\s+/g, ' ')
  if (!q) return null
  const clave = q.toLowerCase()
  if (cache.has(clave)) return cache.get(clave) ?? null

  await esperarTurno(dep.ahora, dep.dormir)
  const url = `${URL_NOMINATIM}?format=jsonv2&limit=1&countrycodes=co&accept-language=es&q=${encodeURIComponent(q)}`
  const r = await dep.fetch(url, {
    headers: { Accept: 'application/json' },
    // El origen de la app viaja como Referer: así Nominatim sabe qué aplicación consulta.
    referrerPolicy: 'strict-origin-when-cross-origin',
  })
  if (!r.ok) throw new Error(`Nominatim respondió ${r.status}`)
  const datos = (await r.json()) as { lat: string; lon: string }[]
  const lat = Number(datos[0]?.lat), lng = Number(datos[0]?.lon)
  const punto: Punto | null = datos.length && Number.isFinite(lat) && Number.isFinite(lng) ? [round6(lat), round6(lng)] : null
  cache.set(clave, punto)
  return punto
}

/** Solo para las pruebas: vuelve al estado inicial (sin caché y sin consulta previa). */
export function reiniciarNominatim() { cache.clear(); ultima = null }

/** numeric(9,6) en la base: 6 decimales (~10 cm). */
export const round6 = (n: number) => Math.round(n * 1e6) / 1e6
