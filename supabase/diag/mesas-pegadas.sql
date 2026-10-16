-- supabase/diag/mesas-pegadas.sql — las consultas 0 a 4 son SOLO LECTURA. Los pasos 2, 3 y 4
-- escriben y están COMENTADOS: correr el archivo entero no toca nada.
-- ============================================================================
-- MESAS PEGADAS: la mesa sale "Ocupada" o "Pide cuenta" pero NO tiene una orden viva
-- (pending / preparing / ready). En pantalla: la tarjeta sin total ni tiempo, y al tocarla el
-- panel dice "Cargando orden..." para siempre, con "Cobrar" deshabilitado y sin "Cerrar mesa".
-- Desde la app no hay forma de liberarla (Configurar tampoco la deja borrar si no está libre).
--
-- ⚠️ NO confundir con las cuentas abiertas largas de G-10 y Salchimelo (CLAUDE.md, flujo
-- INTENCIONAL): esas SÍ tienen orden viva con total, y esta consulta las deja fuera por
-- construcción (exige que NO exista orden viva).
--
-- Corre cada consulta POR SEPARADO: el SQL Editor muestra solo el último resultado.
-- Horas en America/Bogota (R7).
-- ============================================================================

-- ── Consulta 0: ¿tables.updated_at lo mantiene un trigger? ──
-- La consulta 1 usa tables.updated_at como "hora del último cambio de estado". En el repo lo
-- mantiene trg_tables_updated_at (schema.sql); acá se confirma contra la base, por la TABLA.
select tgname, pg_get_triggerdef(oid) as definicion
  from pg_trigger
 where tgrelid = 'public.tables'::regclass and not tgisinternal;
-- Esperado: una fila con "before update on public.tables". Sin ella, la columna causa_probable
-- de la consulta 1 no sirve (las horas no dicen nada) y hay que mirar solo los pagos.

-- ── Consulta 1: mesas pegadas, con su última orden y la causa probable ──
select coalesce(org.name, '(sin organización)')                    as organizacion,
       s.name                                                      as sede,
       t.name                                                      as mesa,
       t.id                                                        as mesa_id,
       t.status::text                                              as estado_mesa,
       (t.updated_at at time zone 'America/Bogota')::timestamp(0) as mesa_cambio_bogota,
       u.order_number                                              as ultima_venta,
       u.status::text                                              as estado_orden,
       u.payment_status::text                                      as estado_pago,
       u.total,
       (select count(*) from public.order_items i where i.order_id = u.id) as items,
       (select count(*) from public.payments p where p.order_id = u.id)    as pagos,
       (u.updated_at at time zone 'America/Bogota')::timestamp(0) as orden_cambio_bogota,
       case
         when u.id is null                then 'sin ninguna orden de mesa'
         when t.updated_at > u.updated_at then 'otro equipo cambió la mesa DESPUÉS de cerrarla (p. ej. "Pide cuenta" con la pantalla vieja)'
         when u.status = 'delivered'      then 'cobro a medias: la venta se cerró y la mesa no se liberó'
         when u.status = 'cancelled'      then '"Cerrar mesa" a medias: la orden se canceló y la mesa no se liberó'
         else                                  'revisar a mano'
       end                                                         as causa_probable
  from public.tables t
  join public.restaurants s        on s.id = t.restaurant_id
  left join public.organizations org on org.id = s.organization_id
  left join lateral (
         select o.* from public.orders o
          where o.table_id = t.id
          order by o.created_at desc
          limit 1
       ) u on true
 where t.status in ('occupied', 'waiting_bill')        -- los estados que EXIGEN orden; 'reserved' no
   and not exists (select 1 from public.orders o
                    where o.table_id = t.id and o.status in ('pending', 'preparing', 'ready'))
 order by organizacion, sede, mesa;
