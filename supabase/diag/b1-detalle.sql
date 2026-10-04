-- supabase/diag/b1-detalle.sql  (DIAGNÓSTICO de solo lectura; no es migración)
-- Casos YA CONOCIDOS que estas queries devuelven: docs/DEUDAS.md → "Datos históricos
-- del reenvío y del cobro en dos pasos: NO se limpian". No son hallazgos nuevos.
-- ============================================================================
-- DETALLE de lo que b1-total-pos.sql marcó en prod (60 días, ventas POS = sin mesa):
--   G-10: 1 venta que NO cuadra (max_diferencia 24000) y 15 sin_items.
-- Misma ventana (60 días, frontera de día en Bogotá) y misma fórmula que B1:
--   calculado = Σ order_items.qty × unit_price + Σ order_item_extras.qty × unit_price − discount_amount
-- Filtra con la clasificación de B1 sobre TODAS las organizaciones (no hace falta
-- el UUID de G-10): hoy solo devuelve filas de G-10.
--
-- QUÉ ESCRIBE: nada. RE-EJECUTAR: inofensivo. Son 3 bloques; correrlos de a uno
-- si el SQL Editor muestra solo el último resultado.
-- ============================================================================


-- ── 1. LA VENTA QUE NO CUADRA, con la evidencia para la hipótesis ───────────
with params as (
  select ((now() at time zone 'America/Bogota')::date - 60)::timestamp at time zone 'America/Bogota' as desde
),
pos as (
  select o.*,
         coalesce((select sum(i.qty * i.unit_price) from public.order_items i where i.order_id = o.id), 0) as sum_items,
         coalesce((select sum(e.qty * e.unit_price) from public.order_item_extras e
                     join public.order_items i on i.id = e.order_item_id where i.order_id = o.id), 0) as sum_extras,
         (select count(*) from public.order_items i where i.order_id = o.id) as n_items
    from public.orders o, params p
   where o.table_id is null and o.created_at >= p.desde
)
select org.name as organizacion, r.name as sede,
       o.id, o.order_number,
       (o.created_at at time zone 'America/Bogota')::timestamp(0) as creada_bogota,
       (o.updated_at at time zone 'America/Bogota')::timestamp(0) as modificada_bogota,
       o.type::text as tipo, o.status::text as status, o.payment_status,
       o.cancelled_at is not null as anulada,
       o.total, o.sum_items, o.sum_extras,
       o.discount_kind, o.discount_type, o.discount_amount,
       o.total - (o.sum_items + o.sum_extras - coalesce(o.discount_amount, 0)) as diferencia,  -- + = total MAYOR que las líneas
       (select string_agg(p.method::text || '=' || p.amount, ' + ' order by p.created_at)
          from public.payments p where p.order_id = o.id) as pagos,
       (select coalesce(sum(p.amount), 0) from public.payments p where p.order_id = o.id) as suma_pagos,
       pr.full_name as creo,
       -- Líneas como están HOY, con el precio actual del producto:
       (select string_agg(pd.name || ' ×' || i.qty || ' @' || i.unit_price
                          || ' (hoy ' || pd.price || ')'
                          || coalesce(' nota=' || i.notes, ''), ' | ' order by i.created_at)
          from public.order_items i join public.products pd on pd.id = i.product_id
         where i.order_id = o.id) as items_hoy,
       -- Extras guardados contra el precio actual del extra (la RPC graba el
       -- precio de la BASE; el total del cliente usa el del carrito):
       (select string_agg(x.name || ' ×' || e.qty || ' @' || e.unit_price || ' (hoy ' || x.price || ')', ' | ')
          from public.order_item_extras e join public.order_items i on i.id = e.order_item_id
          join public.extras x on x.id = e.extra_id
         where i.order_id = o.id) as extras,
       -- Lo que la venta descontó de stock (reference_id = la orden). Si salieron
       -- más unidades que las líneas que hay hoy, una línea se BORRÓ después.
       (select string_agg(pd.name || ' ' || sm.type || ' ' || sm.qty
                          || ' a las ' || to_char(sm.created_at at time zone 'America/Bogota', 'HH24:MI:SS'), ' | ' order by sm.created_at)
          from public.stock_movements sm join public.products pd on pd.id = sm.product_id
         where sm.reference_id = o.id) as movimientos_stock,
       o.customer_name, o.notes, o.delivery_address
  from pos o
  join public.restaurants r     on r.id = o.restaurant_id
  join public.organizations org on org.id = r.organization_id
  left join public.profiles pr  on pr.id = o.created_by
 where o.n_items > 0
   and round(o.total, 2) <> round(o.sum_items + o.sum_extras - coalesce(o.discount_amount, 0), 2)
 order by o.created_at;


