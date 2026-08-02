-- ============================================================
-- G-Vento — organization_id de profiles: fix de raiz + backfill + invariante
--
-- ⚠️  NO APLICAR sin correr antes la VERIFICACION PREVIA (punto 5, abajo).
--
-- ── EL MECANISMO (confirmado leyendo los 3 caminos) ─────────────────────────
-- profiles.organization_id NO SE SETEA EN NINGUN LADO del flujo normal:
--   1. handle_new_user (schema.sql:317) inserta
--        (id, email, full_name, role, restaurant_id)
--      — sin organization_id y sin role_id.
--   2. La Edge Function create-user manda user_metadata
--        { full_name, role, restaurant_id }
--      — tampoco lleva organization_id.
--   3. useUsers.createUserMutation, tras crear, hace UPDATE de role_id
--      UNICAMENTE (useUsers.ts:64).
-- => TODO usuario creado por la UI nace con organization_id NULL. Los perfiles
--    sanos de G-10/Salchimelo/LAB lo tienen porque los sembro onboard-org.sql /
--    multi-tenant-rbac.sql / lab-seed.sql, que si lo escriben explicitamente.
--
-- ── POR QUE ROMPE (y por que se ve como "cuenta rota") ──────────────────────
-- usePermissions lee la fila de `roles` por role_id, y la RLS de roles es
--   "roles: ver los de la org"  using (organization_id = get_my_organization_id())
-- Con organization_id NULL, get_my_organization_id() devuelve NULL, la
-- comparacion da NULL (no TRUE) y la consulta no trae NINGUNA fila => el
-- frontend queda con permissions = [] y can() falso para todo: sidebar vacio y
-- toda ruta con permiso rebota. OJO CON LA ASIMETRIA: has_permission() NO filtra
-- por organizacion (solo profiles JOIN roles por role_id), asi que server-side
-- los permisos SI funcionan. El usuario esta roto en la UI, no en la API.
--
-- ── QUE HACE ESTA MIGRACION ────────────────────────────────────────────────
--   1. FIX DE RAIZ: handle_new_user deriva organization_id de la sede.
--   2. BACKFILL: completa las filas con organization_id NULL.
--   3. INVARIANTE: trigger que exige
--        profiles.organization_id = (organization_id de su restaurant_id)
--
-- El orden importa: el backfill va ANTES del trigger. Con el trigger puesto,
-- una fila con organization_id NULL queda INACTUALIZABLE (cualquier UPDATE
-- sobre ella violaria el invariante), asi que primero se completa y despues se
-- blinda. Todo en una transaccion.
--
-- Ejecutar en: Supabase Dashboard > SQL Editor. Migracion NUEVA.
-- ============================================================


-- ------------------------------------------------------------
-- VERIFICACION PREVIA — read-only. Son TRES queries independientes: el SQL
-- Editor solo muestra la grilla de la ULTIMA, asi que hay que correrlas por
-- separado. Las tres deben leerse antes del begin.
--
-- (A) Perfiles que violan el invariante  → los completa el backfill
-- (B) Sedes SIN organizacion             → BLOQUEANTE, ver nota
-- (C) Perfiles sin role_id               → informativo (punto 6)
-- ------------------------------------------------------------

-- (A) punto 5 — toda fila que hoy viola el invariante: organization_id NULL o
-- distinto del de su sede. Criterio: las unicas filas esperadas son las 2
-- cuentas desactivadas conocidas, ambas en estado 'NULL'. Un MISMATCH seria
-- otra cosa —una fila apuntando a una organizacion que NO es la de su sede— y
-- hay que entenderlo ANTES de aplicar: el backfill lo pisaria sin preguntar.
select coalesce(o.name, '(sin org)')  as org_del_perfil,
       r.name                          as sede,
       ro.name                         as org_de_la_sede,
       p.email,
       p.full_name,
       p.is_active,
       p.role                          as enum_role,
       rl.name                         as rol_rbac,
       case
         when p.organization_id is null                            then 'NULL'
         when p.organization_id is distinct from r.organization_id then 'MISMATCH'
         else 'ok'
       end                             as estado
  from public.profiles p
  join public.restaurants   r  on r.id  = p.restaurant_id
  left join public.organizations o  on o.id  = p.organization_id
  left join public.organizations ro on ro.id = r.organization_id
  left join public.roles         rl on rl.id = p.role_id
 where p.organization_id is null
    or p.organization_id is distinct from r.organization_id
 order by estado, p.email;

