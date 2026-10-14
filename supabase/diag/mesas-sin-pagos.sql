-- supabase/diag/mesas-sin-pagos.sql — SOLO LECTURA. Cada consulta se corre POR SEPARADO.
-- Investiga lo que mostró la consulta 2b de mesas-preflight.sql: mesas cerradas como pagadas
-- SIN filas en payments, y mesas entregadas con total 0. Todo por UUID de organización.
-- G-10 = 12b53bae-a4f7-4076-80f9-8f9288bd0567. Salchimelo: el UUID sale de la consulta 0.

-- ── Consulta 0: organizaciones y sedes, con su UUID ──
select o.id as org_id, o.name as organizacion, s.id as sede_id, s.name as sede
  from public.organizations o
  left join public.restaurants s on s.organization_id = o.id
 order by o.created_at, s.name;

-- ── Consulta 1: cada mesa "pagada" SIN payments, con su clase y el turno en que cayó ──
-- Cambia el UUID de la primera línea para correrla con otra organización.
with p as (select '12b53bae-a4f7-4076-80f9-8f9288bd0567'::uuid as org,
                  ('2026-08-01'::timestamp at time zone 'America/Bogota') as desde),
ord as (
  select x.*, s.name as sede
    from public.orders x
    join public.restaurants s on s.id = x.restaurant_id
    join p on s.organization_id = p.org
   where x.type = 'dine_in' and x.status = 'delivered' and x.payment_status = 'paid' and x.total > 0
     and x.created_at >= p.desde
     and not exists (select 1 from public.payments pa where pa.order_id = x.id)
),
det as (
  select o.id, o.restaurant_id, o.sede, o.order_number, t.name as mesa, o.created_at, o.delivered_at,
         coalesce(o.delivered_at, o.updated_at) as cierre,
         case when o.delivered_at is not null then 'delivered_at' else 'updated_at' end as fuente_cierre,
         o.total, coalesce(o.discount_amount, 0) as descuento, o.discount_reason, o.customer_id,
         coalesce((select sum(i.qty * i.unit_price) from public.order_items i where i.order_id = o.id), 0)
       + coalesce((select sum(e.qty * e.unit_price) from public.order_item_extras e
                     join public.order_items i on i.id = e.order_item_id where i.order_id = o.id), 0) as lineas,
         (select max(i.created_at) from public.order_items i where i.order_id = o.id) as ultima_linea,
         coalesce((select sum(d.amount) from public.debt_payments d where d.order_id = o.id), 0) as abonado
    from ord o
    left join public.tables t on t.id = o.table_id
)
select d.sede, d.order_number, d.mesa,
       (d.created_at at time zone 'America/Bogota')::timestamp(0)   as abierta,
       (d.cierre at time zone 'America/Bogota')::timestamp(0)       as cerrada,
       d.fuente_cierre,
       (d.ultima_linea at time zone 'America/Bogota')::timestamp(0) as ultima_linea,
       d.lineas, d.descuento, d.total, d.abonado, d.discount_reason,
       case
         when d.customer_id is not null and d.abonado >= d.total then 'A fiado saldado con abonos'
         when d.customer_id is not null                          then 'B fiado con cliente, saldo pendiente'
         when d.delivered_at is not null and d.ultima_linea > d.delivered_at then 'C lineas agregadas DESPUES del cierre'
         when d.lineas - d.descuento = d.total                   then 'D cerrada sin pago, total = lineas'
         else                                                         'E total distinto de las lineas'
       end as clase,
       (sh.opened_at at time zone 'America/Bogota')::timestamp(0) as turno_abrio,
       (sh.closed_at at time zone 'America/Bogota')::timestamp(0) as turno_cerro,
       sh.expected_amount as turno_efectivo_esperado,
       sh.closing_amount  as turno_efectivo_declarado,
       sh.difference      as turno_diferencia_efectivo,
       sh.id              as turno_id
  from det d
  left join lateral (
    select c.* from public.cash_shifts c
     where c.restaurant_id = d.restaurant_id
       and c.opened_at <= d.cierre and (c.closed_at is null or c.closed_at >= d.cierre)
     order by c.opened_at desc limit 1) sh on true
 order by d.sede, d.cierre;

-- ── Consulta 2: TODOS los turnos cerrados desde el 1/8, con su diferencia y las ventas sin pago que caen en cada uno ──
-- Cambia el UUID de la primera línea para correrla con otra organización.
with p as (select '12b53bae-a4f7-4076-80f9-8f9288bd0567'::uuid as org,
                  ('2026-08-01'::timestamp at time zone 'America/Bogota') as desde),