-- ── 2. LAS SIN_ITEMS, una por fila, con dónde aparecen y si hubo reintento ───
with params as (
  select ((now() at time zone 'America/Bogota')::date - 60)::timestamp at time zone 'America/Bogota' as desde
),
huerfanas as (
  select o.*
    from public.orders o, params p
   where o.table_id is null and o.created_at >= p.desde
     and not exists (select 1 from public.order_items i where i.order_id = o.id)
)
select org.name as organizacion,
       o.id, o.order_number,
       (o.created_at at time zone 'America/Bogota')::timestamp(0) as creada_bogota,
       to_char(o.created_at at time zone 'America/Bogota', 'Dy') as dia,
       o.type::text as tipo, o.status::text as status, o.payment_status,
       o.cancelled_at is not null as anulada,
       o.total, o.discount_kind, o.discount_amount,
       (select count(*) from public.payments p where p.order_id = o.id) as n_pagos,
       (select coalesce(sum(p.amount), 0) from public.payments p where p.order_id = o.id) as suma_pagos,
       -- 0 = los ítems NUNCA se insertaron (la carga falló); > 0 = existieron y se borraron.
       (select count(*) from public.stock_movements sm where sm.reference_id = o.id) as movs_stock,
       extract(epoch from (o.updated_at - o.created_at))::int as seg_hasta_ultima_modif,
       pr.full_name as creo,
       -- DÓNDE APARECE (criterios del código al 2026-10-01):
       (exists (select 1 from public.payments p where p.order_id = o.id)
          and o.status <> 'cancelled')                         as en_reportes_ventas,   -- vistas daily/hourly/waiter: JOIN payments
       o.order_number is not null                              as en_historial_ventas,  -- getSalesHistory: order_number no nulo, muestra orders.total
       o.discount_kind = 'vale'                                as en_regalado_vales,    -- getVouchersTotal: solo discount_kind
       o.status in ('pending', 'preparing', 'ready')           as en_cocina,            -- KitchenPage
       -- REINTENTO: la siguiente orden del mismo usuario, sin mesa, en los 15
       -- minutos siguientes, con el MISMO total y con ítems.
       (select n.order_number || ' a los ' || round(extract(epoch from (n.created_at - o.created_at)) / 60.0, 1) || ' min'
          from public.orders n
         where n.restaurant_id = o.restaurant_id and n.created_by = o.created_by and n.table_id is null
           and n.created_at > o.created_at and n.created_at < o.created_at + interval '15 minutes'
           and n.total = o.total
           and exists (select 1 from public.order_items i where i.order_id = n.id)
         order by n.created_at limit 1)                         as reintento
  from huerfanas o
  join public.restaurants r     on r.id = o.restaurant_id
  join public.organizations org on org.id = r.organization_id
  left join public.profiles pr  on pr.id = o.created_by
 order by o.created_at;


-- ── 3. PATRÓN: por día y hora de Bogotá (sin_items y la que no cuadra) ───────
with params as (
  select ((now() at time zone 'America/Bogota')::date - 60)::timestamp at time zone 'America/Bogota' as desde
),
marcadas as (
  select o.restaurant_id, o.created_at,
         (o.created_at at time zone 'America/Bogota')::date as dia_bogota,
         case when not exists (select 1 from public.order_items i where i.order_id = o.id) then 'sin_items'
              else 'no_cuadra' end as clase
    from public.orders o, params p
   where o.table_id is null and o.created_at >= p.desde
     and ( not exists (select 1 from public.order_items i where i.order_id = o.id)
        or round(o.total, 2) <> round(
             coalesce((select sum(i.qty * i.unit_price) from public.order_items i where i.order_id = o.id), 0)
           + coalesce((select sum(e.qty * e.unit_price) from public.order_item_extras e
                         join public.order_items i on i.id = e.order_item_id where i.order_id = o.id), 0)
           - coalesce(o.discount_amount, 0), 2) )
)
select org.name as organizacion, m.clase,
       m.dia_bogota,
       to_char(m.dia_bogota, 'Dy') as dia,
       string_agg(to_char(m.created_at at time zone 'America/Bogota', 'HH24:MI'), ', ' order by m.created_at) as horas,
       count(*) as cuantas,
       -- ventas POS normales de ese día en esa sede, para comparar volumen:
       (select count(*) from public.orders x
         where x.restaurant_id = m.restaurant_id and x.table_id is null
           and (x.created_at at time zone 'America/Bogota')::date = m.dia_bogota) as ventas_pos_del_dia
  from marcadas m
  join public.restaurants r     on r.id = m.restaurant_id
  join public.organizations org on org.id = r.organization_id
 group by org.name, m.clase, m.restaurant_id, m.dia_bogota
 order by m.dia_bogota, m.clase;
