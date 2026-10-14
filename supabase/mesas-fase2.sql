-- ============================================================================
-- supabase/mesas-fase2.sql — Paso 11, "Mesas, fase 2": cerrar las escrituras DIRECTAS que el
-- frontend del Paso 10 ya no usa (la fase 2 de D, ahora para Mesas). Solo toca permisos del rol
-- `authenticated` (usuarios CON sesión); `anon` ya no escribe nada desde anon-sin-escritura.sql.
--
-- POR QUÉ: desde el Paso 10, cobrar, quitar ítems, cerrar sin consumo y eliminar mesas van por
-- funciones del servidor (close_table_sale, quitar_item_mesa, cerrar_mesa_sin_consumo,
-- eliminar_mesa), todas SECURITY DEFINER. Pero los caminos viejos seguían abiertos: cualquier
-- usuario de la sede podía, con la API, borrar ítems de una mesa sin dejar rastro (H3), pasar una
-- orden a pagada o a fiado (DEUDAS → "Fiado en MESA"), cambiar su total o su número, y borrar mesas.
--
-- QUÉ HACE (y nada más):
--   1. order_items: authenticated sin DELETE (quitar un ítem = quitar_item_mesa).
--   2. tables:      authenticated sin DELETE (eliminar una mesa = eliminar_mesa).
--   3. orders:      authenticated sin UPDATE de tabla; UPDATE solo de las columnas que la app del
--      Paso 10 escribe directo: status (Cocina, Delivery, Mesas al enviar a cocina), courier_id y
--      estimated_delivery_minutes (Delivery). Todo lo de cobro (total, payment_status, order_number,
--      descuentos, cliente, close_id, cobrada_*, anulación) solo por las funciones del servidor.
--   Las políticas no se tocan: el permiso es la barrera. Las funciones SECURITY DEFINER no cambian
--   (corren como su dueño). INSERT de órdenes e ítems sigue igual.
--
-- 🔴 GUARDA: SOLO SE APLICA CON EL PASO 10 EN TODOS LOS EQUIPOS. Un equipo con el frontend viejo
-- cobra mesas con escrituras directas: después de esta migración, cobrar le fallaría. La migración
-- lee public.app_versiones (cada equipo reporta su versión al cargar: app-version.sql) y ABORTA si
-- algún equipo tiene una versión fuera de la lista de abajo. La versión es el hash corto (7) del
-- commit publicado; no se puede ordenar, por eso la lista es explícita.
-- Lo que la guarda NO ve: un equipo que nunca cargó una versión con el aviso (anterior al 1/10)
-- no aparece en app_versiones.
--
-- PRECONDICIONES: la lista de versiones llena; ningún equipo fuera de ella; el Paso 9 aplicado
-- (md5 de sus funciones); authenticated con UPDATE de tabla en orders y DELETE en order_items y
-- tables, y sin permisos por columna en orders (el estado del que parte la reversa).
-- RE-APLICAR: aborta sin cambiar nada (el estado ya no es el de partida).
-- REVERSA: mesas-fase2-revertir.sql (fuera de git).
--
-- NO DEDUZCAS EL ESTADO DE ESTE COMENTARIO — correlo:
--   select has_table_privilege('authenticated', 'public.orders', 'UPDATE') as sin_aplicar;
-- ============================================================================
begin;

do $$
declare
  -- ⚠️ PEGA ACÁ el hash corto (7 caracteres) de CADA release publicado desde el del Paso 10 (los
  -- de `main`; ver el plan, 11.1). Con el texto de ejemplo, la migración ABORTA a propósito.
  v_versiones text[] := array['PEGA-AQUI-LOS-HASH-DEL-PASO-10'];   -- [VERSIONES-PASO-10]
  v_n integer;
  v_lista text;