-- (B) BLOQUEANTE — sedes sin organizacion. `restaurants.organization_id` es
-- NULLABLE (multi-tenant-rbac.sql:112 lo agrego sin NOT NULL). Si alguna sede
-- la tiene en NULL, tras aplicar el trigger CUALQUIER update sobre los perfiles
-- de esa sede fallaria ('la sede X no tiene organizacion asignada') y el
-- backfill no la arregla: no hay de donde derivarla. Debe devolver 0 FILAS. Si
-- devuelve alguna, hay que asignarle organizacion a esa sede ANTES de aplicar.
select r.id, r.name as sede, r.organization_id,
       (select count(*) from public.profiles p where p.restaurant_id = r.id) as perfiles_afectados
  from public.restaurants r
 where r.organization_id is null
 order by r.name;

-- (C) punto 6 — perfiles SIN role_id (sin ningun permiso: has_permission hace
-- JOIN contra roles). Informativo: esta migracion NO los toca (role_id no es
-- derivable). Sirve para dimensionar el hueco del flujo de 2 pasos.
select coalesce(o.name, '(sin org)') as organizacion, r.name as sede,
       p.email, p.full_name, p.is_active
  from public.profiles p
  join public.restaurants r on r.id = p.restaurant_id
  left join public.organizations o on o.id = p.organization_id
 where p.role_id is null
 order by 1, p.email;


-- ------------------------------------------------------------
-- MIGRACION
-- ------------------------------------------------------------

begin;

-- ============================================================
-- 1. FIX DE RAIZ — handle_new_user deriva organization_id de la sede.
--
-- Se arregla ACA y no en la Edge Function porque cubre TODOS los caminos de
-- creacion: la Edge Function, el Dashboard de Supabase, cualquier signUp y
-- cualquier script futuro. La Edge Function solo cubriria el suyo.
--
-- La funcion es SECURITY DEFINER, asi que el SELECT a restaurants no lo frena
-- la RLS (corre como el owner de la funcion, no como el usuario nuevo — que en
-- ese instante ni siquiera tiene profile).
--
-- DELIBERADO: NO se lee role_id de la metadata. `raw_user_meta_data` es un
-- canal que en un signUp abierto controla el propio usuario; hoy ya se confia
-- para el enum `role` (deuda preexistente, ver CLAUDE.md). Sumar role_id ahi
-- convertiria esa deuda en una escalada directa a owner. El role_id se resuelve
-- server-side en la Edge Function (ver punto 6 del plan).
-- ============================================================

-- FALLA RUIDOSA, NUNCA UN NULL SILENCIOSO. Los 3 modos de fallo se rechazan
-- con mensaje propio en vez de dejar que reviente una constraint desde dentro
-- del trigger con un mensaje ilegible.
--
-- IMPORTANTE — esto NO introduce un modo de fallo nuevo: profiles.restaurant_id
-- ya es NOT NULL (schema.sql:57), asi que HOY crear un usuario desde el
-- Dashboard sin metadata YA aborta la creacion en auth.users (violacion de
-- NOT NULL dentro del trigger AFTER INSERT). No deja un perfil huerfano: no
-- deja nada. Lo unico que cambia es que ahora el error DICE QUE HACER.
--
-- Nota: si la metadata trae un restaurant_id con formato invalido, el cast a
-- uuid revienta antes (22P02 'invalid input syntax for type uuid'). Es un
-- mensaje aceptable y el caso no viene de la app.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid := (new.raw_user_meta_data->>'restaurant_id')::uuid;
  v_org           uuid;
begin
  -- (1) Sin sede en la metadata: es el camino del Dashboard de Supabase.
  if v_restaurant_id is null then
    raise exception using
      errcode = 'check_violation',
      message = 'No se puede crear el perfil: falta restaurant_id en user_metadata',
      hint    = 'Crea el usuario desde Configuracion > Usuarios. Si lo creas desde '
                'el Dashboard de Supabase, agrega en User Metadata: '
                '{"restaurant_id": "<uuid de la sede>", "full_name": "...", "role": "cashier"}';
  end if;

  -- (2) Sede inexistente: hoy reventaria la FK profiles_restaurant_id_fkey con
  --     un mensaje que no dice cual es el problema. Se adelanta el chequeo.
  select r.organization_id into v_org
    from public.restaurants r
   where r.id = v_restaurant_id;

  if not found then
    raise exception using
      errcode = 'check_violation',
      message = format('No se puede crear el perfil: la sede %s no existe', v_restaurant_id);
  end if;

  -- (3) Sede sin organizacion (restaurants.organization_id es NULLABLE). Seria
  --     el unico camino que volveria a producir un profile sin organizacion.
  if v_org is null then
    raise exception using
      errcode = 'check_violation',
      message = format('No se puede crear el perfil: la sede %s no tiene organizacion asignada',
                       v_restaurant_id);
  end if;

  insert into public.profiles
    (id, email, full_name, role, restaurant_id, organization_id)
  values (
    new.id,
    new.email,
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
      split_part(new.email, '@', 1)
    ),
    coalesce(new.raw_user_meta_data->>'role', 'waiter')::public.user_role,
    v_restaurant_id,
    v_org  -- derivado, no recibido: la sede es la fuente de verdad.
  );
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public;
revoke execute on function public.handle_new_user() from anon;


