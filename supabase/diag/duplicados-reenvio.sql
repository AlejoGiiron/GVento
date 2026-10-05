-- supabase/diag/duplicados-reenvio.sql  (DIAGNÓSTICO de solo lectura; no es migración)
-- Casos YA CONOCIDOS que estas queries devuelven: docs/DEUDAS.md → "Datos históricos
-- del reenvío y del cobro en dos pasos: NO se limpian". No son hallazgos nuevos.
-- ============================================================================
-- PREGUNTA: ¿el navegador ejecutó DOS VECES una escritura que el usuario hizo
-- una sola vez?
--
-- MECANISMO (reproducido en Docker el 2026-10-01): si una conexión keep-alive
-- REUTILIZADA se corta después de que el servidor procesó un POST, Chromium
-- reenvía el POST solo, por una conexión nueva, y al código le entrega la
-- respuesta del SEGUNDO: la app ve éxito y la base quedó con la escritura doble.
-- Medido: 2 POST, 2 líneas, a 8–62 ms; HTTP 204 en el fetch.
--
-- CÓMO SE DISTINGUE de un pedido legítimo repetido:
--   · mismo created_at exacto   → MISMA llamada/transacción (now() es el de la
--                                 transacción): la app mandó dos líneas iguales.
--                                 No es reenvío; casi siempre legítimo.
--   · distinto, < 1 s           → DOS llamadas pegadas: la firma del reenvío.
--   · 1 a 3 s                   → zona gris (doble toque rápido o reenvío tardío).
--
-- QUÉ ESCRIBE: nada. Ventana: 60 días, frontera de día en Bogotá.
-- Son 6 bloques; correrlos de a uno si el SQL Editor muestra solo el último.
-- ============================================================================


-- ── 1. ÍTEMS duplicados: resumen por organización y tipo (POS / mesa) ───────
with params as (
  select ((now() at time zone 'America/Bogota')::date - 60)::timestamp at time zone 'America/Bogota' as desde
),
items as (
  select i.id, i.order_id, i.product_id, i.qty, i.unit_price, i.notes, i.created_at,
         o.restaurant_id, case when o.table_id is null then 'POS' else 'mesa' end as tipo,
         coalesce((select string_agg(e.extra_id::text || 'x' || e.qty || '@' || e.unit_price, ',' order by e.extra_id, e.qty)
                     from public.order_item_extras e where e.order_item_id = i.id), '') as firma_extras
    from public.order_items i
    join public.orders o on o.id = i.order_id, params p
   where o.created_at >= p.desde
),
pares as (
  select a.restaurant_id, a.tipo, a.order_id, a.id as id_a, b.id as id_b,
         extract(epoch from (b.created_at - a.created_at)) as seg
    from items a
    join items b
      on b.order_id = a.order_id and b.product_id = a.product_id and b.qty = a.qty
     and b.unit_price = a.unit_price and b.notes is not distinct from a.notes
     and b.firma_extras = a.firma_extras
     and (b.created_at, b.id) > (a.created_at, a.id)
     and b.created_at - a.created_at < interval '3 seconds'
)
select org.name as organizacion, p.tipo,
       count(p.order_id)                                as pares_menos_3s,
       count(*) filter (where p.seg = 0)                as mismo_created_at,
       count(*) filter (where p.seg > 0 and p.seg < 1)  as distinto_menos_1s,
       count(*) filter (where p.seg >= 1)               as entre_1_y_3s,
       count(distinct p.order_id)                       as ordenes
  from public.organizations org
  left join public.restaurants r on r.organization_id = org.id
  left join pares p on p.restaurant_id = r.id
 group by org.name, org.created_at, p.tipo
 order by org.created_at, p.tipo;


