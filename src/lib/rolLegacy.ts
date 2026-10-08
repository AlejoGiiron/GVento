import type { Database } from '@/types/database.types'

// ── El rol VIEJO (profiles.role) que corresponde a un rol RBAC (profiles.role_id) ──
// 🔴 CONTRATO (R1): `profiles.role` decide quién entra a /m y quién cobra
// (get_my_role en register_pos_sale / register_sale_payment, ROLES_QUE_COBRAN en
// posMovil.ts); `profiles.role_id` decide los permisos (has_permission: fiado,
// descuento, …). Si divergen, alguien entra a /m sin fiado o tiene fiado y no entra.
// Por eso TODA escritura de role_id desde la app escribe también role con esta
// función, en la misma llamada: al crear (create-user) y al cambiar el rol en la
// lista de usuarios. Lo que NO cubre: la Edge Function no compara los dos si se la
// llama directo, y un usuario creado desde el Dashboard nace sin role_id (DEUDAS,
// dentro de A). Desaparece cuando el servidor y /m decidan por permisos (A).
//
// ALLOWLIST (R2): solo los roles de sistema tienen traducción. Un rol personalizado
// cae en 'waiter' — no entra a /m ni cobra — hasta que A decida por permisos. Antes
// caía en 'cashier' (fallaba abierto); se cambió el 2026-10-08 con 0 perfiles activos
// con rol personalizado en producción (consulta corrida por el dueño del proyecto).
export type RolLegacy = Database['public']['Enums']['user_role']

export function rolLegacyDeRol(nombre: string): RolLegacy {
  if (nombre === 'owner' || nombre === 'admin') return 'admin'
  if (nombre === 'cajero') return 'cashier'
  return 'waiter'
}
