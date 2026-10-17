// Los datos de quien recibe el pedido. "Recordar mis datos en este celular" los guarda SOLO en el
// navegador del cliente (localStorage del dominio del portal), nunca en G-Vento.

export interface Punto { lat: number; lng: number }

export interface DatosCliente {
  nombre: string
  celular: string
  direccion: string
  indicaciones: string
  punto: Punto | null
}

export const DATOS_VACIOS: DatosCliente = { nombre: '', celular: '', direccion: '', indicaciones: '', punto: null }

const CLAVE = 'gvento-portal-datos'

/** Celular de Colombia: 10 dígitos que empiezan por 3 (con o sin espacios, guiones o +57). */
export function celularValido(texto: string): boolean {
  let d = texto.replace(/\D/g, '')
  if (d.length === 12 && d.startsWith('57')) d = d.slice(2)
  return /^3\d{9}$/.test(d)
}

/** Lo que falta para poder pagar, en el orden en que aparece en la pantalla. [] = completo. */
export function faltantesDatos(d: DatosCliente, acepta: boolean): string[] {
  const f: string[] = []
  if (!d.punto) f.push('el punto de entrega en el mapa')
  if (d.direccion.trim().length < 5) f.push('la dirección')
  if (d.nombre.trim().length < 2) f.push('el nombre de quien recibe')
  if (!celularValido(d.celular)) f.push('un celular de 10 dígitos')
  if (!acepta) f.push('aceptar el uso de tus datos')
  return f
}

function esDatos(x: unknown): x is DatosCliente {
  if (typeof x !== 'object' || x === null) return false
  const o = x as Record<string, unknown>
  const p = o.punto as Record<string, unknown> | null
  return ['nombre', 'celular', 'direccion', 'indicaciones'].every((k) => typeof o[k] === 'string')
    && (p === null || (typeof p === 'object' && typeof p.lat === 'number' && typeof p.lng === 'number'))
}

/** Los datos recordados, o null. Nunca revienta: un almacenamiento bloqueado o dañado = sin datos. */
export function leerRecordados(): DatosCliente | null {
  try {
    const x: unknown = JSON.parse(localStorage.getItem(CLAVE) ?? 'null')
    return esDatos(x) ? x : null
  } catch { return null }
}

export function recordar(d: DatosCliente): void {
  try { localStorage.setItem(CLAVE, JSON.stringify(d)) } catch { /* sin almacenamiento: no se recuerda */ }
}

export function olvidar(): void {
  try { localStorage.removeItem(CLAVE) } catch { /* nada que borrar */ }
}
