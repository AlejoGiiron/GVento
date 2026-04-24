# G-Vento — contexto del proyecto

## Descripción
G-Vento es un sistema POS completo para restaurantes. Monorepo que incluye:
- Panel administrativo y POS (apps/pos) → React + TypeScript + Tailwind
- Tienda pública para clientes (apps/store) → Next.js 14 + App Router
- App móvil para mozos (apps/mobile) → React Native + Expo
- Tipos y utilidades compartidas (packages/shared)

## Stack tecnológico
- Frontend web: React 18, TypeScript (strict), Tailwind CSS, Vite
- Frontend tienda: Next.js 14 App Router, TypeScript, Tailwind
- Base de datos: Supabase (PostgreSQL + Auth + Realtime + Storage)
- Estado global: Zustand
- Fetching: React Query (@tanstack/react-query)
- Validación: Zod
- Íconos: lucide-react
- Fechas: date-fns
- Monorepo: pnpm workspaces

## Convenciones de código
- Componentes: PascalCase en archivos .tsx
- Hooks: camelCase con prefijo "use", en src/hooks/
- Tipos: PascalCase, sin prefijo I ni T
- Strings UI: en español (Colombia)
- Precios: siempre en COP con Intl.NumberFormat('es-CO')
- Fechas: siempre en zona horaria America/Bogota
- IDs: UUID v4 generados por Supabase

## Patrones establecidos
- Todos los componentes son funcionales con React hooks
- No usar any en TypeScript — usar unknown si es necesario
- Errores de Supabase siempre con react-hot-toast
- Mutaciones de BD siempre en hooks custom (useXMutations)
- Las queries de Supabase van en src/hooks/, no en componentes

## Patrones aprendidos en desarrollo

### Modales con flujo de cobro y Realtime activo
Nunca usar directamente el estado reactivo de Supabase Realtime como condición
para mostrar un modal de cobro. El Realtime puede actualizar ese estado durante
el flujo y desmontar el modal antes de llegar al step de éxito.

Patrón correcto:
- Capturar el objeto necesario en un estado propio al abrir el modal (ej: checkoutOrder)
- Usar ese estado capturado como condición del modal
- El estado Realtime puede cambiar libremente sin afectar el flujo de cobro en progreso

Ejemplo: TablesPage usa `checkoutOrder` en lugar de `selectedOrder` para controlar
`TableCheckoutModal`. Si `selectedOrder` se vuelve null por Realtime durante el cobro,
el modal no se desmonta.

## Variables de entorno requeridas
VITE_GVENTO_SUPABASE_URL=
VITE_GVENTO_SUPABASE_ANON_KEY=
Ver .env.example para la lista completa.

## Git
- Rama activa de desarrollo: develop
- Nunca hacer commit directo a main
- Commits en formato Conventional Commits
- Un commit por funcionalidad o fix completo

## Design System
Valores exactos de color, tipografía, espaciado y patrones de layout en:
**`src/design-system.md`** — leer antes de construir cualquier pantalla nueva.

Resumen rápido:
- Acento: `#10b981` (emerald) / oscuro `#059669`
- Sidebar: `#0f172a` bg, `#1e293b` bordes, `#cbd5e1` texto nav
- Texto: primario `#0f172a`, secundario `#64748b`, muted `#94a3b8`
- Fuentes: Inter UI · monospace para precios/números
- Layout POS: `flex h-full overflow-hidden`, split 60/40
- Layout Login: `flex h-full`, split 40/60 (brand oscuro / form blanco)
- Botón CTA: `#10b981`, border-radius 10px, shadow `rgba(16,185,129,.35)`

## Estado actual del proyecto
[ACTUALIZAR AL INICIO DE CADA SESIÓN]
Última fase completada: 07 - Delivery / Kanban Realtime
En progreso: —
Siguiente: 08 - Reportes

### Detalle fase 07 - Delivery / Kanban Realtime (sesión 2026-04-24)
- supabase/delivery-couriers.sql: tabla `couriers` (name, phone, is_active) + ALTER TABLE orders (delivery_address, courier_id FK, estimated_delivery_minutes) + RLS
- database.types.ts: tipos completos para couriers + campos delivery en orders Row/Insert/Update/Relationships
- supabase-helpers: getCouriers, upsertCourier, deleteCourier (soft), getDeliveryOrders (activos + entregados hoy), assignOrderCourier
- useDelivery: órdenes agrupadas por columna kanban (new/accepted/preparing/in_transit/delivered), canal Realtime con nombre único Math.random(), alerta Web Audio API al llegar pedido nuevo, patrón checkoutOrder en AssignCourierModal
- useDeliveryCount: hook ligero usado en AppLayout para el badge del sidebar
- DeliveryPage: Kanban 5 columnas horizontal scroll; columna lógica = status + courier_id (pending sin courier = Nuevos, pending con courier = Aceptados); AssignCourierModal (select courier + tiempo estimado); CourierConfigModal (admin, CRUD repartidores); botones de avance de estado por columna
- AppLayout: Delivery añadido al sidebar (ícono Truck), badge amber con conteo de órdenes activas

### Fix (sesión 2026-04-24) - ShiftBanner no actualizaba al cobrar desde TablesPage
- Causa raíz: TableCheckoutModal se desmontaba antes de step='success' porque
  updateOrderStatus('delivered') disparaba Realtime → fetchAll → selectedOrder=null
- Fix: checkoutOrder (estado capturado al abrir cobro, aislado del Realtime);
  condición del modal usa checkoutOrder en vez de selectedOrder;
  handleCheckoutComplete también invalida ['shift_payments'] como respaldo