-- Lectura:
--   · "cobro a medias" con pagos = 0 y total > 0: además de la mesa, esa venta puede no tener
--     su plata registrada (la clase H2 de DEUDAS). NO se arregla liberando la mesa: pégame la fila.
--   · estado_orden = 'cancelled' por una ANULACIÓN (venta ya cobrada y anulada desde Historial)
--     también cae en "a medias"; la mesa se libera igual.
--   · Cualquier otra fila rara: "revisar a mano", antes del paso 2.

-- ── Consulta 2 (la forma inversa, misma clase): mesa LIBRE con orden viva ──
-- Hasta el 2026-10-13, "Abrir mesa" creaba la orden y DESPUÉS ocupaba la mesa; desde el hotfix,
-- ocupaba y después creaba, y si la respuesta de la orden se perdía DESOCUPABA la mesa con la
-- orden viva. Las dos dejaban esta forma. Desde mesas-una-cuenta.sql es una sola transacción
-- (abrir_mesa), que además recupera una cuenta así en vez de crear otra.
select coalesce(org.name, '(sin organización)') as organizacion, s.name as sede, t.name as mesa,
       o.id as orden_id, o.status::text as estado_orden, o.total,
       (o.created_at at time zone 'America/Bogota')::timestamp(0) as abierta_bogota,
       (select count(*) from public.order_items i where i.order_id = o.id) as items
  from public.tables t
  join public.restaurants s on s.id = t.restaurant_id
  left join public.organizations org on org.id = s.organization_id
  join public.orders o on o.table_id = t.id and o.status in ('pending', 'preparing', 'ready')
 where t.status = 'free'
 order by organizacion, sede, mesa, o.created_at;
-- Esperado: ninguna fila. Si sale alguna, NO se toca en el paso 2: se mira aparte.

-- ── Consulta 3: mesas con MÁS DE UNA cuenta viva (esté la mesa libre u ocupada) ──
-- La consulta 2 no las ve si la mesa quedó ocupada. Es la precondición de mesas-una-cuenta.sql:
-- con alguna fila, el índice de una cuenta viva por mesa no se puede crear.
select coalesce(org.name, '(sin organización)') as organizacion, s.name as sede, t.name as mesa,
       t.id as mesa_id, t.status::text as estado_mesa, count(*) as cuentas_vivas,
       array_agg(o.id order by o.created_at) as ordenes,
       array_agg(o.total order by o.created_at) as totales
  from public.orders o
  join public.tables t on t.id = o.table_id
  join public.restaurants s on s.id = t.restaurant_id
  left join public.organizations org on org.id = s.organization_id
 where o.status in ('pending', 'preparing', 'ready')
 group by org.name, s.name, t.name, t.id, t.status
having count(*) > 1
 order by organizacion, sede, mesa;
-- Esperado: ninguna fila. Las vacías (total 0, sin ítems) se cancelan con el paso 3; una con
-- consumo se mira aparte, antes de tocar nada.

-- ── Consulta 4: mesas con el MISMO nombre en una sede (sin contar mayúsculas ni espacios) ──
-- En Salchimelo había dos "mesa 10" (2026-10-15). Las archivadas no cuentan: no salen en Mesas.
select coalesce(org.name, '(sin organización)') as organizacion, s.name as sede,
       t.id as mesa_id, '"' || t.name || '"' as nombre_exacto, t.zone, t.status::text as estado,
       (t.created_at at time zone 'America/Bogota')::timestamp(0) as creada_bogota,
       (select count(*) from public.orders o where o.table_id = t.id) as ordenes_totales,
       (select count(*) from public.orders o where o.table_id = t.id
                                             and o.status in ('pending', 'preparing', 'ready')) as cuentas_vivas
  from public.tables t
  join public.restaurants s on s.id = t.restaurant_id
  left join public.organizations org on org.id = s.organization_id
 where t.archived_at is null
   and exists (select 1 from public.tables t2
                where t2.restaurant_id = t.restaurant_id and t2.id <> t.id and t2.archived_at is null
                  and lower(btrim(t2.name)) = lower(btrim(t.name)))
 order by organizacion, sede, lower(btrim(t.name)), t.created_at;
