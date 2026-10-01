-- supabase/diag/borrar-mesa-simulacion.sql
-- ============================================================================
-- DIAGNÓSTICO (no es migración). Pregunta: ¿se puede borrar una mesa que YA
-- tuvo ventas?
--
-- SOSPECHA: `orders.table_id` es `references public.tables on delete set null`,
-- pero `orders` tiene `chk_dine_in_has_table` (type <> 'dine_in' or table_id is
-- not null). Borrar la mesa dispara el SET NULL sobre sus órdenes dine_in, y el
-- check lo rechaza ⇒ la mesa que vendió alguna vez NO se puede borrar nunca.
-- Si es así, también le pasa al cliente desde TablesPage (handleDelete): la UI
-- solo bloquea con órdenes pending/preparing/ready, así que deja intentar el
-- borrado de una mesa libre con ventas entregadas y la BD lo rechaza.
--
-- QUÉ ESCRIBE: NADA. Cada bloque DO termina SIEMPRE en `raise exception`, que
-- deshace todo lo que el bloque hizo. No hay camino que llegue a commit.
-- RE-EJECUTAR: inofensivo, las veces que quieras.
-- OBJETIVO: dos mesas fijadas por UUID + guard por UUID de la organización LAB
--   (f4fa692d-6cf3-43fb-a17f-18b8b163c918). Una mesa que no sea de LAB aborta
--   con GUARD antes del delete — y si el UUID no existe, también (v_org null).
--
-- CÓMO CORRERLO: en el SQL Editor, UN BLOQUE POR VEZ (seleccionar el bloque y
-- ejecutar). Si pegás el archivo entero, el primer `raise exception` corta la
-- ejecución y los bloques siguientes no corren.
-- ============================================================================


-- ── 0. LECTURA — por qué se eligió cada mesa, y qué hay en el catálogo ──────
--    (solo select; correr primero)

-- 0a. Las dos mesas: organización, estado y sus órdenes por tipo/estado.
select t.id, t.name, t.status, r.name as sede, r.organization_id,
       (r.organization_id = 'f4fa692d-6cf3-43fb-a17f-18b8b163c918') as es_lab,
       count(o.id)                                   as ordenes,
       count(o.id) filter (where o.type = 'dine_in') as ordenes_dine_in,
       string_agg(distinct o.status::text, ',')      as estados_orden
  from public.tables t
  join public.restaurants r on r.id = t.restaurant_id
  left join public.orders o on o.table_id = t.id
 where t.id in ('26a488ab-17bf-4bf6-955c-78504e70bda5',   -- CON ventas
                '28427f26-9ab2-4d55-89a8-c2e0b0b59c1f')   -- SIN ventas
 group by t.id, t.name, t.status, r.name, r.organization_id;
-- ESPERADO:
--   Mesa Mixto 263700 | free | Sede Lab Norte | es_lab=true | ordenes=1 | dine_in=1 | delivered
--   Mesa Mixto 537269 | free | Sede Lab Norte | es_lab=true | ordenes=0 | dine_in=0 | null

