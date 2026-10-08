import type { Database } from '@/types/database.types'

// ── El rol VIEJO (profiles.role) que corresponde a un rol RBAC (profiles.role_id) ──
// Desde A (permisos-cobro.sql + este frontend), QUIÉN COBRA lo decide el permiso
// (pos.vender / mesas.cobrar, en el servidor y en la pantalla). `profiles.role` queda
// para lo que todavía lo lee: la redirección automática a /m en el celular
// (ROLES_QUE_SE_REDIRIGEN en posMovil.ts, transitoria hasta M2), get_my_role en
// algunas políticas viejas, y create-user. Por eso TODA escritura de role_id desde la
// app sigue escribiendo también role con esta función, en la misma llamada: al crear
// (create-user) y al cambiar el rol en la lista de usuarios. Lo que NO cubre: la Edge
// Function no compara los dos si se la llama directo, y un usuario creado desde el
// Dashboard nace sin role_id (DEUDAS, dentro de A).
//
// ALLOWLIST (R2): solo los roles de sistema tienen traducción. Un rol personalizado
// cae en 'waiter' — no se redirige a /m —; lo que puede cobrar lo deciden sus permisos. Antes
// caía en 'cashier' (fallaba abierto); se cambió el 2026-10-08 con 0 perfiles activos
// con rol personalizado en producción (consulta corrida por el dueño del proyecto).
export type RolLegacy = Database['public']['Enums']['user_role']

export function rolLegacyDeRol(nombre: string): RolLegacy {
  if (nombre === 'owner' || nombre === 'admin') return 'admin'
  if (nombre === 'cajero') return 'cashier'
  return 'waiter'
}
