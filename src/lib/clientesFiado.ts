// ── Clientes para el fiado del POS móvil (/m) ───────────────────────────────
// Búsqueda por NOMBRE (sin mayúsculas ni tildes) o por TELÉFONO (solo dígitos:
// "300 123 45" encuentra "3001234567"), y orden con los RECIENTES primero:
// recientes = los que tuvieron una venta a fiado, de la más nueva a la más vieja
// (dato de la base, igual en todos los celulares); después, el resto por nombre.

export interface ClienteFiado {
  id: string
  name: string
  phone: string | null
}

const normalizar = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

const digitos = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')

/** ¿El cliente coincide con lo escrito? Vacío = todos. */
export function coincide(c: ClienteFiado, busqueda: string): boolean {
  const q = normalizar(busqueda)
  if (!q) return true
  if (normalizar(c.name).includes(q)) return true
  const d = digitos(busqueda)
  // Desde 3 dígitos se busca en el teléfono: con menos, "1" coincidiría con casi todos.
  return d.length >= 3 && digitos(c.phone).includes(d)
}

/**
 * Filtra por la búsqueda y ordena: primero los recientes (último fiado más nuevo
 * primero), después el resto por nombre. `ultimoFiado`: id → fecha ISO.
 */
export function ordenarClientes<T extends ClienteFiado>(
  clientes: readonly T[],
  ultimoFiado: ReadonlyMap<string, string>,
  busqueda: string,
): T[] {
  return clientes
    .filter((c) => coincide(c, busqueda))
    .sort((a, b) => {
      const fa = ultimoFiado.get(a.id), fb = ultimoFiado.get(b.id)
      if (fa && fb) return fb.localeCompare(fa)
      if (fa) return -1
      if (fb) return 1
      return a.name.localeCompare(b.name, 'es')
    })
}

/**
 * Clientes que PARECEN el que se está por crear: mismo nombre (sin mayúsculas ni
 * tildes) o mismo teléfono. Se muestran para elegir el existente en vez de duplicar.
 */
export function posiblesDuplicados<T extends ClienteFiado>(clientes: readonly T[], nombre: string, telefono: string): T[] {
  const n = normalizar(nombre)
  const t = digitos(telefono)
  if (!n && t.length < 7) return []
  return clientes.filter((c) => (n && normalizar(c.name) === n) || (t.length >= 7 && digitos(c.phone) === t))
}
