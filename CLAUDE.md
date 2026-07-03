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

- **Regenerar `database.types.ts` con `supabase gen types`** cuando se resuelva el acceso
  de management del CLI. Hoy la entrada de `register_sale_payment` (Functions) está agregada
  **a mano** pero VERIFICADA idéntica a lo que genera el CLI (mismo shape que
  `register_purchase`/`register_debt_payment`, posición alfabética correcta, `Views<>`
  preservado, tsc 0). El `supabase gen types --linked` falla con 403: la cuenta del CLI no
  tiene privilegios de management sobre el proyecto (es permiso de cuenta, no la password).
  Al resolverlo, correr `supabase gen types typescript --linked --schema public > src/types/database.types.ts`
  y confirmar diff nulo.
- **Rotar la password de BD del proyecto (LAB):** quedó expuesta; pendiente de rotación en
  Supabase (Dashboard → Database → reset password) y actualizar donde se use.
- **RPC de cierre de turno con recompute server-side del esperado (endurecimiento):** hoy el
  cierre es un UPDATE cliente que confía en el esperado calculado en el navegador desde
  `salesSummary` (paridad con F1) y lo congela en `close_reconciliation`. Endurecimiento
  futuro: mover el cierre a una RPC SECURITY DEFINER que **recompute el esperado por método
  desde `payments` en la ventana `[opened_at, closed_at]`** (server-authoritative), evitando
  confiar en el cliente. Requiere acotar la ventana con cota superior (hoy `getShiftPayments`
  no la tiene; ver el bug de ventana temporal que motivó el snapshot). Junto a la deuda de
  pasar los gates de enum a `has_permission`.
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
- **Devolver stock al borrar ítem de mesa (inventario):** al borrar un `order_item` ya
  agregado (TODO en `TablesPage.tsx:1036`), NO se devuelve el stock que descontó al
  agregarse → el inventario queda subestimado. Pendiente (pasada aparte): función SQL de
  reverso `return_stock_for_order_item(p_id)` SECURITY DEFINER que emita
  `stock_movements('return', +qty)` por producto (simple), insumos (composite vía
  product_components) y los insumos de extras vinculados ANTES de borrar la línea,
  reflejando la lógica de deducción. Caso borde: receta cambiada entre venta y borrado.
  Solo aplica a ítems no enviados a cocina (los únicos borrables hoy).
- **Disponibilidad derivada de productos compuestos en POS — OMITIDA por ahora:** el
  indicador de stock del POS solo aplica a productos `simple` con tracking. Los compuestos
  no muestran disponibilidad (exigiría cargar recetas en el POS y calcular el mínimo por
  insumo). Pendiente si se requiere.
- **BUG DE RAÍZ pendiente (observado, no exclusivo de G-Vento):** la caja debe ser POR SEDE
  y hay que **validar que no exista un turno abierto antes de abrir otro** (evitar dos
  turnos simultáneos). Revisar el flujo de apertura de caja con esta regla.
### Testing — laboratorio (LAB) MONTADO
- **✅ Laboratorio listo.** Existe la organización **LAB** (Supabase separado de
  producción) con **2 sedes**, los usuarios **owner.test** (rol owner) y
  **cajero.test** (rol cajero) con sus profiles, y productos de prueba. La suite
  E2E corre contra LAB de forma determinista. **NUNCA correr E2E contra producción**
  (org G-10): los health checks lo impiden.
- **Credenciales en `.env.test`** (gitignored): `E2E_OWNER_EMAIL/PASSWORD` y
  `E2E_CASHIER_EMAIL/PASSWORD`. El backend (`VITE_GVENTO_*`) apunta al Supabase del
  lab. Ver `.env.test.example`.
- **Doble health check en `tests/global-setup.ts`** (defensa en profundidad):
  (1) la app servida en el puerto dedicado **5180** es G-Vento (no otra app);
  (2) **las credenciales pertenecen a la org LAB** — hace login real, consulta
  `organizations` (RLS solo deja ver la propia) y ABORTA la suite si no es LAB.
  Esto evita correr tests (que mutan estado) contra datos reales.