### Detalle fase 06 - Cocina / KDS (sesión 2026-04-24)
- sent_to_kitchen: columna boolean en order_items (SQL en supabase/sent-to-kitchen.sql)
- database.types.ts: sent_to_kitchen en Row/Insert/Update de order_items
- supabase-helpers: markItemsSentToKitchen(itemIds), sent_to_kitchen en getActiveOrdersForTables + getActiveOrderByTable
- useTables: sent_to_kitchen añadido a OrderItemRow
- printer.ts (src/lib/): printComanda(ComandaData) — inyecta CSS 80mm en head, crea nodo DOM, window.print(); printToThermal() alias
- TablesPage: botón "Cocina (N)" reemplaza botón Comanda; marca ítems como sent, actualiza orden a 'preparing', imprime solo ítems no enviados; badge "En cocina" + dim en ítems ya enviados; delete deshabilitado en ítems enviados
- KitchenPage: KDS completo — tarjetas por orden con ítems enviados, flujo pending→preparing→ready, Realtime con canal único Math.random()

### Detalle fase 05 - Gestión de mesas (sesión 2026-04-23)
- TablesPage: mapa visual en grid auto-fill, split layout mapa + panel lateral
- TableCard: colores por estado (gris=libre, verde=ocupada, ámbar=pide cuenta, azul=reservada)
- useTables: carga tablas + órdenes activas en paralelo, Realtime en postgres_changes (tables + orders + order_items), reconexión en CHANNEL_ERROR
- OpenTableModal: crea orden dine_in con total=0, actualiza status→'occupied'
- TableSidePanel (380px): lista ítems, eliminar ítem, total, botones Agregar/Cocina/Pide cuenta/Cobrar
- ProductPickerModal: selector de productos con búsqueda + tabs de categoría + selección con qty
- TableCheckoutModal: mismo flujo method→amount→success que POSPage, pero para orden existente
- TableConfigModal (admin): crear/editar/eliminar mesas, no permite borrar si tiene orden activa
- waiting_bill añadido a table_status enum (SQL en supabase/tables-waiting-bill.sql + database.types.ts)
- Nuevos helpers: createTable, updateTable, deleteTable, getTableActiveOrderCount, getActiveOrdersByTable, getActiveOrdersForTables

### Detalle fase 04 - Turno de caja (sesión 2026-04-23)
- useCashShift: currentShift, isOpen, salesSummary, movements, openShift, closeShift, addMovement
- OpenShiftModal: modal bloqueante (z-100), sin cierre, monto de apertura obligatorio
- ShiftBanner: píldora verde en header con hora de inicio, ventas totales, botones Movimientos y Cerrar turno
- CloseShiftModal: resumen por método de pago, cálculo efectivo esperado, monto declarado, diferencia verde/rojo
- MovementsModal: selector Ingreso/Egreso, monto + motivo, listado del turno con colores por tipo
- AppLayout: ShiftBanner en header + bloqueo total si no hay turno abierto
- cash_movements tabla: SQL migration + tipos TS + helpers Supabase (getCashMovements, createCashMovement)
- movement_type enum: 'in' | 'out' agregado a database.types.ts y Enums

### Detalle fase 03b - POSPage V2 mejoras UX (sesión 2026-04-23)
- cartStore: DiscountType ('pct'|'fixed'), campo discountType, setDiscount acepta tipo
- Atajo teclado `/` enfoca búsqueda; `Escape` limpia y desenfoca; indicador kbd visual
- Descuento dual: botones rápidos % (0/5/10/15/20) o monto fijo COP con input numérico
- Método de pago Transferencia añadido (mapea a 'transfer' en enum BD); modal 4 columnas
- PrintTicket: componente de recibo 80mm, oculto en UI, visible con @media print
- window.print() desde botón "Imprimir" en pantalla de éxito del modal
- Pantalla de éxito mejorada: n.° orden abreviado, vuelto destacado, botones Imprimir + Nueva venta
- Removido botón "Espera" no funcional; Cobrar ocupa ancho completo

### Detalle fase 02b - LoginPage V1 (commit 661e666)
- LoginPage: layout split 40/60 (panel marca + formulario), diseño handoff V1 aprobado
- Panel izquierdo slate-900 con logo, tagline, 3 features y glows radiales verdes
- Panel derecho: formulario con email, contraseña (toggle visibilidad), checkbox recordarme
- Checkbox recordarme controla persistencia: si false, limpia claves sb-* de localStorage tras login
- Banner de error inline rojo con icono X (sin toast)
- Spinner animado durante autenticación, botón deshabilitado si campos vacíos
- Redirección automática a /ventas si ya hay sesión activa (useEffect sobre useAuth)
- Sin enlace de recuperación de contraseña — el admin resetea cuentas

### Detalle fase 03 (commit dc5f144)
- POSPage: layout split 60/40 (catálogo + carrito), diseño V2 aprobado
- cartStore Zustand: add/setQty/setNote/remove/clear/setDiscount
- useProducts y useCategories con React Query sobre supabase-helpers
- CheckoutModal: flujo method → amount (efectivo) → success, graba en Supabase
- ProductCard con placeholder coloreado por categoría + soporte image_url
- Precios en COP con Intl.NumberFormat('es-CO')
- QueryClientProvider en App.tsx
- AppLayout main: overflow-hidden para layout POS full-height

### Detalle fase 02 (commit 3424412)
- AuthProvider + useAuth hook (user, profile, isLoading, signOut)
- ProtectedRoute con control de acceso por rol (admin / cashier / waiter)
- AppLayout: sidebar slate-900, header con nombre y rol del usuario
- Router completo en App.tsx con rutas públicas y protegidas
- Páginas placeholder: Ventas, Mesas, Cocina, Productos, Reportes, Config

## Estado actual del proyecto
Última fase completada: 02 - Core POS
En progreso: 03 - Gestión de mesas
Siguiente: 04 - Delivery y tienda online