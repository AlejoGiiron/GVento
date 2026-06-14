---
description: Genera el scaffold completo de un módulo: página, hook de datos y registro en el router.
argument-hint: <nombre-modulo>
---

Crea un módulo nuevo llamado **$ARGUMENTS** en el proyecto gvento siguiendo estas convenciones:

## 1. Página — `src/pages/{Nombre}Page.tsx`

Componente funcional en PascalCase. Incluye un encabezado con el nombre del módulo en español y un área de contenido vacía lista para implementar. Sin comentarios genéricos.

- **Estado de carga:** mientras `isLoading` sea `true`, mostrar un skeleton con la forma aproximada del contenido (no un spinner genérico centrado)
- **Estado vacío:** cuando `data` exista pero esté vacío (`length === 0`), mostrar un mensaje útil en español que oriente al usuario sobre qué hacer

## 2. Hooks de datos — `src/hooks/use{Nombre}.ts` y `src/hooks/use{Nombre}Mutaciones.ts`

Hook de lectura con React Query (`useQuery`) que:
- Llama al helper correspondiente de `src/lib/supabase-helpers.ts` (créalo si no existe)
- Devuelve `{ data, isLoading, error }`
- Tipado estrictamente con los tipos de `src/types/database.types.ts`
- Sin `any`

Hook de mutaciones con React Query (`useMutation`) en un archivo separado `use{Nombre}Mutaciones.ts` que exponga:
- `crear(data: TablesInsert<'nombre_tabla'>)` — llama al helper de upsert, invalida la query de lista en `onSuccess`
- `actualizar(data: TablesUpdate<'nombre_tabla'> & { id: string })` — ídem
- `eliminar(id: string)` — llama al helper de delete, invalida la query de lista en `onSuccess`
- Cada mutación muestra `toast.error()` en `onError` y `toast.success()` en `onSuccess`

## 3. Router — `src/App.tsx`

Añade la ruta `/nombre-en-kebab-case` dentro del bloque `<ProtectedRoute>` → `<AppLayout>` existente. Si el módulo es solo para admin, anídalo dentro del bloque `<ProtectedRoute roles={['admin']}>`.

## 4. Sidebar — `src/components/layout/AppLayout.tsx`

Agrega la entrada a `NAV_ITEMS` con el ícono de lucide-react más apropiado y el label en español. Si es admin-only, añade `roles: ['admin']`.

## 5. Tests E2E — `tests/{modulo}.spec.ts` (paso final, obligatorio)

7. Crea `tests/[modulo].spec.ts` con Playwright cubriendo los flujos principales del módulo (happy path + validaciones + limpieza de datos de prueba).

- Reutiliza los helpers existentes (`tests/helpers/auth.ts`, `tests/helpers/shift.ts`).
- Selectores robustos con `data-testid` donde el texto sea ambiguo.
- Tests deterministas e idempotentes; `describe.serial` si hay dependencia de datos.
- Ver la sección "Política de testing (obligatoria)" del `CLAUDE.md`.

## Convenciones obligatorias
- TypeScript strict — sin `any`, usar `unknown` si es necesario
- Strings de UI en español (Colombia)
- Errores de Supabase con `toast.error()` de react-hot-toast
- Queries de Supabase solo en hooks, nunca en componentes directamente
