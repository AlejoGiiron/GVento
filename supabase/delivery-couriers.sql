-- ============================================================
-- G-Vento — Delivery: Couriers + extensiones a orders
-- Ejecutar en: Supabase Dashboard > SQL Editor
-- ============================================================


-- ----------------------------------------------------------
-- 1. Tabla couriers
-- Repartidores asignados a órdenes de delivery.
-- ----------------------------------------------------------
create table public.couriers (
  id            uuid        primary key default gen_random_uuid(),
  restaurant_id uuid        not null references public.restaurants on delete cascade,
  name          text        not null,
  phone         text,
  is_active     boolean     not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.couriers is
  'Repartidores asignados a órdenes de delivery del restaurante.';


-- ----------------------------------------------------------
-- 2. Columnas de delivery en orders
-- delivery_address : dirección de entrega
-- courier_id       : repartidor asignado (FK a couriers)
-- estimated_delivery_minutes : tiempo estimado de entrega
-- ----------------------------------------------------------
alter table public.orders
  add column if not exists delivery_address           text,
  add column if not exists courier_id                 uuid
    references public.couriers(id) on delete set null,
  add column if not exists estimated_delivery_minutes integer
    check (estimated_delivery_minutes > 0);


-- ----------------------------------------------------------
-- 3. Índices
-- ----------------------------------------------------------
create index idx_couriers_restaurant_id on public.couriers (restaurant_id);
create index idx_orders_courier_id      on public.orders   (courier_id);
create index idx_orders_type            on public.orders   (type);


-- ----------------------------------------------------------
-- 4. Trigger updated_at para couriers
-- Reutiliza handle_updated_at() definida en schema.sql
-- ----------------------------------------------------------
create trigger trg_couriers_updated_at
  before update on public.couriers
  for each row execute function public.handle_updated_at();


-- ----------------------------------------------------------
-- 5. RLS — couriers
-- Lectura: todos los usuarios del restaurante.
-- Escritura: admin y cajeros.
-- Eliminación lógica (is_active=false): admin.
-- ----------------------------------------------------------
alter table public.couriers enable row level security;

create policy "couriers: ver del restaurante"
  on public.couriers for select to authenticated
  using (restaurant_id = get_my_restaurant_id());

create policy "couriers: admin/cajero crea"
  on public.couriers for insert to authenticated
  with check (
    restaurant_id = get_my_restaurant_id()
    and get_my_role() in ('admin', 'cashier')
  );

create policy "couriers: admin/cajero actualiza"
  on public.couriers for update to authenticated
  using  (restaurant_id = get_my_restaurant_id() and get_my_role() in ('admin', 'cashier'))
  with check (restaurant_id = get_my_restaurant_id());

create policy "couriers: admin elimina"
  on public.couriers for delete to authenticated
  using (restaurant_id = get_my_restaurant_id() and get_my_role() = 'admin');
