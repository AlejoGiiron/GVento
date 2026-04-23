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
Última fase completada: 04 - Módulo turno de caja (ShiftBanner + modales)
En progreso: —
Siguiente: 05 - Gestión de mesas / TablesPage

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