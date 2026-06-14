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

## Aprendizajes de proyectos hermanos (G-Quota)

Reglas duras traídas de G-Quota — aplican a todo el trabajo en este repo:

- **NO ASUMIR, CONFIRMAR CONTRA LA BD:** ante un número raro o un comportamiento
  inesperado, mirar el dato real (un `select` directo, `information_schema`), no
  teorizar. La hipótesis se valida contra la base, no contra la intuición.
- **TIPOS GENERADOS, NO A MANO:** regenerar `database.types.ts` con
  `supabase gen types typescript` después de cada migración. Los 129 errores de
  tipos de la Fase 0 vinieron justamente de tipos escritos a mano y
  desincronizados con la BD (vistas sin `Relationships`).
- **MIGRACIONES NUEVAS, NUNCA EDITAR LAS APLICADAS:** todo cambio de esquema va
  en un archivo nuevo dentro de `supabase/`. Jamás modificar una migración que ya
  se aplicó.
- **`tsc` NO PRUEBA EL SQL:** triggers, RLS y vistas solo se verifican ejecutando
  con datos reales contra la BD. El compilador de TypeScript no sabe nada del SQL.
- **VERIFICAR CADA CASO CON DATOS LIMPIOS:** no encadenar pruebas sobre la misma
  orden/mesa; cada escenario se prueba desde un estado limpio para no arrastrar
  efectos de la prueba anterior.
- **`git status` ANTES DE COMMITEAR:** revisar siempre qué se va a incluir; evitar
  `git add -A` a ciegas.
- **SECURITY DEFINER → `revoke execute from public`:** Postgres concede `EXECUTE`
  a `PUBLIC` por defecto en toda función nueva. En funciones `SECURITY DEFINER`
  hay que revocar ese permiso explícitamente y concederlo solo a los roles que lo
  necesiten (`authenticated`, `service_role`, etc.).

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

## Pendientes de verificar / deuda conocida

- **SELECT de `profiles` es por sede activa** (RLS `restaurant_id = get_my_restaurant_id()`):
  las listas org-wide (asignar usuarios a sedes, conteo de usuarios por rol) solo ven
  usuarios de la sede activa. Con 1 sede coincide con toda la org; al haber multi-sede
  real hay que ampliar ese SELECT a nivel organización.
- **Edge Function `create-user` valida enum `role === 'admin'`**: cambiar a
  `has_permission(...)` cuando se elimine el enum `profiles.role`.
- **Política vieja `"restaurants: admin actualiza"` (por enum `get_my_role()`)**: debe
  quitarse al eliminar el enum `role` (queda redundante con `"restaurants: editar sede
  con permiso"`).
- **Verificación en navegador pendiente:**
  - Gating RBAC con cuenta `cajero` (Andrés) vs `owner` — sidebar, rutas y botones
    (descuento, anular, cerrar turno, configurar mesas, delivery, secciones Sedes/Roles).
    Con `owner` se ve todo.
  - Delivery v2: kanban de 3 columnas, scroll independiente por columna, indicador de
    urgencia (≥30 min), botones de llamar/mapa.
  - Venta en espera: pausar/retomar múltiples ventas, diálogo de 3 opciones al retomar
    con carrito activo, descartar con confirmación.
- **`pos.anular` aplicado a "Vaciar carrito"** en el POS (no hay botón "anular venta"
  dedicado). Revisar si el target es el correcto al construir la anulación de ventas.
- **Tests E2E corren contra el mismo Supabase que la app** — pendiente crear proyecto
  de testing separado para aislarlos de producción (`closeShiftIfOpen` cierra la caja
  real; los specs pueden crear datos). Ver tests/README.md.

## Estado actual del proyecto
[ACTUALIZAR AL INICIO DE CADA SESIÓN]
Última fase completada: Grupo D — venta en espera (sesión 2026-06-12)
En progreso: —
Siguiente: Grupo E — identidad + reportes consolidados