begin
  -- ── 0a. La lista, bien formada ──
  select count(*), string_agg(quote_literal(v), ', ') into v_n, v_lista
    from unnest(v_versiones) v where v !~ '^[0-9a-f]{7}$' and v <> 'dev';
  if v_n > 0 or cardinality(v_versiones) = 0 then
    raise exception 'La lista de versiones del Paso 10 no está llena o tiene valores inválidos (%): pega los hash de 7 caracteres. No se cambió nada.',
      coalesce(v_lista, 'vacía');
  end if;

  -- ── 0b. Ningún equipo con una versión fuera de la lista ──
  select count(*), string_agg(format('%s (%s, equipo %s…, visto %s)', v.version, coalesce(s.name, 'sin sede'),
                                     left(v.equipo, 8), to_char(v.ultima_vez at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI')),
                              '; ' order by v.ultima_vez desc)
    into v_n, v_lista
    from public.app_versiones v
    left join public.restaurants s on s.id = v.restaurant_id
   where v.version <> all(v_versiones);
  if v_n > 0 then
    raise exception 'Hay % equipo(s) con una versión anterior al Paso 10 (o que no está en la lista): %. Que recarguen la app y vuelve a correr el pre-flight. No se cambió nada.',
      v_n, v_lista;
  end if;
  raise notice 'mesas-fase2: % equipo(s) en app_versiones, todos con una versión de la lista', (select count(*) from public.app_versiones);

  -- ── 0c. El Paso 9 aplicado (las funciones que reemplazan los caminos que se cierran) ──
  select count(*) into v_n
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and (p.oid::regprocedure::text, md5(regexp_replace(regexp_replace(pg_get_functiondef(p.oid), E'\r','','g'), E'[ \t]+\n', E'\n','g'))) in (
           ('close_table_sale(uuid,uuid,numeric,jsonb,jsonb,jsonb)', '4380322652241d8ed7241fc724fd06d1'),
           ('quitar_item_mesa(uuid,uuid,text,boolean)',              'd6765c89592fd87bd07044f7c2a89830'),
           ('cerrar_mesa_sin_consumo(uuid)',                         'f7386154b392c7972bc555ee2e3ab453'),
           ('eliminar_mesa(uuid)',                                   '6e3eb4e986d6f3a429dc4195ca5a0d43'));
  if v_n <> 4 then
    raise exception 'Precondición: el Paso 9 (mesas-servidor.sql) no está aplicado tal cual (% de 4 funciones con su md5). No se cambió nada.', v_n;
  end if;

  -- ── 0d. El estado de partida (del que parte la reversa) ──
  if not has_table_privilege('authenticated', 'public.orders', 'UPDATE')
     or not has_table_privilege('authenticated', 'public.order_items', 'DELETE')
     or not has_table_privilege('authenticated', 'public.tables', 'DELETE')
     or exists (select 1 from pg_attribute where attrelid = 'public.orders'::regclass and attacl is not null) then
    raise exception 'Precondición: authenticated no está en el estado de partida (UPDATE en orders, DELETE en order_items y tables, sin permisos por columna). ¿Ya se aplicó? No se cambió nada.';
  end if;
end $$;

-- ── 1 y 2. Sin DELETE directo de ítems ni de mesas ──
revoke delete on public.order_items from authenticated;
revoke delete on public.tables from authenticated;

-- ── 3. orders: UPDATE solo de las columnas que la app escribe directo ──
revoke update on public.orders from authenticated;
grant  update (status, courier_id, estimated_delivery_minutes) on public.orders to authenticated;

-- ── 4. Comprobación, en esta misma transacción (fail-closed) ──
do $$
declare
  v_cols text;
begin
  if has_table_privilege('authenticated', 'public.order_items', 'DELETE')
     or has_table_privilege('authenticated', 'public.tables', 'DELETE')
     or has_table_privilege('authenticated', 'public.orders', 'UPDATE') then
    raise exception 'authenticated todavía tiene DELETE en order_items/tables o UPDATE de tabla en orders. No se cambió nada.';
  end if;
  select string_agg(attname::text, ',' order by attname) into v_cols
    from pg_attribute
   where attrelid = 'public.orders'::regclass and attnum > 0 and not attisdropped
     and has_column_privilege('authenticated', 'public.orders', attname, 'UPDATE');
  if v_cols is distinct from 'courier_id,estimated_delivery_minutes,status' then
    raise exception 'authenticated puede actualizar en orders: % (se esperaba courier_id,estimated_delivery_minutes,status). No se cambió nada.', v_cols;
  end if;
  raise notice 'mesas-fase2: listo — orders actualizable solo en %', v_cols;
end $$;

commit;
