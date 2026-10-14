import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Punto, ZonaTipo } from '@/lib/portal'
import { round6 } from '@/lib/nominatim'

/**
 * Mapa de la zona de cobertura (Leaflet + OpenStreetMap). Solo dibuja y avisa: los valores viven
 * en el padre y se guardan con actualizar_portal. Modos:
 *   · 'ver'         → los puntos de la zona se arrastran para ajustar; clic derecho en uno lo quita.
 *   · 'dibujar'     → cada clic en el mapa agrega un punto al final.
 *   · 'mover_local' → el punto del local se arrastra, o un clic lo pone ahí.
 */
export type ModoMapa = 'ver' | 'dibujar' | 'mover_local'

interface Props {
  local: Punto | null
  nombre: string
  tipo: ZonaTipo
  radioM: number | null
  poligono: Punto[]
  modo: ModoMapa
  /** Cambiarlo pide volver a encuadrar el mapa (al ubicar la dirección, al cargar). */
  encuadre: number
  onLocal: (p: Punto) => void
  onPoligono: (p: Punto[]) => void
}

const VERDE = '#047857'
const CENTRO_POR_DEFECTO: Punto = [4.711, -74.0721]   // Bogotá, mientras no hay ubicación

const iconoVertice = L.divIcon({
  className: '',
  html: `<div data-testid="zona-vertice" style="width:16px;height:16px;border-radius:50%;background:#fff;border:3px solid ${VERDE};box-sizing:border-box;cursor:grab"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
})
const iconoLocal = L.divIcon({
  className: '',
  html: '<div data-testid="zona-local" style="width:28px;height:28px;border-radius:8px;background:#0f172a;border:2px solid #fff;box-shadow:0 2px 6px rgba(15,23,42,.35)"></div>',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
})

const aPunto = (ll: L.LatLng): Punto => [round6(ll.lat), round6(ll.lng)]

export function MapaZona({ local, nombre, tipo, radioM, poligono, modo, encuadre, onLocal, onPoligono }: Props) {
  const div = useRef<HTMLDivElement>(null)
  const mapa = useRef<L.Map | null>(null)
  const capas = useRef<L.LayerGroup | null>(null)
  // Lo último que llegó por props, para los manejadores de eventos (que se registran una vez).
  const actual = useRef({ modo, poligono, onLocal, onPoligono })
  actual.current = { modo, poligono, onLocal, onPoligono }

  // Crear el mapa una sola vez.
  useEffect(() => {
    if (!div.current || mapa.current) return
    const m = L.map(div.current, { zoomControl: true, attributionControl: true })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; colaboradores de <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m)
    m.setView(CENTRO_POR_DEFECTO, 12)
    capas.current = L.layerGroup().addTo(m)
    m.on('click', (e: L.LeafletMouseEvent) => {
      const a = actual.current
      if (a.modo === 'dibujar') a.onPoligono([...a.poligono, aPunto(e.latlng)])
      else if (a.modo === 'mover_local') a.onLocal(aPunto(e.latlng))
    })
    mapa.current = m
    return () => { m.remove(); mapa.current = null; capas.current = null }
  }, [])

  // Redibujar las capas cuando cambia algo.
  useEffect(() => {
    const g = capas.current
    if (!g) return
    g.clearLayers()
    if (tipo === 'radio' && local && radioM) {
      L.circle(local, { radius: radioM, color: VERDE, weight: 3, fillColor: '#10b981', fillOpacity: 0.22 }).addTo(g)
    }
    if (tipo === 'poligono' && poligono.length > 0) {
      if (poligono.length >= 3) {
        L.polygon(poligono, { color: VERDE, weight: 3, fillColor: '#10b981', fillOpacity: 0.22 }).addTo(g)
      } else {
        L.polyline(poligono, { color: VERDE, weight: 3, dashArray: '6 6' }).addTo(g)
      }
      poligono.forEach((p, i) => {
        const v = L.marker(p, { icon: iconoVertice, draggable: modo !== 'mover_local', keyboard: false }).addTo(g)
        v.on('dragend', () => {
          const nuevo = [...actual.current.poligono]
          nuevo[i] = aPunto(v.getLatLng())
          actual.current.onPoligono(nuevo)
        })
        v.on('contextmenu', () => actual.current.onPoligono(actual.current.poligono.filter((_, k) => k !== i)))
      })
    }
    if (local) {
      const mk = L.marker(local, { icon: iconoLocal, draggable: modo === 'mover_local', keyboard: false, zIndexOffset: 1000 }).addTo(g)
      mk.bindTooltip(nombre, { permanent: true, direction: 'bottom', offset: [0, 14], className: 'gv-tooltip-local' })
      mk.on('dragend', () => actual.current.onLocal(aPunto(mk.getLatLng())))
    }
    const contenedor = mapa.current?.getContainer()
    if (contenedor) contenedor.style.cursor = modo === 'ver' ? '' : 'crosshair'
  }, [local, nombre, tipo, radioM, poligono, modo])

  // Encuadrar cuando el padre lo pide.
  useEffect(() => {
    const m = mapa.current
    if (!m) return
    const puntos: L.LatLngExpression[] = [...(tipo === 'poligono' ? poligono : []), ...(local ? [local] : [])]
    if (tipo === 'radio' && local && radioM) {
      m.fitBounds(L.latLng(local).toBounds(radioM * 2), { padding: [24, 24] })
    } else if (puntos.length >= 2) {
      m.fitBounds(L.latLngBounds(puntos), { padding: [24, 24] })
    } else if (local) {
      m.setView(local, 15)
    }
    // Solo cuando el padre lo pide: encuadrar en cada arrastre sería molesto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encuadre])

  return (
    <div
      ref={div}
      data-testid="zona-mapa"
      role="application"
      aria-label="Mapa de la zona de cobertura"
      style={{ width: '100%', height: 320, borderRadius: 14, overflow: 'hidden', border: '1px solid #e2e8f0', background: '#e8eef3' }}
    />
  )
}
