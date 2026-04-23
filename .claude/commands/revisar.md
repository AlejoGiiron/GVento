---
description: Revisa los cambios de la rama actual contra main — convenciones, tipos, seguridad y calidad.
---

Revisa los cambios del branch actual en el proyecto gvento con `git diff main...HEAD`. Evalúa cada archivo modificado o creado según los criterios siguientes y produce un reporte estructurado.

## Criterios de revisión

### TypeScript
- Ejecuta `npx tsc --noEmit` y reporta cualquier error
- Detecta usos de `any` — proponer el tipo correcto en cada caso
- Verifica que las props de componentes estén tipadas con interfaces explícitas

### Convenciones del proyecto
- Strings de UI deben estar en español (Colombia) — ningún texto en inglés visible al usuario
- Precios monetarios deben usar `Intl.NumberFormat('es-CO')` con COP
- Fechas deben usar zona horaria `America/Bogota`
- Componentes en PascalCase, hooks con prefijo `use`, archivos en camelCase o PascalCase según corresponda
- Queries de Supabase solo dentro de `src/hooks/` — nunca directamente en componentes o páginas
- Mutaciones de BD en hooks `useXMutations` — no inline en handlers de eventos

### Manejo de errores
- Errores de Supabase deben mostrarse con `toast.error()` de react-hot-toast
- No swallow de errores (`catch` vacío o `console.error` sin toast)

### Seguridad
- Sin secretos o credenciales hardcodeadas
- Sin `dangerouslySetInnerHTML` sin sanitización
- Sin `eval()` o ejecución dinámica de código

### Calidad general
- Sin código muerto (variables declaradas y no usadas, imports sin usar)
- Sin `console.log` de depuración
- Sin comentarios que describan qué hace el código (solo los que expliquen el porqué)
- Sin `TODO` sin issue asociado
- Verificar que cada componente que consume datos tenga estado de carga (skeleton o spinner) y estado vacío con mensaje útil al usuario

## Formato del reporte

Para cada problema encontrado indica:
- **Archivo y línea** (como link clickeable)
- **Severidad**: error / advertencia / sugerencia
- **Descripción** del problema
- **Corrección propuesta**

Al final incluye un resumen: N errores, M advertencias, K sugerencias. Si no hay problemas, confirmarlo explícitamente.
