// ── Guardas del cobro y las tandas de Mesas contra el estado REAL de la orden ──
// (hotfix/mesa-total-cero). El modal de cobro trabaja sobre la copia de la orden
// tomada al tocar "Cobrar", y el selector de productos sobre la que tenía la pantalla.
// Si otro equipo agregó una tanda o cerró la mesa mientras tanto, esa copia miente:
// - el cobro podía cerrar la mesa en $0 (o con un descuento calculado sobre lo viejo)
//   y dejar sin cobrar lo que entró después;
// - "Cerrar mesa" podía cancelar una orden que ya tenía consumo;
// - una tanda podía entrar a una orden ya cobrada o cancelada.
// Antes de escribir se relee la orden y se decide con esto. Es una guarda del
// navegador: entre releer y escribir queda una ventana de milisegundos que solo el
// servidor cierra (Paso 9: close_table_sale y la guarda de add_order_items_with_extras).

const ABIERTA = new Set(['pending', 'preparing', 'ready'])

/** La orden sigue abierta (se le puede agregar, cobrar o cerrar). */
export const estaAbierta = (status: string): boolean => ABIERTA.has(status)

/** La orden como está en la base: estado, total, descuento y la suma de sus líneas. */
export interface OrdenFresca {
  status: string
  total: number
  discount_amount: number | null
  /** Σ qty × unit_price de las líneas + Σ de sus extras. */
  lineas: number
  items: number
}

const COP = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)

export const NO_ABIERTA = 'Esta mesa ya no está abierta: la cobró o la cerró otro equipo. Actualiza la pantalla.'

/**
 * ¿Se puede cobrar con lo que muestra el modal? null = sí; si no, el motivo.
 * @param subtotalDelModal  order.total + order.discount_amount de la copia del modal
 * @param totalACobrar      lo que el modal va a cobrar (subtotal − descuento escrito)
 */
export function motivoParaNoCobrar(
  f: OrdenFresca,
  subtotalDelModal: number,
  totalACobrar: number,
  esFiado: boolean,
): string | null {
  if (!ABIERTA.has(f.status)) return NO_ABIERTA
  const subtotal = Number(f.total) + Number(f.discount_amount ?? 0)
  if (subtotal !== Number(subtotalDelModal)) {
    return `La mesa cambió desde que abriste el cobro: ahora suma ${COP(subtotal)}. Cierra el cobro y vuelve a abrirlo.`
  }
  // Cerrar sin cobro (total $0, no fiado): solo si el descuento cubre TODAS las líneas.
  const descuento = Number(subtotalDelModal) - Number(totalACobrar)
  if (!esFiado && Number(totalACobrar) === 0 && Number(f.lineas) - descuento > 0) {
    return `La mesa tiene consumo por ${COP(Number(f.lineas) - descuento)} sin cobrar: no se puede cerrar en $0. Cóbrala.`
  }
  return null
}

/** ¿Se puede "Cerrar mesa" sin consumo? null = sí. */
export function motivoParaNoCerrarVacia(f: OrdenFresca): string | null {
  if (!ABIERTA.has(f.status)) return NO_ABIERTA
  if (f.items > 0) return `La mesa ya tiene consumo (${f.items} ${f.items === 1 ? 'ítem' : 'ítems'}): no se puede cerrar sin cobro. Actualiza la pantalla y cóbrala.`
  return null
}

/** ¿Se puede agregar una tanda? null = sí. */
export function motivoParaNoAgregar(status: string): string | null {
  return ABIERTA.has(status) ? null : 'La mesa ya se cobró o se cerró: no se agregó nada. Actualiza la pantalla.'
}