-- ── 2. ÍTEMS duplicados: el detalle de cada par ─────────────────────────────
with params as (
  select ((now() at time zone 'America/Bogota')::date - 60)::timestamp at time zone 'America/Bogota' as desde
),
items as (
  select i.id, i.order_id, i.product_id, i.qty, i.unit_price, i.notes, i.created_at,
         coalesce((select string_agg(e.extra_id::text || 'x' || e.qty || '@' || e.unit_price, ',' order by e.extra_id, e.qty)
                     from public.order_item_extras e where e.order_item_id = i.id), '') as firma_extras
    from public.order_items i
    join public.orders o on o.id = i.order_id, params p
   where o.created_at >= p.desde
)
select org.name as organizacion, case when o.table_id is null then 'POS' else 'mesa' end as tipo,
       o.order_number, o.id as order_id, o.status::text as status,
       pd.name as producto, a.qty, a.unit_price, a.notes,
       (a.created_at at time zone 'America/Bogota')::time(3) as linea_a_bogota,
       (b.created_at at time zone 'America/Bogota')::time(3) as linea_b_bogota,
       round(extract(epoch from (b.created_at - a.created_at))::numeric * 1000) as ms_entre,
       a.id as id_linea_a, b.id as id_linea_b,
       o.total,
       coalesce((select sum(x.qty * x.unit_price) from public.order_items x where x.order_id = o.id), 0) as sum_items,
       (select coalesce(sum(p.amount), 0) from public.payments p where p.order_id = o.id) as suma_pagos,
       pr.full_name as creo_la_orden,
       (o.created_at at time zone 'America/Bogota')::date as dia_bogota
  from items a
  join items b
    on b.order_id = a.order_id and b.product_id = a.product_id and b.qty = a.qty
   and b.unit_price = a.unit_price and b.notes is not distinct from a.notes
   and b.firma_extras = a.firma_extras
   and (b.created_at, b.id) > (a.created_at, a.id)
   and b.created_at - a.created_at < interval '3 seconds'
  join public.orders o          on o.id = a.order_id
  join public.restaurants r     on r.id = o.restaurant_id
  join public.organizations org on org.id = r.organization_id
  join public.products pd       on pd.id = a.product_id
  left join public.profiles pr  on pr.id = o.created_by
 order by org.name, o.created_at;


-- ── 3. ÓRDENES gemelas (un createOrder reenviado): mismo usuario, misma sede,
--      mismo tipo, misma mesa, mismo total, creadas a < 3 s ────────────────────
with params as (
  select ((now() at time zone 'America/Bogota')::date - 60)::timestamp at time zone 'America/Bogota' as desde
)
select org.name as organizacion, case when a.table_id is null then 'POS' else 'mesa' end as tipo,
       a.id as orden_a, a.order_number as num_a, b.id as orden_b, b.order_number as num_b,
       a.total, round(extract(epoch from (b.created_at - a.created_at))::numeric * 1000) as ms_entre,
       a.created_at = b.created_at as misma_transaccion,   -- t = NO es reenvío (dos requests nunca comparten transacción)
       (select count(*) from public.order_items i where i.order_id = a.id) as items_a,
       (select count(*) from public.order_items i where i.order_id = b.id) as items_b,
       a.status::text as status_a, b.status::text as status_b,
       (a.created_at at time zone 'America/Bogota')::timestamp(0) as creada_bogota,
       pr.full_name as creo
  from public.orders a
  join public.orders b
    on b.restaurant_id = a.restaurant_id and b.created_by = a.created_by and b.type = a.type
   and b.table_id is not distinct from a.table_id and b.total = a.total
   and (b.created_at, b.id) > (a.created_at, a.id)
   and b.created_at - a.created_at < interval '3 seconds'
  join public.restaurants r     on r.id = a.restaurant_id
  join public.organizations org on org.id = r.organization_id
  left join public.profiles pr  on pr.id = a.created_by, params p
 where a.created_at >= p.desde
 order by org.name, a.created_at;


-- ── 4. ABONOS gemelos (register_debt_payment reenviado): misma orden, monto y
--      método, a < 3 s ─────────────────────────────────────────────────────────
with params as (
  select ((now() at time zone 'America/Bogota')::date - 60)::timestamp at time zone 'America/Bogota' as desde
)
select org.name as organizacion, o.order_number, a.amount, a.payment_method,
       round(extract(epoch from (b.created_at - a.created_at))::numeric * 1000) as ms_entre,
       a.id as abono_a, b.id as abono_b,
       a.cash_movement_id is not null as a_entro_a_caja, b.cash_movement_id is not null as b_entro_a_caja,
       (a.created_at at time zone 'America/Bogota')::timestamp(0) as creado_bogota
  from public.debt_payments a
  join public.debt_payments b
    on b.order_id = a.order_id and b.amount = a.amount and b.payment_method = a.payment_method
   and (b.created_at, b.id) > (a.created_at, a.id)
   and b.created_at - a.created_at < interval '3 seconds'
  join public.orders o          on o.id = a.order_id
  join public.restaurants r     on r.id = o.restaurant_id
  join public.organizations org on org.id = r.organization_id, params p
 where a.created_at >= p.desde
 order by org.name, a.created_at;


