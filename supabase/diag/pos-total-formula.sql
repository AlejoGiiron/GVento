-- supabase/diag/pos-total-formula.sql
-- ============================================================================
-- DIAGNÓSTICO de SOLO LECTURA (no es migración). Precondición de la decisión
-- B1 de register_pos_sale: el servidor va a RECALCULAR el total de una venta
-- de POS desde sus líneas y RECHAZAR si no coincide con el que manda el
-- cliente. Antes de construirlo hay que saber si la fórmula cuadra con las
-- ventas reales: si no cuadra, existe una regla de precio que la fórmula no
-- conoce, y el rechazo bloquearía ventas legítimas.
--
-- QUÉ ESCRIBE: nada (solo select). RE-EJECUTAR: inofensivo.
-- ALCANCE: todas las organizaciones (lectura). Arranca de `organizations`
--   con left join: una org sin ventas aparece con 0 (caso #12).
--
-- LA FÓRMULA (la del carrito: cartItemTotal en src/stores/cartStore.ts y
-- `total` en POSPage):
--   total = Σ order_items.qty × unit_price
--         + Σ order_item_extras.qty × unit_price   (qty del extra = por unidad
--                                                   × qty del ítem: es lo que
--                                                   graba add_order_items_with_extras)
--         − orders.discount_amount                  (CUALQUIER descuento, normal
--                                                   o vale: el % ya está
--                                                   convertido a monto)
--
-- QUÉ ES "VENTA DE POS": table_id IS NULL. Mesas tiene table_id y su total lo
-- reescribe el cliente al agregar o quitar ítems (otro flujo, no entra en B1).
-- VENTANA: 60 días, con la frontera de día en America/Bogota (R7).
--
-- VALIDADA en Docker el 2026-09-30 con controles conocidos, en LAB y dentro de
-- una transacción con rollback: una venta que cuadra (2×5000 + extra 3×700 −
-- descuento 1000 = 11100), una que no (8500 contra 8000 de líneas), una sin
-- ítems, y una de MESA que no cuadra. Resultado: LAB 3 | 1 | 1 | 0 | 1 | 500.00.
-- La de mesa quedó afuera. Después del rollback, todo en 0. El DETALLE mostró
-- la que no cuadraba.
-- ============================================================================

with params as (
  select ((now() at time zone 'America/Bogota')::date - 60)::timestamp
           at time zone 'America/Bogota' as desde
),
pos as (
  select o.id, o.restaurant_id, o.total, coalesce(o.discount_amount, 0) as descuento,
         o.discount_kind, o.status::text as status, o.cancelled_at,
         (select count(*) from public.order_items i where i.order_id = o.id) as n_items,
         coalesce((select sum(i.qty * i.unit_price) from public.order_items i where i.order_id = o.id), 0)
         + coalesce((select sum(e.qty * e.unit_price)
                       from public.order_item_extras e
                       join public.order_items i on i.id = e.order_item_id
                      where i.order_id = o.id), 0)
         - coalesce(o.discount_amount, 0) as calculado
    from public.orders o, params p
   where o.table_id is null
     and o.created_at >= p.desde
),
clasif as (
  select pos.*,
         case
           when n_items = 0                          then 'sin_items'
           when round(total, 2) = round(calculado, 2) then 'cuadra'
           else 'no_cuadra'
         end as clase
    from pos
)
select org.name                                                         as organizacion,
       count(c.id)                                                      as ventas_pos,
       count(*) filter (where c.clase = 'cuadra')                       as cuadran,
       count(*) filter (where c.clase = 'no_cuadra')                    as no_cuadran,
       count(*) filter (where c.clase = 'no_cuadra' and c.cancelled_at is not null) as no_cuadran_anuladas,
       count(*) filter (where c.clase = 'sin_items')                    as sin_items,
       max(abs(c.total - c.calculado)) filter (where c.clase = 'no_cuadra') as max_diferencia
  from public.organizations org
  left join public.restaurants r on r.organization_id = org.id
  left join clasif c on c.restaurant_id = r.id
 group by org.name, org.created_at
 order by org.created_at;

-- CÓMO LEERLO:
--   · Tienen que salir las CINCO organizaciones. Si falta alguna, la query está
--     mal: no la uses como evidencia.
--   · no_cuadran = 0 en G-10, Salchimelo y Café Aroma ⇒ la fórmula es la regla
--     real y B1 se puede construir tal cual.
--   · no_cuadran > 0 ⇒ hay una regla que la fórmula no conoce. Correr el
--     DETALLE de abajo y pasármelo antes de construir nada.
--   · no_cuadran_anuladas: informativo. La anulación devuelve stock pero no
--     debería tocar líneas ni total; si TODAS las diferencias son anuladas, la
--     causa es la anulación, no una regla de precio.
--   · sin_items: ventas con total y SIN líneas. Son las órdenes huérfanas que
--     register_pos_sale viene a eliminar (el cobro falló después de crear la
--     orden, o se cayó la carga de ítems). No cuentan contra la fórmula.

-- DETALLE (solo si alguna org tiene no_cuadran > 0). Correr aparte:
-- with params as (
--   select ((now() at time zone 'America/Bogota')::date - 60)::timestamp at time zone 'America/Bogota' as desde
-- )
-- select org.name, r.name as sede, o.order_number,
--        (o.created_at at time zone 'America/Bogota')::timestamp(0) as hora_bogota,
--        o.type::text, o.status::text, o.payment_status, o.cancelled_at is not null as anulada,
--        o.total,
--        coalesce((select sum(i.qty * i.unit_price) from public.order_items i where i.order_id = o.id), 0) as items,
--        coalesce((select sum(e.qty * e.unit_price) from public.order_item_extras e
--                    join public.order_items i on i.id = e.order_item_id where i.order_id = o.id), 0) as extras,
--        o.discount_amount, o.discount_type, o.discount_kind,
--        (select string_agg(p.method::text || '=' || p.amount, ' + ') from public.payments p where p.order_id = o.id) as pagos
--   from public.orders o
--   join public.restaurants r     on r.id = o.restaurant_id
--   join public.organizations org on org.id = r.organization_id, params
--  where o.table_id is null and o.created_at >= params.desde
--    and exists (select 1 from public.order_items i where i.order_id = o.id)
--    and round(o.total, 2) <> round(
--          coalesce((select sum(i.qty * i.unit_price) from public.order_items i where i.order_id = o.id), 0)
--        + coalesce((select sum(e.qty * e.unit_price) from public.order_item_extras e
--                      join public.order_items i on i.id = e.order_item_id where i.order_id = o.id), 0)
--        - coalesce(o.discount_amount, 0), 2)
--  order by org.name, o.created_at
--  limit 200;
