import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { IDENTIDADES } from './identidadRutas'

// Los íconos del POS móvil, leídos del PNG (no del nombre del archivo): existen, miden lo
// que el manifest declara, y los que no pueden tener transparencia no tienen canal alfa.
// Se generan con `node scripts/iconos-movil.mjs` desde public/movil/icono.svg.
const PUBLIC = path.resolve(__dirname, '../../public')

interface Png { ancho: number; alto: number; tipoColor: number; trozos: string[] }
function leerPng(ruta: string): Png {
  const b = fs.readFileSync(ruta)
  expect(b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), `${ruta} no es un PNG`).toBe(true)
  const trozos: string[] = []
  let i = 8
  while (i < b.length) {
    const largo = b.readUInt32BE(i)
    trozos.push(b.toString('latin1', i + 4, i + 8))
    i += 12 + largo
  }
  // IHDR: ancho (8..12 del trozo), alto, profundidad, TIPO DE COLOR (2 = RGB, 6 = RGBA).
  return { ancho: b.readUInt32BE(16), alto: b.readUInt32BE(20), tipoColor: b[25], trozos }
}
const sinAlfa = (p: Png) => p.tipoColor === 2 && !p.trozos.includes('tRNS')

type Icono = { src: string; sizes: string; purpose: string }
const manifest = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'movil/manifest.webmanifest'), 'utf-8')) as { icons: Icono[] }

describe('íconos del manifest de /m', () => {
  it.each(manifest.icons.map((i) => [i.src, i] as const))('%s existe y mide lo declarado', (_src, icono) => {
    const png = leerPng(path.join(PUBLIC, icono.src))
    const [w, h] = icono.sizes.split('x').map(Number)
    expect([png.ancho, png.alto]).toEqual([w, h])
  })

  it('el maskable va a sangre completa: sin canal alfa', () => {
    const maskable = manifest.icons.find((i) => i.purpose === 'maskable')!
    expect(sinAlfa(leerPng(path.join(PUBLIC, maskable.src)))).toBe(true)
  })
})

describe('apple-touch-icon de /m', () => {
  const href = /rel="apple-touch-icon" href="([^"]+)"/.exec(IDENTIDADES.movil.head)![1]
  it('existe, mide 180x180 y NO tiene canal alfa (iOS pinta de negro lo transparente)', () => {
    const png = leerPng(path.join(PUBLIC, href))
    expect([png.ancho, png.alto]).toEqual([180, 180])
    expect(sinAlfa(png), `tipo de color ${png.tipoColor}, trozos ${png.trozos.join(',')}`).toBe(true)
  })
  it('contraste: un ícono "any" SÍ tiene alfa (las esquinas redondeadas son transparentes)', () => {
    expect(leerPng(path.join(PUBLIC, 'movil/icon-512.png')).tipoColor).toBe(6)
  })
})
