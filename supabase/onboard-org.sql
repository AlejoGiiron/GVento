-- ============================================================
-- G-Vento — Onboarding de una ORGANIZACIÓN nueva (cliente nuevo)
--
-- Crea la estructura MÍNIMA para que una org opere, siguiendo el molde
-- de lab-seed.sql pero SIN datos de prueba (catálogo VACÍO: el owner lo
-- carga desde la app). Reutilizable para cada cliente: solo editas el
-- bloque de PARÁMETROS de abajo.
--
-- Qué crea, en orden por las FK:
--   1. organizations                         (la org / tenant raíz)
--   2. restaurants                           (1 sede, organization_id NOT NULL)
--   3. roles                                 (owner/admin/cajero/mozo, POR ORG)
--   4. profiles del owner                    (liga el UID de Auth → org+rol+sede)
--   5. user_stores                           (acceso del owner a la sede)
--   (categorías/productos: NINGUNO — arranca vacío)
--
-- REQUISITOS PREVIOS:
--   • La cuenta Auth del owner ya debe existir en auth.users (la creas en
--     Supabase → Authentication → Users). Este script NO crea cuentas Auth.
--   • Copia su UID a v_owner_uid abajo (Authentication → Users → el usuario).
--
-- IDEMPOTENTE: se puede correr más de una vez sin duplicar (identidad por
-- NOMBRE donde no hay unique; ON CONFLICT donde sí). Re-correrlo COMPLETA
-- un onboarding a medias en vez de fallar.
--
-- GUARD del usuario huérfano: el trigger handle_new_user pudo dejar el
-- profile del owner a medias (o no crearlo) al crear la cuenta Auth sin
-- metadata. El paso 4 usa INSERT ... ON CONFLICT (id) DO UPDATE → si el
-- profile ya existe a medias, lo COMPLETA/corrige; si no existe, lo crea.
--
-- ============================================================
-- REVISAR ANTES DE CONFIRMAR:
--   El SQL Editor corre begin..commit atómico en una sola ejecución, así
--   que no se puede pausar entre la verificación y el commit. Para
--   inspeccionar de verdad ANTES de confirmar:
--     1) cambia el `commit;` del final por `rollback;`
--     2) ejecuta y revisa las grillas de VERIFICACIÓN (org, sede, roles,
--        profile del owner, user_stores)
--     3) si todo cuadra, vuelve a poner `commit;` y ejecuta de nuevo
--        (es idempotente: re-correrlo es seguro).
-- ============================================================

begin;

-- ============================================================
-- PARÁMETROS — EDITAR SOLO ESTO (una vez, aquí).
-- Definidos en una tabla temporal para que TANTO el bloque de mutación
-- COMO la verificación de abajo lean los mismos valores.
-- ============================================================
create temporary table _onboard_params on commit drop as
select
  'Salchimelo'::text                                     as v_org_name,
  'Salchimelo Principal'::text                           as v_sede_name,
  'ca99217e-25e8-458b-bf0c-5002da46d8af'::uuid           as v_owner_uid,
  'is2947499@gmail.com'::text                            as v_owner_email,
  'Owner Salchimelo'::text                               as v_owner_name;


-- ============================================================
-- MUTACIÓN — atómica dentro de la transacción.
-- ============================================================
do $$
declare
  v_org_name    text;
  v_sede_name   text;
  v_owner_uid   uuid;
  v_owner_email text;
  v_owner_name  text;

  v_org         uuid;
  v_sede        uuid;

  v_role_owner  uuid;
  v_role_admin  uuid;
  v_role_cajero uuid;
  v_role_mozo   uuid;
