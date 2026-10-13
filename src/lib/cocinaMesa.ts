// Por qué el botón "Cocina" de una mesa no tiene nada que enviar. Antes quedaba gris y
// mudo, y en producción se tomó por una falla del KDS (2026-10-13). En una sede SIN
// cocina la pantalla no muestra el motivo (ni el botón); SEDE_SIN_COCINA solo se usa
// como defensa si igual se intenta enviar.
//
// Qué va a cocina (supabase/cocina-por-sede.sql): sede.uses_kitchen AND
// producto.routes_to_kitchen AND la línea todavía no se envió.

export const SEDE_SIN_COCINA = 'La sede no usa cocina; recarga si lo acabas de cambiar'
export const NADA_VA_A_COCINA = 'No hay productos que vayan a cocina'
export const TODO_ENVIADO = 'Lo que va a cocina ya se envió'
export const MESA_VACIA = 'Agrega productos para enviar a cocina'

/** null = hay algo que enviar; si no, el motivo que se le muestra al usuario. */
export function motivoSinCocina(p: {
  sedeUsaCocina: boolean
  lineas: number
  sinEnviar: number
  paraCocina: number
}): string | null {
  if (!p.sedeUsaCocina) return SEDE_SIN_COCINA
  if (p.paraCocina > 0) return null
  if (p.lineas === 0) return MESA_VACIA
  // Algo ya se envió y lo que queda no va a cocina (o no queda nada).
  if (p.sinEnviar < p.lineas) return TODO_ENVIADO
  return NADA_VA_A_COCINA
}
