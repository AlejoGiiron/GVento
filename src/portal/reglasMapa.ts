// Reglas puras del mapa y del color del portal (las prueba reglasMapa.test.ts).

/**
 * ¿Mover el mapa fija el punto de entrega? Solo si se ven las calles. Con el mapa liso (sin
 * VITE_PORTAL_MAPA_URL) o con las teselas fallando, el cliente pondría el punto a ciegas y el
 * domiciliario iría a un lugar que nadie eligió: en ese caso el punto solo sale de "Usar mi
 * ubicación actual" (falla cerrado). La excepción es el modo desarrollo (pnpm dev, las pruebas), que
 * no tiene teselas: ahí el mapa liso sí mueve el punto, para poder probar el arrastre.
 */
export function mapaFijaPunto(o: { hayTeselas: boolean; fallaron: boolean; desarrollo: boolean }): boolean {
  if (o.fallaron) return false
  return o.hayTeselas || o.desarrollo
}

/**
 * El texto que se lee sobre el color del negocio: blanco o casi negro, el de más contraste (WCAG,
 * luminancia relativa). Un color que no es #rrggbb devuelve blanco (el color por defecto es oscuro).
 */
export function textoSobre(color: string): '#ffffff' | '#0f172a' {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color)
  if (!m) return '#ffffff'
  const lin = (h: string) => {
    const c = parseInt(h, 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const l = 0.2126 * lin(m[1]) + 0.7152 * lin(m[2]) + 0.0722 * lin(m[3])
  const contraste = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  const OSCURO = 0.0093 // luminancia de #0f172a
  return contraste(l, 1) >= contraste(l, OSCURO) ? '#ffffff' : '#0f172a'
}