begin
  -- Cargar parámetros
  select p.v_org_name, p.v_sede_name, p.v_owner_uid, p.v_owner_email, p.v_owner_name
    into v_org_name, v_sede_name, v_owner_uid, v_owner_email, v_owner_name
    from _onboard_params p;

  -- Guard: la cuenta Auth debe existir (profiles.id → auth.users FK). Sin
  -- esto el INSERT del profile fallaría con un error críptico de FK.
  if not exists (select 1 from auth.users where id = v_owner_uid) then
    raise exception
      'La cuenta Auth % (%) no existe en auth.users. Créala en Supabase → Authentication → Users y copia su UID a v_owner_uid.',
      v_owner_uid, v_owner_email;
  end if;

  -- ========================================================
  -- 1) organizations — identidad por nombre
  -- ========================================================
  select id into v_org from public.organizations where name = v_org_name limit 1;
  if v_org is null then
    insert into public.organizations (name) values (v_org_name) returning id into v_org;
  end if;

  -- ========================================================
  -- 2) restaurants — 1 sede. uses_kitchen queda en su default (true).
  --    config.cash_out_reasons con una lista razonable por defecto (merge
  --    con || para no pisar otras claves si la sede ya existía).
  -- ========================================================
  select id into v_sede
    from public.restaurants
   where organization_id = v_org and name = v_sede_name limit 1;
  if v_sede is null then
    insert into public.restaurants (organization_id, name)
    values (v_org, v_sede_name)
    returning id into v_sede;
  end if;

  update public.restaurants
     set config = coalesce(config, '{}'::jsonb)
                  || jsonb_build_object('cash_out_reasons', jsonb_build_array(
                       'Compra de insumos', 'Pago a proveedor', 'Retiro de caja',
                       'Servicios', 'Otro'))
   where id = v_sede
     and not (config ? 'cash_out_reasons');   -- no re-pisar si ya los configuraron

  -- ========================================================
  -- 3) roles de sistema — POR ORG (unique organization_id,name).
  --    owner usa el comodín "*" (hereda todo permiso, presente y futuro).
  --    admin/cajero/mozo son explícitos (copiados de lab-seed, incluyen
  --    compras.gestionar y fiado.gestionar). Upsert: reescribe permisos si
  --    el rol ya existía (mantiene la org al día).
  -- ========================================================
  insert into public.roles (organization_id, name, is_system, permissions) values
    (v_org, 'owner', true, '["*"]'::jsonb)
  on conflict (organization_id, name)
    do update set permissions = excluded.permissions, is_system = true
  returning id into v_role_owner;

  insert into public.roles (organization_id, name, is_system, permissions) values
    (v_org, 'admin', true, '[
      "pos.vender","pos.descuento","pos.anular",
      "caja.abrir","caja.cerrar","caja.movimientos",
      "mesas.gestionar","mesas.cobrar","cocina.acceder","delivery.gestionar",
      "productos.ver","productos.editar",
      "reportes.financiero","reportes.stock",
      "config.acceder","usuarios.gestionar","compras.gestionar","fiado.gestionar"
    ]'::jsonb)
  on conflict (organization_id, name)
    do update set permissions = excluded.permissions, is_system = true
  returning id into v_role_admin;

  insert into public.roles (organization_id, name, is_system, permissions) values
    (v_org, 'cajero', true, '[
      "pos.vender","pos.descuento","pos.anular",
      "caja.abrir","caja.cerrar","caja.movimientos",
      "mesas.cobrar","delivery.gestionar","fiado.gestionar"
    ]'::jsonb)
  on conflict (organization_id, name)
    do update set permissions = excluded.permissions, is_system = true
  returning id into v_role_cajero;

  insert into public.roles (organization_id, name, is_system, permissions) values
    (v_org, 'mozo', true, '[
      "pos.vender","mesas.gestionar","cocina.acceder"
    ]'::jsonb)
  on conflict (organization_id, name)
    do update set permissions = excluded.permissions, is_system = true
  returning id into v_role_mozo;

  -- ========================================================
  -- 4) profile del owner — liga el UID de Auth → org + rol owner + sede.
  --    role (enum legacy) = 'admin' (NOT NULL); role_id (RBAC) = owner.
  --    ON CONFLICT (id) DO UPDATE = GUARD del usuario huérfano: completa
  --    un profile dejado a medias por handle_new_user en vez de fallar.
  -- ========================================================
  insert into public.profiles
    (id, email, full_name, role, role_id, organization_id, restaurant_id, is_active)
  values
    (v_owner_uid, v_owner_email, v_owner_name,
     'admin'::public.user_role, v_role_owner, v_org, v_sede, true)
  on conflict (id) do update set
    email           = excluded.email,
    full_name       = excluded.full_name,
    role            = excluded.role,
    role_id         = excluded.role_id,
    organization_id = excluded.organization_id,
    restaurant_id   = excluded.restaurant_id,
    is_active       = true;

  -- ========================================================
  -- 5) user_stores — acceso del owner a la sede (sede activa = restaurant_id
  --    del profile). Sin esto no podría operar/cambiar de sede.
  -- ========================================================
  insert into public.user_stores (user_id, restaurant_id)
  values (v_owner_uid, v_sede)
  on conflict (user_id, restaurant_id) do nothing;

  raise notice 'Onboarding OK — org "%" (%) · sede "%" (%) · owner % (%).',
    v_org_name, v_org, v_sede_name, v_sede, v_owner_email, v_owner_uid;
