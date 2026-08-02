-- ============================================================
-- G-Vento — PRIORIDAD 2: hacer efectivo profiles.is_active
--
-- ⚠️  NO APLICAR sin haber corrido antes la VERIFICACION 2 (ver abajo) y
--     SIN haber aplicado protect-profile-self-escalation.sql.
--     Sin la Prioridad 1, el propio usuario desactivado revierte su is_active
--     con un solo UPDATE y este filtro no sirve de nada.
--
-- Del diagnostico: is_active existe desde config-profile-active.sql pero NINGUNA
-- policy, funcion ni trigger la consulta. Es una columna decorativa: desactivar
-- a alguien escribe el flag y nada mas. Conserva sede, rol enum y TODOS sus
-- permisos RBAC a nivel RLS.
--
-- Fix: agregar el filtro a las 4 funciones que gobiernan la RLS. Al quedar
-- is_active = false:
--   · has_permission(perm)       -> false para todo permiso => gates RBAC cerrados
--   · get_my_restaurant_id()     -> null => `restaurant_id = null` es NULL, no TRUE
--                                   => cero filas en toda la RLS por sede
--   · get_my_role()              -> null => gates legacy in ('admin','cashier') falsos
--   · get_my_organization_id()   -> null => cierra organizations, roles y las
--                                   policies de user_stores que cuelgan de la org
--
-- get_my_organization_id() entra por decision explicita: los datos operativos ya
-- los cierra get_my_restaurant_id(), pero sin este filtro un desactivado sigue
-- leyendo `roles` de su org — y los UUID de rol son justamente la materia prima
-- de la escalada que tapa protect-profile-self-escalation.sql. Se cierra el
-- vector completo en una sola pasada.
--
-- Un desactivado queda sin acceso a datos aunque conserve el JWT. El baneo en
-- auth.users y el chequeo en login quedan para la pasada de app (no son SQL).
--
-- Se preservan textualmente: firma, volatilidad (stable), security definer,
-- search_path y los grants. Solo cambia el cuerpo. has_permission se reescribe
-- sobre la version VIGENTE (la de owner-wildcard-permission.sql, con el
-- comodin '*'), NO sobre la original de multi-tenant-rbac.sql.
--
-- Ejecutar en: Supabase Dashboard > SQL Editor. Migracion NUEVA.
-- ============================================================

-- ------------------------------------------------------------
-- VERIFICACION PREVIA OBLIGATORIA (read-only). Correr y LEER antes del begin.
-- Criterio de go/no-go:
--   · is_nullable = 'NO' y column_default = 'true'
--   · la lista de perfiles no-activos esta VACIA (o es exactamente la esperada)
--   · TODA organizacion conserva al menos un owner activo
-- ------------------------------------------------------------
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name = 'profiles' and column_name = 'is_active';

select coalesce(o.name, '(sin org)') as organizacion, r.name as sede,
       p.email, p.full_name, p.is_active, rl.name as rol_rbac
  from public.profiles p
  left join public.organizations o  on o.id  = p.organization_id
  left join public.restaurants   r  on r.id  = p.restaurant_id
  left join public.roles         rl on rl.id = p.role_id
 where p.is_active is distinct from true
 order by 1, p.email;

select coalesce(o.name, '(sin org)') as organizacion,
       count(*) filter (where p.is_active is true) as owners_activos
  from public.profiles p
  join public.roles rl on rl.id = p.role_id and rl.permissions @> '["*"]'::jsonb
  left join public.organizations o on o.id = p.organization_id
 group by 1 order by 1;

-- ------------------------------------------------------------
-- MIGRACION
-- ------------------------------------------------------------

begin;

-- has_permission: version vigente (comodin '*') + filtro is_active.
create or replace function public.has_permission(perm text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    join public.roles r on r.id = p.role_id
    where p.id = auth.uid()
      and p.is_active
      and (r.permissions ? perm or r.permissions ? '*')
  )
$$;

revoke execute on function public.has_permission(text) from public;
revoke execute on function public.has_permission(text) from anon;
grant  execute on function public.has_permission(text) to authenticated;

-- get_my_restaurant_id: null si el usuario esta desactivado.
create or replace function public.get_my_restaurant_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select restaurant_id from public.profiles
   where id = auth.uid() and is_active
$$;

-- get_my_role: null si el usuario esta desactivado.
create or replace function public.get_my_role()
returns public.user_role
language sql stable security definer
set search_path = public
as $$
  select role from public.profiles
   where id = auth.uid() and is_active
$$;

-- get_my_organization_id: null si el usuario esta desactivado.
-- Cierra organizations, roles y las policies de user_stores acotadas por org.
create or replace function public.get_my_organization_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select organization_id from public.profiles
   where id = auth.uid() and is_active
$$;

revoke execute on function public.get_my_organization_id() from public;
revoke execute on function public.get_my_organization_id() from anon;
grant  execute on function public.get_my_organization_id() to authenticated;

commit;

-- ============================================================
-- VERIFICACION POSTERIOR (read-only) — los 4 cuerpos llevan el filtro.
-- ============================================================
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef                                as security_definer,
       p.provolatile                              as volatilidad,
       pg_get_functiondef(p.oid)                  as cuerpo
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('has_permission', 'get_my_restaurant_id',
                     'get_my_role', 'get_my_organization_id')
 order by p.proname;

-- ============================================================
-- ROLLBACK / RECUPERACION DE EMERGENCIA
--
-- Si un owner queda desactivado por accidente, PIERDE el acceso a Configuracion
-- y no puede reactivarse a si mismo (Prioridad 1). La unica salida es el SQL
-- Editor (corre como postgres: ni el trigger ni la RLS aplican):
--
--   update public.profiles set is_active = true where email = '<email>';
--
-- Para revertir la migracion entera, reaplicar los cuerpos previos:
-- has_permission de owner-wildcard-permission.sql y get_my_restaurant_id /
-- get_my_role de schema.sql (lineas 238-252), sin el `and is_active`.
-- ============================================================
