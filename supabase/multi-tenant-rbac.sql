-- ============================================================
-- Fase ARQ — Multi-tenant + RBAC
--
-- Migración NUEVA. No edita migraciones ya aplicadas.
-- Orden estricto: TABLAS → COLUMNAS → FUNCIONES → SEED → RLS.
-- El SEED corre ANTES de poner restaurants.organization_id NOT NULL.
--
-- Modelo:
--   organizations  → tenant raíz (agrupa varias sedes/restaurants)
--   restaurants    → sede (pertenece a una organización)
--   profiles       → usuario; profiles.restaurant_id = SEDE ACTIVA
--   user_stores    → sedes a las que un usuario tiene acceso (N:M)
--   roles          → rol con set de permisos (jsonb) por organización
--   profiles.role_id → rol RBAC del usuario
--
-- profiles.role (enum) SE MANTIENE por ahora; se eliminará en una
-- migración posterior cuando el código ya no lo use.
--
-- ------------------------------------------------------------
-- CATÁLOGO DE PERMISOS (valores del array permissions de roles):
--   pos.vender             vender en el POS
--   pos.descuento          aplicar descuentos
--   pos.anular             anular ventas/órdenes
--   caja.abrir             abrir turno de caja
--   caja.cerrar            cerrar turno de caja
--   caja.movimientos       registrar ingresos/egresos de caja
--   mesas.gestionar        abrir/atender/administrar mesas
--   mesas.cobrar           cobrar una mesa
--   cocina.acceder         acceder al KDS de cocina
--   delivery.gestionar     gestionar pedidos de delivery
--   productos.ver          ver el catálogo de productos
--   productos.editar       crear/editar productos y categorías
--   reportes.financiero    ver reportes financieros (ventas, caja)
--   reportes.stock         ver reportes de inventario
--   reportes.consolidado   ver reportes consolidados multi-sede
--   config.acceder         acceder al panel de configuración
--   usuarios.gestionar     gestionar usuarios y sus accesos
--   sedes.gestionar        crear/editar sedes y la organización
--   roles.gestionar        crear/editar roles y permisos
-- ============================================================

-- Toda la migración es atómica: si cualquier statement falla, ROLLBACK
-- completo (aprendizaje #4: tsc no prueba SQL; se valida contra la BD).
begin;


-- ============================================================
-- 1. TABLAS
-- ============================================================

-- ----------------------------------------------------------
-- organizations: tenant raíz. Agrupa una o varias sedes.
-- ----------------------------------------------------------
create table if not exists public.organizations (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null,
  logo_url   text,
  config     jsonb       not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.organizations is
  'Tenant raíz del sistema. Agrupa las sedes (restaurants) de un mismo negocio.';

create trigger trg_organizations_updated_at
  before update on public.organizations
  for each row execute function public.handle_updated_at();

-- ----------------------------------------------------------
-- roles: rol RBAC con set de permisos (jsonb array) por organización.
-- ----------------------------------------------------------
create table if not exists public.roles (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations on delete cascade,
  name            text        not null,
  is_system       boolean     not null default false,
  permissions     jsonb       not null default '[]',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, name)
);

comment on table public.roles is
  'Rol RBAC. permissions es un array jsonb de strings del catálogo de permisos.';
comment on column public.roles.is_system is
  'true = rol de sistema sembrado (owner/admin/cajero/mozo); no debería borrarse.';

create trigger trg_roles_updated_at
  before update on public.roles
  for each row execute function public.handle_updated_at();

-- ----------------------------------------------------------
-- user_stores: acceso N:M de un usuario a varias sedes.
-- ----------------------------------------------------------
create table if not exists public.user_stores (
  user_id       uuid        not null references public.profiles    on delete cascade,
  restaurant_id uuid        not null references public.restaurants on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (user_id, restaurant_id)
);

comment on table public.user_stores is
  'Sedes a las que un usuario tiene acceso. profiles.restaurant_id = sede activa.';


-- ============================================================
-- 2. COLUMNAS (organization_id se agrega NULLABLE; el SEED las puebla;
--    restaurants.organization_id pasa a NOT NULL al final del SEED)
-- ============================================================

alter table public.restaurants
  add column if not exists organization_id uuid references public.organizations on delete cascade;

alter table public.profiles
  add column if not exists organization_id uuid references public.organizations on delete cascade;

alter table public.profiles
  add column if not exists role_id uuid references public.roles;

comment on column public.restaurants.organization_id is
  'Organización (tenant) a la que pertenece la sede.';
comment on column public.profiles.restaurant_id is
  'Sede ACTIVA del usuario (multi-sede vía user_stores).';
comment on column public.profiles.role_id is
  'Rol RBAC del usuario. profiles.role (enum) se mantiene hasta migración posterior.';


-- ============================================================
-- 3. FUNCIONES
-- SECURITY DEFINER + search_path fijo. Se revoca EXECUTE a public y
-- anon, y se concede solo a authenticated (aprendizaje de seguridad
-- de Fase 0: Postgres concede EXECUTE a PUBLIC por defecto).
-- get_my_restaurant_id() NO se toca: sigue devolviendo la sede activa.
-- ============================================================

-- Organización del usuario actual (sede activa → su organización).
create or replace function public.get_my_organization_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select organization_id from public.profiles where id = auth.uid()
$$;

revoke execute on function public.get_my_organization_id() from public;
revoke execute on function public.get_my_organization_id() from anon;
grant  execute on function public.get_my_organization_id() to authenticated;

-- ¿El usuario actual tiene el permiso `perm` en su rol RBAC?
-- permissions es un array jsonb de strings; el operador `?` comprueba
-- si `perm` existe como elemento del array.
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
      and r.permissions ? perm
  )