### Detalle Grupo D - Venta en espera (sesión 2026-06-12, rama feature/venta-en-espera)
- cartStore: `heldOrders` en memoria (efímeras, SIN persistencia en Supabase ni
  localStorage); `holdCurrentOrder(label)`, `resumeHeldOrder(id)`, `discardHeldOrder(id)`;
  tipo `HeldOrder` (id, items, discount, discountType, customer, label, createdAt)
- POS: botón "En espera" en el footer junto a Cobrar (mini-modal de referencia/label);
  indicador "En espera (N)" en la cabecera del carrito; panel con label, ítems, total y
  antigüedad, con Retomar/Descartar
- Retomar con carrito activo no vacío → modal propio `ResumeConflictDialog` de 3 opciones
  (guardar la actual / descartar la actual / cancelar); descartar usa window.confirm
  (convención del repo)
- `customer` queda null hasta que el POS capture cliente
- tsc 0 + build verde; integrado a develop (Grupo D)

### Detalle Grupo C - Delivery v2 (sesión 2026-06-12, rama feature/delivery-v2)
- Kanban simplificado a 3 columnas (Nuevos/En camino/Entregados) mapeando el enum real
  sin tocar la BD: pending/preparing→Nuevos, ready→En camino, delivered→Entregados;
  avance de 3 pasos (ready, delivered)
- Scroll independiente por columna (altura fija, header fijo, sin scroll horizontal de página)
- Tarjeta mejorada: cliente destacado, dirección con ícono, hora absoluta + transcurrido,
  indicador de urgencia (≥30 min, borde/badge ámbar), botones tel: (llamar) y mapas
- Asignar/reasignar repartidor + tiempo estimado intactos; patrón checkoutOrder conservado
- Fix de cleanup Realtime: unsubscribe antes de removeChannel en useDelivery y useDeliveryCount
- Integrado con ARQ vía rebase: DeliveryPage usa can('delivery.gestionar')

### Detalle Fase ARQ - Multi-tenant + RBAC (sesión 2026-06-12, rama feature/multi-tenant-rbac)
- Migración multi-tenant-rbac.sql: organizations, roles (permissions jsonb), user_stores;
  organization_id en restaurants/profiles, role_id en profiles; funciones SECURITY DEFINER
  get_my_organization_id() y has_permission(); seed org G-10 + 4 roles de sistema
- Capa de permisos frontend: usePermissions() con can()/isOwner/permissions[]; ProtectedRoute
  por permiso; sidebar filtrado; checks role==='admin' reemplazados por can(); StoreSelector
- Migración profiles-active-store-rls: cambio de sede activa validado contra user_stores
- Migración restaurants-sedes-rls: SELECT por org + CRUD de sedes con has_permission('sedes.gestionar')
- ConfigPage: sección Sedes (useStores: CRUD + asignación de usuarios via user_stores) y
  sección Roles (useRoles: CRUD de roles custom, matriz de permisos por módulo, sistema protegido);
  select de rol en Usuarios lista roles de la org y asigna role_id al crear
- profiles.role (enum) se mantiene hasta migración posterior (ver deuda conocida)

### Detalle Grupo A - Quick wins (sesión 2026-06-12, rama fix/quick-wins)
- Fix 1 — Apertura de caja NO bloqueante: AppLayout dejó de bloquear; banner amber
  descartable "No hay turno abierto" + botón Abrir turno; ShiftBanner muestra píldora
  gris "Sin turno"; OpenShiftModal ahora cerrable (props onClose/onOpened); Cobrar en
  POS y Mesas exige turno abierto (abre el modal de apertura si falta)
- Fix 2 — Descuento %: cartStore.setDiscount clampa (pct 0–100, fijo ≥0, enteros, sin
  NaN); POS pasa a input % editable + presets; input $ con borde constante (sin saltos)
- Fix 3 — Responsable de mesa (texto libre): migración supabase/orders-waiter-name.sql
  agrega orders.waiter_name text; OpenTableModal lo capta; visible en TableCard,
  comanda (printer) y KDS
