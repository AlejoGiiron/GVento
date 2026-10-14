-- supabase/diag/arqueo-abonos-preflight.sql — SOLO LECTURA. Correr JUSTO ANTES de
-- supabase/arqueo-abonos.sql, cada consulta por separado.

-- ── Consulta 1: las tres funciones que la migración reemplaza, y si la columna ya existe ──
select 'funcion' as que, p.proname as nombre,
       md5(regexp_replace(regexp_replace(pg_get_functiondef(p.oid), E'\r','','g'), E'[ \t]+\n', E'\n','g')) as estado
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.proname in ('close_cash_shift', 'register_debt_payment', 'register_debt_payments_batch')
union all
select 'columna', 'debt_payments.shift_id',
       coalesce((select data_type from information_schema.columns
                  where table_schema = 'public' and table_name = 'debt_payments' and column_name = 'shift_id'), 'no existe')
 order by 1, 2;
-- Esperado: close_cash_shift 433e2d781efb73df033b58d549dc3d5b, register_debt_payment
-- f90d210f8f69c53ba809440933f0d29c, register_debt_payments_batch d6d090a2df4e0589d4b279ad3b4742f8,
-- y "columna | debt_payments.shift_id | no existe". Si algún md5 difiere, la precondición abortaría:
-- pégame la salida (alguien redefinió esa función en producción).

-- ── Consulta 2: turnos abiertos ahora (la migración no los toca; su cierre ya usará la regla nueva) ──
select s.name as sede, (c.opened_at at time zone 'America/Bogota')::timestamp(0) as abrio
  from public.cash_shifts c
  join public.restaurants s on s.id = c.restaurant_id
 where c.closed_at is null
 order by 1;
-- Lectura: un turno ABIERTO durante la migración cierra con la regla nueva, pero sus abonos de
-- ANTES de la migración no tienen shift_id: no entran a su esperado (como hoy). Si hay turnos
-- abiertos con abonos no efectivo ya cobrados, conviene aplicar con los turnos cerrados.
