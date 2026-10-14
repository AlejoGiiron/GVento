import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { toast } from 'react-hot-toast'
import QRCode from 'qrcode'
import { Loader2, Plus, X } from 'lucide-react'
import { useRestaurantConfig } from '@/hooks/useRestaurantConfig'
import { consultarSlugDisponible, usePortalConfig, usePortalMutations } from '@/hooks/usePortal'
import { colorDesdeLogo } from '@/lib/colorLogo'
import { ubicarDireccion } from '@/lib/nominatim'
import {
  COLOR_PORTAL_POR_DEFECTO, DIAS, DOMINIO_PORTAL, RE_COLOR, etiquetaTramo, horarioAgrupado, leerPesos,
  mostrarPesos, mostrarWhatsapp, normalizarSlug, normalizarWhatsapp, problemaHorario, problemaTramos,
  slugValido, textoEstado, urlPortal,
  type DiaIso, type EnvioTipo, type Horario, type PortalSede, type Punto, type ZonaTipo,
} from '@/lib/portal'
import { MapaZona, type ModoMapa } from '@/components/config/MapaZona'

// Configuración › Pedidos en línea (pantalla 4 del diseño, sin "Pagos en línea", que es de P3).
// Cada tarjeta guarda SOLO sus claves por actualizar_portal; el servidor las fusiona.

const VERDE = '#047857'

const tarjeta: CSSProperties = {
  background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: 20,
  display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0,
}
const h3: CSSProperties = { margin: 0, fontSize: 16, fontWeight: 800, color: '#0f172a' }
const etiqueta: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontWeight: 600, color: '#0f172a' }
const campo: CSSProperties = {
  minHeight: 44, border: '1px solid #cbd5e1', borderRadius: 10, padding: '0 12px', fontSize: 14,
  color: '#0f172a', background: '#fff', boxSizing: 'border-box', width: '100%', minWidth: 0,
}
const nota: CSSProperties = { margin: 0, fontSize: 12, color: '#64748b', lineHeight: 1.5 }
const botonOscuro: CSSProperties = {
  minHeight: 44, padding: '0 16px', borderRadius: 10, border: 0, background: '#0f172a', color: '#fff',
  fontSize: 14, fontWeight: 700, cursor: 'pointer',
}
const botonClaro: CSSProperties = { ...botonOscuro, background: '#fff', color: '#0f172a', border: '1px solid #cbd5e1' }
const botonVerde: CSSProperties = { ...botonOscuro, background: '#10b981', boxShadow: '0 6px 16px rgba(16,185,129,.35)' }
const enlace: CSSProperties = { background: 'none', border: 0, padding: 0, color: VERDE, fontSize: 13, fontWeight: 700, cursor: 'pointer', textDecoration: 'underline', alignSelf: 'flex-start' }

function Opcion({ nombre, valor, actual, onElegir, testId, children }: {
  nombre: string; valor: string; actual: string | null; onElegir: () => void; testId: string; children: ReactNode
}) {
  const sel = actual === valor
  return (
    <label style={{
      display: 'flex', alignItems: 'center', gap: 8, borderRadius: 10, padding: '10px 12px', fontSize: 14, cursor: 'pointer',
      border: sel ? `2px solid ${VERDE}` : '1px solid #cbd5e1', fontWeight: sel ? 700 : 500,
    }}>
      <input type="radio" name={nombre} checked={sel} onChange={onElegir} data-testid={testId} style={{ accentColor: VERDE }} />
      {children}
    </label>
  )
}

function Guardar({ onClick, ocupado, testId, children = 'Guardar' }: { onClick: () => void; ocupado: boolean; testId: string; children?: ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={ocupado} data-testid={testId}
      style={{ ...botonVerde, alignSelf: 'flex-start', opacity: ocupado ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: 8 }}>
      {ocupado && <Loader2 size={15} className="animate-spin" />}{children}
    </button>
  )
}

/** Lo guardado, por CONTENIDO: un refetch con los mismos datos no borra lo que se está editando. */
function useGuardado<T>(valor: T): T {
  const texto = JSON.stringify(valor)
  return useMemo(() => JSON.parse(texto) as T, [texto])
}

// ─── Estado y publicación ───────────────────────────────────────────

