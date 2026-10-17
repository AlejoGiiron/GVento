import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Protocol } from 'pmtiles'
import { layers, namedFlavor } from '@protomaps/basemaps'
import type { Punto } from './datosCliente'
import { mapaFijaPunto } from './reglasMapa'

// El mapa del cliente: MapLibre con el recorte de Cali en PMTiles (Cloudflare R2). El punto de entrega
// es el CENTRO del mapa ("Mueve el mapa para ajustar el punto"): el pin es un dibujo fijo encima.
// Variables (en Vercel; ver el plan → "P2 · el mapa del portal"):
//   VITE_PORTAL_MAPA_URL     el .pmtiles de Cali. Sin ella el mapa es liso y, fuera de desarrollo,
//                            moverlo NO fija el punto (mapaFijaPunto: falla cerrado);
//   VITE_PORTAL_MAPA_GLIFOS  las fuentes de las etiquetas ({fontstack}/{range}.pbf); sin ella, sin textos;
//   VITE_PORTAL_MAPA_SPRITE  los íconos de lugares; sin ella, sin íconos.

const URL_TESELAS = import.meta.env.VITE_PORTAL_MAPA_URL
let protocoloRegistrado = false

function estilo(): maplibregl.StyleSpecification {
  const glifos = import.meta.env.VITE_PORTAL_MAPA_GLIFOS
  const sprite = import.meta.env.VITE_PORTAL_MAPA_SPRITE
  const fondo: maplibregl.LayerSpecification = { id: 'fondo', type: 'background', paint: { 'background-color': '#e7ecf2' } }
  if (!URL_TESELAS) return { version: 8, sources: {}, layers: [fondo] }
  if (!protocoloRegistrado) {
    maplibregl.addProtocol('pmtiles', new Protocol().tile)
    protocoloRegistrado = true
  }
  // Sin glifos no puede haber textos, y sin sprite no puede haber íconos: esas capas se quitan (si no,
  // MapLibre falla al pedirlos).
  const capas = (layers('protomaps', namedFlavor('light'), { lang: 'es' }) as maplibregl.LayerSpecification[])
    .filter((c) => {
      if (c.type !== 'symbol') return true
      const layout = (c.layout ?? {}) as Record<string, unknown>
      if (!glifos && layout['text-field'] !== undefined) return false
      if (!sprite && layout['icon-image'] !== undefined) return false
      return true
    })
  return {
    version: 8,
    ...(glifos ? { glyphs: glifos } : {}),
    ...(sprite ? { sprite } : {}),
    sources: {
      protomaps: { type: 'vector', url: `pmtiles://${URL_TESELAS}`, attribution: '© OpenStreetMap · Protomaps' },
    },
    layers: capas,
  }
}

/** Los textos del mapa para el lector de pantalla, en español (MapLibre los trae en inglés). */
const TEXTOS_MAPA: Record<string, string> = {
  'Map.Title': 'Mapa del punto de entrega',
  'AttributionControl.ToggleAttribution': 'Mostrar los créditos del mapa',
  'AttributionControl.MapFeedback': 'Reportar un error del mapa',
  'NavigationControl.ZoomIn': 'Acercar',
  'NavigationControl.ZoomOut': 'Alejar',
  'Marker.Title': 'El local',
}

interface Props {
  local: Punto
  punto: Punto | null
  onMover: (p: Punto) => void
}