anom as (
  select x.id, x.restaurant_id, x.total, coalesce(x.delivered_at, x.updated_at) as cierre
    from public.orders x
    join public.restaurants s on s.id = x.restaurant_id
    join p on s.organization_id = p.org
   where x.type = 'dine_in' and x.status = 'delivered' and x.payment_status = 'paid' and x.total > 0
     and x.created_at >= p.desde
     and x.customer_id is null
     and not exists (select 1 from public.payments pa where pa.order_id = x.id)
)
select s.name as sede,
       (c.opened_at at time zone 'America/Bogota')::timestamp(0) as abrio,
       (c.closed_at at time zone 'America/Bogota')::timestamp(0) as cerro,
       c.expected_amount as efectivo_esperado,
       c.closing_amount  as efectivo_declarado,
       c.difference      as diferencia_efectivo,
       c.close_reconciliation->>'difference_total' as diferencia_todos_los_metodos,
       count(a.id)                 as ventas_sin_pago,
       coalesce(sum(a.total), 0)   as monto_sin_pago,
       c.difference - coalesce(sum(a.total), 0) as diferencia_si_se_hubieran_registrado
  from public.cash_shifts c
  join public.restaurants s on s.id = c.restaurant_id
  join p on s.organization_id = p.org
  left join anom a on a.restaurant_id = c.restaurant_id and a.cierre >= c.opened_at and a.cierre <= c.closed_at
 where c.opened_at >= p.desde and c.closed_at is not null
 group by s.name, c.id
 order by s.name, c.opened_at;

-- ── Consulta 3: mesas entregadas con total 0 y SIN pagos — ¿cortesía del 100 % o H2? ──
-- Pega el UUID de Salchimelo (de la consulta 0) en la primera línea. Con el texto de ejemplo
-- la consulta FALLA a propósito (no es un UUID).
with p as (select 'PEGA-AQUI-EL-UUID-DE-SALCHIMELO'::uuid as org,
                  ('2026-08-01'::timestamp at time zone 'America/Bogota') as desde),
det as (
  select x.id, s.name as sede, x.order_number, t.name as mesa, x.created_at,
         coalesce(x.delivered_at, x.updated_at) as cierre, x.delivered_at,
         coalesce(x.discount_amount, 0) as descuento, x.discount_kind, x.discount_reason, x.total,
         x.waiter_name, pr.full_name as abrio_la_mesa, x.restaurant_id,
         coalesce((select sum(i.qty * i.unit_price) from public.order_items i where i.order_id = x.id), 0)
       + coalesce((select sum(e.qty * e.unit_price) from public.order_item_extras e
                     join public.order_items i on i.id = e.order_item_id where i.order_id = x.id), 0) as lineas,
         (select count(*) from public.order_items i where i.order_id = x.id) as items
    from public.orders x
    join public.restaurants s on s.id = x.restaurant_id
    join p on s.organization_id = p.org
    left join public.tables t on t.id = x.table_id
    left join public.profiles pr on pr.id = x.created_by
   where x.type = 'dine_in' and x.status = 'delivered' and x.total = 0
     and x.created_at >= p.desde
     and not exists (select 1 from public.payments pa where pa.order_id = x.id)
)
select d.sede, d.order_number, d.mesa,
       (d.created_at at time zone 'America/Bogota')::timestamp(0) as abierta,
       (d.cierre at time zone 'America/Bogota')::timestamp(0)     as cerrada,
       d.items, d.lineas, d.descuento, d.discount_kind, d.discount_reason,
       d.abrio_la_mesa, d.waiter_name, cj.full_name as cajero_del_turno,
       case
         when d.lineas = 0                    then '1 sin consumo (lineas en 0)'
         when d.descuento = d.lineas          then '2 cortesia del 100 % (descuento = lineas)'
         when d.descuento > 0                 then '3 descuento distinto de las lineas'
         else                                      '4 sin descuento y con consumo'
       end as clase
  from det d
  left join lateral (
    select c.opened_by from public.cash_shifts c
     where c.restaurant_id = d.restaurant_id
       and c.opened_at <= d.cierre and (c.closed_at is null or c.closed_at >= d.cierre)
     order by c.opened_at desc limit 1) sh on true
  left join public.profiles cj on cj.id = sh.opened_by
 order by d.sede, d.cierre;

-- ── Consulta 4: G-10, las mesas abiertas hoy (para el diseño C: cuentas abiertas) ──
with p as (select '12b53bae-a4f7-4076-80f9-8f9288bd0567'::uuid as org)
select s.name as sede, t.name as mesa, x.order_number,
       (x.created_at at time zone 'America/Bogota')::timestamp(0) as abierta,
       (select (max(i.created_at) at time zone 'America/Bogota')::timestamp(0)
          from public.order_items i where i.order_id = x.id) as ultima_linea,
       (select count(*) from public.order_items i where i.order_id = x.id) as items,
       x.total, coalesce(x.discount_amount, 0) as descuento,
       coalesce((select sum(i.qty * i.unit_price) from public.order_items i where i.order_id = x.id), 0)
     + coalesce((select sum(e.qty * e.unit_price) from public.order_item_extras e
                   join public.order_items i on i.id = e.order_item_id where i.order_id = x.id), 0) as lineas,
       x.customer_id is not null as tiene_cliente
  from public.orders x
  join public.restaurants s on s.id = x.restaurant_id
  join p on s.organization_id = p.org
  left join public.tables t on t.id = x.table_id
 where x.type = 'dine_in' and x.status in ('pending', 'preparing', 'ready')
 order by s.name, x.total desc;