-- ============================================================
-- 2. BACKFILL — completa organization_id derivandolo de la sede.
--
-- Trivial y sin decisiones: restaurant_id es NOT NULL y tiene FK a restaurants,
-- asi que toda fila tiene sede y toda sede tiene organizacion. No se toca
-- role_id (no es derivable: Katherine queda sin rol, esta desactivada).
-- ============================================================

update public.profiles p
   set organization_id = r.organization_id
  from public.restaurants r
 where r.id = p.restaurant_id
   and p.organization_id is distinct from r.organization_id;


-- ============================================================
-- 3. INVARIANTE — profiles.organization_id = organizacion de su sede.
--
-- Por TRIGGER y no por FK compuesta (unique(restaurants.id, organization_id) +
-- FK sobre (restaurant_id, organization_id)): la FK solo muerde con
-- organization_id NOT NULL, y poner NOT NULL sobre una columna con datos vivos
-- de 2 clientes exige un backfill perfecto e irreversible. El trigger da la
-- misma garantia funcional, es reversible (drop trigger) y no cambia el
-- esquema. Si mas adelante se quiere la FK, este trigger habra garantizado que
-- ninguna fila la viole.
--
-- VALIDA, no fuerza. Es deliberado: hace el resultado INDEPENDIENTE DEL ORDEN
-- de disparo respecto de trg_protect_profile_self_escalation. Postgres dispara
-- los BEFORE ROW por orden alfabetico de nombre, y este cae antes
-- ('trg_profiles_...' < 'trg_protect_...'), pero no dependemos de eso:
--   · Cambio de sede DENTRO de la org  -> org coincide  -> pasan los dos.
--   · Cambio de sede a OTRA org (el atacante manda solo restaurant_id):
--       - si valida primero: new.organization_id (la vieja) != org de la sede
--         nueva -> RECHAZA.
--       - si corre primero el de escalada: no ve cambio de organization_id y
--         deja pasar; despues este RECHAZA igual.
--     Bloqueado en ambos ordenes. Si en cambio FORZARA el valor, el segundo
--     orden reescribiria la organizacion en silencio y abriria justo el salto
--     de org que tapa P1.
--
-- NO se acota a current_user = 'authenticated' (a diferencia del trigger de
-- escalada): esto es un invariante de DATOS, no una regla de autorizacion, y
-- debe valer tambien para seeds y service_role. lab-seed / onboard-org /
-- multi-tenant-rbac ya escriben org y sede coherentes -> no se rompen.
-- ============================================================

-- El `if not found` cubre DE UNA los dos bordes: restaurant_id NULL y
-- restaurant_id inexistente. No es codigo muerto disfrazado: expresa "la sede
-- tiene que existir", que es parte del invariante. Y evita la trampa de
-- `NULL is distinct from NULL` = FALSE, que dejaria pasar en silencio una fila
-- sin sede si alguien alguna vez aflojara el NOT NULL de schema.sql:57.
create or replace function public.enforce_profile_organization()
returns trigger
language plpgsql
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

drop trigger if exists trg_profiles_org_consistency on public.profiles;

create trigger trg_profiles_org_consistency
  before insert or update on public.profiles
  for each row execute function public.enforce_profile_organization();

commit;


-- ============================================================
-- VERIFICACION POSTERIOR (read-only)
-- ============================================================

-- a) Cero violaciones del invariante (debe devolver 0 filas).
select p.email, p.organization_id, r.organization_id as org_de_la_sede
  from public.profiles p
  join public.restaurants r on r.id = p.restaurant_id
 where p.organization_id is distinct from r.organization_id;

-- b) Los 2 triggers BEFORE UPDATE conviven, en este orden de disparo.
select tgname, pg_get_triggerdef(oid) as definicion
  from pg_trigger
 where tgrelid = 'public.profiles'::regclass
   and not tgisinternal
 order by tgname;

-- c) handle_new_user ya deriva la organizacion.
select pg_get_functiondef(p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'handle_new_user';

-- ============================================================
-- PRUEBA EMPIRICA del invariante (transaccional, con ROLLBACK).
-- Simula el salto de organizacion via cambio de sede. Reemplazar los UUID.
--
--   begin;
--     update public.profiles
--        set restaurant_id = '<sede de OTRA organizacion>'
--      where id = '<uuid de un profile>';
--     -- esperado: ERROR 'profiles.organization_id (...) no corresponde ...'
--   rollback;
-- ============================================================

-- ============================================================
-- ROLLBACK / REVERSION
--   drop trigger if exists trg_profiles_org_consistency on public.profiles;
--   drop function if exists public.enforce_profile_organization();
--   -- y reaplicar handle_new_user de schema.sql:317 si se quiere el original.
-- El backfill NO se revierte (completa datos, no los destruye).
-- ============================================================
