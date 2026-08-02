-- ============================================================
-- G-Vento — FIX: enforce_profile_organization debe ser SECURITY DEFINER
--
-- Migracion NUEVA. No edita profiles-organization-invariant.sql (ya aplicada).
--
-- ── SINTOMA ────────────────────────────────────────────────────────────────
-- Un usuario DESACTIVADO que actualiza su propio profile recibe
--     'profiles.restaurant_id (<uuid>) no corresponde a ninguna sede'
-- sobre una sede que SI EXISTE. Detectado por tests/rbac-escalada.spec.ts, caso
-- "un usuario desactivado NO puede auto-reactivarse": esperaba el mensaje del
-- trigger de escalada y recibio el del invariante de organizacion.
--
-- ── CAUSA RAIZ ─────────────────────────────────────────────────────────────
-- enforce_profile_organization() se creo SIN security definer, asi que corre
-- con los privilegios del usuario que dispara el UPDATE y su
--     select r.organization_id from public.restaurants r where r.id = ...
-- PASA POR RLS. Las dos policies de SELECT de restaurants son:
--     "restaurants: ver el propio"    using (id = get_my_restaurant_id())
--     "restaurants: ver las de la org" using (organization_id = get_my_organization_id())
-- Tras el endurecimiento de is_active (profiles-is-active-enforced.sql), un
-- usuario desactivado obtiene NULL de AMBAS funciones -> no ve ninguna sede ->
-- la subconsulta no encuentra fila -> `if not found` -> raise.
--
-- El invariante estaba evaluando DATOS FILTRADOS POR QUIEN MIRA en vez de los
-- datos reales. Un invariante de datos no puede depender de la visibilidad del
-- observador: la organizacion de una sede es la misma la mire quien la mire.
--
-- ── ALCANCE (medido, no supuesto) ──────────────────────────────────────────
-- El modo de fallo es FAIL-CLOSED: rechaza de mas, nunca de menos. No abre
-- ningun bypass ni permite violar el invariante. Ningun flujo legitimo esta
-- roto hoy: un usuario ACTIVO ve todas las sedes de su organizacion por
-- "restaurants: ver las de la org", asi que el cambio de sede activa, la
-- edicion de perfiles ajenos por un admin y la asignacion de rol funcionan.
-- Lo que falla es el caso del desactivado (que igual debe quedar bloqueado,
-- pero por el trigger de escalada y con SU mensaje) y, sobre todo, queda una
-- bomba de tiempo: cualquier ajuste futuro a las policies de restaurants
-- empezaria a rechazar updates de perfiles validos con un mensaje que apunta
-- al lugar equivocado.
--
-- ── FIX ────────────────────────────────────────────────────────────────────
-- security definer + revoke execute (regla dura del repo: Postgres concede
-- EXECUTE a PUBLIC por defecto). Mismo patron que get_my_restaurant_id /
-- get_my_role / has_permission, que leen tablas con RLS por la misma razon.
-- El cuerpo NO cambia: mismas 3 guardas, misma semantica de validacion.
--
-- Es una funcion de TRIGGER: no la invoca nadie directamente, pero el revoke
-- va igual por higiene y consistencia con security-definer-revoke.sql.
--
-- Ejecutar en: Supabase Dashboard > SQL Editor. Migracion NUEVA.
-- ============================================================

begin;

create or replace function public.enforce_profile_organization()
returns trigger
language plpgsql
security definer                    -- <<< el fix: leer restaurants sin RLS
set search_path = public
as $$
declare
  v_org uuid;
begin
  select r.organization_id into v_org
    from public.restaurants r
   where r.id = new.restaurant_id;

  if not found then
    raise exception
      'profiles.restaurant_id (%) no corresponde a ninguna sede', new.restaurant_id
      using errcode = 'check_violation';
  end if;

  if v_org is null then
    raise exception
      'la sede % no tiene organizacion asignada', new.restaurant_id
      using errcode = 'check_violation';
  end if;

  if new.organization_id is distinct from v_org then
    raise exception
      'profiles.organization_id (%) no corresponde a la organizacion de su sede (%)',
      new.organization_id, v_org
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_profile_organization() from public;
revoke execute on function public.enforce_profile_organization() from anon;

commit;

-- El trigger trg_profiles_org_consistency NO se recrea: apunta a la funcion por
-- nombre y `create or replace function` conserva el vinculo.

-- ============================================================
-- VERIFICACION (read-only) — prosecdef debe ser true.
-- ============================================================
select p.proname,
       p.prosecdef as security_definer,
       pg_get_functiondef(p.oid) as cuerpo
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname = 'enforce_profile_organization';

-- El trigger sigue en pie y en el mismo orden de disparo.
select tgname, pg_get_triggerdef(oid) as definicion
  from pg_trigger
 where tgrelid = 'public.profiles'::regclass
   and not tgisinternal
 order by tgname;

-- ============================================================
-- PRUEBA: tras aplicar, correr
--     npx playwright test rbac-escalada
-- El caso "un usuario desactivado NO puede auto-reactivarse" debe volver a
-- recibir 'No podes activar ni desactivar tu propio usuario' (el invariante
-- deja pasar porque la organizacion coincide, y contesta el trigger de
-- escalada, que es el que corresponde). Los 8 en verde.
-- ============================================================
