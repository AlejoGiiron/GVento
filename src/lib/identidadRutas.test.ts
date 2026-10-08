import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { identidadDeRuta, htmlConIdentidad, IDENTIDADES, MARCADOR_IDENTIDAD } from './identidadRutas'

// 🔴 CONTRATO DE DOS LADOS (R1): la regla que usa el dev server (identidadDeRuta)
// y las rewrites de PRODUCCIÓN (vercel.json). Si divergen, en local se prueba un
// documento y en Vercel se sirve otro. Este test emula el orden de vercel.json
// (primera regla que coincide) para estas rutas.
type Rewrite = { source: string; destination: string }
const vercel = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../vercel.json'), 'utf-8')) as { rewrites: Rewrite[] }
const destinoVercel = (ruta: string): string => {
  const p = ruta.split('?')[0]
  for (const r of vercel.rewrites) {
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