- **`retries: 0` por defecto** (lab determinista; un fallo es un fallo limpio que se
  investiga). Override puntual con `E2E_RETRIES=N`.
- **Suites pendientes de correr en el lab:** `tests/extras.spec.ts`,
  `tests/extras-pos.spec.ts` (incl. sobreventa con stock negativo),
  `tests/ventas-historial.spec.ts`, `tests/inventario.spec.ts`. Compilan
  (`playwright test --list` lista 71). `rbac.spec.ts` ya se corre verde contra el lab.
- **Los flujos de caja y mesas mutan estado** — los specs limpian tras de sí, pero
  pueden acumular residuos entre corridas (p. ej. mesas ocupadas). `closeShiftIfOpen`
  cierra la caja del lab. Ver tests/README.md.

## Política de testing (obligatoria)
- Todo módulo o funcionalidad nueva **DEBE** incluir su spec E2E en `tests/` antes de
  considerarse completo.
- El prompt de cada feature nuevo termina con: "crea/actualiza el spec de Playwright que
  cubra esta funcionalidad".
- Antes de cada merge a `develop`: `pnpm test:e2e` debe pasar al 100%.
- Selectores robustos con `data-testid` donde el texto sea ambiguo.
- Tests deterministas e idempotentes (aprendizaje: verificar con datos limpios).
- Los tests corren en serie (`workers: 1`) por compartir backend.

## Estado actual del proyecto
[ACTUALIZAR AL INICIO DE CADA SESIÓN]
Última fase completada: Arqueo multi-método al cerrar turno
  (rama feature/arqueo-cierre, sesión 2026-07-03) — migración shift-reconciliation.sql
  APLICADA en LAB; CloseShiftModal con conciliación por método (F1 efectivo intacto +
  card/transfer/nequi), snapshot congelado en close_reconciliation (jsonb) + close_comment,
  comprobante printCashReport (auto-print al cerrar) reusando printThermal de P4.1,
  reimpresión desde P3 (idéntica byte-a-byte al cierre). tests/arqueo.spec.ts 4/4 + caja.spec
  6/6 verde en lab. tsc 0 + build verde.
  (Antes en esta sesión: impresión unificada thermalPrintCss/printThermal MERGEADO a develop;
  pago mixto register_sale_payment + PaymentSplitEditor MERGEADO a develop, 7/7 verde.)
Siguiente: mergear feature/arqueo-cierre a develop. Pendiente aplicar register-sale-payment.sql
  y shift-reconciliation.sql en G-10 (prod) cuando toque desplegar; regenerar database.types.ts
  cuando se resuelva el acceso de management del CLI (deuda).

### Detalle Arqueo multi-método (F, sesión 2026-07-03, rama feature/arqueo-cierre)
- **Migración `supabase/shift-reconciliation.sql`** (APLICADA en LAB): `cash_shifts` +2 columnas
  nullable aditivas — `close_reconciliation jsonb` (snapshot del arqueo por método) +
  `close_comment text`. No rompe cierres viejos (null → reimpresión deshabilitada).
- **Por qué SNAPSHOT y no recomputar:** `payments` no tiene `shift_id` y `getShiftPayments`
  filtra solo por `created_at >= opened_at` (sin cota superior). Recomputar el esperado de un
  turno CERRADO sumaría pagos de turnos posteriores → hay que CONGELAR el esperado por método
  al cerrar. Al cierre la ventana solo-`opened_at` sí es correcta (único turno abierto).
- **Esperado por método:** efectivo = apertura + ventas efvo + ingresos − egresos (fórmula F1,
  `calcShiftBalance`); card/transfer/nequi = solo ventas de ese método (`salesSummary[m]`, sin
  apertura ni movimientos — los `cash_movements` son solo efectivo).
