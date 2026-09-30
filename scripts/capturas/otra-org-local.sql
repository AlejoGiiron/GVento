-- scripts/capturas/otra-org-local.sql
-- ============================================================================
-- SOLO BASE LOCAL (Docker). Lo aplica scripts/capturas/preparar-local.mjs
-- después de lab-seed.sql. NO es una migración y no va a prod: vive fuera de
-- supabase/ a propósito (no entra a ORDEN ni a la deriva, que mide esquema).
--
-- QUÉ CREA: una SEGUNDA organización, "LAB-OTRA", con una sede y un usuario
-- admin (otra.test@gvento.com, cuenta de Auth creada por preparar-local con el
-- UUID de abajo). Sin ella no hay forma de probar el AISLAMIENTO ENTRE CLIENTES
-- en local: todo lo demás vive en LAB. Es el "usuario de OTRA organización" de
-- los tests de Storage (restaurant-logos) y de cualquier prueba de RLS cruzada.
--
-- RE-APLICAR: idempotente (busca por nombre de org / sede y UUID de usuario).
-- ============================================================================
do $$
declare
  c_otra_uid constant uuid := '0e7a0e7a-0e7a-4e7a-8e7a-0e7a0e7a0e7a';
  v_org   uuid;
  v_sede  uuid;
  v_role  uuid;
begin
  select id into v_org from public.organizations where name = 'LAB-OTRA';
  if v_org is null then
    insert into public.organizations (name) values ('LAB-OTRA') returning id into v_org;
  end if;

  select id into v_sede from public.restaurants where organization_id = v_org and name = 'Sede Otra';
  if v_sede is null then
    insert into public.restaurants (organization_id, name, address, phone)
    values (v_org, 'Sede Otra', 'Calle Otra 1', '3000000000') returning id into v_sede;
  end if;

  perform public.seed_system_roles(v_org);
  select id into strict v_role from public.roles where organization_id = v_org and name = 'owner';

  insert into public.profiles
    (id, email, full_name, role, role_id, organization_id, restaurant_id, is_active)
  values
    (c_otra_uid, 'otra.test@gvento.com', 'Admin Otra', 'admin'::public.user_role, v_role, v_org, v_sede, true)
  on conflict (id) do update set
    role = excluded.role, role_id = excluded.role_id, organization_id = excluded.organization_id,
    restaurant_id = excluded.restaurant_id, is_active = true;

  insert into public.user_stores (user_id, restaurant_id) values (c_otra_uid, v_sede)
  on conflict do nothing;

  raise notice 'LAB-OTRA: org %, sede %, admin otra.test', v_org, v_sede;
end $$;