export default function Mapa({ local, punto, onMover }: Props) {
  const caja = useRef<HTMLDivElement>(null)
  const mapa = useRef<maplibregl.Map | null>(null)
  const alMover = useRef(onMover)
  alMover.current = onMover
  const [fallo, setFallo] = useState(false)
  const [teselasFallaron, setTeselasFallaron] = useState(false)
  const fija = mapaFijaPunto({ hayTeselas: Boolean(URL_TESELAS), fallaron: teselasFallaron, desarrollo: import.meta.env.DEV })
  const fijaRef = useRef(fija)
  fijaRef.current = fija

  useEffect(() => {
    if (!caja.current) return
    let m: maplibregl.Map
    try {
      const inicio = punto ?? local
      m = new maplibregl.Map({
        container: caja.current,
        style: estilo(),
        center: [inicio.lng, inicio.lat],
        zoom: 15,
        attributionControl: { compact: true },
        locale: TEXTOS_MAPA,
        dragRotate: false,
        pitchWithRotate: false,
        // El zoom es alrededor del CENTRO: acercar o alejar no mueve el punto de entrega.
        scrollZoom: { around: 'center' },
        touchZoomRotate: { around: 'center' },
        doubleClickZoom: false,
      })
    } catch (e) {
      console.error('[portal] el mapa no arrancó', e)
      setFallo(true)   // sin WebGL: queda "Usar mi ubicación" y la dirección escrita
      return
    }
    m.touchZoomRotate.disableRotation()
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    new maplibregl.Marker({ color: '#0f172a' }).setLngLat([local.lng, local.lat]).addTo(m)
    // Un error de teselas, fuentes o íconos = el cliente no ve bien las calles: deja de fijar el punto.
    m.on('error', (e) => {
      console.error('[portal] error del mapa', e.error)
      if (URL_TESELAS) setTeselasFallaron(true)
    })
    // Solo lo que mueve la PERSONA cambia el punto (un movimiento programado no trae originalEvent).
    m.on('moveend', (e) => {
      if (!(e as { originalEvent?: unknown }).originalEvent || !fijaRef.current) return
      const c = m.getCenter()
      alMover.current({ lat: c.lat, lng: c.lng })
    })
    mapa.current = m
    return () => { m.remove(); mapa.current = null }
    // El mapa se crea una vez; los cambios del punto se aplican abajo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Un punto que llega de afuera ("Usar mi ubicación"): se centra el mapa ahí.
  useEffect(() => {
    const m = mapa.current
    if (!m || !punto) return
    const c = m.getCenter()
    if (Math.abs(c.lat - punto.lat) > 1e-6 || Math.abs(c.lng - punto.lng) > 1e-6) m.jumpTo({ center: [punto.lng, punto.lat] })
  }, [punto])

  if (fallo) {
    return (
      <p data-testid="pedido-mapa-fallo" style={{ margin: 0, padding: 16, borderRadius: 14, background: 'var(--p-suave)', color: 'var(--p-texto-2)', fontSize: 14 }}>
        Este navegador no puede mostrar el mapa. Usa "Usar mi ubicación actual" y escribe bien la dirección.
      </p>
    )
  }
  return (
    <div style={{ position: 'relative', height: 230, borderRadius: 14, overflow: 'hidden', border: '1px solid var(--p-borde)' }}>
      <div ref={caja} data-testid="pedido-mapa" style={{ position: 'absolute', inset: 0 }} />
      {/* El pin: fijo en el centro; la punta marca el punto de entrega. */}
      <svg aria-hidden="true" width="34" height="44" viewBox="0 0 34 44"
        style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -100%)', pointerEvents: 'none' }}>
        <path d="M17 43C17 43 32 26 32 16A15 15 0 1 0 2 16C2 26 17 43 17 43Z" fill="var(--p-marca)" stroke="#fff" strokeWidth="2" />
        <circle cx="17" cy="16" r="5.5" fill="#fff" />
      </svg>
      <span data-testid={fija ? undefined : 'pedido-mapa-sin-calles'} role={fija ? undefined : 'status'}
        style={{ position: 'absolute', left: 10, right: 10, bottom: 10, width: 'fit-content', maxWidth: 'calc(100% - 20px)', background: 'var(--p-panel)', color: 'var(--p-texto)', fontSize: 13, fontWeight: 600, padding: '6px 12px', borderRadius: 12, boxShadow: '0 1px 3px rgba(15,23,42,.15)' }}>
        {fija ? 'Mueve el mapa para ajustar el punto' : 'El mapa no cargó las calles. Usa "Usar mi ubicación actual".'}
      </span>
    </div>
  )
}