$$;

revoke execute on function public.has_permission(text) from public;
revoke execute on function public.has_permission(text) from anon;
grant  execute on function public.has_permission(text) to authenticated;


-- ============================================================
-- 4. SEED de datos existentes
-- Corre ANTES de poner restaurants.organization_id NOT NULL.
--
-- ⚠️  EDITAR el nombre de la organización antes de ejecutar.
-- ============================================================

do $$
declare
  v_org_id    uuid;
  v_owner_id  uuid;
  v_cajero_id uuid;
  v_mozo_id   uuid;
begin
  -- 4.1 Crear la organización
  insert into public.organizations (name)
  values ('G-10')
  returning id into v_org_id;

  -- 4.2 Asignar todas las sedes existentes a la organización
  update public.restaurants
     set organization_id = v_org_id
   where organization_id is null;

  -- 4.3 Crear los 4 roles de sistema de la organización
  insert into public.roles (organization_id, name, is_system, permissions) values
    (v_org_id, 'owner', true, '[
      "pos.vender","pos.descuento","pos.anular",
      "caja.abrir","caja.cerrar","caja.movimientos",
      "mesas.gestionar","mesas.cobrar","cocina.acceder","delivery.gestionar",
      "productos.ver","productos.editar",
      "reportes.financiero","reportes.stock","reportes.consolidado",
      "config.acceder","usuarios.gestionar","sedes.gestionar","roles.gestionar"
    ]'::jsonb)
  returning id into v_owner_id;

  insert into public.roles (organization_id, name, is_system, permissions) values
    (v_org_id, 'admin', true, '[
      "pos.vender","pos.descuento","pos.anular",
      "caja.abrir","caja.cerrar","caja.movimientos",
      "mesas.gestionar","mesas.cobrar","cocina.acceder","delivery.gestionar",
      "productos.ver","productos.editar",
      "reportes.financiero","reportes.stock",
      "config.acceder","usuarios.gestionar"
    ]'::jsonb);

  insert into public.roles (organization_id, name, is_system, permissions) values
    (v_org_id, 'cajero', true, '[
      "pos.vender","pos.descuento","pos.anular",
      "caja.abrir","caja.cerrar","caja.movimientos",
      "mesas.cobrar","delivery.gestionar"
    ]'::jsonb)
  returning id into v_cajero_id;

  insert into public.roles (organization_id, name, is_system, permissions) values
    (v_org_id, 'mozo', true, '[
      "pos.vender","mesas.gestionar","cocina.acceder"
    ]'::jsonb)
  returning id into v_mozo_id;

  -- 4.4 Poblar organization_id de los perfiles (vía su sede)
  update public.profiles p
     set organization_id = r.organization_id
    from public.restaurants r
   where p.restaurant_id = r.id;

  -- 4.5 Mapear profiles.role (enum) → profiles.role_id (RBAC)
  --     admin actual → owner; cashier → cajero; waiter → mozo.
  update public.profiles set role_id = v_owner_id  where role = 'admin';
  update public.profiles set role_id = v_cajero_id where role = 'cashier';
  update public.profiles set role_id = v_mozo_id   where role = 'waiter';

  -- 4.6 Poblar user_stores con la sede actual de cada usuario
  insert into public.user_stores (user_id, restaurant_id)
  select id, restaurant_id
    from public.profiles
   where restaurant_id is not null
  on conflict do nothing;
