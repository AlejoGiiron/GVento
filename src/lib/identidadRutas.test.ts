import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { DOCUMENTO_PORTAL, HOST_PORTAL, RUTA_INICIO_PORTAL, esDelPortal, identidadDeRuta, htmlConIdentidad, IDENTIDADES, MARCADOR_IDENTIDAD } from './identidadRutas'
import { DOMINIO_PORTAL, RE_SLUG } from './portal'
import { ORIGENES_POR_DEFECTO } from '../../supabase/functions/portal/reglas'

// 🔴 CONTRATO DE DOS LADOS (R1): la regla que usa el dev server (identidadDeRuta)
// y las rewrites de PRODUCCIÓN (vercel.json). Si divergen, en local se prueba un
// documento y en Vercel se sirve otro. Este test emula el orden de vercel.json
// (primera regla que coincide) para estas rutas.
// Emula también la condición `has: host` (el dominio del portal). Una condición de otro tipo no
// la sabe evaluar: el test falla ruidoso en vez de ignorarla.
type Rewrite = { source: string; destination: string; has?: { type: string; value: string }[] }
const vercel = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../vercel.json'), 'utf-8')) as
  { rewrites: Rewrite[]; redirects?: (Rewrite & { permanent?: boolean })[] }
const destinoVercel = (ruta: string, host = 'g-vento.vercel.app'): string => {
  const p = ruta.split('?')[0]
  for (const r of vercel.rewrites) {
    for (const h of r.has ?? []) if (h.type !== 'host') throw new Error(`condición has de tipo ${h.type}: el test no la sabe emular`)
    if ((r.has ?? []).some((h) => h.value !== host)) continue
    const re = new RegExp('^' + r.source.replace(/\(\.\*\)/g, '(.*)') + '$')
    if (re.test(p)) return r.destination
  }
  throw new Error(`ninguna rewrite para ${ruta}`)
}

describe('identidad por ruta = vercel.json', () => {
  const rutas = ['/m', '/m/', '/m/ventas', '/m/ventas?x=1', '/mesas', '/cocina', '/cocina/', '/ventas', '/login', '/', '/configuracion']
  it.each(rutas)('%s → el mismo documento en dev y en Vercel', (ruta) => {
    const id = identidadDeRuta(ruta)
    expect(destinoVercel(ruta)).toBe(id ? `/${IDENTIDADES[id].archivo}` : '/index.html')
  })
  it('/mesas NO es /m (empieza con "/m")', () => {
    expect(identidadDeRuta('/mesas')).toBeNull()
  })
})

describe('el portal del cliente = vercel.json (también por dominio)', () => {
  // [ruta, host]: el documento lo decide esDelPortal (portal) o la regla de identidades (el resto).
  const casos: [string, string][] = [
    ['/pedir/salchimelo', 'g-vento.vercel.app'], ['/pedir', 'g-vento.vercel.app'], ['/pedir/', 'g-vento.vercel.app'],
    ['/pedir/salchimelo', 'g-vento-git-x-equipo.vercel.app'], ['/pedidos', 'g-vento.vercel.app'], ['/pedirx', 'g-vento.vercel.app'],
    ['/salchimelo', HOST_PORTAL], ['/', HOST_PORTAL], ['/m', HOST_PORTAL], ['/cocina', HOST_PORTAL], ['/login', HOST_PORTAL],
    ['/m', 'g-vento.vercel.app'], ['/salchimelo', 'g-vento.vercel.app'],
  ]
  it.each(casos)('%s en %s → el mismo documento en dev y en Vercel', (ruta, host) => {
    const id = identidadDeRuta(ruta)
    const esperado = esDelPortal(ruta, host) ? `/${DOCUMENTO_PORTAL}` : id ? `/${IDENTIDADES[id].archivo}` : '/index.html'
    expect(destinoVercel(ruta, host)).toBe(esperado)
  })
  it('en el dominio del portal, las RUTAS que el disco resuelve a un documento del POS se redirigen al inicio del portal', () => {
    // Por la clase, no por los archivos: `/` también es un documento del POS (el disco la resuelve a
    // /index.html antes que las rewrites).
    const rutasDelPos = ['/', '/index.html', ...Object.values(IDENTIDADES).map((i) => `/${i.archivo}`)]
    const redirigidas = (vercel.redirects ?? [])
      .filter((r) => r.destination === RUTA_INICIO_PORTAL && (r.has ?? []).some((h) => h.type === 'host' && h.value === HOST_PORTAL))
      .map((r) => r.source)
    expect(rutasDelPos.filter((d) => !redirigidas.includes(d))).toEqual([])
    // El destino: no es un documento, cae en la rewrite del portal y no puede ser un negocio.
    expect([rutasDelPos.includes(RUTA_INICIO_PORTAL), destinoVercel(RUTA_INICIO_PORTAL, HOST_PORTAL), RE_SLUG.test(RUTA_INICIO_PORTAL.slice(1))])
      .toEqual([false, `/${DOCUMENTO_PORTAL}`, false])
    // Contraste: fuera del dominio del portal no se redirige nada (los redirects llevan su has).
    expect((vercel.redirects ?? []).filter((r) => !(r.has ?? []).length)).toEqual([])
  })
  it('el dominio del portal es UNO: el link de Configuración, vercel.json y los orígenes de la función', () => {
    expect([DOMINIO_PORTAL, (ORIGENES_POR_DEFECTO as readonly string[]).includes(`https://${HOST_PORTAL}`)]).toEqual([HOST_PORTAL, true])
  })
  it('en el dominio del portal NO se sirve el POS; fuera de él, /pedidos sigue siendo del POS', () => {
    expect([esDelPortal('/m', HOST_PORTAL), esDelPortal('/login', 'PEDIR.gvento.online:443'), esDelPortal('/pedidos', 'g-vento.vercel.app')])
      .toEqual([true, true, false])
  })
})

describe('htmlConIdentidad', () => {
  const base = `<head>\n    ${MARCADOR_IDENTIDAD}\n</head>`
  const manifests = (h: string) => [...h.matchAll(/rel="manifest" href="([^"]+)"/g)].map((m) => m[1])
  it('/m: SOLO el manifest de /m, con su ícono y nombre', () => {
    const h = htmlConIdentidad(base, 'movil')
    expect(manifests(h)).toEqual(['/movil/manifest.webmanifest'])
    expect(h).toContain('apple-touch-icon')
    expect(h).toContain('content="G-Vento"')
  })
  it('/cocina: SOLO el del KDS', () => {
    expect(manifests(htmlConIdentidad(base, 'cocina'))).toEqual(['/manifest.json'])
  })
  it('el resto: ningún manifest', () => {
    expect(manifests(htmlConIdentidad(base, null))).toEqual([])
  })
  it('sin el marcador, falla ruidoso (no arma un documento sin identidad en silencio)', () => {
    expect(() => htmlConIdentidad('<head></head>', 'movil')).toThrow(/marcador/)
  })
  it('el manifest de /m tiene start_url y scope en /m', () => {
    const m = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../public/movil/manifest.webmanifest'), 'utf-8')) as { start_url: string; scope: string }
    expect(m.start_url).toBe('/m')
    expect(m.scope).toBe('/m')
  })
})