function TarjetaEstado({ portal, estado }: { portal: PortalSede; estado: { recibe: boolean; motivo: string | null; faltantes: string[] } }) {
  const { actualizar, pausar, guardando } = usePortalMutations()
  const t = textoEstado(estado as Parameters<typeof textoEstado>[0])
  const punto = t.tono === 'ok' ? '#10b981' : t.tono === 'pausa' ? '#f59e0b' : '#94a3b8'
  return (
    <section style={{ ...tarjeta, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 20, gridColumn: '1 / -1' }}>
      <div style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: '50%', background: punto }} />
          <h3 style={{ ...h3, fontSize: 18 }} data-testid="portal-estado">{t.titulo}</h3>
        </div>
        <p style={{ margin: 0, fontSize: 14, color: '#475569', lineHeight: 1.5 }} data-testid="portal-estado-detalle">{t.detalle}</p>
        <p style={nota}>
          El portal acepta pedidos solo con el turno de caja abierto y dentro del horario. Afuera de eso muestra el menú con el aviso de cerrado.
        </p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, fontWeight: 600 }}>
          <input type="checkbox" data-testid="portal-publicado" checked={portal.activo} disabled={guardando}
            onChange={(e) => actualizar({ activo: e.target.checked }).catch(() => {})}
            style={{ width: 22, height: 22, accentColor: VERDE }} />
          Portal publicado
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, fontWeight: 600 }}>
          <input type="checkbox" data-testid="portal-pausar" checked={portal.pausado} disabled={guardando}
            onChange={(e) => pausar(e.target.checked).catch(() => {})}
            style={{ width: 22, height: 22, accentColor: VERDE }} />
          Pausar pedidos si nos llenamos
        </label>
      </div>
    </section>
  )
}

// ─── Link, QR y color ───────────────────────────────────────────────

function useDisponibilidad(slug: string, propio: string | null) {
  const [estado, setEstado] = useState<'libre' | 'tomado' | 'invalido' | 'consultando' | 'error' | null>(null)
  useEffect(() => {
    if (!slug || slug === propio) { setEstado(null); return }
    if (!slugValido(slug)) { setEstado('invalido'); return }
    setEstado('consultando')
    let vigente = true
    const t = setTimeout(() => {
      consultarSlugDisponible(slug)
        .then((libre) => { if (vigente) setEstado(libre ? 'libre' : 'tomado') })
        // Si la consulta falla, se dice: con null el botón quedaba deshabilitado sin ningún aviso.
        .catch(() => { if (vigente) setEstado('error') })
    }, 400)
    return () => { vigente = false; clearTimeout(t) }
  }, [slug, propio])
  return estado
}

function AvisoSlug({ estado }: { estado: ReturnType<typeof useDisponibilidad> }) {
  if (!estado) return null
  const textos = {
    libre: ['Disponible', VERDE],
    tomado: ['Ese link ya lo usa otro negocio', '#b91c1c'],
    invalido: ['De 3 a 40 letras minúsculas, números o guiones (sin guion al principio ni al final)', '#b91c1c'],
    consultando: ['Revisando…', '#64748b'],
    error: ['No se pudo revisar si el link está libre. Recarga la página e inténtalo de nuevo.', '#b91c1c'],
  } as const
  const [texto, color] = textos[estado]
  return <span data-testid="portal-slug-aviso" style={{ fontSize: 12, fontWeight: 600, color }}>{texto}</span>
}