end $$;


-- ============================================================
-- VERIFICACIÓN (read-only) — corre dentro de la misma transacción,
-- ANTES del commit. Lee los parámetros de _onboard_params (mismos valores
-- que usó la mutación). Revisar estas grillas antes de confirmar.
-- ============================================================

-- 1. Organización + sede (con flag de cocina y config de egresos)
select 'org + sede' as check, o.name as org, r.name as sede,
       r.uses_kitchen, r.config -> 'cash_out_reasons' as cash_out_reasons,
       o.id as organization_id, r.id as restaurant_id
  from _onboard_params p
  join public.organizations o on o.name = p.v_org_name
  join public.restaurants   r on r.organization_id = o.id and r.name = p.v_sede_name;

-- 2. Los 4 roles de sistema de la org, con conteo de permisos.
--    owner debe salir con 1 "permiso" (el comodín "*").
select 'roles' as check, r.name as rol, r.is_system,
       jsonb_array_length(r.permissions) as num_permisos,
       r.permissions
  from _onboard_params p
  join public.organizations o on o.name = p.v_org_name
  join public.roles r on r.organization_id = o.id
 order by (r.name = 'owner') desc, num_permisos desc;

-- 3. Profile del owner: rol RBAC = owner, org y sede activa correctas.
select 'profile owner' as check, pr.email, pr.full_name,
       pr.role as enum_legacy, rl.name as rol_rbac,
       o.name as org, r.name as sede_activa, pr.is_active
  from _onboard_params p
  join public.profiles pr        on pr.id = p.v_owner_uid
  left join public.organizations o on o.id = pr.organization_id
  left join public.roles rl        on rl.id = pr.role_id
  left join public.restaurants r   on r.id = pr.restaurant_id;

-- 4. user_stores del owner (sedes a las que tiene acceso).
select 'user_stores' as check, pr.email, r.name as sede_con_acceso
  from _onboard_params p
  join public.user_stores us  on us.user_id = p.v_owner_uid
  join public.profiles pr     on pr.id = us.user_id
  join public.restaurants r   on r.id = us.restaurant_id
 order by r.name;

-- 5. Catálogo: debe estar VACÍO (0 categorías, 0 productos) al onboardear.
select 'catalogo (debe ser 0/0)' as check,
  (select count(*) from public.categories c
     join public.restaurants r on r.id = c.restaurant_id
     join public.organizations o on o.id = r.organization_id
     join _onboard_params p on p.v_org_name = o.name) as categorias,
  (select count(*) from public.products pr
     join public.restaurants r on r.id = pr.restaurant_id
     join public.organizations o on o.id = r.organization_id
     join _onboard_params p on p.v_org_name = o.name) as productos;


-- Para inspeccionar antes de confirmar: cambia `commit;` por `rollback;`,
-- revisa las grillas, y vuelve a `commit;` (idempotente).
commit;
