---
description: Genera el SQL, los tipos TypeScript y los helpers de Supabase para una nueva tabla.
argument-hint: <nombre_tabla> [descripcion-breve]
---

Añade la tabla **$ARGUMENTS** al proyecto gvento generando los tres artefactos necesarios:

## 1. SQL — `supabase/schema.sql`

Agrega al final del archivo el bloque SQL de la nueva tabla con:
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- Columnas específicas de la tabla según el contexto del argumento
- `CREATE INDEX` sobre `restaurant_id` y cualquier FK adicional
- RLS habilitado: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
- Políticas RLS coherentes con las del resto del schema (los usuarios solo ven registros de su `restaurant_id`)
- Trigger `updated_at` usando la función `moddatetime` si ya existe en el schema, o definiéndola si no

## 2. Tipos TypeScript — `src/types/database.types.ts`

Añade la entrada de la tabla en `Database['public']['Tables']` con:
- `Row` — todos los campos con tipos exactos
- `Insert` — campos requeridos vs opcionales (`?`) correctamente marcados
- `Update` — todos los campos opcionales (`?`)
- `Relationships` — referencias FK con `foreignKeyName`, `columns`, `referencedRelation`, `referencedColumns`

## 3. Helpers — `src/lib/supabase-helpers.ts`

Añade las funciones CRUD básicas tipadas:
- `get{Tabla}s(restaurantId: string)` — lista todos los registros
- `upsert{Tabla}(data: TablesInsert<'nombre_tabla'> | TablesUpdate<'nombre_tabla'>)` — insert o update
- `delete{Tabla}(id: string)` — soft delete si hay `is_active`, hard delete si no

Todas las funciones devuelven `{ data, error }` de Supabase sin try/catch — el manejo de errores es responsabilidad del hook que las llama.

## Al terminar

Resume las columnas añadidas, las políticas RLS y las funciones helper creadas.
