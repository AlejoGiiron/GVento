-- ============================================================
-- G-Vento — Onboarding de ORGANIZACIÓN NUEVA · PASO 1 de 3
--            (estructura: organización + sede + roles)
--
-- 🔴 ESTO NO ES UNA MIGRACIÓN. No define ni altera esquema.
--
-- ── POR QUÉ EXISTE (y por qué NO se usa supabase/onboard-org.sql) ───────────
-- `onboard-org.sql` exige que la cuenta de Auth del owner YA EXISTA, y remite
-- a "creala en el Dashboard". Ese camino está ROTO desde
-- profiles-organization-invariant.sql: el trigger handle_new_user ABORTA la
-- creación si `raw_user_meta_data` no trae `restaurant_id`… y para una
-- organización NUEVA todavía no existe ninguna sede cuyo id poner. Deadlock.
--
-- La salida es invertir el orden. Este archivo es el paso 1:
--
--   PASO 1 (este)  SQL Editor  → organización + sede + 4 roles.  SIN profile.
--                                Imprime el restaurant_id de la sede.
--   PASO 2         Auth        → crear la cuenta CON user_metadata
--                                {restaurant_id, role, full_name}. El
--                                procedimiento está en onboard-org-paso3.sql.
--                                handle_new_user crea el profile solo, con
--                                organization_id DERIVADO de la sede.
--   PASO 3         SQL Editor  → onboard-org-paso3.sql: role_id + user_stores.
--
-- ── QUÉ CAMBIA RESPECTO DE onboard-org.sql (además del orden) ───────────────
-- 1. LOS ROLES ESTABAN INCOMPLETOS. `ventas.historial` (order-numbering.sql:113)
--    y `ventas.anular` (sale-void.sql:83) se sembraron con un
--    `update ... where name = 'admin'` de UNA SOLA PASADA sobre las orgs que
--    existían ese día. onboard-org.sql nunca se actualizó ⇒ toda org creada
--    con él nace con un admin que NO ve el Historial de ventas ni puede
--    anular. Lo mismo con `sedes.gestionar`, `roles.gestionar` y
--    `reportes.consolidado`, que están en el catálogo
--    (src/lib/permissions.ts) y en multi-tenant-rbac.sql pero no en
--    onboard-org.sql. Acá los roles se listan CONTRA ese catálogo.
-- 2. `uses_kitchen` es PARÁMETRO, no el default. Un negocio de mostrador
--    (cafetería, coctelería) lo quiere en false para que Cocina desaparezca
--    del sidebar.
--
-- ── IDEMPOTENTE ─────────────────────────────────────────────────────────────
-- Identidad por nombre + on conflict. Re-correrlo completa/corrige en vez de
-- duplicar, y reescribe los permisos de los 4 roles de sistema al día.
--
-- ── ALCANCE ─────────────────────────────────────────────────────────────────
-- ⚠️ BD ÚNICA COMPARTIDA. Toda sentencia se acota a la organización NUEVA que
--    crea este script, resuelta por nombre. No hay un solo UPDATE ni DELETE
--    sin filtro: no puede alcanzar LAB, G-10 ni Salchimelo. En particular NO
--    toca "Sede Lab Norte" (donde corre la suite E2E) ni roles de otra org.
--
-- ── PARA INSPECCIONAR ANTES DE CONFIRMAR ────────────────────────────────────
-- Cambiá el `commit;` del final por `rollback;`, ejecutá, revisá las grillas,
-- y volvé a `commit;` (es idempotente).
--
-- Ejecutar en: Supabase Dashboard > SQL Editor.
-- ============================================================

begin;

-- ============================================================
-- PARÁMETROS — EDITAR SOLO ESTO.
-- ============================================================
create temporary table _params on commit drop as
select
  'Café Aroma'::text                   as v_org_name,
  'Café Aroma'::text                   as v_sede_name,  -- mostrador = 1 sede: mismo nombre
  false                                as v_uses_kitchen,
  -- Dirección y teléfono SALEN IMPRESOS EN EL TICKET (printSaleTicket lee la
  -- fila `restaurants`). Estos son inventados: cambialos por algo que no
  -- desentone si el dueño mira el recibo de cerca.
  'Cra. 70 # 44-18, Laureles'::text     as v_address,
  '604 448 2210'::text                  as v_phone;


do $$
declare
  v_org_name  text;  v_sede_name text;  v_uses_kitchen boolean;
  v_address   text;  v_phone     text;
  v_org uuid;  v_sede uuid;
