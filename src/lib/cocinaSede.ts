// Qué sede mira la pantalla de Cocina. El KDS guarda la sede en el navegador
// (localStorage.kds_restaurant_id) y antes la usaba sin preguntar: si ese navegador
// había abierto Cocina con otra organización (LAB, por ejemplo), RLS devolvía cero
// órdenes y el tablero salía vacío, sin ningún error (Café Aroma, 2026-10-13).

export const AVISO_SEDE_CAMBIADA =
  'Esta pantalla tenía guardada una sede que no es de tu organización (o no se pudo leer). ' +
  'Ahora muestra la sede de tu perfil.'

export type Perfil = { restaurant_id: string | null; organization_id: string | null }

/**
 * - Sin sesión (tableta con PIN): no hay con qué comparar → la guardada, como antes.
 * - Con sesión: la guardada solo si es de la MISMA organización del perfil (una cocina
 *   puede mirar otra sede de su propia organización). Si no lo es, o no se pudo leer
 *   (null = RLS no la deja ver, 'error' = falló la lectura), la del perfil, avisando.
 */
export function decidirSedeCocina(p: {
  guardada: string | null
  perfil: Perfil | null
  /** organization_id de la sede guardada, null si no se pudo ver, 'error' si falló. */
  orgDeLaGuardada: string | null | 'error'
}): { sede: string | null; aviso: string | null } {
  const { guardada, perfil } = p
  if (!perfil?.restaurant_id) return { sede: guardada, aviso: null }
  if (!guardada || guardada === perfil.restaurant_id) return { sede: perfil.restaurant_id, aviso: null }
  if (p.orgDeLaGuardada !== 'error' && p.orgDeLaGuardada !== null
      && p.orgDeLaGuardada === perfil.organization_id) {
    return { sede: guardada, aviso: null }
  }
  return { sede: perfil.restaurant_id, aviso: AVISO_SEDE_CAMBIADA }
}
