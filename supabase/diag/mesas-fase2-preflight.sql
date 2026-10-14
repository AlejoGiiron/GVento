-- supabase/diag/mesas-fase2-preflight.sql — SOLO LECTURA. Antes y después de
-- supabase/mesas-fase2.sql (Paso 11), cada consulta por separado.

-- ── Consulta 1: qué versión tiene cada equipo (la guarda de la migración) ──
select v.version, coalesce(o.name, '(sin organización)') as organizacion, coalesce(s.name, '(sin sede)') as sede,
       count(*) as equipos,
       to_char(max(v.ultima_vez) at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') as ultima_vez_bogota
  from public.app_versiones v
  left join public.restaurants s on s.id = v.restaurant_id
  left join public.organizations o on o.id = s.organization_id
 group by v.version, o.name, s.name
 order by max(v.ultima_vez) desc;
-- Lectura: TODAS las versiones tienen que ser releases con el Paso 10 o posteriores (los hash que
-- se pegan en mesas-fase2.sql). Si aparece una versión anterior, ese equipo tiene que recargar
-- la app antes de aplicar; la migración abortaría y diría cuál es.

-- ── Consulta 2: el detalle de los equipos (para ubicar al que falta recargar) ──
select v.version, coalesce(s.name, '(sin sede)') as sede, left(v.equipo, 8) as equipo,
       left(v.user_agent, 60) as navegador,
       to_char(v.ultima_vez at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') as ultima_vez_bogota
  from public.app_versiones v
  left join public.restaurants s on s.id = v.restaurant_id
 order by v.ultima_vez desc;

-- ── Consulta 3: el Paso 9 aplicado (las funciones que reemplazan lo que se cierra) ──
select p.oid::regprocedure as funcion,
       md5(regexp_replace(regexp_replace(pg_get_functiondef(p.oid), E'\r','','g'), E'[ \t]+\n', E'\n','g')) as md5
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.proname in ('close_table_sale', 'quitar_item_mesa', 'cerrar_mesa_sin_consumo', 'eliminar_mesa')
 order by 1;
-- Esperado: close_table_sale 4380322652241d8ed7241fc724fd06d1, quitar_item_mesa
-- d6765c89592fd87bd07044f7c2a89830, cerrar_mesa_sin_consumo f7386154b392c7972bc555ee2e3ab453,
-- eliminar_mesa 6e3eb4e986d6f3a429dc4195ca5a0d43 (los del Paso 9).

-- ── Consulta 4: qué puede escribir directo un usuario con sesión ──
select has_table_privilege('authenticated', 'public.orders', 'UPDATE')      as orders_update_tabla,
       (select coalesce(string_agg(attname::text, ',' order by attname), '(ninguna)')
          from pg_attribute where attrelid = 'public.orders'::regclass and attnum > 0 and not attisdropped
           and attacl is not null and has_column_privilege('authenticated', 'public.orders', attname, 'UPDATE')) as orders_update_por_columna,
       has_table_privilege('authenticated', 'public.order_items', 'DELETE') as order_items_delete,
       has_table_privilege('authenticated', 'public.tables', 'DELETE')      as tables_delete,
       has_table_privilege('authenticated', 'public.order_items', 'UPDATE') as order_items_update_tabla,
       (select coalesce(string_agg(attname::text, ',' order by attname), '(ninguna)')
          from pg_attribute where attrelid = 'public.order_items'::regclass and attnum > 0 and not attisdropped
           and attacl is not null and has_column_privilege('authenticated', 'public.order_items', attname, 'UPDATE')) as order_items_update_por_columna,
       has_table_privilege('authenticated', 'public.orders', 'DELETE')      as orders_delete;
-- ANTES:   t · (ninguna) · t · t · t · (ninguna) · t
-- DESPUÉS: f · courier_id,estimated_delivery_minutes,status · f · f · f · sent_to_kitchen · f
