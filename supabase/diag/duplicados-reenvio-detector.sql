-- supabase/diag/duplicados-reenvio-detector.sql  (DIAGNÓSTICO de solo lectura; no es migración)
-- ============================================================================
-- Detecta escrituras de ítems ejecutadas DOS veces por el reenvío automático de
-- Chromium (docs/DEUDAS.md → "El navegador ejecuta DOS VECES"). Una ventana fija de
-- segundos no sirve: la #2945 de G-10 tuvo sus dos líneas a 19,5 s. El reenvío del navegador puede llegar
-- mucho después del primer envío (conexión colgada), así que la distancia no sirve
-- de criterio. Este detector usa la ESTRUCTURA de cada flujo:
--
--   POS:   toda venta de POS inserta sus ítems en UNA llamada a
--          add_order_items_with_extras, y todas las filas de una llamada comparten
--          el now() de su transacción (la función no fija created_at). ⇒ una orden
--          POS con líneas de MÁS DE UN created_at está duplicada, a cualquier
--          distancia.
--   MESAS: cada "Agregar" es una tanda = las líneas de la orden con el mismo
--          created_at. Duplicado = la MISMA tanda (mismo conjunto de líneas:
--          producto, qty, precio, notas, modifiers, extras) repetida en la misma
--          orden con hasta 60 s de diferencia. Puede haber legítimos ("otra ronda
--          igual"): son candidatos, no condena.
--
-- Ventana: 60 días (frontera de día en Bogotá). Sin laboratorios: fuera LAB por su
-- UUID de prod y toda org marcada config->>'es_laboratorio'. QUÉ ESCRIBE: nada.
-- ============================================================================


-- ── 1. POS: órdenes con ítems de más de una llamada ──────────────────────────
with params as (
  select ((now() at time zone 'America/Bogota')::date - 60)::timestamp at time zone 'America/Bogota' as desde
),
orgs as (
  select id, name from public.organizations
   where id <> 'f4fa692d-6cf3-43fb-a17f-18b8b163c918'               -- LAB
     and coalesce((config ->> 'es_laboratorio')::boolean, false) = false
),
pos as (
  select o.*, org.name as organizacion
    from public.orders o
    join public.restaurants r on r.id = o.restaurant_id
    join orgs org on org.id = r.organization_id, params p
   where o.table_id is null and o.created_at >= p.desde
),
llamadas as (
  select i.order_id, i.created_at,
         string_agg(pd.name || ' ×' || i.qty || ' @' || i.unit_price, ' + ' order by pd.name, i.id) as lineas,
         sum(i.qty * i.unit_price) as monto
    from public.order_items i join public.products pd on pd.id = i.product_id
   where i.order_id in (select id from pos)
   group by i.order_id, i.created_at
)
select o.organizacion, o.order_number, o.id,
       (o.created_at at time zone 'America/Bogota')::timestamp(0) as creada_bogota,
       o.status::text as status, o.cancelled_at is not null as anulada,
       count(*) as llamadas,
       round(extract(epoch from (max(l.created_at) - min(l.created_at)))::numeric, 1) as seg_entre_primera_y_ultima,
       string_agg(to_char(l.created_at at time zone 'America/Bogota', 'HH24:MI:SS.MS') || ' → ' || l.lineas
                  || ' (' || l.monto || ')', '  |  ' order by l.created_at) as detalle_por_llamada,
       o.total,
       sum(l.monto) as sum_items,
       (select coalesce(sum(p.amount), 0) from public.payments p where p.order_id = o.id) as pagos,
       (select count(*) from public.stock_movements sm where sm.reference_id = o.id) as movs_stock,
       pr.full_name as creo
  from pos o
  join llamadas l on l.order_id = o.id
  left join public.profiles pr on pr.id = o.created_by
 group by o.organizacion, o.order_number, o.id, o.created_at, o.status, o.cancelled_at, o.total, pr.full_name
having count(*) > 1
 order by o.organizacion, o.created_at;


-- ── 2. MESAS: tandas idénticas repetidas con hasta 60 s ──────────────────────
with params as (
  select ((now() at time zone 'America/Bogota')::date - 60)::timestamp at time zone 'America/Bogota' as desde
),
orgs as (
  select id, name from public.organizations
   where id <> 'f4fa692d-6cf3-43fb-a17f-18b8b163c918'               -- LAB
     and coalesce((config ->> 'es_laboratorio')::boolean, false) = false
),
mesa as (
  select o.*, org.name as organizacion
    from public.orders o
    join public.restaurants r on r.id = o.restaurant_id
    join orgs org on org.id = r.organization_id, params p
   where o.table_id is not null and o.created_at >= p.desde
),
linea as (
  select i.order_id, i.created_at,
         i.product_id::text || '|' || i.qty || '|' || i.unit_price || '|' || coalesce(i.notes, '') || '|'
           || coalesce(i.modifiers::text, '') || '|'
           || coalesce((select string_agg(e.extra_id::text || 'x' || e.qty || '@' || e.unit_price, ',' order by e.extra_id, e.qty)
                          from public.order_item_extras e where e.order_item_id = i.id), '') as firma_linea,
         pd.name || ' ×' || i.qty || ' @' || i.unit_price as texto,
         i.qty * i.unit_price as monto
    from public.order_items i join public.products pd on pd.id = i.product_id
   where i.order_id in (select id from mesa)
),
tanda as (
  select order_id, created_at,
         string_agg(firma_linea, ';' order by firma_linea) as firma,
         string_agg(texto, ' + ' order by texto) as lineas,
         sum(monto) as monto
    from linea group by order_id, created_at
)
select m.organizacion, m.order_number, m.id,
       (a.created_at at time zone 'America/Bogota')::timestamp(3) as tanda_a_bogota,
       (b.created_at at time zone 'America/Bogota')::timestamp(3) as tanda_b_bogota,
       round(extract(epoch from (b.created_at - a.created_at))::numeric, 1) as seg_entre,
       a.lineas, a.monto as monto_tanda,
       m.status::text as status, m.total,
       (select sum(qty * unit_price) from public.order_items where order_id = m.id) as sum_items,
       (select coalesce(sum(p.amount), 0) from public.payments p where p.order_id = m.id) as pagos
  from tanda a
  join tanda b on b.order_id = a.order_id and b.firma = a.firma
              and b.created_at > a.created_at and b.created_at - a.created_at <= interval '60 seconds'
  join mesa m on m.id = a.order_id
 order by m.organizacion, a.created_at;

-- CÓMO LEERLO:
--   · Bloque 1: CONTROL. Hasta la limpieza del 2026-10-04, la #2945 de G-10
--     aparecía (2 llamadas a 19,5 s); limpia, ya no. Para validar el detector
--     después de eso, usar un caso conocido de la ventana o el fixture de Docker.
--   · total = monto de UNA llamada y pagos = total ⇒ se cobró bien; la llamada de
--     más infla el reporte de productos y, si tiene receta, descontó stock de más.
--   · Bloque 2: en mesas el total lo suma el cliente una vez por tanda, así que
--     total < sum_items es la marca de la tanda reenviada.
