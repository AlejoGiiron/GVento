// Dirección → coordenadas con Nominatim (OpenStreetMap). Solo al CONFIGURAR (botón "Ubicar con la
// dirección de la sede"), nunca desde el portal del cliente: la política de uso de Nominatim pide
// pocas consultas y sin automatizar. El mapa del portal se decide en P2.

import type { Punto } from '@/lib/portal'

export async function ubicarDireccion(direccion: string): Promise<Punto | null> {
  const q = direccion.trim()
  if (!q) return null
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=co&accept-language=es&q=${encodeURIComponent(q)}`
  const r = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!r.ok) throw new Error(`Nominatim respondió ${r.status}`)
  const datos = (await r.json()) as { lat: string; lon: string }[]
  if (!datos.length) return null
  const lat = Number(datos[0].lat), lng = Number(datos[0].lon)
  return Number.isFinite(lat) && Number.isFinite(lng) ? [round6(lat), round6(lng)] : null
}

/** numeric(9,6) en la base: 6 decimales (~10 cm). */
export const round6 = (n: number) => Math.round(n * 1e6) / 1e6
