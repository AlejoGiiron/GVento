// Color sugerido para el portal a partir del logo de la sede (pantalla 4: "se toma con el logo").
// Es solo una SUGERENCIA: el dueño lo puede cambiar, y si no hay logo o no se puede leer, el
// portal usa el verde de G-Vento.

const hex = (n: number) => Math.round(n).toString(16).padStart(2, '0')

/** Color dominante "con carácter" de una imagen: ignora transparentes, casi blancos, casi negros y grises. */
export function colorDominante(datos: Uint8ClampedArray): string | null {
  const cubetas = new Map<string, { n: number; r: number; g: number; b: number }>()
  for (let i = 0; i < datos.length; i += 4) {
    const [r, g, b, a] = [datos[i], datos[i + 1], datos[i + 2], datos[i + 3]]
    if (a < 200) continue
    const max = Math.max(r, g, b), min = Math.min(r, g, b)
    if (max > 235 && min > 235) continue          // casi blanco
    if (max < 30) continue                          // casi negro
    if (max - min < 40) continue                    // gris
    const clave = `${r >> 5}-${g >> 5}-${b >> 5}`
    const c = cubetas.get(clave) ?? { n: 0, r: 0, g: 0, b: 0 }
    c.n++; c.r += r; c.g += g; c.b += b
    cubetas.set(clave, c)
  }
  let mejor: { n: number; r: number; g: number; b: number } | null = null
  for (const c of cubetas.values()) if (!mejor || c.n > mejor.n) mejor = c
  if (!mejor) return null
  return `#${hex(mejor.r / mejor.n)}${hex(mejor.g / mejor.n)}${hex(mejor.b / mejor.n)}`
}

/** Carga el logo y devuelve su color dominante, o null si no se pudo (sin logo, CORS, etc.). */
export function colorDesdeLogo(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const lado = 64
        const canvas = document.createElement('canvas')
        canvas.width = lado; canvas.height = lado
        const ctx = canvas.getContext('2d')
        if (!ctx) return resolve(null)
        ctx.drawImage(img, 0, 0, lado, lado)
        resolve(colorDominante(ctx.getImageData(0, 0, lado, lado).data))
      } catch {
        resolve(null)   // canvas "tainted": el servidor del logo no permite leerlo
      }
    }
    img.onerror = () => resolve(null)
    img.src = url
  })
}
