-- supabase/diag/numeracion-duplicados.sql
-- ============================================================================
-- DIAGNÓSTICO de SOLO LECTURA (no es migración). Precondición para proponer un
-- `unique (restaurant_id, order_number)` en orders: si hay duplicados, el
-- `create unique index` falla, así que el número tiene que conocerse ANTES.
--
-- QUÉ ESCRIBE: nada (solo select). RE-EJECUTAR: inofensivo.
-- ALCANCE: todas las organizaciones (lectura). Se enumera ARRANCANDO DE
--   `organizations` con left join, para que una org sin órdenes aparezca con 0
--   en vez de desaparecer (caso #12: LabCentro no salió porque la query arrancaba
--   de una tabla hija).
-- ============================================================================


-- ── (a) Índices y constraints de orders que incluyen order_number ──────────
--    Buscado por la COLUMNA en el catálogo (attnum en indkey/conkey), no por un
--    nombre de índice supuesto (R2 / caso #15).
select 'index' as tipo,
       i.indexrelid::regclass::text as nombre,
       i.indisunique               as es_unique,
       pg_get_indexdef(i.indexrelid) as definicion
  from pg_index i
  join pg_attribute a
    on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
 where i.indrelid = 'public.orders'::regclass
   and a.attname  = 'order_number'
union all
select 'constraint', c.conname, c.contype = 'u', pg_get_constraintdef(c.oid)
  from pg_constraint c
  join pg_attribute a
    on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
 where c.conrelid = 'public.orders'::regclass
   and a.attname  = 'order_number';
-- ESPERADO (según el repo, order-numbering.sql): UNA fila,
--   index | idx_orders_restaurant_order_number | es_unique=false
-- Si aparece alguna con es_unique=true, el UNIQUE YA existe y (b) debería dar 0.


-- ── (b) Duplicados de (restaurant_id, order_number), por organización ──────
with dup as (
  select o.restaurant_id, o.order_number, count(*) as n
    from public.orders o
   where o.order_number is not null
   group by o.restaurant_id, o.order_number
  having count(*) > 1
),
por_org as (
  select r.organization_id,
         count(d.order_number)            as numeros_repetidos,
         coalesce(sum(d.n), 0)            as ordenes_involucradas
    from public.restaurants r
    left join dup d on d.restaurant_id = r.id
   group by r.organization_id
),
sin_numero as (
  select r.organization_id,
         count(o.id) filter (where o.order_number is null
                               and o.payment_status = 'paid'
                               and exists (select 1 from public.payments p where p.order_id = o.id))
           as cobradas_sin_numero
    from public.restaurants r
    left join public.orders o on o.restaurant_id = r.id
   group by r.organization_id
)
select org.name                                   as organizacion,
       coalesce(p.numeros_repetidos, 0)           as numeros_repetidos,
       coalesce(p.ordenes_involucradas, 0)        as ordenes_involucradas,
       coalesce(s.cobradas_sin_numero, 0)         as cobradas_sin_numero
  from public.organizations org
  left join por_org    p on p.organization_id = org.id
  left join sin_numero s on s.organization_id = org.id
 order by org.created_at;

-- CÓMO LEERLO:
--   · Tienen que salir las CINCO organizaciones (G-10, Salchimelo, Café Aroma,
--     LAB, LabCentro). LabCentro con ceros: no tiene sede. Si falta alguna, la
--     query está mal — no la uses como evidencia.
--   · numeros_repetidos = 0 en TODAS ⇒ el unique se puede crear directo.
--   · numeros_repetidos > 0 en alguna ⇒ NO se puede crear el unique sin decidir
--     antes qué hacer con esas filas. Correr el detalle de abajo para verlas.
--   · cobradas_sin_numero: informativo. Son ventas cobradas que quedaron sin
--     número (la ventana de la "opción C" en supabase-helpers). El unique no las
--     afecta (NULL no choca), pero mide si esa ventana ocurre en la realidad.

-- Detalle (solo si alguna org tiene numeros_repetidos > 0):
-- select org.name, r.name as sede, o.order_number, count(*) as n,
--        min(o.created_at) as primera, max(o.created_at) as ultima,
--        string_agg(o.status::text || '/' || o.payment_status, ', ') as estados
--   from public.orders o
--   join public.restaurants r   on r.id = o.restaurant_id
--   join public.organizations org on org.id = r.organization_id
--  where o.order_number is not null
--  group by org.name, r.name, o.restaurant_id, o.order_number
-- having count(*) > 1
--  order by org.name, o.order_number;