function TarjetaLink({ portal }: { portal: PortalSede }) {
  const { restaurant } = useRestaurantConfig()
  const { actualizar, guardando } = usePortalMutations()
  const [slug, setSlug] = useState(portal.slug)
  const [qr, setQr] = useState<string | null>(null)
  const [color, setColor] = useState(portal.color ?? '')
  const [sugerido, setSugerido] = useState<string | null>(null)
  const disponible = useDisponibilidad(slug, portal.slug)
  const whatsappInicial = portal.whatsapp ?? normalizarWhatsapp(restaurant?.phone)
  const [whatsapp, setWhatsapp] = useState(mostrarWhatsapp(whatsappInicial))
  useEffect(() => { setWhatsapp(mostrarWhatsapp(portal.whatsapp ?? normalizarWhatsapp(restaurant?.phone))) }, [portal.whatsapp, restaurant?.phone])

  useEffect(() => { setSlug(portal.slug) }, [portal.slug])
  useEffect(() => { setColor(portal.color ?? '') }, [portal.color])
  useEffect(() => {
    let vigente = true
    QRCode.toDataURL(urlPortal(portal.slug), { width: 512, margin: 2, color: { dark: '#0f172a', light: '#ffffff' } })
      .then((d) => { if (vigente) setQr(d) })
      .catch(() => { if (vigente) { setQr(null); toast.error('No se pudo generar el código QR') } })
    return () => { vigente = false }
  }, [portal.slug])
  // Sugerencia desde el logo, solo si la sede todavía no eligió color.
  useEffect(() => {
    if (portal.color || !restaurant?.logo_url) { setSugerido(null); return }
    let vigente = true
    colorDesdeLogo(restaurant.logo_url).then((c) => { if (vigente) setSugerido(c) })
    return () => { vigente = false }
  }, [portal.color, restaurant?.logo_url])

  const copiar = () => navigator.clipboard.writeText(urlPortal(portal.slug))
    .then(() => toast.success('Link copiado'))
    .catch(() => toast.error('No se pudo copiar el link'))

  const guardarSlug = () => {
    if (!slugValido(slug)) { toast.error('El link no es válido'); return }
    actualizar({ slug }).catch(() => {})
  }
  const whatsappNuevo = normalizarWhatsapp(whatsapp)
  const guardarWhatsapp = () => {
    if (whatsapp.trim() === '') { actualizar({ whatsapp: null }).catch(() => {}); return }
    if (!whatsappNuevo) { toast.error('Escribe un número de Colombia de 10 dígitos'); return }
    actualizar({ whatsapp: whatsappNuevo }).catch(() => {})
  }
  const guardarColor = (c: string | null) => {
    if (c !== null && !RE_COLOR.test(c)) { toast.error('El color tiene que tener la forma #rrggbb'); return }
    actualizar({ color: c }).catch(() => {})
  }
  const muestra = portal.color ?? sugerido ?? COLOR_PORTAL_POR_DEFECTO

  return (
    <section style={tarjeta}>
      <h3 style={h3}>Tu link para clientes</h3>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ ...etiqueta, flex: '1 1 220px' }}>
          Dirección
          <span style={{ display: 'flex', alignItems: 'center', border: '1px solid #cbd5e1', borderRadius: 10, overflow: 'hidden' }}>
            <span style={{ padding: '0 0 0 12px', fontSize: 14, color: '#64748b', whiteSpace: 'nowrap' }}>{DOMINIO_PORTAL}/</span>
            <input data-testid="portal-slug" value={slug} onChange={(e) => setSlug(normalizarSlug(e.target.value))}
              style={{ ...campo, border: 0, paddingLeft: 2 }} aria-label="Link del portal" />
          </span>
        </label>
        {slug === portal.slug
          ? <button type="button" style={botonOscuro} onClick={copiar} data-testid="portal-copiar">Copiar</button>
          : <button type="button" style={botonOscuro} onClick={guardarSlug} disabled={guardando || disponible !== 'libre'} data-testid="portal-slug-guardar">Guardar link</button>}
      </div>
      <AvisoSlug estado={disponible} />
      {slug !== portal.slug && (
        <p style={{ ...nota, color: '#9a3412' }}>Si cambias el link, el anterior deja de funcionar: los QR impresos y los enlaces compartidos dejan de abrir el portal.</p>
      )}
      <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
        {qr
          ? <img src={qr} alt={`Código QR de ${urlPortal(portal.slug)}`} width={88} height={88} style={{ borderRadius: 8, border: '1px solid #e2e8f0' }} />
          : <div style={{ width: 88, height: 88, borderRadius: 8, background: '#f1f5f9' }} />}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: '#475569' }}>
          <span>Para el estado de WhatsApp, Instagram y la mesa del local.</span>
          {qr && <a href={qr} download={`qr-${portal.slug}.png`} style={{ color: VERDE, fontWeight: 700 }} data-testid="portal-qr-descargar">Descargar código QR</a>}
        </div>
      </div>
      <div style={{ ...etiqueta, gap: 8 }}>
        Color del negocio en el portal
        <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontWeight: 500 }}>
          <input type="color" aria-label="Color del portal" data-testid="portal-color"
            value={color || muestra} onChange={(e) => setColor(e.target.value)}
            style={{ width: 40, height: 40, padding: 0, border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff' }} />
          <span style={{ color: '#475569', fontSize: 13 }}>
            {portal.color
              ? portal.color.toUpperCase()
              : sugerido ? `${sugerido.toUpperCase()} · sugerido con el logo de la sede` : 'Verde de G-Vento (sin elegir)'}
          </span>
        </span>
        <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {color && color !== portal.color && (
            <button type="button" style={botonClaro} onClick={() => guardarColor(color)} disabled={guardando} data-testid="portal-color-guardar">Guardar color</button>
          )}
          {!portal.color && sugerido && !color && (
            <button type="button" style={botonClaro} onClick={() => guardarColor(sugerido)} disabled={guardando} data-testid="portal-color-sugerido">Usar el color del logo</button>
          )}
          {portal.color && (
            <button type="button" style={enlace} onClick={() => guardarColor(null)} disabled={guardando} data-testid="portal-color-quitar">Volver al verde de G-Vento</button>
          )}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ ...etiqueta, flex: '1 1 200px' }}>
          WhatsApp del local
          <input data-testid="portal-whatsapp" inputMode="tel" value={whatsapp} placeholder="300 123 4567"
            onChange={(e) => setWhatsapp(e.target.value.replace(/[^\d +]/g, ''))} style={campo} />
        </label>
        {(whatsappNuevo ?? null) !== portal.whatsapp && (
          <button type="button" style={botonOscuro} onClick={guardarWhatsapp} disabled={guardando} data-testid="portal-whatsapp-guardar">
            {whatsapp.trim() === '' ? 'Quitar WhatsApp' : 'Guardar WhatsApp'}
          </button>
        )}
      </div>
      <p style={nota}>
        {portal.whatsapp
          ? 'Tus clientes lo ven en el seguimiento del pedido y si su dirección queda fuera de la zona.'
          : 'Todavía no está guardado: arranca con el teléfono de la sede. Guárdalo para que tus clientes puedan escribirte.'}
      </p>
    </section>
  )
}