-- 0b. TODO lo que referencia a public.tables, desde el catálogo (no desde los
--     .sql: la BD puede diferir del repo). Buscado por la TABLA, no por el
--     nombre de constraint que uno esperaría (R2 / caso #15).
select c.conrelid::regclass as tabla_hija, c.conname,
       pg_get_constraintdef(c.oid) as definicion
  from pg_constraint c
 where c.confrelid = 'public.tables'::regclass;
-- ESPERADO: una sola fila, orders.table_id … ON DELETE SET NULL.
-- Si aparece OTRA fila, el resultado del bloque 1 puede venir de ahí: leela.

-- 0c. Los checks de orders que mencionan table_id (el que choca con el SET NULL).
select conname, pg_get_constraintdef(oid) as definicion
  from pg_constraint
 where conrelid = 'public.orders'::regclass and contype = 'c'
   and pg_get_constraintdef(oid) ilike '%table_id%';
-- ESPERADO: chk_dine_in_has_table.

-- 0d. Triggers sobre las dos tablas involucradas (el SET NULL es un UPDATE de
--     orders: sus triggers BEFORE UPDATE corren y podrían fallar antes que el check).
select tgrelid::regclass as tabla, tgname, pg_get_triggerdef(oid) as definicion
  from pg_trigger
 where tgrelid in ('public.tables'::regclass, 'public.orders'::regclass)
   and not tgisinternal;


-- ── 1. SIMULACIÓN — mesa CON ventas ─────────────────────────────────────────
do $$
declare
  v_mesa constant uuid := '26a488ab-17bf-4bf6-955c-78504e70bda5';
  v_org  uuid;
  n      int;
begin
  select r.organization_id into v_org
    from public.tables t join public.restaurants r on r.id = t.restaurant_id
   where t.id = v_mesa;
  if v_org is distinct from 'f4fa692d-6cf3-43fb-a17f-18b8b163c918'::uuid then
    raise exception 'GUARD: la mesa % no es de LAB (org=%)', v_mesa, v_org;
  end if;

  delete from public.tables where id = v_mesa;
  get diagnostics n = row_count;
  raise exception 'SIMULACION_OK filas=%', n;   -- fuerza el rollback siempre
end $$;


-- ── 2. SIMULACIÓN — mesa SIN ventas (control) ───────────────────────────────
do $$
declare
  v_mesa constant uuid := '28427f26-9ab2-4d55-89a8-c2e0b0b59c1f';
  v_org  uuid;
  n      int;
begin
  select r.organization_id into v_org
    from public.tables t join public.restaurants r on r.id = t.restaurant_id
   where t.id = v_mesa;
  if v_org is distinct from 'f4fa692d-6cf3-43fb-a17f-18b8b163c918'::uuid then
    raise exception 'GUARD: la mesa % no es de LAB (org=%)', v_mesa, v_org;
  end if;

  delete from public.tables where id = v_mesa;
  get diagnostics n = row_count;
  raise exception 'SIMULACION_OK filas=%', n;   -- fuerza el rollback siempre
end $$;


-- ── CÓMO LEER EL RESULTADO ──────────────────────────────────────────────────
--
-- Bloque 1 (CON ventas):
--   · `new row for relation "orders" violates check constraint
--      "chk_dine_in_has_table"` (SQLSTATE 23514), con CONTEXT
--      `UPDATE ONLY "public"."orders" SET "table_id" = NULL …`
--        ⇒ SOSPECHA CONFIRMADA. Una mesa que vendió no se borra nunca, ni en LAB
--          ni en un cliente. El `raise` final no llegó a ejecutarse.
--   · `violates foreign key constraint …` (SQLSTATE 23503)
--        ⇒ también se confirma que no se borra, pero por OTRA FK que el repo no
--          declara: mirar 0b, esa FK es un hallazgo en sí.
--   · Error de un trigger (ver 0d) ⇒ no se borra, pero la causa es el trigger.
--   · `SIMULACION_OK filas=1`
--        ⇒ SOSPECHA REFUTADA: el borrado SÍ funciona (y se deshizo). Hay que
--          buscar otra razón por la que las 115 mesas con órdenes sobreviven
--          (p. ej. que la limpieza de los specs nunca llegue a clickear).
--   · `GUARD: …` ⇒ el UUID no es de LAB o no existe. No se tocó nada.
--
-- Bloque 2 (SIN ventas, control):
--   · `SIMULACION_OK filas=1` ⇒ esperado: sin órdenes no hay SET NULL que
--     choque. Confirma que el mecanismo del bloque 1 es la orden y no la mesa.
--   · Cualquier error ⇒ el problema no es de las órdenes: leer el mensaje.
--
-- En los dos casos `SIMULACION_OK` significa "el DELETE se ejecutó sin error y
-- fue revertido por el raise". NO significa que la mesa se haya borrado.