- Fix 4 — Cerrar mesa sin consumo: botón "Cerrar mesa" en panel lateral cuando la orden
  no tiene ítems; cancela la orden (status cancelled) y libera la mesa, con confirmación
- Regeneración de tipos: database.types.ts regenerado con `supabase gen types` (formato
  moderno, PostgrestVersion 14.5, Relationships reales, alias Views<> conservado). Reveló
  que las vistas de reportes devuelven columnas number|null; se endureció ReportsPage y
  useDailySummary (coalescer a 0, omitir filas con clave de agrupación nula)
- Pendiente de aplicar por el usuario en Supabase: supabase/orders-waiter-name.sql (ya
  aplicada — confirmada vía gen types que incluye waiter_name)

### Detalle Fase 0 - Desbloqueo de tipos y build (sesión 2026-06-12)
- Causa raíz de 129 errores `never`: el schema hand-written de `database.types.ts` no
  cumplía `GenericSchema` de postgrest-js 2.104 — las 4 vistas de reportes (fase 08a) se
  agregaron sin `Relationships`, lo que tumbaba el tipado del cliente Supabase entero
- Fix: `__InternalSupabase.PostgrestVersion: '12'` + `Relationships: []` en las 4 vistas
- useRestaurantConfig: `config` casteado a `Json` (no `Record<string, unknown>`)
- ConfigPage: íconos de secciones tipados como `LucideIcon` (acepta `style`); removido
  import `RestaurantConfig` sin usar. DeliveryPage: removido import `Plus` sin usar
- Resultado: `tsc --noEmit` 0 errores y `pnpm build` de producción pasa
- KitchenPage:758 no requirió null guard — al tiparse `restaurant_id` como string, `rid`
  se estrecha solo
- CLAUDE.md: nueva sección "Aprendizajes de proyectos hermanos (G-Quota)"; eliminado bloque
  "Estado actual" duplicado (decía fase 02)
- `supabase/security-definer-revoke.sql`: auditoría (verificación + revoke) de las 3
  funciones SECURITY DEFINER — pendiente de ejecutar/verificar por el usuario en Supabase
- Rama: `fix/types-postgrest-aprendizajes` (commit c0b6d1d)

### Detalle fase 09 - Panel de configuración (sesión 2026-04-25)
- ConfigPage.tsx: layout dos columnas (nav 220px + contenido scrollable), 6 secciones
- Sección Restaurante: nombre, dirección, teléfono, slug (en config.slug), upload logo a bucket restaurant-logos
- Sección Usuarios: tabla con rol select inline + toggle is_active; InviteModal con email/nombre/rol; llama a Edge Function invite-user via supabase.functions.invoke
- Sección Caja: EditableList para motivos de egreso (config.cash_out_reasons); toggle buttons métodos de pago (config.payment_methods); upload QR Nequi a restaurant-logos (config.nequi_qr_url)
- Sección Cocina: PIN 4 dígitos (config.kitchen_pin); EditableList estaciones (config.kitchen_stations); inputs timers semáforo verde/ámbar (config.kds_timers)
- Sección Delivery: CourierFormModal reutiliza upsertCourier/deleteCourier; usa getAllCouriers (incluye inactivos); tiempo estimado default (config.default_delivery_time)
- Sección Notificaciones: toggles delivery_sound y kitchen_sound (config.notifications)
- useRestaurantConfig: carga restaurant + config tipado; updateRestaurant y updateConfig (merge parcial); staleTime 30s
- useUsers: carga profiles del restaurante; updateUser (rol, is_active); inviteUser via Edge Function
- Nuevos helpers: getRestaurantProfiles, updateProfile, inviteUser, uploadRestaurantLogo, uploadNequiQR, getAllCouriers
- Migración: supabase/config-profile-active.sql agrega is_active boolean NOT NULL DEFAULT true a profiles
- Rutas: /configuracion y /config (alias) bajo ProtectedRoute roles=['admin']; sidebar apunta a /configuracion