// ─── Horario ────────────────────────────────────────────────────────

function TarjetaHorario({ portal }: { portal: PortalSede }) {
  const { actualizar, guardando } = usePortalMutations()
  const guardado = useGuardado(portal.horario)
  const [editando, setEditando] = useState(false)
  const [h, setH] = useState<Horario>(guardado)
  useEffect(() => { setH(guardado) }, [guardado])

  const franjasDe = (d: DiaIso) => h[d] ?? []
  const cambiar = (d: DiaIso, f: [string, string][]) => setH((x) => ({ ...x, [d]: f }))

  const guardar = async () => {
    const problema = problemaHorario(h)
    if (problema) { toast.error(problema); return }
    // Los días sin franjas no se guardan: un día que falta es un día cerrado.
    const limpio = Object.fromEntries(Object.entries(h).filter(([, f]) => (f?.length ?? 0) > 0)) as Horario
    try { await actualizar({ horario: limpio }); setEditando(false) } catch { /* el toast ya salió */ }
  }

  return (
    <section style={tarjeta}>
      <h3 style={h3}>Horario de pedidos en línea</h3>
      {!editando ? (
        <>
          <div data-testid="horario-resumen">
            {horarioAgrupado(guardado).map((g) => (
              <div key={g.dias} style={{ display: 'flex', gap: 12, fontSize: 14, borderBottom: '1px solid #f1f5f9', padding: '8px 0' }}>
                <span style={{ width: 150, fontWeight: 700 }}>{g.dias}</span>
                <span style={{ color: '#334155' }}>{g.horas}</span>
              </div>
            ))}
          </div>
          <button type="button" style={enlace} onClick={() => setEditando(true)} data-testid="horario-editar">Editar horario</button>
          <p style={nota}>Hora de Colombia. Si cierra después de la medianoche (por ejemplo, de 4:00 p. m. a 1:00 a. m.), la franja cuenta para el día en que abre.</p>
        </>
      ) : (
        <>
          {DIAS.map(({ iso, nombre }) => {
            const f = franjasDe(iso)
            return (
              <div key={iso} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', borderBottom: '1px solid #f1f5f9', paddingBottom: 8, flexWrap: 'wrap' }}>
                <label style={{ width: 120, display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 700, minHeight: 40 }}>
                  <input type="checkbox" data-testid={`horario-${iso}-abre`} checked={f.length > 0}
                    onChange={(e) => cambiar(iso, e.target.checked ? [['17:00', '23:00']] : [])} style={{ accentColor: VERDE }} />
                  {nombre}
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 220px' }}>
                  {f.length === 0 && <span style={{ fontSize: 14, color: '#64748b', minHeight: 40, display: 'flex', alignItems: 'center' }}>Cerrado</span>}
                  {f.map(([a, c], k) => (
                    <div key={k} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input type="time" aria-label={`${nombre}: abre`} data-testid={`horario-${iso}-${k}-desde`} value={a}
                        onChange={(e) => cambiar(iso, f.map((x, i) => (i === k ? [e.target.value, x[1]] : x)))} style={{ ...campo, minHeight: 40, width: 120 }} />
                      <span style={{ fontSize: 13, color: '#64748b' }}>a</span>
                      <input type="time" aria-label={`${nombre}: cierra`} data-testid={`horario-${iso}-${k}-hasta`} value={c}
                        onChange={(e) => cambiar(iso, f.map((x, i) => (i === k ? [x[0], e.target.value] : x)))} style={{ ...campo, minHeight: 40, width: 120 }} />
                      <button type="button" aria-label={`Quitar franja de ${nombre}`} onClick={() => cambiar(iso, f.filter((_, i) => i !== k))}
                        style={{ background: 'none', border: 0, color: '#94a3b8', cursor: 'pointer', minWidth: 32, minHeight: 32 }}><X size={16} /></button>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
          <div style={{ display: 'flex', gap: 8 }}>
            <Guardar onClick={guardar} ocupado={guardando} testId="horario-guardar">Guardar horario</Guardar>
            <button type="button" style={botonClaro} onClick={() => { setH(guardado); setEditando(false) }}>Cancelar</button>
          </div>
        </>
      )}
    </section>
  )
}

// ─── Zona de cobertura ──────────────────────────────────────────────

function TarjetaZona({ portal }: { portal: PortalSede }) {
  const { restaurant } = useRestaurantConfig()
  const { actualizar, guardando } = usePortalMutations()
  const guardado = useGuardado({
    local: portal.lat !== null && portal.lng !== null ? [portal.lat, portal.lng] as Punto : null,
    tipo: (portal.zona_tipo ?? 'radio') as ZonaTipo,
    radioM: portal.zona_radio_m,
    poligono: portal.zona_poligono ?? [],
  })
  const [local, setLocal] = useState<Punto | null>(guardado.local)
  const [tipo, setTipo] = useState<ZonaTipo>(guardado.tipo)
  const [radioKm, setRadioKm] = useState(guardado.radioM ? String(guardado.radioM / 1000).replace('.', ',') : '3')
  const [poligono, setPoligono] = useState<Punto[]>(guardado.poligono)
  const [modo, setModo] = useState<ModoMapa>('ver')
  const [encuadre, setEncuadre] = useState(0)
  const [ubicando, setUbicando] = useState(false)

  useEffect(() => {
    setLocal(guardado.local); setTipo(guardado.tipo); setPoligono(guardado.poligono)
    setRadioKm(guardado.radioM ? String(guardado.radioM / 1000).replace('.', ',') : '3')
    setEncuadre((n) => n + 1)
  }, [guardado])

  const radioM = (() => {
    const km = Number(radioKm.replace(',', '.'))
    return Number.isFinite(km) && km > 0 ? Math.round(km * 1000) : null
  })()

  const ubicar = async () => {
    const dir = restaurant?.address?.trim()
    if (!dir) { toast.error('La sede no tiene dirección. Agrégala en Configuración › Restaurante, o pon el punto con "Mover el local".'); return }
    setUbicando(true)
    try {
      const p = await ubicarDireccion(dir)
      if (!p) { toast.error('No se encontró esa dirección en el mapa. Pon el punto con "Mover el local".'); return }
      setLocal(p); setEncuadre((n) => n + 1)
      toast.success('Ubicado. Revisa el punto y corrígelo si hace falta.')
    } catch {
      toast.error('No se pudo consultar el mapa. Inténtalo de nuevo o pon el punto a mano.')
    } finally {
      setUbicando(false)
    }
  }

  const guardar = () => {
    if (!local) { toast.error('Falta la ubicación del local'); return }
    if (tipo === 'radio' && (!radioM || radioM < 200 || radioM > 30000)) { toast.error('El radio tiene que estar entre 0,2 y 30 km'); return }
    if (tipo === 'poligono' && poligono.length < 3) { toast.error('Dibuja la zona con al menos 3 puntos'); return }
    setModo('ver')
    actualizar({
      lat: local[0], lng: local[1], zona_tipo: tipo,
      zona_radio_m: tipo === 'radio' ? radioM : portal.zona_radio_m,
      zona_poligono: tipo === 'poligono' ? poligono : portal.zona_poligono,
    }).catch(() => {})
  }

  return (
    <section style={{ ...tarjeta, flexDirection: 'row', flexWrap: 'wrap', gap: 20, gridColumn: '1 / -1' }}>
      <div style={{ flex: '999 1 420px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <MapaZona local={local} nombre={restaurant?.name ?? 'Local'} tipo={tipo} radioM={radioM} poligono={poligono}
          modo={modo} encuadre={encuadre} onLocal={setLocal} onPoligono={setPoligono} />
        <span style={nota}>
          {modo === 'dibujar' ? 'Toca el mapa para poner cada punto del borde de la zona. Clic derecho en un punto lo quita.'
            : modo === 'mover_local' ? 'Arrastra el punto del local o toca el mapa donde está.'
            : tipo === 'poligono' ? 'Arrastra los puntos para ajustar la zona.' : 'El círculo es hasta dónde llegan tus domiciliarios.'}
        </span>
      </div>
      <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h3 style={h3}>Zona de cobertura</h3>
        <p style={{ margin: 0, fontSize: 14, color: '#475569', lineHeight: 1.5 }}>
          Hasta dónde llegan tus domiciliarios. Si la ubicación del cliente queda por fuera, el portal se lo dice antes de pagar y no deja hacer el pedido.
        </p>
        <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <legend style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Cómo se define</legend>
          <Opcion nombre="zona" valor="radio" actual={tipo} onElegir={() => { setTipo('radio'); setModo('ver') }} testId="zona-tipo-radio">Un radio desde el local</Opcion>
          <Opcion nombre="zona" valor="poligono" actual={tipo} onElegir={() => { setTipo('poligono'); if (poligono.length === 0) setModo('dibujar') }} testId="zona-tipo-poligono">Dibujada en el mapa</Opcion>
        </fieldset>
        {tipo === 'radio' && (
          <label style={etiqueta}>
            Radio (km)
            <input data-testid="zona-radio-km" inputMode="decimal" value={radioKm} onChange={(e) => setRadioKm(e.target.value.replace(/[^\d,.]/g, ''))} style={campo} />
          </label>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {tipo === 'poligono' && (modo === 'dibujar'
            ? <button type="button" style={botonOscuro} onClick={() => setModo('ver')} data-testid="zona-terminar">Terminar zona</button>
            : <button type="button" style={botonOscuro} onClick={() => { setPoligono([]); setModo('dibujar') }} data-testid="zona-redibujar">Redibujar zona</button>)}
          {modo === 'mover_local'
            ? <button type="button" style={botonOscuro} onClick={() => setModo('ver')} data-testid="zona-local-listo">Listo</button>
            : <button type="button" style={botonClaro} onClick={() => setModo('mover_local')} data-testid="zona-mover-local">Mover el local</button>}
          <button type="button" style={botonClaro} onClick={ubicar} disabled={ubicando} data-testid="zona-ubicar">
            {ubicando ? 'Buscando…' : 'Ubicar con la dirección de la sede'}
          </button>
        </div>
        <span style={nota}>
          El punto del local sale de la dirección de la sede; se puede corregir arrastrándolo. La búsqueda de la
          dirección usa <a href="https://nominatim.openstreetmap.org/" target="_blank" rel="noreferrer" style={{ color: '#64748b' }}>Nominatim</a> ©
          colaboradores de <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" style={{ color: '#64748b' }}>OpenStreetMap</a>.
        </span>
        <Guardar onClick={guardar} ocupado={guardando} testId="zona-guardar">Guardar zona</Guardar>
      </div>
    </section>
  )
}

// ─── Envío, mínimo y tiempo ─────────────────────────────────────────

interface TramoTexto { hasta: string; valor: string }

function TarjetaEnvio({ portal }: { portal: PortalSede }) {
  const { actualizar, guardando } = usePortalMutations()
  const guardado = useGuardado({
    tipo: portal.envio_tipo, fijo: portal.envio_fijo, tramos: portal.envio_tramos,
    minimo: portal.pedido_minimo, tmin: portal.tiempo_min, tmax: portal.tiempo_max,
  })
  const aTexto = (t: typeof guardado.tramos): TramoTexto[] =>
    (t ?? [{ hasta_km: 2, valor: NaN }, { hasta_km: null, valor: NaN }]).map((x) => ({
      hasta: x.hasta_km === null ? '' : String(x.hasta_km).replace('.', ','),
      valor: Number.isNaN(x.valor) ? '' : mostrarPesos(x.valor),
    }))
  const [tipo, setTipo] = useState<EnvioTipo | null>(guardado.tipo)
  const [fijo, setFijo] = useState(mostrarPesos(guardado.fijo))
  const [tramos, setTramos] = useState<TramoTexto[]>(aTexto(guardado.tramos))
  const [minimo, setMinimo] = useState(mostrarPesos(guardado.minimo))
  const [tmin, setTmin] = useState(guardado.tmin?.toString() ?? '')
  const [tmax, setTmax] = useState(guardado.tmax?.toString() ?? '')

  useEffect(() => {
    setTipo(guardado.tipo); setFijo(mostrarPesos(guardado.fijo)); setTramos(aTexto(guardado.tramos))
    setMinimo(mostrarPesos(guardado.minimo)); setTmin(guardado.tmin?.toString() ?? ''); setTmax(guardado.tmax?.toString() ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guardado])

  const tramosNum = tramos.map((t, i) => ({
    hasta_km: i === tramos.length - 1 ? null : (t.hasta.trim() === '' ? NaN : Number(t.hasta.replace(',', '.'))),
    valor: leerPesos(t.valor) ?? NaN,
  }))

  const guardar = () => {
    if (!tipo) { toast.error('Elige cómo se cobra el envío'); return }
    const fijoNum = leerPesos(fijo)
    if (tipo === 'fijo' && fijoNum === null) { toast.error('Escribe el valor del envío'); return }
    if (tipo === 'distancia') {
      const p = problemaTramos(tramosNum)
      if (p) { toast.error(p); return }
    }
    const a = Number(tmin), b = Number(tmax)
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 5 || b > 240 || a > b) {
      toast.error('El tiempo de entrega va de 5 a 240 minutos, y el mínimo no puede ser mayor que el máximo'); return
    }
    actualizar({
      envio_tipo: tipo,
      envio_fijo: tipo === 'fijo' ? fijoNum : portal.envio_fijo,
      envio_tramos: tipo === 'distancia' ? tramosNum : portal.envio_tramos,
      pedido_minimo: leerPesos(minimo) ?? 0,
      tiempo_min: a, tiempo_max: b,
    }).catch(() => {})
  }

  const cambiarTramo = (i: number, k: keyof TramoTexto, v: string) =>
    setTramos((t) => t.map((x, j) => (j === i ? { ...x, [k]: v } : x)))

  return (
    <section style={tarjeta}>
      <h3 style={h3}>Envío</h3>
      <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <legend style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Cómo se cobra</legend>
        <Opcion nombre="envio" valor="fijo" actual={tipo} onElegir={() => setTipo('fijo')} testId="envio-tipo-fijo">Tarifa fija</Opcion>
        <Opcion nombre="envio" valor="distancia" actual={tipo} onElegir={() => setTipo('distancia')} testId="envio-tipo-distancia">Por distancia</Opcion>
      </fieldset>
      {tipo === 'fijo' && (
        <label style={etiqueta}>
          Valor del envío
          <input data-testid="envio-fijo" inputMode="numeric" value={fijo} placeholder="$4.000"
            onChange={(e) => setFijo(mostrarPesos(leerPesos(e.target.value)))} style={campo} />
        </label>
      )}
      {tipo === 'distancia' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', fontSize: 12, fontWeight: 600, color: '#475569', gap: 8 }}>
            <span style={{ flex: 1 }}>Desde el local</span><span style={{ width: 120 }}>Valor</span><span style={{ width: 32 }} />
          </div>
          {tramos.map((t, i) => {
            const ultimo = i === tramos.length - 1
            return (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
                  {ultimo
                    ? <span data-testid={`envio-tramo-${i}-etiqueta`}>{etiquetaTramo(tramosNum.map((x) => ({ ...x, hasta_km: Number.isNaN(x.hasta_km) ? 0 : x.hasta_km })), i)}</span>
                    : <>
                        {i === 0 ? 'Hasta' : `${tramos[i - 1].hasta || '?'} a`}
                        <input data-testid={`envio-tramo-${i}-km`} inputMode="decimal" value={t.hasta} aria-label={`Tramo ${i + 1}: hasta cuántos km`}
                          onChange={(e) => cambiarTramo(i, 'hasta', e.target.value.replace(/[^\d,.]/g, ''))} style={{ ...campo, width: 70, minHeight: 40 }} />
                        km
                      </>}
                </span>
                <input data-testid={`envio-tramo-${i}-valor`} inputMode="numeric" value={t.valor} placeholder="$0" aria-label={`Tramo ${i + 1}: valor`}
                  onChange={(e) => cambiarTramo(i, 'valor', mostrarPesos(leerPesos(e.target.value)))} style={{ ...campo, width: 120, minHeight: 40 }} />
                {!ultimo && tramos.length > 1
                  ? <button type="button" aria-label={`Quitar tramo ${i + 1}`} onClick={() => setTramos((x) => x.filter((_, j) => j !== i))}
                      style={{ background: 'none', border: 0, color: '#94a3b8', cursor: 'pointer', width: 32, height: 32 }}><X size={16} /></button>
                  : <span style={{ width: 32 }} />}
              </div>
            )
          })}
          {tramos.length < 10 && (
            <button type="button" style={{ ...enlace, fontSize: 12 }} data-testid="envio-tramo-agregar"
              onClick={() => setTramos((x) => [...x.slice(0, -1), { hasta: '', valor: '' }, x[x.length - 1]])}>
              <Plus size={12} style={{ verticalAlign: -2 }} /> Agregar tramo
            </button>
          )}
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <label style={{ ...etiqueta, flex: '1 1 140px' }}>
          Pedido mínimo
          <input data-testid="pedido-minimo" inputMode="numeric" value={minimo} placeholder="$0"
            onChange={(e) => setMinimo(mostrarPesos(leerPesos(e.target.value)))} style={campo} />
        </label>
        <div style={{ ...etiqueta, flex: '1 1 180px' }}>
          Tiempo que se muestra
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
            <input data-testid="tiempo-min" inputMode="numeric" value={tmin} aria-label="Tiempo mínimo (min)"
              onChange={(e) => setTmin(e.target.value.replace(/\D/g, ''))} style={{ ...campo, width: 64 }} />
            a
            <input data-testid="tiempo-max" inputMode="numeric" value={tmax} aria-label="Tiempo máximo (min)"
              onChange={(e) => setTmax(e.target.value.replace(/\D/g, ''))} style={{ ...campo, width: 64 }} />
            min
          </span>
        </div>
      </div>
      <p style={nota}>La distancia se mide en línea recta desde el local. Fuera de la zona de cobertura no se reciben pedidos.</p>
      <Guardar onClick={guardar} ocupado={guardando} testId="envio-guardar">Guardar envío</Guardar>
    </section>
  )
}

// ─── Primera vez: elegir el link ────────────────────────────────────

function CrearPortal() {
  const { restaurant, config } = useRestaurantConfig()
  const { actualizar, guardando } = usePortalMutations()
  // Sugerencia: el "Slug público" viejo de Configuración › Restaurante, o el nombre de la sede.
  const sugerido = normalizarSlug(String(config.slug ?? '') || restaurant?.name || '').replace(/-+$/, '')
  const [slug, setSlug] = useState(sugerido)
  const [tocado, setTocado] = useState(false)
  useEffect(() => { if (!tocado) setSlug(sugerido) }, [sugerido, tocado])
  const disponible = useDisponibilidad(slug, null)

  return (
    <section style={{ ...tarjeta, maxWidth: 560 }}>
      <h3 style={h3}>Tu link para clientes</h3>
      <p style={{ margin: 0, fontSize: 14, color: '#475569', lineHeight: 1.5 }}>
        Con este link tus clientes ven el menú y piden a domicilio. Elígelo para empezar: después configuras la zona, el envío, el horario y los productos. El portal no se publica hasta que tú lo decidas.
      </p>
      <label style={etiqueta}>
        Dirección
        <span style={{ display: 'flex', alignItems: 'center', border: '1px solid #cbd5e1', borderRadius: 10, overflow: 'hidden' }}>
          <span style={{ padding: '0 0 0 12px', fontSize: 14, color: '#64748b', whiteSpace: 'nowrap' }}>{DOMINIO_PORTAL}/</span>
          <input data-testid="portal-slug" value={slug} onChange={(e) => { setTocado(true); setSlug(normalizarSlug(e.target.value)) }}
            style={{ ...campo, border: 0, paddingLeft: 2 }} aria-label="Link del portal" />
        </span>
      </label>
      <AvisoSlug estado={disponible} />
      <Guardar onClick={() => actualizar({ slug }).catch(() => {})} ocupado={guardando || disponible !== 'libre'} testId="portal-crear">
        Crear el portal
      </Guardar>
    </section>
  )
}

// ─── La sección ─────────────────────────────────────────────────────

export function SeccionPedidosOnline() {
  const { data, isLoading, error } = usePortalConfig()
  if (isLoading) return <p style={{ color: '#64748b' }}>Cargando…</p>
  if (error) return <p style={{ color: '#b91c1c' }}>No se pudo cargar la configuración del portal: {(error as { message?: string }).message}</p>
  const portal = data?.portal ?? null
  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: '0 0 24px' }}>Pedidos en línea</h2>
      {!portal || !data ? <CrearPortal /> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 18 }}>
          <TarjetaEstado portal={portal} estado={data.estado} />
          <TarjetaLink portal={portal} />
          <TarjetaHorario portal={portal} />
          <TarjetaZona portal={portal} />
          <TarjetaEnvio portal={portal} />
        </div>
      )}
    </div>
  )
}