-- Esperado: ninguna fila. Para renombrar una, el paso 4 (por mesa_id, nunca por nombre).

/* ── PASO 2 — LIBERAR (ESCRIBE). Solo después de leer la consulta 1. ──────────────────────
   Qué hace: pone en 'free' las mesas cuyos mesa_id pegues abajo. Nada más: no toca órdenes,
   pagos ni stock.
   Fail-closed: si alguna mesa de la lista ya no está pegada (alguien la abrió, ya tiene orden
   viva, ya está libre, el id está repetido o no existe), aborta y no toca NINGUNA.
   Re-aplicar: inofensivo; la segunda vez aborta porque las mesas ya están libres.

begin;
do $$
declare
  v_ids uuid[] := array[
    '00000000-0000-0000-0000-000000000000'   -- ← reemplaza por los mesa_id de la consulta 1
  ]::uuid[];
  v_pegadas   int;
  v_liberadas int;
begin
  perform 1 from public.tables where id = any(v_ids) for update;

  select count(*) into v_pegadas
    from public.tables t
   where t.id = any(v_ids)
     and t.status in ('occupied', 'waiting_bill')
     and not exists (select 1 from public.orders o
                      where o.table_id = t.id and o.status in ('pending', 'preparing', 'ready'));

  if v_pegadas <> cardinality(v_ids) then
    raise exception 'De % mesas en la lista, % siguen pegadas: no se tocó ninguna. Vuelve a correr la consulta 1.',
      cardinality(v_ids), v_pegadas;
  end if;

  update public.tables t
     set status = 'free'
   where t.id = any(v_ids)
     and t.status in ('occupied', 'waiting_bill')
     and not exists (select 1 from public.orders o
                      where o.table_id = t.id and o.status in ('pending', 'preparing', 'ready'));
  get diagnostics v_liberadas = row_count;

  if v_liberadas <> v_pegadas then
    raise exception 'Se esperaban % mesas y se liberaron %: no se tocó ninguna.', v_pegadas, v_liberadas;
  end if;

  raise notice 'Mesas liberadas: %', v_liberadas;
end $$;
commit;

-- Verificación: vuelve a correr la consulta 1; esas mesas ya no deben salir.
*/

