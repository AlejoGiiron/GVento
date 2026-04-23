---
description: Crea un componente React siguiendo las convenciones del proyecto (TypeScript strict, Tailwind, lucide-react).
argument-hint: <NombreComponente> [descripcion-breve]
---

Crea el componente **$ARGUMENTS** en el proyecto gvento.

## Ubicación

Determina la carpeta correcta según el tipo:
- Componente de UI genérico reutilizable → `src/components/ui/`
- Componente de layout → `src/components/layout/`
- Componente específico de un módulo → `src/components/{modulo}/`

## Requisitos del componente

- Componente funcional con React hooks
- Props tipadas con una interfaz explícita (sin `any`, sin `unknown` innecesario)
- Exportación nombrada (no `export default`)
- Íconos de `lucide-react` si se necesitan
- Clases de Tailwind CSS — paleta coherente con el resto del proyecto (slate-900 sidebar, blanco área principal)
- Strings de UI en español (Colombia)
- Sin comentarios que expliquen qué hace el código — solo los que expliquen *por qué* si hay algo no obvio
- Accesibilidad: añadir `aria-label` y `role` donde corresponda (botones sin texto visible, inputs sin `<label>` visible, listas navegables, diálogos)
- Si en la carpeta destino existe un archivo `index.ts`, exportar el nuevo componente desde ese archivo

## Si el componente recibe datos de Supabase

No hagas fetching dentro del componente. Recibe los datos como props o usa un hook existente de `src/hooks/`. Si el hook no existe, créalo primero.

## Al terminar

Muestra la firma del componente y sus props principales.
