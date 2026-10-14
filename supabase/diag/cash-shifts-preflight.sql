-- supabase/diag/cash-shifts-preflight.sql — SOLO LECTURA. Antes y después del Paso 6
-- (fase 2 de D: supabase/close-cash-shift-revoke.sql = fase2-aplicar.sql de la raíz).
--
-- Responde dos cosas en una sola tabla:
--   · La FASE 1 de D (close-cash-shift.sql) y lo que la redefinió después están en prod
--     tal cual (filas 1 a 8). La fase 1 NUNCA quitó el UPDATE de cash_shifts: eso es la
--     fase 2, archivo aparte (ver el encabezado de close-cash-shift.sql, punto 2).
--   · El estado del UPDATE directo sobre cash_shifts (filas 9 a 11).
-- Los md5 esperados son los de la última definición de cada función (el mapa GANA de
-- scripts/capturas/preparar-local.mjs), medidos en la base local el 2026-10-13.

select n, que, actual,
       antes_paso_6, (actual = antes_paso_6) as como_antes,
       despues_paso_6, (actual = despues_paso_6) as como_despues
  from (
  -- Encendido Y con su definición completa (eventos INSERT, UPDATE y DELETE: el DELETE lo agregó
  -- 3339978). md5 de pg_get_triggerdef medido en la base local el 2026-10-14.
  select 1 as n, 'fase 1: trigger trg_cash_movements_turno_abierto (encendido · md5 de su definición)' as que,
         coalesce((select case tgenabled when 'O' then 'activo' else 'estado ' || tgenabled::text end
                          || ' · ' || md5(pg_get_triggerdef(oid)) from pg_trigger
                    where tgname = 'trg_cash_movements_turno_abierto' and tgrelid = 'public.cash_movements'::regclass), 'NO EXISTE') as actual,
         'activo · 2bbb6d7622ed006fd5f07983a25c5eb3' as antes_paso_6, 'activo · 2bbb6d7622ed006fd5f07983a25c5eb3' as despues_paso_6
  union all
  select 2, 'fase 1: md5 de enforce_cash_movement_turno_abierto',
         coalesce((select md5(regexp_replace(regexp_replace(pg_get_functiondef(p.oid), E'\r','','g'), E'[ \t]+\n', E'\n','g'))
                     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'enforce_cash_movement_turno_abierto'), 'NO EXISTE'),
         '2df4f0aafd265636a8faf8ee597895d3', '2df4f0aafd265636a8faf8ee597895d3'
  union all
  select 3, 'fase 1: enforce_… ejecutable por anon / authenticated',
         coalesce((select has_function_privilege('anon', p.oid, 'EXECUTE') || ' / ' || has_function_privilege('authenticated', p.oid, 'EXECUTE')
                     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'enforce_cash_movement_turno_abierto'), 'NO EXISTE'),
         'false / false', 'false / false'
  union all
  select 4, 'close_cash_shift ejecutable por anon / authenticated',
         coalesce((select has_function_privilege('anon', p.oid, 'EXECUTE') || ' / ' || has_function_privilege('authenticated', p.oid, 'EXECUTE')
                     from pg_proc p where p.oid = to_regprocedure('public.close_cash_shift(uuid,jsonb,text)')), 'NO EXISTE'),
         'false / true', 'false / true'
  union all
  select 5, 'md5 de close_cash_shift (la del arqueo, arqueo-abonos.sql)',
         coalesce((select md5(regexp_replace(regexp_replace(pg_get_functiondef(p.oid), E'\r','','g'), E'[ \t]+\n', E'\n','g'))
                     from pg_proc p where p.oid = to_regprocedure('public.close_cash_shift(uuid,jsonb,text)')), 'NO EXISTE'),
         'a395c0a1f04cf6405c461887f508115f', 'a395c0a1f04cf6405c461887f508115f'
  union all
  select 6, 'md5 de register_debt_payment (toma el turno for share; arqueo-abonos.sql)',
         coalesce((select md5(regexp_replace(regexp_replace(pg_get_functiondef(p.oid), E'\r','','g'), E'[ \t]+\n', E'\n','g'))
                     from pg_proc p where p.oid = to_regprocedure('public.register_debt_payment(uuid,numeric,text)')), 'NO EXISTE'),
         'e75fd428dc199fa4f92b72040c5bd9fa', 'e75fd428dc199fa4f92b72040c5bd9fa'
  union all
  select 7, 'md5 de register_debt_payments_batch (for share; arqueo-abonos.sql)',
         coalesce((select md5(regexp_replace(regexp_replace(pg_get_functiondef(p.oid), E'\r','','g'), E'[ \t]+\n', E'\n','g'))
                     from pg_proc p where p.oid = to_regprocedure('public.register_debt_payments_batch(uuid[],numeric,text)')), 'NO EXISTE'),
         'e9c9743ce3d37d3194515eca343ea750', 'e9c9743ce3d37d3194515eca343ea750'
  union all
  select 8, 'md5 de register_sale_void (for share; mesas-servidor.sql)',
         coalesce((select md5(regexp_replace(regexp_replace(pg_get_functiondef(p.oid), E'\r','','g'), E'[ \t]+\n', E'\n','g'))
                     from pg_proc p where p.oid = to_regprocedure('public.register_sale_void(uuid,text)')), 'NO EXISTE'),
         'f23b1a71764f6a37acfac373d0f65dbe', 'f23b1a71764f6a37acfac373d0f65dbe'
  union all
  -- has_any_column_privilege: también ve un UPDATE por columna (has_table_privilege no).
  select 9, 'anon con UPDATE en cash_shifts, de tabla o por columna (lo cerró P0.2)',
         has_any_column_privilege('anon', 'public.cash_shifts', 'UPDATE')::text,
         'false', 'false'
  union all
  select 10, 'authenticated con UPDATE en cash_shifts, de tabla o por columna (lo cierra el Paso 6)',
         has_any_column_privilege('authenticated', 'public.cash_shifts', 'UPDATE')::text,
         'true', 'false'
  union all
  select 11, 'políticas de cash_shifts',
         coalesce((select string_agg(policyname || ' (' || cmd || ')', ', ' order by policyname) from pg_policies
                    where schemaname = 'public' and tablename = 'cash_shifts'), '(ninguna)'),
         'cash_shifts: cajero/admin abre turno (INSERT), cash_shifts: cajero/admin cierra turno (UPDATE), cash_shifts: ver del restaurante (SELECT)',
         'cash_shifts: cajero/admin abre turno (INSERT), cash_shifts: ver del restaurante (SELECT)'
) t
order by n;
-- Lectura:
--   ANTES del Paso 6: como_antes = t en las 11 filas.
--   DESPUÉS:          como_despues = t en las 11 filas.
--   Una fila de 1 a 9 en f (antes o después) es una diferencia con el repo que el Paso 6 no
--   arregla: parar y mirarla antes de seguir.
--   Fila 11 en f en LAS DOS columnas (ni las 3 políticas de antes ni las 2 de después): hay una
--   política de más o de menos en cash_shifts. Parar: el Paso 6 no la toca y la reversa recrearía
--   la de UPDATE encima de lo que haya.
--   La fila 11 compara nombre y comando de cada política, no su texto (USING / WITH CHECK).
