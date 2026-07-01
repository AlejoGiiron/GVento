// ============================================================
// Catálogo central de permisos RBAC — ÚNICA fuente de verdad.
//
// Estos son los permisos que el sistema realmente enforcea (has_permission en
// SQL/RLS, can() en el frontend, ProtectedRoute, NAV_ITEMS). La matriz de la
// UI de Roles (ConfigPage → RoleModal) se construye SOLO desde aquí.
//
// Agregar un permiso nuevo = UNA línea en el grupo que corresponda. No hay que
// tocar la UI. (El rol owner usa el comodín '*' y hereda cualquier permiso sin
// listarlo; ver usePermissions / owner-wildcard-permission.sql.)
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