begin
  select p.v_org_name, p.v_sede_name, p.v_uses_kitchen, p.v_address, p.v_phone
    into v_org_name, v_sede_name, v_uses_kitchen, v_address, v_phone
    from _params p;

  -- Guard del placeholder: falla RUIDOSO si alguien corre el script sin editar
  -- los parámetros. Sin esto quedaría una organización basura con ese nombre, y
  -- como `organizations.name` tiene UNIQUE, la corrida "buena" posterior NO la
  -- pisaría: crearía otra y habría dos organizaciones para el mismo cliente.
  if v_org_name like 'CAMBIAR:%' or v_sede_name like 'CAMBIAR:%' then
    raise exception 'Editá el bloque de PARÁMETROS antes de ejecutar (v_org_name / v_sede_name).';
  end if;

  -- Guard de organización real: este script CREA organizaciones, así que un
  -- nombre existente de un cliente sería un UPDATE sobre su sede y sus roles.
  if v_org_name in ('G-10', 'Salchimelo') then
    raise exception 'v_org_name apunta a un cliente REAL (%). Este script no se corre sobre producción.', v_org_name;
  end if;

  -- ── 1) organizations ─────────────────────────────────────────────────────
  -- subscription_status NO se toca: queda en su DEFAULT 'active'
  -- (organization-subscription.sql:155). Con 'active', resolveNotice() cae en
  -- el `default` del switch y NO se muestra ningún banner. Y el trigger
  -- trg_protect_organization_subscription es BEFORE **UPDATE**, así que este
  -- INSERT no lo dispara.
  select id into v_org from public.organizations where name = v_org_name limit 1;
  if v_org is null then
    insert into public.organizations (name) values (v_org_name) returning id into v_org;
  end if;

  -- ── 2) restaurants — 1 sede ──────────────────────────────────────────────
  select id into v_sede
    from public.restaurants
   where organization_id = v_org and name = v_sede_name limit 1;
  if v_sede is null then
    insert into public.restaurants (organization_id, name)
    values (v_org, v_sede_name)
    returning id into v_sede;
  end if;

  update public.restaurants
     set uses_kitchen = v_uses_kitchen,
         address      = v_address,
         phone        = v_phone,
         config       = coalesce(config, '{}'::jsonb) || jsonb_build_object(
           'cash_out_reasons', jsonb_build_array(
             'Compra de insumos', 'Pago a proveedor', 'Retiro de caja',
             'Servicios', 'Otro'),
           'payment_methods', jsonb_build_array('cash', 'card', 'transfer', 'nequi'))
   where id = v_sede;

  -- ── Roles de sistema ─────────────────────────────────────────────────────
  -- Los siembra `seed_system_roles()`, GENERADA desde src/lib/permissions.ts
  -- (ver supabase/seed-system-roles.sql). Requiere esa migración aplicada antes.
  --
  -- Hasta el 2026-08-31 acá había 4 bloques `insert` inline, y las 4 copias del
  -- repo habían divergido: `admin` valía 16/20/18/23 según el archivo que abrieras.
  -- Ya no hay lista que mantener en este archivo. Ver R1 en CLAUDE.md.
  perform public.seed_system_roles(v_org);
  -- Nota: `ventas.anular` YA está en PERMISSION_GROUPS desde el 2026-08-31, así
  -- que ahora se concede desde la UI de Roles como cualquier otro. La advertencia
  -- que había acá sobre ese hueco quedó obsoleta y se eliminó.


  raise notice 'PASO 1 OK — org "%" (%) · sede "%" (%) · uses_kitchen=%',
    v_org_name, v_org, v_sede_name, v_sede, v_uses_kitchen;
end $$;


-- ============================================================
-- SALIDA — copiá `restaurant_id` de esta grilla: es EXACTAMENTE lo que va en
-- la user_metadata de la cuenta de Auth en el PASO 2.
-- ============================================================
select 'PEGAR EN LA METADATA DEL PASO 2' as check,
       r.id            as restaurant_id,
       o.id            as organization_id,
       o.name          as org,
       r.name          as sede,
       r.uses_kitchen,
       o.subscription_status,     -- debe decir 'active' → sin banner
       o.subscription_message     -- debe estar en null
  from _params p
  join public.organizations o on o.name = p.v_org_name
  join public.restaurants   r on r.organization_id = o.id and r.name = p.v_sede_name;

-- owner debe salir con 1 "permiso" (el comodín) y admin con 23.
select 'roles' as check, r.name as rol, r.is_system,
       jsonb_array_length(r.permissions) as num_permisos, r.permissions
  from _params p
  join public.organizations o on o.name = p.v_org_name
  join public.roles r on r.organization_id = o.id
 order by (r.name = 'owner') desc, num_permisos desc;

commit;
