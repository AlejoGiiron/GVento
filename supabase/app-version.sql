-- supabase/app-version.sql
-- ============================================================================
-- QUÉ HACE: cada equipo reporta qué versión de la app tiene cargada, para poder
-- saber DESDE FUERA (SQL Editor) qué celular o computador sigue con una versión
-- vieja. Motivo: después del release del 2026-10-01, un equipo de G-10 siguió
-- 3 días cerrando turno con el código viejo y no había forma de saber cuál.
--
--   · public.app_versiones: una fila por (usuario, equipo). "Equipo" es un id
--     aleatorio que el navegador guarda en localStorage. Guarda la versión, la sede
--     activa, el navegador (user agent) y cuándo se vio por primera y última vez.
--   · public.marcar_version(p_version, p_equipo, p_user_agent): la app la llama al
--     cargar y al volver a primer plano (src/hooks/useMarcarVersion.ts). Escribe
--     SOLO la fila del usuario que llama (auth.uid()).
--
-- ACCESO: SOLO por la RPC. La tabla tiene RLS activa y NINGUNA policy, y se le
-- revocan los privilegios a anon y authenticated: nadie la lee ni la escribe
-- directo desde la app. Se consulta desde el SQL Editor (postgres).
-- LO QUE NO RESUELVE: un equipo con una versión ANTERIOR a esta no llama a la RPC,
-- así que no aparece. Su ausencia es la señal: un usuario que vende y no figura
-- (o figura con una versión vieja) tiene un equipo sin recargar.
--
-- FRONTEND: es aditiva; el frontend actual no la llama y no le afecta. Aplicar
-- ANTES del frontend que la llama (si no, la app ignora el error: es telemetría).
-- RE-APLICAR: idempotente (if not exists, create or replace). En una transacción.
--
-- NO DEDUZCAS EL ESTADO DE ESTE COMENTARIO — correlo:
--   select to_regclass('public.app_versiones') is not null as tabla,
--          exists (select 1 from pg_proc where proname = 'marcar_version') as rpc;  -- t, t
--
-- CONSULTA para ver qué versión tiene cada equipo:
--   select org.name as organizacion, r.name as sede, p.full_name as usuario,
--          v.version, (v.ultima_vez at time zone 'America/Bogota')::timestamp(0) as ultima_vez_bogota,
--          left(v.equipo, 8) as equipo, v.user_agent
--     from public.app_versiones v
--     join public.profiles p on p.id = v.user_id
--     left join public.restaurants r on r.id = v.restaurant_id
--     left join public.organizations org on org.id = r.organization_id
--    order by v.ultima_vez desc;
-- ============================================================================

begin;

create table if not exists public.app_versiones (
  user_id       uuid        not null references auth.users(id) on delete cascade,
  equipo        text        not null check (length(equipo) between 8 and 64),
  version       text        not null check (length(version) between 1 and 40),
  restaurant_id uuid        references public.restaurants(id) on delete set null,
  user_agent    text        check (length(user_agent) <= 300),
  primera_vez   timestamptz not null default now(),
  ultima_vez    timestamptz not null default now(),
  primary key (user_id, equipo)
);

alter table public.app_versiones enable row level security;
-- Sin policies a propósito: solo se accede por marcar_version (SECURITY DEFINER).
revoke all on table public.app_versiones from anon, authenticated;

create or replace function public.marcar_version(p_version text, p_equipo text, p_user_agent text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;                                    -- sin sesión: nada que marcar
  end if;
  insert into public.app_versiones as v (user_id, equipo, version, restaurant_id, user_agent)
  values (auth.uid(), left(p_equipo, 64), left(p_version, 40), get_my_restaurant_id(), left(p_user_agent, 300))
  on conflict (user_id, equipo) do update
     set version       = excluded.version,
         restaurant_id = excluded.restaurant_id,
         user_agent    = excluded.user_agent,
         ultima_vez    = now();
end;
$$;

revoke execute on function public.marcar_version(text, text, text) from public, anon;
grant  execute on function public.marcar_version(text, text, text) to authenticated;

commit;
