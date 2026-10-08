// Genera los íconos del POS móvil (public/movil/*.png) desde public/movil/icono.svg.
//
//   node scripts/iconos-movil.mjs                       → escribe los 4 PNG
//   node scripts/iconos-movil.mjs --muestra <archivo>   → además, una imagen de muestra
//
// Rasteriza con el Chromium de Playwright (dependencia de DESARROLLO, ya instalada): no
// agrega nada al bundle. Los PNG se codifican acá para controlar el canal alfa:
//   · icon-192 / icon-512 (purpose any): tal cual el SVG, esquinas redondeadas → RGBA.
//   · icon-maskable-512: fondo a sangre completa (sin rx) → RGB, SIN alfa. El contenido
//     tiene que caer dentro del círculo central del 80 %: se VERIFICA sobre los píxeles.
//   · apple-touch-icon-180: a sangre completa, sin rx → RGB, SIN alfa (iOS pinta de
//     negro lo transparente y redondea las esquinas él solo).
import { readFileSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIR = path.join(RAIZ, 'public', 'movil')
const FONDO = [0x0f, 0x17, 0x2a]   // #0f172a
const SVG = readFileSync(path.join(DIR, 'icono.svg'), 'utf8')
if (SVG.split('rx="14.4"').length !== 2) throw new Error('icono.svg: se esperaba un único rx="14.4" en el fondo')
const A_SANGRE = SVG.replace('rx="14.4"', 'rx="0"')

const SALIDAS = [
  { archivo: 'icon-192.png', svg: SVG, lado: 192, alfa: true },
  { archivo: 'icon-512.png', svg: SVG, lado: 512, alfa: true },
  { archivo: 'icon-maskable-512.png', svg: A_SANGRE, lado: 512, alfa: false, maskable: true },
  { archivo: 'apple-touch-icon-180.png', svg: A_SANGRE, lado: 180, alfa: false },
]

// ── PNG ──────────────────────────────────────────────────────────────────────
function crc32(buf) {
  let c, crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}
function trozo(tipo, datos) {
  const largo = Buffer.alloc(4); largo.writeUInt32BE(datos.length)
  const td = Buffer.concat([Buffer.from(tipo), datos])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([largo, td, crc])
}
function png(rgba, lado, conAlfa) {
  const canales = conAlfa ? 4 : 3
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(lado, 0); ihdr.writeUInt32BE(lado, 4)
  ihdr[8] = 8; ihdr[9] = conAlfa ? 6 : 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const filas = Buffer.alloc(lado * (1 + lado * canales))
  for (let y = 0; y < lado; y++) {
    const base = y * (1 + lado * canales)
    filas[base] = 0
    for (let x = 0; x < lado; x++) {
      const i = (y * lado + x) * 4
      const o = base + 1 + x * canales
      filas[o] = rgba[i]; filas[o + 1] = rgba[i + 1]; filas[o + 2] = rgba[i + 2]
      if (conAlfa) filas[o + 3] = rgba[i + 3]
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo('IHDR', ihdr), trozo('IDAT', deflateSync(filas)), trozo('IEND', Buffer.alloc(0)),
  ])
}

// ── Rasterizar en Chromium ───────────────────────────────────────────────────
async function rasterizar(pagina, svg, lado) {
  // El tamaño de rasterizado lo pone el script: se quitan width/height de la raíz si el SVG
  // los trae (los demás atributos y el dibujo quedan intactos).
  const raiz = /<svg\b[^>]*>/.exec(svg)[0]
  const sinTamano = raiz.replace(/\s(width|height)="[^"]*"/g, '')
  const conTamano = svg.replace(raiz, sinTamano.replace('<svg', `<svg width="${lado}" height="${lado}"`))
  const b64 = await pagina.evaluate(async ({ s, n }) => {
    const img = new Image()
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s)
    await img.decode()
    const c = document.createElement('canvas'); c.width = n; c.height = n
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0, n, n)
    const d = ctx.getImageData(0, 0, n, n).data
    let bin = ''
    for (let i = 0; i < d.length; i += 0x8000) bin += String.fromCharCode(...d.subarray(i, i + 0x8000))
    return btoa(bin)
  }, { s: conTamano, n: lado })
  return Buffer.from(b64, 'base64')
}

