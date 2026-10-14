-- supabase/diag/arqueo-abonos-preflight.sql — SOLO LECTURA. Correr JUSTO ANTES de
-- supabase/arqueo-abonos.sql, cada consulta por separado. La consulta 1 sirve también como
-- VERIFICACIÓN después de aplicarla. Es la misma que se entregó en el reporte del 2026-10-13.

-- ── Consulta 1: las tres funciones que la migración reemplaza, si authenticated las puede
--    ejecutar, y si la columna debt_payments.shift_id ya existe ──
select 'funcion' as que, p.proname as nombre,
       md5(regexp_replace(regexp_replace(pg_get_functiondef(p.oid), E'\r','','g'), E'[ \t]+\n', E'\n','g')) as estado,
       has_function_privilege('authenticated', p.oid, 'execute')::text as authenticated_ejecuta
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.proname in ('close_cash_shift', 'register_debt_payment', 'register_debt_payments_batch')
union all
select 'columna', 'debt_payments.shift_id',
       coalesce((select data_type from information_schema.columns
                  where table_schema = 'public' and table_name = 'debt_payments' and column_name = 'shift_id'), 'no existe'),
       '—'
 order by 1, 2;
-- ANTES de la migración: close_cash_shift 433e2d781efb73df033b58d549dc3d5b, register_debt_payment
-- f90d210f8f69c53ba809440933f0d29c, register_debt_payments_batch d6d090a2df4e0589d4b279ad3b4742f8,
-- las tres con authenticated_ejecuta = true, y "columna | debt_payments.shift_id | no existe".
-- Si algún md5 difiere, alguien redefinió esa función: no se corre la migración (igual abortaría
-- en su precondición). Si la columna ya existe, la migración ya corrió.
-- DESPUÉS de la migración: a395c0a1f04cf6405c461887f508115f / e75fd428dc199fa4f92b72040c5bd9fa /
-- e9c9743ce3d37d3194515eca343ea750, las tres con true, y "debt_payments.shift_id | uuid".

-- ── Consulta 2: turnos de caja ABIERTOS de G-10 y Salchimelo (por UUID), y cuántos abonos de
--    fiado NO efectivo ya entraron desde que abrieron ──
select org.name as organizacion, s.name as sede, c.id as turno_id,
       (c.opened_at at time zone 'America/Bogota')::timestamp(0) as abrio_bogota,
       (select count(*) from public.debt_payments d
         where d.restaurant_id = c.restaurant_id and d.payment_method <> 'cash'
           and d.created_at >= c.opened_at) as abonos_no_efectivo_desde_que_abrio
  from public.cash_shifts c
  join public.restaurants s     on s.id = c.restaurant_id
  join public.organizations org on org.id = s.organization_id
 where c.closed_at is null
   and org.id in ('12b53bae-a4f7-4076-80f9-8f9288bd0567',   -- G-10
                  '6b35f20d-fa53-47fe-bef0-5817ba6d5725')   -- Salchimelo
 order by 1, 2;
-- Lectura: lo ideal son 0 filas. Un turno abierto durante la migración cierra con la regla nueva,
-- pero sus abonos de ANTES no tienen shift_id y no entran a su esperado (como hoy). Si hay turnos
-- abiertos con abonos_no_efectivo_desde_que_abrio > 0, conviene aplicar con los turnos cerrados.