- **`ShiftReconciliation`/`MethodReconciliation`** en `src/lib/shiftCalc.ts`: `{ methods:
  {cash,card,transfer,nequi}:{expected,declared,difference}, expected_total, declared_total,
  difference_total, sales_count }`. Diferencia = declared − expected en los 4 (uniforme).
- **`sales_count`** = órdenes DISTINTAS con pago en la ventana (`getShiftSalesCount` →
  `new Set(order_id).size`) — una venta mixta = 1 venta aunque tenga N filas payments.
- **CloseShiftModal:** bloque F1 de efectivo INTACTO (caja.spec byte-estable; solo se añadió el
  testid `shift-cash-difference` para desambiguar del total del arqueo) + sección "Otros
  métodos" (esperado | declarado input opcional blanco=0 | dif con color, testids
  `pay-declared-{m}`/`pay-diff-{m}`) + comentario (`close-shift-comment`) + total del arqueo
  (`shift-arqueo-total`). Diferencia informativa NO bloqueante (`canClose` = efectivo declarado,
  como F1). El efectivo del snapshot = `calcShiftBalance` (misma fuente que F1, no diverge).
- **Cierre atómico:** `useCashShift.closeShiftMutation` computa `sales_count` al cerrar (no lo
  recibe del cliente — blindado por `Omit<ShiftReconciliation,'sales_count'>`) y persiste TODO
  en un solo UPDATE (`closeShift` helper, ahora con joins abrió/cerró). `close_comment` = null
  si vacío (`.trim() || null`). Retorna la fila cerrada (snapshot + closed_at server).
- **Comprobante `printCashReport`** (printer.ts) = `buildCashReportHtml` + `printThermal` (P4.1):
  sede, turno (rango), abrió/cerró, apertura, ventas por método (efvo derivado =
  esperado−apertura−ing+egr), ingresos/egresos, arqueo esp/dec/dif por método, totales,
  comentario, nº ventas. **Auto-print al confirmar el cierre**.
- **`buildCashReportData(row, ctx)`** (printer.ts, compartido): arma `CashReportData` desde una
  fila de turno. Lo usan IDÉNTICO el cierre (fila recién persistida) y la reimpresión P3 (misma
  fila) → reimpreso byte-a-byte idéntico (verificado 5157=5157). Usa el snapshot, NUNCA recomputa.
- **P3 ShiftHistoryPage:** `getClosedShifts`/`ClosedShiftRow` + `close_reconciliation`/
  `close_comment`; botón "Reimprimir arqueo" (`shift-reprint`) por fila → `buildCashReportData` +
  `printCashReport`; movimientos re-leídos por `shift_id` (`getShiftMovementTotals`, persisten).
  Deshabilitado con tooltip "Sin arqueo por método" si `close_reconciliation` null (turnos
  viejos). Gating `can('caja.cerrar')` (la ruta P3 ya lo exige).
- **tests/arqueo.spec.ts** (4, lab): cierre → snapshot correcto (efvo con apertura+mov, otros
  solo ventas; el assert caza la mixta mal cargada) + sales_count 3 + comentario; no bloquea con
  diferencia; reimpresión P3 lee el snapshot (stub window.print, verifica sin recomputar);
  limpieza. `caja.spec` 6/6 (F1 intacto, `shift-cash-difference` desambiguado). tsc 0 + build verde.
- database.types.ts: `cash_shifts.close_reconciliation`/`close_comment` agregadas A MANO
  (regeneración pendiente por permisos de CLI — ver deuda).

### Detalle Pago mixto (F, sesión 2026-07-03, rama feature/pago-mixto)
- **RPC `supabase/register-sale-payment.sql`** (APLICADA en LAB, pendiente en G-10):
  `register_sale_payment(p_order_id uuid, p_payments jsonb) → jsonb` SECURITY DEFINER.
  Valida sede + gate `get_my_role() in ('admin','cashier')` (calca el RLS de INSERT de
  payments; deuda: pasar a has_permission al eliminar el enum). Solo CONTADO: rechaza
  `payment_status <> 'paid'` (el fiado se salda con register_debt_payment). Rechaza pagos
  previos (doble cobro). Deriva el total de la BD y valida `Σ amounts = total` (raise si no
  cuadra). Inserta N filas payments (una por método) atómico. NO crea cash_movement (el
  efectivo se deriva de payments en el cuadre). revoke public/anon + grant authenticated.
