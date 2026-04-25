-- ============================================================
-- G-Vento POS — Vistas de Reportes
-- Ejecutar en: Supabase Dashboard > SQL Editor
-- ============================================================
-- RLS: las vistas usan security_invoker = true (PostgreSQL 15+).
-- Esto hace que el RLS de las tablas subyacentes se aplique con
-- las credenciales del usuario que consulta — orders, payments,
-- products y profiles ya tienen políticas que filtran por
-- get_my_restaurant_id(), así que no se necesitan políticas
-- adicionales a nivel de vista.
-- ============================================================


-- ============================================================
-- 1. daily_sales_summary
-- Ventas por día, canal y método de pago.
-- Un registro por (día, tipo de orden).
-- PostgREST: filtrar con .gte('day', from).lte('day', to)
-- ============================================================

create or replace view public.daily_sales_summary
  with (security_invoker = true)
as
select
  (o.created_at at time zone 'America/Bogota')::date          as day,
  o.type                                                       as order_type,
  o.restaurant_id,
  count(distinct o.id)                                         as order_count,
  coalesce(sum(p.amount), 0)                                   as total_revenue,
  round(
    coalesce(sum(p.amount), 0) / nullif(count(distinct o.id), 0),
    2
  )                                                            as avg_ticket,
  coalesce(sum(p.amount) filter (where p.method = 'cash'),     0) as cash_total,
  coalesce(sum(p.amount) filter (where p.method = 'card'),     0) as card_total,
  coalesce(sum(p.amount) filter (where p.method = 'transfer'), 0) as transfer_total,
  coalesce(sum(p.amount) filter (where p.method = 'nequi'),    0) as nequi_total
from public.orders o
join public.payments p on p.order_id = o.id
where o.status != 'cancelled'
group by
  (o.created_at at time zone 'America/Bogota')::date,
  o.type,
  o.restaurant_id;


-- ============================================================
-- 2. product_performance
-- Unidades vendidas y revenue por producto/categoría por día.
-- Un registro por (día, producto).
-- PostgREST: filtrar con .gte('day', from).lte('day', to)
-- ============================================================

create or replace view public.product_performance
  with (security_invoker = true)
as
select
  (o.created_at at time zone 'America/Bogota')::date   as day,
  oi.product_id,
  p.name                                               as product_name,
  c.id                                                 as category_id,
  c.name                                               as category_name,
  o.restaurant_id,
  sum(oi.qty)                                          as total_qty,
  sum(oi.qty * oi.unit_price)                          as total_revenue
from public.order_items oi
join public.orders     o  on o.id = oi.order_id
join public.products   p  on p.id = oi.product_id
join public.categories c  on c.id = p.category_id
where o.status != 'cancelled'
group by
  (o.created_at at time zone 'America/Bogota')::date,
  oi.product_id,
  p.name,
  c.id,
  c.name,
  o.restaurant_id;


-- ============================================================
-- 3. hourly_sales
-- Órdenes y revenue agrupados por hora del día (zona Bogotá).
-- Un registro por (día, hora 0-23).
-- PostgREST: filtrar con .gte('day', from).lte('day', to)
-- ============================================================

create or replace view public.hourly_sales
  with (security_invoker = true)
as
select
  (o.created_at at time zone 'America/Bogota')::date                       as day,
  extract(hour from (o.created_at at time zone 'America/Bogota'))::integer as hour,
  o.restaurant_id,
  count(distinct o.id)                                                       as order_count,
  coalesce(sum(p.amount), 0)                                                 as total_revenue
from public.orders o
join public.payments p on p.order_id = o.id
where o.status != 'cancelled'
group by
  (o.created_at at time zone 'America/Bogota')::date,
  extract(hour from (o.created_at at time zone 'America/Bogota')),
  o.restaurant_id;


-- ============================================================
-- 4. waiter_performance
-- Ventas, órdenes y ticket promedio por mozo por día.
-- Un registro por (día, mozo).
-- PostgREST: filtrar con .gte('day', from).lte('day', to)
-- ============================================================

create or replace view public.waiter_performance
  with (security_invoker = true)
as
select
  (o.created_at at time zone 'America/Bogota')::date   as day,
  o.created_by                                         as waiter_id,
  pr.full_name                                         as waiter_name,
  o.restaurant_id,
  count(distinct o.id)                                  as order_count,
  coalesce(sum(p.amount), 0)                            as total_revenue,
  round(
    coalesce(sum(p.amount), 0) / nullif(count(distinct o.id), 0),
    2
  )                                                     as avg_ticket
from public.orders   o
join public.payments  p  on p.order_id = o.id
join public.profiles  pr on pr.id      = o.created_by
where o.status != 'cancelled'
group by
  (o.created_at at time zone 'America/Bogota')::date,
  o.created_by,
  pr.full_name,
  o.restaurant_id;
