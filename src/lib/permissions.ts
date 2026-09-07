// ============================================================
// Catálogo central de permisos RBAC — ÚNICA fuente de verdad.
//
// Estos son los permisos que el sistema realmente enforcea (has_permission en
// SQL/RLS, can() en el frontend, ProtectedRoute, NAV_ITEMS). La matriz de la
// UI de Roles (ConfigPage → RoleModal) se construye SOLO desde aquí.
//
// Agregar un permiso nuevo = UNA línea en el grupo que corresponda. No hay que
// tocar la UI. (El rol owner usa el comodín '*' y hereda cualquier permiso sin
// listarlo; ver usePermissions y has_permission() en
// supabase/profiles-is-active-enforced.sql, que es la versión vigente.)
// ============================================================

export interface PermissionDef {
  key: string
  label: string
}

export interface PermissionGroup {
  module: string
  perms: PermissionDef[]
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  { module: 'POS', perms: [
    { key: 'pos.vender', label: 'Vender' },
    { key: 'pos.descuento', label: 'Descuento' },
    { key: 'pos.anular', label: 'Anular' },
  ] },
  { module: 'Caja', perms: [
    { key: 'caja.abrir', label: 'Abrir turno' },
    { key: 'caja.cerrar', label: 'Cerrar turno' },
    { key: 'caja.movimientos', label: 'Movimientos' },
  ] },
  { module: 'Mesas', perms: [
    { key: 'mesas.gestionar', label: 'Gestionar' },
    { key: 'mesas.cobrar', label: 'Cobrar' },
  ] },
  { module: 'Cocina', perms: [
    { key: 'cocina.acceder', label: 'Acceder' },
  ] },
  { module: 'Delivery', perms: [
    { key: 'delivery.gestionar', label: 'Gestionar' },
  ] },
  { module: 'Productos', perms: [
    { key: 'productos.ver', label: 'Ver' },
    { key: 'productos.editar', label: 'Editar' },
  ] },
  { module: 'Compras', perms: [
    { key: 'compras.gestionar', label: 'Gestionar' },
  ] },
  { module: 'Fiado', perms: [
    { key: 'fiado.gestionar', label: 'Gestionar' },
  ] },
  { module: 'Ventas', perms: [
    { key: 'ventas.historial', label: 'Historial de ventas' },
    // Se enforcea desde 2026-06 (register-sale-void.sql + SalesHistoryPage) pero
    // faltaba acá, así que no se podía conceder desde la UI de Roles: solo por SQL
    // o heredado por el comodín del owner. Agregado el 2026-08-31.
    { key: 'ventas.anular', label: 'Anular venta' },
  ] },
  { module: 'Reportes', perms: [
    { key: 'reportes.financiero', label: 'Financiero' },
    { key: 'reportes.stock', label: 'Stock' },
    { key: 'reportes.consolidado', label: 'Consolidado' },
  ] },
  { module: 'Configuración', perms: [
    { key: 'config.acceder', label: 'Acceder' },
    { key: 'usuarios.gestionar', label: 'Usuarios' },
    { key: 'sedes.gestionar', label: 'Sedes' },
    { key: 'roles.gestionar', label: 'Roles' },
  ] },
]

/** Lista plana de todas las claves de permiso del sistema. */
export const ALL_PERMISSION_KEYS: string[] =
  PERMISSION_GROUPS.flatMap(g => g.perms.map(p => p.key))

/**
 * Permisos "críticos de recuperación": si un usuario se los quita de su propio
 * rol, podría perder acceso a la gestión. Se usan para el aviso de auto-bloqueo
 * (no bloquea; el owner con '*' siempre puede reparar).
 */
export const RECOVERY_PERMISSIONS = ['config.acceder', 'roles.gestionar'] as const

// ============================================================
// POLÍTICA DE LOS ROLES DE SISTEMA — la otra mitad de la fuente única.
//
// Hasta el 2026-08-31 esto NO existía acá: vivía inline en 4 archivos SQL que
// habían divergido entre sí (admin valía 16 / 20 / 18 / 23 según cuál abrieras,
// cajero 8 / 10 / 9 / 10). `mozo` era el único idéntico en los 4 — el único que
// nadie tocó nunca, que es justo la forma del defecto: lo que se agregaba se
// sembraba en el archivo que estaba abierto ese día.
//
// De acá sale `supabase/seed-system-roles.sql` vía `pnpm gen:rbac`. Los seeds
// LLAMAN a esa función; no repiten listas. Ver R1 en CLAUDE.md.
// ============================================================

/**
 * `admin` es DERIVADO, no enumerado: hereda cualquier permiso nuevo del catálogo
 * sin que nadie se acuerde de agregarlo. Ese olvido es exactamente el defecto que
 * dejó organizaciones sin `ventas.historial`.
 *
 * `owner` usa el comodín '*'. La resuelve has_permission() en
 * supabase/profiles-is-active-enforced.sql (comodín + filtro is_active).
 * `cajero` y `mozo` son listas EXPLÍCITAS a propósito: son restricciones de
 * negocio, y un permiso nuevo NO debería llegarles solo.
 */
export const SYSTEM_ROLES: Record<string, readonly string[]> = {
  owner: ['*'],
  admin: ALL_PERMISSION_KEYS,
  cajero: [
    'pos.vender', 'pos.descuento', 'pos.anular',
    'caja.abrir', 'caja.cerrar', 'caja.movimientos',
    'mesas.cobrar', 'delivery.gestionar',
    'fiado.gestionar', 'ventas.historial',
  ],
  mozo: ['pos.vender', 'mesas.gestionar', 'cocina.acceder'],
}
