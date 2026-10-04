// UUID v4 para claves de idempotencia (id de venta del POS, tanda de Mesas).
// crypto.randomUUID solo existe en contexto SEGURO (https o localhost): un celular
// que abre la app por la IP de la LAN no lo tiene. getRandomValues sí está en
// cualquier contexto, así que el respaldo arma el v4 a mano. Tiene que ser un UUID
// válido: el servidor lo castea a uuid y un formato inventado rompería el cobro.
export function nuevoUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