-- ── 5. MOVIMIENTOS DE CAJA gemelos (insert directo reenviado): mismo turno,
--      tipo, monto y motivo, a < 3 s ──────────────────────────────────────────
with params as (
  select ((now() at time zone 'America/Bogota')::date - 60)::timestamp at time zone 'America/Bogota' as desde
)
select org.name as organizacion, a.shift_id, a.type::text as tipo, a.amount, a.reason,
       round(extract(epoch from (b.created_at - a.created_at))::numeric * 1000) as ms_entre,
       a.id as mov_a, b.id as mov_b,
       (a.created_at at time zone 'America/Bogota')::timestamp(0) as creado_bogota
  from public.cash_movements a
  join public.cash_movements b
    on b.shift_id = a.shift_id and b.type = a.type and b.amount = a.amount
   and b.reason is not distinct from a.reason
   and (b.created_at, b.id) > (a.created_at, a.id)
   and b.created_at - a.created_at < interval '3 seconds'
  join public.restaurants r     on r.id = a.restaurant_id
  join public.organizations org on org.id = r.organization_id, params p
 where a.created_at >= p.desde
 order by org.name, a.created_at;


-- ── 6. La #2945 en particular: ¿sus dos líneas son una llamada o dos? ───────
--      (mismo created_at = una sola llamada con la línea repetida; distinto =
--      dos ejecuciones de add_order_items_with_extras)
select o.order_number, i.id as id_linea, pd.name as producto, i.qty, i.unit_price, i.notes,
       (i.created_at at time zone 'America/Bogota')::timestamp(3) as creada_bogota,
       (select count(*) from public.order_item_extras e where e.order_item_id = i.id) as extras
  from public.orders o
  join public.order_items i on i.order_id = o.id
  join public.products pd   on pd.id = i.product_id
 where o.id::text like 'c1a79e70%'
 order by i.created_at;

-- CÓMO LEERLO:
--   · Bloque 1, columna distinto_menos_1s: la firma del reenvío. En 'mesa' no
--     se cobra de más (TablesPage suma el total una vez por tanda en el cliente),
--     pero Cocina ve la comanda doble, el stock baja dos veces, y si alguien
--     borra la línea de más, handleRemoveItem resta su precio y la mesa termina
--     cobrando DE MENOS.
--   · mismo_created_at: la app mandó dos líneas iguales en una llamada. Casi
--     siempre legítimo (en el POS, un ítem con extras no se fusiona).
--   · Bloque 3: la firma del createOrder reenviado es una gemela con items = 0
--     (la app usó una sola de las dos). misma_transaccion = t descarta reenvío.
--   · Bloques 4 y 5: cualquier fila es una escritura posiblemente reenviada.
--     Un abono gemelo (4) es plata cobrada dos veces en el saldo del cliente.


-- ── 7. HUÉRFANAS CON ÍTEMS (R3): la carga de ítems SÍ se guardó, pero la app
--      recibió un error (corte en conexión nueva: medido, "Failed to fetch" con
--      la línea ya guardada) y no siguió al cobro. Queda una venta de POS con
--      ítems y stock descontado, sin pago y sin número. B1 no la ve: su total
--      cuadra con sus líneas. Excluye fiado (payment_status 'pending' sin pago es
--      normal) y lo de la última hora (puede estar cobrándose).
with params as (
  select ((now() at time zone 'America/Bogota')::date - 60)::timestamp at time zone 'America/Bogota' as desde
)
select org.name as organizacion, o.id, (o.created_at at time zone 'America/Bogota')::timestamp(0) as creada_bogota,
       o.status::text as status, o.payment_status, o.total,
       (select count(*) from public.order_items i where i.order_id = o.id) as n_items,
       (select count(*) from public.stock_movements sm where sm.reference_id = o.id) as movs_stock,
       pr.full_name as creo,
       (select n.order_number || ' a los ' || round(extract(epoch from (n.created_at - o.created_at)) / 60.0, 1) || ' min'
          from public.orders n
         where n.restaurant_id = o.restaurant_id and n.created_by = o.created_by and n.table_id is null
           and n.created_at > o.created_at and n.created_at < o.created_at + interval '15 minutes'
           and n.total = o.total and exists (select 1 from public.payments p where p.order_id = n.id)
         order by n.created_at limit 1) as reintento_cobrado
  from public.orders o
  join public.restaurants r     on r.id = o.restaurant_id
  join public.organizations org on org.id = r.organization_id
  left join public.profiles pr  on pr.id = o.created_by, params p
 where o.table_id is null and o.created_at >= p.desde and o.created_at < now() - interval '1 hour'
   and o.cancelled_at is null and o.payment_status <> 'pending' and o.total > 0
   and o.order_number is null
   and exists (select 1 from public.order_items i where i.order_id = o.id)
   and not exists (select 1 from public.payments p where p.order_id = o.id)
 order by org.name, o.created_at;