### Detalle fase 08b - ReportsPage UI (sesión 2026-04-25)
- ReportsPage.tsx: barra de controles fija + contenido scrollable (patrón flex h-full)
- KPI cards con comparación % vs período anterior (período igual longitud, inmediatamente anterior)
- BarChart apilado (recharts): ventas diarias por canal — dine_in/takeaway/delivery
- LineChart: ventas por hora del día (0-23) agregadas en el período
- PieChart con leyenda manual: distribución por método de pago (efectivo/tarjeta/transferencia/nequi)
- Top 10 productos: tabla con unidades, revenue COP y % del revenue total
- Atajos: Hoy / Esta semana / Este mes / Mes anterior con date-fns
- Inputs manuales from/to + shortcut activo resaltado en emerald
- Exportación Excel lazy-loaded (ExcelJS): 3 hojas, montos como números puros
- Skeleton durante carga; estado vacío si totalOrd === 0
- Deps nuevas: recharts 3.8.1 + exceljs 4.4.0

### Detalle fase 08a - Reportes capa de datos (sesión 2026-04-25)
- 4 vistas PostgreSQL con `security_invoker = true` en `supabase/reports-views.sql`
  - `daily_sales_summary`: ventas por día × canal × método de pago; avg_ticket; order_count
  - `product_performance`: unidades y revenue por producto/categoría por día
  - `hourly_sales`: órdenes y revenue por hora del día (zona Bogotá)
  - `waiter_performance`: ventas, órdenes y ticket promedio por mozo por día
- RLS heredado de tablas subyacentes vía `security_invoker`; sin políticas extra en vistas
- `Views<T>` alias + tipos completos de las 4 vistas en `database.types.ts`
- `useReports({ from, to })` — carga las 4 vistas filtradas por rango de fechas; staleTime 5 min
- `useDailySummary(date)` — resumen del día con agregación por canal y método de pago

### Detalle fase 05b - KDS Cocina standalone (sesión 2026-04-25)
- KitchenPage.tsx reescrito como pantalla independiente (sin AppLayout, sin Supabase Auth)
- /cocina movida fuera de ProtectedRoute en App.tsx
- Login por PIN de 4 dígitos leído de `restaurants.config.kitchen_pin`; sin PIN → acceso directo
- Setup inicial: restaurant_id en localStorage; autenticación en sessionStorage
- Cards dark (slate-900/800) con franja semáforo: verde <10min / ámbar 10-20min / rojo >20min
- Elapsed time actualizado cada 30 s; clock en header zona horaria Bogotá
- Filtros por estado: Todos / Nuevos / Preparando / Listos
- Alerta sonora Web Audio API (triple beep) al llegar orden nueva en Realtime
- Canal Realtime con nombre único Math.random() (patrón del proyecto)
- Patrón checkoutOrder en handleAdvance: captura id/status antes del avance, aislado de Realtime
- Screen Wake Lock API para mantener la tablet encendida en cocina
- PWA: public/manifest.json (landscape, start_url /cocina) + public/sw.js (network-first) + meta tags en index.html

### Fix (sesión 2026-04-24) - ShiftBanner total ventas no actualizaba tras cobros en Ventas y Mesas
- Causa raíz: `queryClient.invalidateQueries` desde componentes externos (CheckoutModal, TableCheckoutModal) no disparaba refetch confiable del useQuery en useCashShift, por diferencias en el ciclo React Query v5
- Fix: useCashShift expone `refetchSales` (refetch directo del useQuery de pagos); CheckoutModal y TableCheckoutModal llaman `refetchSales()` directamente tras createPayment, eliminando la dependencia de invalidateQueries externo
- Adicional: refetchInterval reducido de 30 s a 5 s como fallback; getShiftPayments eliminó filtro .lte (innecesario y fuente de race condition por clock skew)

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