// ── Verificaciones sobre los PÍXELES generados ───────────────────────────────
function verificar(rgba, lado, salida) {
  const res = {}
  if (!salida.alfa) {
    let transparentes = 0
    for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) transparentes++
    if (transparentes) throw new Error(`${salida.archivo}: ${transparentes} píxeles no opacos; no puede ir sin canal alfa`)
    res.opaco = true
  }
  if (salida.maskable) {
    // Contenido = todo píxel que se aparta del fondo (incluye el borde suavizado).
    const c = (lado - 1) / 2
    let maxR = 0
    for (let y = 0; y < lado; y++) for (let x = 0; x < lado; x++) {
      const i = (y * lado + x) * 4
      const dif = Math.abs(rgba[i] - FONDO[0]) + Math.abs(rgba[i + 1] - FONDO[1]) + Math.abs(rgba[i + 2] - FONDO[2])
      if (dif > 6) maxR = Math.max(maxR, Math.hypot(x - c, y - c))
    }
    const limite = 0.4 * lado   // círculo central del 80 % → radio = 40 % del lado
    res.radioMaximoContenido = +maxR.toFixed(1)
    res.radioPermitido = limite
    res.fraccionDelRadio = +(maxR / (lado / 2)).toFixed(3)   // 0.8 = borde de la zona segura
    if (maxR > limite) throw new Error(`${salida.archivo}: el contenido llega a r=${maxR.toFixed(1)} px, fuera del círculo del 80 % (r=${limite})`)
  }
  return res
}

const muestraIdx = process.argv.indexOf('--muestra')
const muestra = muestraIdx > 0 ? process.argv[muestraIdx + 1] : null

const navegador = await chromium.launch()
try {
  const pagina = await navegador.newPage()
  await pagina.setContent('<!doctype html><html><body></body></html>')
  const generados = {}
  for (const s of SALIDAS) {
    const rgba = await rasterizar(pagina, s.svg, s.lado)
    const v = verificar(rgba, s.lado, s)
    const bytes = png(rgba, s.lado, s.alfa)
    writeFileSync(path.join(DIR, s.archivo), bytes)
    generados[s.archivo] = bytes
    console.log(`${s.archivo}: ${s.lado}x${s.lado} ${s.alfa ? 'RGBA' : 'RGB (sin alfa)'} ${JSON.stringify(v)}`)
  }

  if (muestra) {
    const uri = (a) => 'data:image/png;base64,' + generados[a].toString('base64')
    const r16 = await rasterizar(pagina, SVG, 16)
    const ico16 = 'data:image/png;base64,' + png(r16, 16, true).toString('base64')
    // Squircle (superelipse n=5, como el ícono de iOS) como polígono para clip-path.
    const pts = []
    for (let k = 0; k < 360; k++) {
      const t = (k / 360) * 2 * Math.PI
      const ct = Math.cos(t), st = Math.sin(t)
      const x = Math.sign(ct) * Math.abs(ct) ** (2 / 5), y = Math.sign(st) * Math.abs(st) ** (2 / 5)
      pts.push(`${(50 + 50 * x).toFixed(2)}% ${(50 + 50 * y).toFixed(2)}%`)
    }
    const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#e2e8f0;font:14px Inter,system-ui,sans-serif;color:#0f172a">
      <style>.f{display:flex;gap:28px;align-items:flex-end;flex-wrap:wrap;margin-bottom:28px}.c{display:grid;gap:6px;justify-items:center}
      .z{position:relative}.z::after{content:'';position:absolute;left:10%;top:10%;width:80%;height:80%;border-radius:50%;outline:2px dashed #ef4444}</style>
      <div class="f">
        <div class="c"><img src="${uri('icon-192.png')}" width="192" height="192"><div>icon-192 (any) · 192 px</div></div>
        <div class="c"><img src="${uri('icon-512.png')}" width="512" height="512"><div>icon-512 (any) · 512 px</div></div>
      </div>
      <div class="f">
        <div class="c"><div class="z"><img src="${uri('icon-maskable-512.png')}" width="512" height="512" style="display:block"></div><div>icon-maskable-512 · 512 px (rojo: zona segura del 80 %)</div></div>
        <div class="c"><img src="${uri('apple-touch-icon-180.png')}" width="180" height="180"><div>apple-touch-icon-180 · 180 px</div></div>
      </div>
      <div class="f">
        <div class="c"><img src="${uri('icon-maskable-512.png')}" width="256" height="256" style="border-radius:50%"><div>maskable en círculo</div></div>
        <div class="c"><img src="${uri('icon-maskable-512.png')}" width="256" height="256" style="clip-path:polygon(${pts.join(',')})"><div>maskable en squircle</div></div>
        <div class="c"><img src="${ico16}" width="16" height="16"><div>16 px</div></div>
        <div class="c"><img src="${ico16}" width="128" height="128" style="image-rendering:pixelated"><div>16 px ampliado ×8</div></div>
      </div></body></html>`
    await pagina.setViewportSize({ width: 1000, height: 800 })
    await pagina.setContent(html)
    await pagina.screenshot({ path: muestra, fullPage: true })
    console.log(`muestra: ${muestra}`)
  }
} finally {
  await navegador.close()
}
