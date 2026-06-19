-- ============================================================
-- G-Vento — Extras (subproductos reutilizables)
-- Parte 1: catálogo por sede + asignación a productos + extras por línea.
-- La selección en POS/Mesas y el descuento de inventario van en una
-- migración/feature posterior (prompt 2).
--
-- Ejecutar en: Supabase Dashboard > SQL Editor.
-- Migración NUEVA. No edita migraciones aplicadas.
-- ============================================================

begin;

-- ----------------------------------------------------------
-- 1. extras — catálogo reutilizable por sede.
-- linked_product_id: si está presente, vender el extra descuenta
-- stock de ese producto (la lógica de descuento es del prompt 2).
-- ON DELETE SET NULL: borrar el producto vinculado no borra el extra.
-- ----------------------------------------------------------
create table public.extras (
  id                uuid           primary key default gen_random_uuid(),
  restaurant_id     uuid           not null references public.restaurants on delete cascade,
  name              text           not null,
  price             numeric(12, 2) not null default 0 check (price >= 0),
  linked_product_id uuid           references public.products on delete set null,
  is_active         boolean        not null default true,
  created_at        timestamptz    not null default now(),
  updated_at        timestamptz    not null default now()
);

comment on table public.extras is
  'Catálogo de extras/subproductos reutilizables por sede. Se asignan a productos vía product_extras.';
comment on column public.extras.linked_product_id is
  'Si está presente, vender este extra descuenta stock del producto vinculado (control de inventario).';

-- ----------------------------------------------------------
-- 2. product_extras — N:N producto ↔ extra.
-- Qué extras del catálogo aplican a cada producto.
-- ON DELETE CASCADE en ambas FK: limpiar la relación al borrar
-- el producto o el extra (la fila de relación, no el catálogo).
-- ----------------------------------------------------------
create table public.product_extras (
  id         uuid        primary key default gen_random_uuid(),
  product_id uuid        not null references public.products on delete cascade,
  extra_id   uuid        not null references public.extras   on delete cascade,
  created_at timestamptz not null default now(),
  unique (product_id, extra_id)
);

comment on table public.product_extras is
  'Relación N:N: qué extras del catálogo están disponibles para cada producto.';

-- ----------------------------------------------------------
-- 3. order_item_extras — extras elegidos en una línea de venta.
-- unit_price es snapshot del precio del extra al momento de vender.
-- ON DELETE CASCADE en order_item_id: al borrar la línea se borran sus extras.
-- ON DELETE RESTRICT en extra_id: no se borra un extra que está en ventas.
-- ----------------------------------------------------------
create table public.order_item_extras (
  id            uuid           primary key default gen_random_uuid(),
  order_item_id uuid           not null references public.order_items on delete cascade,
  extra_id      uuid           not null references public.extras      on delete restrict,
  qty           integer        not null check (qty > 0),
  unit_price    numeric(12, 2) not null check (unit_price >= 0),
  created_at    timestamptz    not null default now()
);

comment on column public.order_item_extras.unit_price is
  'Snapshot del precio del extra al momento de la venta. No referencia extras.price en tiempo real.';

-- ----------------------------------------------------------
-- 4. Índices
-- ----------------------------------------------------------
create index idx_extras_restaurant_id           on public.extras            (restaurant_id);
create index idx_product_extras_product_id       on public.product_extras    (product_id);
create index idx_order_item_extras_order_item_id on public.order_item_extras (order_item_id);

-- ----------------------------------------------------------
-- 5. Trigger updated_at — extras.
-- Reutiliza handle_updated_at() definida en schema.sql.
-- ----------------------------------------------------------
create trigger trg_extras_updated_at
  before update on public.extras
  for each row execute function public.handle_updated_at();

-- ----------------------------------------------------------
-- 6. RLS
-- Patrón de la deuda conocida: pertenencia por restaurant_id =
-- get_my_restaurant_id(); edición de extras con has_permission('productos.editar').
-- product_extras y order_item_extras no tienen restaurant_id propio:
-- la pertenencia se verifica vía la fila padre (subquery sobre índice existente).
-- ----------------------------------------------------------
alter table public.extras            enable row level security;
alter table public.product_extras    enable row level security;
alter table public.order_item_extras enable row level security;

-- extras --------------------------------------------------
create policy "extras: ver del restaurante"
  on public.extras for select to authenticated
  using (restaurant_id = get_my_restaurant_id());

create policy "extras: crear con permiso"
  on public.extras for insert to authenticated
  with check (
    restaurant_id = get_my_restaurant_id()
    and has_permission('productos.editar')
  );

create policy "extras: editar con permiso"
  on public.extras for update to authenticated
  using  (restaurant_id = get_my_restaurant_id() and has_permission('productos.editar'))
  with check (restaurant_id = get_my_restaurant_id());

create policy "extras: borrar con permiso"
  on public.extras for delete to authenticated
  using (restaurant_id = get_my_restaurant_id() and has_permission('productos.editar'));

-- product_extras ------------------------------------------
create policy "product_extras: ver por producto del restaurante"
  on public.product_extras for select to authenticated
  using (
    product_id in (
      select id from public.products where restaurant_id = get_my_restaurant_id()
    )
  );

create policy "product_extras: crear con permiso"
  on public.product_extras for insert to authenticated
  with check (
    has_permission('productos.editar')
    and product_id in (
      select id from public.products where restaurant_id = get_my_restaurant_id()
    )
  );

create policy "product_extras: borrar con permiso"
  on public.product_extras for delete to authenticated
  using (
    has_permission('productos.editar')
    and product_id in (
      select id from public.products where restaurant_id = get_my_restaurant_id()
    )
  );

-- order_item_extras ---------------------------------------
-- Pertenencia vía la orden padre del order_item. Crear: mismo criterio
-- que order_items (staff que vende). Sin update/delete por ahora:
-- los extras de una línea se fijan al venderse; la corrección es anular.
create policy "order_item_extras: ver por orden del restaurante"
  on public.order_item_extras for select to authenticated
  using (
    order_item_id in (
      select oi.id
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where o.restaurant_id = get_my_restaurant_id()
    )
  );

create policy "order_item_extras: staff crea"
  on public.order_item_extras for insert to authenticated
  with check (
    order_item_id in (
      select oi.id
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where o.restaurant_id = get_my_restaurant_id()
    )
  );

commit;
