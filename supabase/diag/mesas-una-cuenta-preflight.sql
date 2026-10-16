-- supabase/diag/mesas-una-cuenta-preflight.sql — SOLO LECTURA. El ANTES y el DESPUÉS de
-- supabase/mesas-una-cuenta.sql. Corre cada consulta POR SEPARADO (el SQL Editor muestra solo el
-- último resultado).

-- ── ANTES 1: ¿ya está aplicada? Esperado ANTES: f | f | f ──
select to_regprocedure('public.abrir_mesa(uuid,uuid,text)') is not null       as funcion,
       to_regclass('public.orders_una_cuenta_viva_por_mesa') is not null      as indice,
       exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'orders' and column_name = 'open_id') as columna;

-- ── ANTES 2: mesas con más de una cuenta viva. Esperado: 0 (si no, la migración aborta) ──
-- El detalle de cada una: consulta 3 de supabase/diag/mesas-pegadas.sql.
select count(*) as mesas_con_varias_cuentas from (
  select table_id from public.orders
   where table_id is not null and status in ('pending', 'preparing', 'ready')
   group by table_id having count(*) > 1) x;

-- ── DESPUÉS: una fila por pieza. Esperado: ok = true en TODAS ──
select 'índice único y válido' as pieza,
       coalesce((select i.indisunique and i.indisvalid from pg_index i
                  where i.indexrelid = to_regclass('public.orders_una_cuenta_viva_por_mesa')), false) as ok,
       (select pg_get_expr(indpred, indrelid) from pg_index
         where indexrelid = to_regclass('public.orders_una_cuenta_viva_por_mesa')) as detalle
union all
select 'unique orders_open_id_key',
       exists (select 1 from pg_constraint where conname = 'orders_open_id_key'
                and conrelid = 'public.orders'::regclass and contype = 'u'), null
union all
select 'abrir_mesa SECURITY DEFINER + search_path',
       coalesce((select prosecdef and proconfig @> array['search_path=public'] from pg_proc
                  where oid = to_regprocedure('public.abrir_mesa(uuid,uuid,text)')), false),
       (select array_to_string(proconfig, ',') from pg_proc where oid = to_regprocedure('public.abrir_mesa(uuid,uuid,text)'))
union all
select 'abrir_mesa: authenticated SÍ ejecuta',
       coalesce(has_function_privilege('authenticated', to_regprocedure('public.abrir_mesa(uuid,uuid,text)'), 'execute'), false), null
union all
select 'abrir_mesa: anon NO ejecuta',
       not coalesce(has_function_privilege('anon', to_regprocedure('public.abrir_mesa(uuid,uuid,text)'), 'execute'), true), null
union all
select 'ninguna mesa con varias cuentas vivas',
       not exists (select 1 from public.orders where table_id is not null and status in ('pending', 'preparing', 'ready')
                    group by table_id having count(*) > 1), null;
