-- ============================================================
-- G-Vento — Blindaje del rol OWNER + invariante del comodín '*' (nivel BD)
--
-- Del diagnóstico: la RLS de public.roles permite UPDATE/DELETE de cualquier
-- rol de la org a quien tenga 'roles.gestionar' (no mira is_system). Dos huecos:
--   (1) editar/borrar el rol OWNER (ancla de recuperación, comodín '*').
--   (2) "mint": crear un rol nuevo con '*' o agregar '*' a un rol, escalando a
--       acceso total. La UI nunca asigna '*', pero la API es directa.
--
-- Fix: trigger BEFORE INSERT OR UPDATE OR DELETE en public.roles, acotado a
-- usuarios reales (current_user = 'authenticated'). Dos ramas:
--   Rama 1 (proteger owner): UPDATE/DELETE de una fila con OLD.permissions @> '*'
--           -> rechazado. El owner es inmutable e imborrable desde la app.
--   Rama 2 (anti-mint): INSERT/UPDATE cuyo NEW.permissions @> '*' -> rechazado.
--           Ningun rol nuevo puede nacer con '*'; a ninguno se le puede agregar.
--   Combinadas garantizan la invariante: SOLO la fila del owner de sistema
--   (creada por seed/servicio) tiene '*', y esta protegida de cambios.
--
-- CLAVE - no romper seeds: lab-seed y multi-tenant CREAN/upsertean el owner con
-- '["*"]' corriendo como postgres/service_role (NO authenticated), asi que el
-- trigger se salta por completo para ellos. La RLS ya limita toda escritura de
-- roles a 'authenticated', que es el unico vector a blindar.
--
-- Ejecutar en: Supabase Dashboard > SQL Editor. Migracion NUEVA.
-- ============================================================

begin;

create or replace function public.protect_owner_role()
returns trigger
language plpgsql
as $$
begin
  -- Solo aplica a usuarios reales (PostgREST hace SET ROLE authenticated).
  -- Seeds/servicio (postgres, service_role) pasan sin restriccion.
  if current_user = 'authenticated' then

    -- Rama 1 - el owner (fila con '*') no se edita ni se elimina.
    if tg_op in ('UPDATE', 'DELETE')
       and coalesce(old.permissions, '[]'::jsonb) @> '["*"]'::jsonb then
      raise exception 'El rol propietario no puede editarse ni eliminarse'
        using errcode = 'check_violation';
    end if;

    -- Rama 2 - nadie puede crear un rol con '*' ni agregarle '*' a uno.
    if tg_op in ('INSERT', 'UPDATE')
       and coalesce(new.permissions, '[]'::jsonb) @> '["*"]'::jsonb then
      raise exception 'No se puede asignar el permiso comodin "*" a un rol'
        using errcode = 'check_violation';
    end if;

  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_owner_role on public.roles;
create trigger trg_protect_owner_role
  before insert or update or delete on public.roles
  for each row execute function public.protect_owner_role();

commit;

-- ============================================================
-- VERIFICACION (transaccion con ROLLBACK - no cambia nada).
--   A) authenticated (admin real) edita el owner        -> BLOQUEADO (rama 1)
--   B) authenticated crea un rol nuevo con '*'           -> BLOQUEADO (rama 2)
--   C) authenticated agrega '*' a un rol no-owner        -> BLOQUEADO (rama 2)
--   D) postgres (seed) inserta un rol con '*'            -> PASA (seeds intactos)
-- Esperado en los NOTICE: A=t, B=t, C=t, D=t.
-- ============================================================
begin;
do $$
declare
  v_owner_role uuid;
  v_org        uuid;
  v_admin_role uuid;
  v_admin_uid  uuid;
  a_blocked boolean := false;
  b_blocked boolean := false;
  c_blocked boolean := false;
  d_passed  boolean := false;
begin
  select id, organization_id into v_owner_role, v_org
    from public.roles where permissions @> '["*"]'::jsonb limit 1;

  select r.id, p.id into v_admin_role, v_admin_uid
    from public.profiles p
    join public.roles r on r.id = p.role_id
   where p.organization_id = v_org
     and r.permissions ? 'roles.gestionar'
   limit 1;

  if v_admin_uid is null then
    raise notice 'Sin admin con roles.gestionar en la org del owner; test A-C omitido';
  else
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_admin_uid, 'role', 'authenticated')::text, true);
    set local role authenticated;

    begin  -- A: editar owner
      update public.roles set permissions = '[]'::jsonb where id = v_owner_role;
    exception when others then a_blocked := true; end;

    begin  -- B: crear rol nuevo con '*'
      insert into public.roles (organization_id, name, is_system, permissions)
      values (v_org, '__mint_test__', false, '["*"]'::jsonb);
    exception when others then b_blocked := true; end;

    begin  -- C: agregar '*' a un rol no-owner (el admin)
      update public.roles set permissions = permissions || '["*"]'::jsonb
       where id = v_admin_role;
    exception when others then c_blocked := true; end;

    reset role;  -- volver a postgres
  end if;

  begin  -- D: seed (postgres) inserta un rol con '*' -> debe pasar
    insert into public.roles (organization_id, name, is_system, permissions)
    values (v_org, '__seed_test__', true, '["*"]'::jsonb);
    d_passed := true;
  exception when others then d_passed := false; end;

  raise notice 'A editar-owner bloqueado: %  | B mint-insert bloqueado: %  | C mint-update bloqueado: %  | D seed-insert pasa: %',
    a_blocked, b_blocked, c_blocked, d_passed;
end $$;
rollback;
