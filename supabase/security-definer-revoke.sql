-- ============================================================
-- Auditoría de funciones SECURITY DEFINER — revoke EXECUTE a PUBLIC
--
-- Postgres concede EXECUTE a PUBLIC por defecto en toda función nueva.
-- En funciones SECURITY DEFINER eso permite que cualquier rol (incluido
-- anon) las invoque corriendo con privilegios del owner. Hay que revocar
-- ese permiso y concederlo solo a los roles que realmente lo necesitan.
--
-- Funciones auditadas:
--   public.get_my_restaurant_id()  → usada DENTRO de políticas RLS
--   public.get_my_role()           → usada DENTRO de políticas RLS
--   public.handle_new_user()       → trigger AFTER INSERT en auth.users
--
-- ⚠️  NO EJECUTAR A CIEGAS. Correr primero el PASO 1 (verificación),
--     interpretar el resultado y solo entonces aplicar el PASO 2.
-- ============================================================


-- ============================================================
-- PASO 1 — VERIFICACIÓN (solo lectura): ¿quién tiene EXECUTE hoy?
-- ============================================================
-- proacl NULL  → función sin ACL explícita = PUBLIC tiene EXECUTE (default) → revocar.
-- proacl con un item cuyo grantee está VACÍO antes de '=' (ej: '=X/owner')
--              → PUBLIC tiene EXECUTE explícito → revocar.
-- Si PUBLIC no aparece y solo está 'authenticated=X/...' → ya está correcto.

select
  n.nspname                                   as schema,
  p.proname                                   as function,
  pg_get_function_identity_arguments(p.oid)   as args,
  p.prosecdef                                 as security_definer,
  p.proacl                                    as acl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('get_my_restaurant_id', 'get_my_role', 'handle_new_user')
order by p.proname;

-- Vista alternativa, normalizada, desde information_schema:
select
  routine_name,
  grantee,
  privilege_type,
  is_grantable
from information_schema.routine_privileges
where specific_schema = 'public'
  and routine_name in ('get_my_restaurant_id', 'get_my_role', 'handle_new_user')
order by routine_name, grantee;


-- ============================================================
-- PASO 2 — REVOKE (aplicar solo si el PASO 1 muestra EXECUTE a PUBLIC)
-- ============================================================

-- get_my_restaurant_id() y get_my_role() se evalúan dentro de las políticas
-- RLS, que corren con el rol del usuario que consulta. Postgres SÍ verifica
-- el privilegio EXECUTE en ese contexto, por lo que 'authenticated' DEBE
-- conservar EXECUTE; de lo contrario las políticas fallan con permission denied.
-- Por eso: revocar a PUBLIC + grant explícito a authenticated.

revoke execute on function public.get_my_restaurant_id() from public;
grant  execute on function public.get_my_restaurant_id() to authenticated;

revoke execute on function public.get_my_role() from public;
grant  execute on function public.get_my_role() to authenticated;

-- handle_new_user() es un trigger AFTER INSERT en auth.users. Los triggers
-- NO verifican el privilegio EXECUTE del usuario que dispara el INSERT, así
-- que se puede revocar a PUBLIC sin conceder a ningún rol. Esto impide que
-- alguien la invoque directamente para forjar un profile.

revoke execute on function public.handle_new_user() from public;


-- ============================================================
-- PASO 3 — VERIFICACIÓN POST-CAMBIO (real, no asumir)
-- ============================================================
-- Tras aplicar, confirmar contra datos reales (el SQL no se prueba con tsc):
--   1. Re-correr el PASO 1: PUBLIC ya no debe aparecer; authenticated sí en
--      las dos funciones de RLS.
--   2. Como usuario authenticated, hacer un select sobre cualquier tabla con
--      RLS (ej: select * from products) y confirmar que sigue devolviendo
--      filas — eso prueba que las funciones RLS siguen ejecutables.
--   3. Crear un usuario nuevo vía la Edge Function create-user y confirmar que
--      el trigger sigue creando el profile correctamente.