- **`PaymentSplitEditor`** (components/pos, compartido POS+Mesa): N líneas método+monto,
  "restante" en vivo, máx 1 línea/método (4 del enum), reporta `(parts, valid)` al padre
  (valid = restante 0 exacto y todo monto>0 → gobierna Cobrar, bloquea falta Y excedido).
  Vuelto anclado a la línea de efectivo (recibido opcional, solo UI; la fila se registra por
  el monto imputado). Semilla `[efectivo: total]` editable (no fuerza efectivo).
- **POS (CheckoutModal) y Mesa (TableCheckoutModal):** botón "Dividir pago" (pay-split-toggle)
  bajo demanda; el caso común de 1 método queda intacto. `handleConfirm` unificado: simple →
  `[{method, amount:total}]`, dividir → splitParts; ambos por `registerSalePayment`. isFiado =
  `!split && method==='fiado'` (en dividir no hay fiado, 3 capas: UI + lógica + RPC). El
  efectivo entra a caja / el nequi no, derivado de payments (sin lógica nueva de caja).
- **Historial (SalesHistoryPage):** `methodDisplay` agrega TODOS los métodos ("Efectivo +
  Nequi"); detalle con desglose método+monto cuando hay >1 pago (sale-detail-payments).
  Simple se ve igual que hoy. Filtro por método: con filtro activo la fila muestra solo el
  método filtrado (acordado, por el `payments!inner` de PostgREST).
- Helper `registerSalePayment(orderId, parts)` + tipo `SalePaymentPart`. Testids de soporte:
  `checkout-total` (ambos modales), `shift-sales-{method}` (CloseShiftModal).
- **tests/pago-mixto.spec.ts** (7 tests, lab): POS mixta (2 filas payments + efectivo a caja/
  nequi no, vía Supabase directo + cuadre), historial, validación bloqueante (falta+excedido),
  simple 1 fila, mesa mixta sin doble descuento de stock, fiado no se cruza, limpieza. 7/7 verde.
- database.types.ts: `register_sale_payment` agregado A MANO (regeneración pendiente por
  permisos de CLI — ver deuda). tsc 0 + build verde.

### Detalle Compras / Proveedores (F5, sesión 2026-06-24, rama feature/compras-proveedores)

**Parte 1 — BD** (`supabase/compras-proveedores.sql`, APLICADA + verificada):
- Tablas `suppliers`, `purchase_invoices`, `purchase_invoice_items` (RLS por sede /
  has_permission('compras.gestionar'); items heredan RLS vía la factura padre).
- `products.cost_price numeric nullable` (último costo conocido). `stock_movements.type`
  ahora acepta `'purchase'` (4 tipos). Permiso `compras.gestionar`: admin explícito,
  owner vía comodín "*" (la siembra del punto 6 quedó solo `where name='admin'`).
- RPC `register_purchase(p_invoice jsonb, p_items jsonb) → jsonb` SECURITY DEFINER:
  crea factura + ítems, sube stock (solo stock_tracking) + `stock_movement('purchase',+qty)`,
  actualiza `cost_price`, y si es efectivo CON turno abierto inserta `cash_movement('out')`.
  Deriva total/subtotales/restaurant_id (no confía en el JSON). Retorna
  `{invoice_id, total, cash_movement_created, shift_open}`.

**Parte 2 — UI** (esta sesión, PENDIENTE de revisión):
- Helpers (supabase-helpers): getSuppliers/upsertSupplier/deleteSupplier(soft),
  registerPurchase, getPurchaseInvoices(paginado), getPurchaseInvoiceDetail.
- Hooks: `useSuppliers` (CRUD), `usePurchases` (`usePurchaseInvoices`,
  `usePurchaseInvoiceDetail`, `useRegisterPurchase`). El registro invalida
  ['products'] + ['stock_movements'] + ['purchase_invoices'] + ['cash_movements'] +
  ['shift_payments'] (inventario + caja se refrescan solos).
- Toast inequívoco cuando efectivo + sin turno: "Compra registrada y stock actualizado.
  El pago en efectivo no se registró en caja (sin turno abierto)." (no parece fallo).
- `PurchasesPage` (/compras, sidebar+ruta con permiso compras.gestionar) con 2 pestañas
  Compras (historial paginado + detalle) y Proveedores (CRUD). Modales:
  `NewInvoiceModal` (proveedor + método + líneas producto/cantidad/costo con subtotal y
  total en vivo; prefill de costo con cost_price), `SupplierFormModal`, `PurchaseDetailModal`.
  Helper compartido `paymentMethods.ts`.
- InventoryPage: 'purchase' mapeado como "Compra" (badge + filtro + referencia a factura).
- tests/compras.spec.ts (6 tests, lab): crear proveedor, compra que sube stock + movimiento
  'purchase', compra efectivo con turno → egreso, compra efectivo sin turno → advertencia,
  gating del cajero, limpieza. Suite total: 79 (compila vía --list). PENDIENTE de correr.
- tsc 0 + build verde.

### RBAC — permiso comodín "*" (sesión 2026-06-24)
- El rol **owner** usa `permissions = ["*"]` en vez de enumerar los permisos; hereda
  automáticamente cualquier permiso nuevo sin sembrarlo por organización.
- `has_permission(perm)` → true si el rol tiene `perm` O tiene `"*"`. SOLO el owner
  (name=owner, is_system) usa el comodín; admin/cajero/mozo y roles custom siguen con
  permisos explícitos (la UI nunca asigna el comodín a un rol custom).
- Frontend: `usePermissions.can` contempla `"*"`; `isOwner = permissions.includes("*")`.
  ConfigPage Roles muestra "Todos los permisos" + badge "Acceso total" para el owner.
- `enumFromRoleName` (ConfigPage) sigue usando el string 'owner' para mapear al enum
  legacy de la Edge Function create-user — NO es gating, no se tocó.

### Detalle Inventario por recetas (sesión 2026-06-20, rama feature/inventario-recetas)

**Parte 1 — BD** (migraciones APLICADAS):
- `supabase/inventory-recipes.sql`: `products.kind` text ('simple'|'composite', default
  simple); tabla `stock_movements` (auditoría append-only, qty CON SIGNO, type
  sale/adjustment/return, reference_id FK lógico a order_id, RLS solo SELECT por sede —
  escritura solo vía funciones DEFINER); tabla `product_components` (receta BOM 1 nivel,
  parent CASCADE / component RESTRICT, qty>0, unique(parent,component)); función
  `adjust_stock(product_id, qty, reason)` SECURITY DEFINER (valida sede + permiso
  productos.editar + kind=simple; UPDATE stock + INSERT movimiento ATÓMICO).
- `supabase/order-items-stock-recipes.sql`: extiende `add_order_items_with_extras`
  (create or replace, NO edita order-extras-rpc.sql) para descontar stock del producto al
  vender, en la MISMA transacción que los extras: simple+tracking → −qty propio; composite
  → explota product_components y descuenta qty_receta×qty por insumo (solo insumos con
  stock_tracking); el compuesto NO descuenta de su propio stock. Cada salida → un
  stock_movement('sale', −qty, reference_id=order_id). ENFOQUE INTEGRADO aprobado: NO hay
  deduct_stock_for_order suelto; el movimiento de stock va atado a insertar la línea (una
  vez por ítem en POS y Mesas). Stock NEGATIVO permitido (señal de reponer).
- `supabase/inventory-min-stock.sql`: `products.min_stock` integer not null default 0
  (umbral de alerta de stock bajo; solo aplica a simple+tracking).

**Parte 2 — UI** (esta sesión):
- ProductModal: selector Tipo (`product-kind-simple`/`-composite`); inventario solo para
  simple; **Stock actual SOLO-LECTURA al editar** (`stock-current`) — al crear arranca en 0
  y se carga por ajuste; **Stock mínimo** editable (`product-min-stock`). Al editar se
  PRESERVA stock_qty (no se reescribe para no pisar descuentos concurrentes); solo se toca
  al crear (0/null) o al apagar tracking (null).
- `RecipeEditor` (components/products): arma la receta con productos simple+tracking
  (≠ él mismo, no compuestos), qty entero >0; advertencia no bloqueante si vacío. Se
  reconcilia (add/update/remove) tras guardar vía `useProductComponents` (patrón reconcile
  con parentId explícito, soporta productos recién creados).
- `InventoryPage` (/inventario, sidebar+ruta con permiso productos.editar — REUSADO, no se
  creó inventario.ver): pestaña Niveles (4 KPIs: total/sin stock/bajo/negativo; tabla con
  badge out/low/ok/negative, búsqueda + filtro por estado; botón Ajustar por fila) y
  pestaña Movimientos (paginada 25, filtro tipo+rango fechas, fecha zona Bogotá, qty con
  signo verde/rojo, referencia = order_id truncado o notas).
- `StockAdjustModal` (components/inventory): selector producto + signo (+/−) + cantidad con
  PREVIEW del stock resultante (rojo si negativo) + motivo obligatorio → RPC adjust_stock.
- POS: indicador `pos-stock-indicator` ("Sin stock"/"Reponer") en card de simple+tracking
  con stock ≤0; NO bloquea la venta (stock negativo permitido).
- Hooks: `useProductComponents`, `useStockMovements` (keepPreviousData), `useInventory`
  (adjust). Helpers: getProductComponents/add/update/remove, adjustStock, getStockMovements.
- Tests: extras-pos.spec.ts REESCRITO (readStock/setStock/createProduct ahora pasan por el
  flujo real de Inventario — el stock dejó de editarse en la ficha). tests/inventario.spec.ts
  (6 tests: receta, ajuste +/−, venta de compuesto descuenta insumo + movimiento, sobreventa
  negativa con alerta, limpieza). Suite total 71 (compila vía `--list`).
- tsc 0 + build verde; database.types.ts regenerado tras aplicar inventory-min-stock.sql.

### Detalle Ventas numeradas + Historial (sesión 2026-06-19, rama feature/ventas-numeradas)
- Migración `supabase/order-numbering.sql` (NUEVA, sin aplicar): columna
  `orders.order_number int NULL` (solo ventas cobradas la reciben); tabla
  `store_sequences` (contador por sede, 1 fila/sede sembrada en 0); función
  `next_order_number(p_restaurant_id)` SECURITY DEFINER (valida sede activa,
  incremento atómico INSERT ... ON CONFLICT ... RETURNING, revoke public/anon +
  grant authenticated); NUMERACIÓN INDEPENDIENTE POR SEDE (cada una arranca en 1);
  índice (restaurant_id, order_number desc); RLS en store_sequences solo SELECT de la
  propia sede (escritura solo vía DEFINER). Permiso RBAC nuevo `ventas.historial`
  sembrado en owner/admin/cajero (el cajero reimprime tickets del día; mozo NO).
- Asignación del número AL COBRO EXITOSO (no antes): tras `createPayment` se llama
  `assignOrderNumber(orderId, restaurantId)` (helper = next_order_number RPC + update).
  Si falla, NO tumba el cobro (la venta queda registrada). Evita huecos por pagos
  fallidos. Aplica en POS (CheckoutModal) y Mesas (TableCheckoutModal).
- Visualización: PrintTicket (POS) y pantalla de éxito ("¡Venta #N registrada!",
  data-testid `success-order-number`); `printSaleTicket` en printer.ts (recibo de venta
  reutilizable para la reimpresión del historial, con "Venta #N"); tarjeta de Delivery
  muestra "Venta #N" si ya tiene número.
- Página `SalesHistoryPage` (ruta /historial, sidebar con permiso ventas.historial):
  lista paginada (25/pág, server-side `.range`) por número desc; filtros rango de
  fechas + método de pago (inner join cuando hay método) + búsqueda por número exacto;
  click en fila → modal detalle con ítems, extras, subtotal/descuento derivado, quién
  atendió, método; botón Reimprimir ticket. Hooks `useSalesHistory` (paginación/filtros,
  keepPreviousData) y `useSaleDetail`. Helpers `getSalesHistory`/`getSaleDetail`/
  `nextOrderNumber`/`setOrderNumber`/`assignOrderNumber` en supabase-helpers.
- Nota descuento (DEUDA): orders no persiste el descuento; el detalle lo DERIVA como
  max(0, suma_líneas − total). Es estimación, no dato de caja. MEJORA FUTURA: persistir
  el discount real (monto y tipo pct/fixed) en orders al cobrar, y mostrarlo exacto en
  el historial en vez de derivarlo.
- tests/ventas-historial.spec.ts (6 tests): secuencia #N→#N+1, listado desc, búsqueda
  por número, detalle con ítems+extras+reimpresión, setup/limpieza. Suite total: 65
  (compila vía `--list`); PENDIENTE de correr en laboratorio.
- tsc 0 + build verde; database.types.ts regenerado tras aplicar la migración.

### Detalle Grupo B - Extras / subproductos reutilizables (sesión 2026-06-19)

**Parte 1 — catálogo + asignación** (rama feature/extras-productos, merge a develop):
- Migración `supabase/product-extras.sql`: tablas `extras` (catálogo por sede;
  `linked_product_id` FK ON DELETE SET NULL = el insumo cuyo stock descuenta el extra),
  `product_extras` (N:N producto↔extra, ON DELETE CASCADE), `order_item_extras`
  (extras por línea, `extra_id` ON DELETE RESTRICT = no borrar extra en uso, `unit_price`
  snapshot). RLS por `restaurant_id`/`has_permission('productos.editar')`; pertenencia de
  las hijas vía fila padre.
- Catálogo en ConfigPage (sección "Extras", precedente couriers): `useExtras` (CRUD),
  `ExtraFormModal` con toggle "descuenta inventario" + selector de producto vinculado.
  Borrado lógico (soft-deactivate); `handleDeactivate` chequea `countOrderItemsUsingExtra`
  y avisa con `window.confirm` que se desactiva (no se elimina) — nunca FK error.
- Asignación en ProductModal (sección "Extras disponibles"): `useProductExtras(productId)`
  con `reconcile` que recibe el productId explícito (sirve para productos recién creados).
- tests/extras.spec.ts (6 tests). Suite Parte 1: 51/51 verde (corrida histórica antes de
  limpiar producción).

**Parte 2 — venta en POS/Mesas + stock negativo** (rama feature/extras-pos):
- RPC `supabase/order-extras-rpc.sql` `add_order_items_with_extras(p_order_id, p_items jsonb)`
  SECURITY DEFINER: inserta order_items + order_item_extras y descuenta stock vinculado en
  UNA transacción. DEFINER porque el descuento hace `UPDATE products` (RLS solo-admin) y un
  cajero debe poder vender. SEGURIDAD: no confía en el JSON — del JSON usa solo `extra_id` y
  `qty`; lee `price`/`linked_product_id` de la BD; valida extra activo+sede, producto de la
  sede y que el extra esté asignado al producto (`product_extras`). `revoke execute` a
  public/anon, `grant` a authenticated.
- Migración `supabase/products-allow-negative-stock.sql`: quita el check `stock_qty >= 0`
  (resuelve el constraint dinámicamente por definición). El stock de insumos puede ser
  NEGATIVO = señal visible de sobreventa (estimación, no verdad de caja; un bar vende aunque
  diga 0). La RPC descuenta sin `greatest(0,…)`.
- Semántica de qty: el cliente envía qty del extra POR UNIDAD; la RPC guarda en
  `order_item_extras.qty` el total de línea (qty_extra × qty_ítem) y descuenta esa cantidad.
- cartStore: `CartExtra`, `CartItem.id+extras`, `addItem`/`updateItemExtras`, helper
  `cartItemTotal`. `ItemConfigModal` (src/components/pos) reutilizable por POS y Mesas:
  qty por extra + subtotal en vivo. `useProductsWithExtras` (set de productos con extras)
  decide si abrir el modal o agregar directo (sin fricción si no hay extras).
- Extras reflejados en: carrito (editable), PrintTicket, comanda (printer.ts) y KDS
  (KitchenPage). ProductCard/ProductModal: alerta roja "Sobreventa: reponer N"
  (data-testid `oversold-alert`, `stock-badge`) cuando el stock es negativo.
- tests/extras-pos.spec.ts (8 tests, incl. sobreventa). Total suite: 59 (compila vía
  `--list`); PENDIENTE de correr en laboratorio.

### Detalle Grupo E - Identidad + reportes Financiero/Stock (sesión 2026-06-19, rama feature/identidad-reportes)
- Branding por SEDE (restaurants), no por org: nombre/logo/dirección ya se capturan en
  Config y los tickets necesitan la dirección de la sede (con 1 sede = la org)
  - Sidebar (AppLayout): logo + nombre de la sede, fallback "G-Vento" (data-testid
    sidebar-brand-name); POSPage PrintTicket: nombre + dirección reales; printer.ts
    comanda + TablesPage: nombre de la sede; LoginPage queda genérico (pre-auth, RLS)
- ReportsPage en dos tabs Financiero/Stock con selector de fechas COMPARTIDO:
  - Financiero: KPIs ventas/órdenes/ticket, barras día·canal, línea horaria, pie métodos,
    comparación vs período anterior, export financiero
  - Stock: KPIs unidades/productos/categorías, top productos, ranking de categorías,
    export stock; nota de stock-prep (inventario por unidad pendiente)
  - data-testid: report-tab-financiero/stock, export-financiero/stock
- Blindaje de colisión de puertos E2E (G-Mura ocupa 5173): puerto DEDICADO 5180 +
  --strictPort + reuseExistingServer:false (Playwright siempre levanta su propio gvento);
  tests/global-setup.ts con health check del marcador "G-Vento"; README documentado
- Suite E2E ampliada a 45 tests (reportes 5); resultado 45/45 verde, aislado de G-Mura

### Detalle Testing E2E (sesión 2026-06-14, ramas feature/e2e-tests + feature/e2e-coverage)

### Detalle Testing E2E (sesión 2026-06-14, ramas feature/e2e-tests + feature/e2e-coverage)
- Suite Playwright de 44 tests en 10 specs cubriendo los 10 módulos: auth, rbac, pos,
  venta-espera, delivery, productos, caja, mesas, config, reportes
- Helpers: auth (loginAsOwner/Cashier), shift (closeShiftIfOpen/openShiftIfClosed)
- data-testid en la app donde el texto es ambiguo: product-card, cart-total,
  close-shift-declared, open-shift-amount, movement-amount, checkout-received,
  config-restaurant-name; títulos en botones de config de mesas
- Determinismo: sufijo Date.now, limpieza por test, page.on('dialog') para window.confirm,
  describe.serial donde hay dependencia de datos; retries:2 por backend compartido
- Resultado: 43 passed + 1 flaky (pos-vuelto pasa en retry) = 44/44, exit 0
- Ver "Política de testing (obligatoria)" y "Deuda de testing" arriba

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