/* ── PASO 3 — CANCELAR CUENTAS ESCONDIDAS (ESCRIBE). Solo después de leer la consulta 2 o la 3. ─
   Qué hace: pasa a 'cancelled' las órdenes cuyos orden_id pegues abajo. Es lo mismo que haría
   "Cerrar mesa" (cerrar_mesa_sin_consumo), pero SIN tocar la mesa.
   Una cuenta "escondida" es una de estas dos:
     · la mesa está LIBRE (consulta 2), o
     · la mesa está ocupada y hay OTRA cuenta viva más antigua en ella (consulta 3): la pantalla
       muestra la más antigua, así que la más antigua nunca se cancela aquí.
   Fail-closed: si alguna orden de la lista no es una cuenta escondida VACÍA (dine_in, pending/
   preparing/ready, total 0, sin ítems, sin pagos), aborta y no toca NINGUNA. Una orden con
   consumo nunca se cancela aquí: esa se mira aparte.
   Re-aplicar: inofensivo; la segunda vez aborta porque las órdenes ya no están vivas.
   Triggers de orders al 2026-10-16 (por la TABLA, R2): trg_orders_updated_at y
   trg_order_delivered_at. Para reconfirmarlo contra la base:
     select tgname from pg_trigger where tgrelid = 'public.orders'::regclass and not tgisinternal;

begin;
do $$
declare
  v_ids uuid[] := array[
    '00000000-0000-0000-0000-000000000000'   -- ← reemplaza por los orden_id de la consulta 2 o 3
  ]::uuid[];
  v_vacias     int;
  v_canceladas int;
begin
  perform 1 from public.orders where id = any(v_ids) for update;

  select count(*) into v_vacias
    from public.orders o
    join public.tables t on t.id = o.table_id
   where o.id = any(v_ids)
     and o.type = 'dine_in'
     and o.status in ('pending', 'preparing', 'ready')
     and o.total = 0
     and (t.status = 'free'
          or exists (select 1 from public.orders o2
                      where o2.table_id = o.table_id and o2.id <> o.id
                        and o2.status in ('pending', 'preparing', 'ready')
                        and (o2.created_at, o2.id) < (o.created_at, o.id)))
     and not exists (select 1 from public.order_items i where i.order_id = o.id)
     and not exists (select 1 from public.payments p where p.order_id = o.id);

  if v_vacias <> cardinality(v_ids) then
    raise exception 'De % órdenes en la lista, % siguen siendo cuentas escondidas vacías: no se tocó ninguna. Vuelve a correr la consulta 2 o la 3.',
      cardinality(v_ids), v_vacias;
  end if;

  update public.orders o
     set status = 'cancelled'
   where o.id = any(v_ids)
     and o.status in ('pending', 'preparing', 'ready')
     and o.total = 0
     and not exists (select 1 from public.order_items i where i.order_id = o.id)
     and not exists (select 1 from public.payments p where p.order_id = o.id);
  get diagnostics v_canceladas = row_count;

  if v_canceladas <> v_vacias then
    raise exception 'Se esperaban % órdenes y se cancelaron %: no se tocó ninguna.', v_vacias, v_canceladas;
  end if;

  raise notice 'Cuentas escondidas canceladas: %', v_canceladas;
end $$;
commit;

-- Verificación: vuelve a correr la consulta 2 y la 3; esas órdenes ya no deben salir.
*/

/* ── PASO 4 — RENOMBRAR UNA MESA (ESCRIBE). Solo después de leer la consulta 4. ──────────────
   Qué hace: cambia el nombre de UNA mesa, fijada por mesa_id. Nada más: no toca su estado, su
   zona ni sus órdenes (las ventas siguen apuntando a la misma mesa, solo cambia cómo se llama).
   Fail-closed: aborta sin tocar nada si la mesa no existe, si su nombre actual no es el que
   escribiste (alguien ya la cambió, o pegaste otro mesa_id), o si el nombre nuevo ya lo usa otra
   mesa de la misma sede.
   Re-aplicar: inofensivo; la segunda vez aborta porque el nombre actual ya no coincide.

begin;
do $$
declare
  v_mesa  uuid := '00000000-0000-0000-0000-000000000000';  -- ← mesa_id de la consulta 4
  v_antes text := 'nombre actual EXACTO';                  -- ← sin las comillas de nombre_exacto
  v_nuevo text := 'nombre nuevo';
  v_sede  uuid;
  v_n     int;
begin
  select restaurant_id into v_sede from public.tables
   where id = v_mesa and name = v_antes and archived_at is null for update;
  if not found then
    raise exception 'La mesa % no existe, está archivada o ya no se llama "%": no se tocó nada.', v_mesa, v_antes;
  end if;
  if exists (select 1 from public.tables
              where restaurant_id = v_sede and id <> v_mesa and archived_at is null
                and lower(btrim(name)) = lower(btrim(v_nuevo))) then
    raise exception 'Ya hay otra mesa que se llama "%" en esa sede: no se tocó nada.', v_nuevo;
  end if;

  update public.tables set name = btrim(v_nuevo) where id = v_mesa and name = v_antes;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'Se esperaba 1 mesa y se cambiaron %: no se tocó nada.', v_n; end if;
  raise notice 'Mesa renombrada: "%" → "%"', v_antes, btrim(v_nuevo);
end $$;
commit;

-- Verificación: vuelve a correr la consulta 4; esa sede ya no debe salir.
*/