end $$;

-- 4.7 Ahora sí: organization_id de las sedes es obligatorio
alter table public.restaurants
  alter column organization_id set not null;


-- ============================================================
-- 5. RLS de las tablas nuevas
-- ============================================================

alter table public.organizations enable row level security;
alter table public.roles         enable row level security;
alter table public.user_stores   enable row level security;

-- ----------------------------------------------------------
-- organizations: los miembros la ven; sedes.gestionar la edita.
-- ----------------------------------------------------------
create policy "organizations: ver la propia"
  on public.organizations for select to authenticated
  using (id = get_my_organization_id());

create policy "organizations: editar con permiso"
  on public.organizations for update to authenticated
  using  (id = get_my_organization_id() and has_permission('sedes.gestionar'))
  with check (id = get_my_organization_id());

-- ----------------------------------------------------------
-- roles: lectura para la org; escritura con roles.gestionar.
-- ----------------------------------------------------------
create policy "roles: ver los de la org"
  on public.roles for select to authenticated
  using (organization_id = get_my_organization_id());

create policy "roles: crear con permiso"
  on public.roles for insert to authenticated
  with check (organization_id = get_my_organization_id() and has_permission('roles.gestionar'));

create policy "roles: actualizar con permiso"
  on public.roles for update to authenticated
  using  (organization_id = get_my_organization_id() and has_permission('roles.gestionar'))
  with check (organization_id = get_my_organization_id());

create policy "roles: borrar con permiso"
  on public.roles for delete to authenticated
  using (organization_id = get_my_organization_id() and has_permission('roles.gestionar'));

-- ----------------------------------------------------------
-- user_stores: lectura propia; escritura con usuarios.gestionar.
-- La escritura además se limita a sedes de la propia organización.
-- ----------------------------------------------------------
create policy "user_stores: ver los propios"
  on public.user_stores for select to authenticated
  using (user_id = auth.uid());

-- Lectura ampliada para la sección Usuarios del admin: quien tenga
-- usuarios.gestionar ve los accesos de toda su organización.
create policy "user_stores: ver los de la org con permiso"
  on public.user_stores for select to authenticated
  using (
    has_permission('usuarios.gestionar')
    and restaurant_id in (
      select id from public.restaurants where organization_id = get_my_organization_id()
    )
  );

create policy "user_stores: crear con permiso"
  on public.user_stores for insert to authenticated
  with check (
    has_permission('usuarios.gestionar')
    and restaurant_id in (
      select id from public.restaurants where organization_id = get_my_organization_id()
    )
  );

create policy "user_stores: borrar con permiso"
  on public.user_stores for delete to authenticated
  using (
    has_permission('usuarios.gestionar')
    and restaurant_id in (
      select id from public.restaurants where organization_id = get_my_organization_id()
    )
  );


-- Fin de la migración atómica.
commit;
