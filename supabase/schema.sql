-- ============================================================
-- G-Vento POS — Schema SQL
-- Ejecutar en: Supabase Dashboard > SQL Editor
-- ============================================================


-- ============================================================
-- 1. EXTENSIONES
-- ============================================================

create extension if not exists "uuid-ossp";


-- ============================================================
-- 2. TIPOS ENUMERADOS
-- ============================================================

create type public.user_role      as enum ('admin', 'cashier', 'waiter');
create type public.table_status   as enum ('free', 'occupied', 'reserved');
create type public.order_type     as enum ('dine_in', 'takeaway', 'delivery');
create type public.order_status   as enum ('pending', 'preparing', 'ready', 'delivered', 'cancelled');
create type public.payment_method as enum ('cash', 'card', 'transfer', 'nequi');


-- ============================================================
-- 3. TABLAS
-- El orden importa: primero las tablas sin dependencias.
-- ============================================================

-- ----------------------------------------------------------
-- restaurants: punto de partida del modelo de datos.
-- Cada tenant del sistema es un restaurante.
-- ----------------------------------------------------------
create table public.restaurants (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null,
  address    text,
  phone      text,
  logo_url   text,
  config     jsonb       not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.restaurants is
  'Un registro por local/negocio. Actúa como tenant root del sistema.';

-- ----------------------------------------------------------
-- profiles: extiende auth.users con datos del negocio.
-- Se crea automáticamente por trigger al hacer signup/invite.
-- ----------------------------------------------------------
create table public.profiles (
  id            uuid            primary key references auth.users on delete cascade,
  email         text            not null,
  full_name     text            not null,
  role          public.user_role not null default 'waiter',
  restaurant_id uuid            not null references public.restaurants on delete cascade,
  created_at    timestamptz     not null default now(),
  updated_at    timestamptz     not null default now()
);

comment on table public.profiles is
  'Perfil de negocio del usuario. Siempre 1:1 con auth.users.';
comment on column public.profiles.role is
  'admin: gestión total | cashier: caja y pagos | waiter: órdenes en mesa';

-- ----------------------------------------------------------
-- categories: agrupan los productos del menú.
-- ----------------------------------------------------------
create table public.categories (
  id            uuid        primary key default gen_random_uuid(),
  name          text        not null,
  description   text,
  color         text        not null default '#6366f1',
  sort_order    integer     not null default 0,
  restaurant_id uuid        not null references public.restaurants on delete cascade,
  is_active     boolean     not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ----------------------------------------------------------
-- products: ítems del menú con precio y stock opcional.
-- ----------------------------------------------------------
create table public.products (
  id             uuid        primary key default gen_random_uuid(),
  name           text        not null,
  description    text,
  price          numeric(12, 2) not null check (price >= 0),
  category_id    uuid        not null references public.categories  on delete restrict,
  restaurant_id  uuid        not null references public.restaurants on delete cascade,
  image_url      text,
  is_active      boolean     not null default true,
  stock_tracking boolean     not null default false,
  stock_qty      integer     check (stock_qty >= 0),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on column public.products.stock_qty is
  'Nulo cuando stock_tracking = false. Nunca negativo.';

-- ----------------------------------------------------------
-- tables: mesas físicas del restaurante.
-- ----------------------------------------------------------
create table public.tables (
  id            uuid               primary key default gen_random_uuid(),
  name          text               not null,
  capacity      integer            check (capacity > 0),
  zone          text,
  status        public.table_status not null default 'free',
  restaurant_id uuid               not null references public.restaurants on delete cascade,
  created_at    timestamptz        not null default now(),
  updated_at    timestamptz        not null default now()
);

-- ----------------------------------------------------------
-- orders: cabecera de cada pedido.
-- ----------------------------------------------------------
create table public.orders (
  id             uuid               primary key default gen_random_uuid(),
  type           public.order_type  not null,
  status         public.order_status not null default 'pending',
  table_id       uuid               references public.tables   on delete set null,
  customer_name  text,
  customer_phone text,
  notes          text,
  total          numeric(12, 2)     not null default 0 check (total >= 0),
  restaurant_id  uuid               not null references public.restaurants on delete cascade,
  created_by     uuid               not null references public.profiles on delete restrict,
  created_at     timestamptz        not null default now(),
  updated_at     timestamptz        not null default now(),

  -- Una orden de tipo dine_in debería tener mesa asignada
  constraint chk_dine_in_has_table check (
    type != 'dine_in' or table_id is not null
  )
);

comment on column public.orders.total is
  'Calculado en el cliente y persistido. Verificar vs sum(order_items) si se necesita auditoría.';

-- ----------------------------------------------------------
-- order_items: líneas de cada orden.
-- Precio capturado al momento de crear la línea (no cambia si el producto varía).
-- ----------------------------------------------------------
create table public.order_items (
  id         uuid        primary key default gen_random_uuid(),
  order_id   uuid        not null references public.orders   on delete cascade,
  product_id uuid        not null references public.products on delete restrict,
  qty        integer     not null check (qty > 0),
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  modifiers  jsonb       not null default '[]',
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.order_items.unit_price is
  'Snapshot del precio al momento de la venta. No referencia products.price en tiempo real.';

-- ----------------------------------------------------------
-- payments: registros de cobro de una orden.
-- Una orden puede tener múltiples pagos (pago dividido).
-- ----------------------------------------------------------
create table public.payments (
  id            uuid                 primary key default gen_random_uuid(),
  order_id      uuid                 not null references public.orders      on delete restrict,
  method        public.payment_method not null,
  amount        numeric(12, 2)       not null check (amount > 0),
  restaurant_id uuid                 not null references public.restaurants on delete cascade,
  created_at    timestamptz          not null default now()
  -- Sin updated_at: los pagos son inmutables. Correcciones = anular + recrear.
);

comment on table public.payments is
  'Inmutable por diseño. Para corregir: eliminar el registro incorrecto y crear uno nuevo.';

-- ----------------------------------------------------------
-- cash_shifts: turnos de apertura/cierre de caja.
-- Solo puede haber un turno abierto por restaurante a la vez.
-- ----------------------------------------------------------
create table public.cash_shifts (
  id              uuid        primary key default gen_random_uuid(),
  restaurant_id   uuid        not null references public.restaurants on delete cascade,
  opened_by       uuid        not null references public.profiles on delete restrict,
  closed_by       uuid        references public.profiles on delete set null,
  opening_amount  numeric(12, 2) not null check (opening_amount >= 0),
  closing_amount  numeric(12, 2) check (closing_amount >= 0),
  opened_at       timestamptz not null default now(),
  closed_at       timestamptz,
  updated_at      timestamptz not null default now(),

  constraint chk_shift_closed_after_opened check (
    closed_at is null or closed_at > opened_at
  )
);


-- ============================================================
-- 4. ÍNDICES
-- Cubren los filtros más frecuentes del POS en producción.
-- ============================================================

-- orders: las dos consultas más comunes son por restaurante y por estado
create index idx_orders_restaurant_id     on public.orders (restaurant_id);
create index idx_orders_status            on public.orders (status);
create index idx_orders_restaurant_status on public.orders (restaurant_id, status);
create index idx_orders_created_at        on public.orders (created_at desc);

-- order_items: siempre se accede filtrado por orden
create index idx_order_items_order_id     on public.order_items (order_id);

-- products: filtrado por categoría desde el panel del POS
create index idx_products_category_id     on public.products (category_id);
create index idx_products_restaurant_id   on public.products (restaurant_id);

-- apoyo en otras tablas
create index idx_categories_restaurant_id on public.categories  (restaurant_id);
create index idx_tables_restaurant_id     on public.tables       (restaurant_id);
create index idx_tables_restaurant_status on public.tables       (restaurant_id, status);
create index idx_payments_order_id        on public.payments     (order_id);
create index idx_cash_shifts_restaurant   on public.cash_shifts  (restaurant_id);

-- índice parcial: garantiza que solo exista un turno abierto por restaurante
create unique index idx_cash_shifts_one_open
  on public.cash_shifts (restaurant_id)
  where closed_at is null;


-- ============================================================
-- 5. FUNCIONES AUXILIARES
-- Usan SECURITY DEFINER para leer profiles sin ser bloqueadas
-- por RLS (el bucle huevo-gallina: RLS llama a la función que
-- lee la tabla que tiene RLS).
-- ============================================================

create or replace function public.get_my_restaurant_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select restaurant_id from public.profiles where id = auth.uid()
$$;

create or replace function public.get_my_role()
returns public.user_role
language sql stable security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;


-- ============================================================
-- 6. TRIGGERS — updated_at automático
-- Una sola función reutilizable para todas las tablas.
-- ============================================================

create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_restaurants_updated_at
  before update on public.restaurants
  for each row execute function public.handle_updated_at();

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.handle_updated_at();

create trigger trg_categories_updated_at
  before update on public.categories
  for each row execute function public.handle_updated_at();

create trigger trg_products_updated_at
  before update on public.products
  for each row execute function public.handle_updated_at();

create trigger trg_tables_updated_at
  before update on public.tables
  for each row execute function public.handle_updated_at();

create trigger trg_orders_updated_at
  before update on public.orders
  for each row execute function public.handle_updated_at();

create trigger trg_order_items_updated_at
  before update on public.order_items
  for each row execute function public.handle_updated_at();

create trigger trg_cash_shifts_updated_at
  before update on public.cash_shifts
  for each row execute function public.handle_updated_at();


-- ============================================================
-- 7. TRIGGER — Creación automática de perfil en signup/invite
--
-- Flujo esperado:
--   1. Admin llama: supabase.auth.admin.inviteUserByEmail(email, {
--        data: { restaurant_id: '...', role: 'waiter', full_name: '...' }
--      })
--   2. Supabase inserta en auth.users con esos metadatos.
--   3. Este trigger crea el profile con el restaurant_id del invitador.
--
-- Si full_name no viene en los metadatos se usa la parte local del email.
-- Si role no viene se asigna 'waiter' por defecto.
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role, restaurant_id)
  values (
    new.id,
    new.email,
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
      split_part(new.email, '@', 1)
    ),
    coalesce(new.raw_user_meta_data->>'role', 'waiter')::public.user_role,
    (new.raw_user_meta_data->>'restaurant_id')::uuid
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ============================================================
-- 8. ROW LEVEL SECURITY — habilitar en todas las tablas
-- ============================================================

alter table public.restaurants  enable row level security;
alter table public.profiles      enable row level security;
alter table public.categories    enable row level security;
alter table public.products      enable row level security;
alter table public.tables        enable row level security;
alter table public.orders        enable row level security;
alter table public.order_items   enable row level security;
alter table public.payments      enable row level security;
alter table public.cash_shifts   enable row level security;


-- ============================================================
-- 9. POLÍTICAS RLS
-- Regla general: un usuario autenticado solo opera sobre datos
-- de su propio restaurant_id (aislamiento multi-tenant).
-- ============================================================

-- ----------------------------------------------------------
-- restaurants
-- ----------------------------------------------------------

create policy "restaurants: ver el propio"
  on public.restaurants for select to authenticated
  using (id = get_my_restaurant_id());

-- Solo el admin puede modificar la configuración del restaurante
create policy "restaurants: admin actualiza"
  on public.restaurants for update to authenticated
  using  (id = get_my_restaurant_id() and get_my_role() = 'admin')
  with check (id = get_my_restaurant_id());

-- ----------------------------------------------------------
-- profiles
-- Lectura: todos ven los perfiles de su restaurante (necesario
-- para mostrar nombre del cajero en órdenes, etc.).
-- Escritura: cada uno edita el propio; admin edita cualquiera.
-- Insert: lo gestiona handle_new_user (security definer).
-- ----------------------------------------------------------

create policy "profiles: ver del mismo restaurante"
  on public.profiles for select to authenticated
  using (restaurant_id = get_my_restaurant_id());

create policy "profiles: editar el propio"
  on public.profiles for update to authenticated
  using  (id = auth.uid())
  with check (id = auth.uid() and restaurant_id = get_my_restaurant_id());

create policy "profiles: admin edita cualquiera"
  on public.profiles for update to authenticated
  using  (restaurant_id = get_my_restaurant_id() and get_my_role() = 'admin')
  with check (restaurant_id = get_my_restaurant_id());

-- ----------------------------------------------------------
-- categories
-- Lectura: todos. Escritura: solo admin.
-- ----------------------------------------------------------

create policy "categories: ver del restaurante"
  on public.categories for select to authenticated
  using (restaurant_id = get_my_restaurant_id());

create policy "categories: admin crea"
  on public.categories for insert to authenticated
  with check (restaurant_id = get_my_restaurant_id() and get_my_role() = 'admin');

create policy "categories: admin actualiza"
  on public.categories for update to authenticated
  using  (restaurant_id = get_my_restaurant_id() and get_my_role() = 'admin')
  with check (restaurant_id = get_my_restaurant_id());

create policy "categories: admin elimina"
  on public.categories for delete to authenticated
  using (restaurant_id = get_my_restaurant_id() and get_my_role() = 'admin');

-- ----------------------------------------------------------
-- products
-- Lectura: todos. Escritura: solo admin.
-- ----------------------------------------------------------

create policy "products: ver del restaurante"
  on public.products for select to authenticated
  using (restaurant_id = get_my_restaurant_id());

create policy "products: admin crea"
  on public.products for insert to authenticated
  with check (restaurant_id = get_my_restaurant_id() and get_my_role() = 'admin');

create policy "products: admin actualiza"
  on public.products for update to authenticated
  using  (restaurant_id = get_my_restaurant_id() and get_my_role() = 'admin')
  with check (restaurant_id = get_my_restaurant_id());

create policy "products: admin elimina"
  on public.products for delete to authenticated
  using (restaurant_id = get_my_restaurant_id() and get_my_role() = 'admin');

-- ----------------------------------------------------------
-- tables (mesas)
-- Lectura: todos. Crear/eliminar: admin.
-- Actualizar: todos (el mozo cambia el status cuando atiende la mesa).
-- ----------------------------------------------------------

create policy "tables: ver del restaurante"
  on public.tables for select to authenticated
  using (restaurant_id = get_my_restaurant_id());

create policy "tables: admin crea"
  on public.tables for insert to authenticated
  with check (restaurant_id = get_my_restaurant_id() and get_my_role() = 'admin');

create policy "tables: staff actualiza estado"
  on public.tables for update to authenticated
  using  (restaurant_id = get_my_restaurant_id())
  with check (restaurant_id = get_my_restaurant_id());

create policy "tables: admin elimina"
  on public.tables for delete to authenticated
  using (restaurant_id = get_my_restaurant_id() and get_my_role() = 'admin');

-- ----------------------------------------------------------
-- orders
-- Lectura: todos. Crear: cajeros, mozos y admin.
-- Actualizar (cambios de status): todos del restaurante.
-- Eliminar: solo admin (anulaciones excepcionales).
-- ----------------------------------------------------------

create policy "orders: ver del restaurante"
  on public.orders for select to authenticated
  using (restaurant_id = get_my_restaurant_id());

create policy "orders: staff crea"
  on public.orders for insert to authenticated
  with check (
    restaurant_id = get_my_restaurant_id()
    and get_my_role() in ('admin', 'cashier', 'waiter')
    and created_by = auth.uid()
  );

create policy "orders: staff actualiza"
  on public.orders for update to authenticated
  using  (restaurant_id = get_my_restaurant_id())
  with check (restaurant_id = get_my_restaurant_id());

create policy "orders: admin elimina"
  on public.orders for delete to authenticated
  using (restaurant_id = get_my_restaurant_id() and get_my_role() = 'admin');

-- ----------------------------------------------------------
-- order_items
-- No tienen restaurant_id propio: la pertenencia se verifica
-- a través de la orden padre (subquery sobre índice existente).
-- ----------------------------------------------------------

create policy "order_items: ver por orden del restaurante"
  on public.order_items for select to authenticated
  using (
    order_id in (
      select id from public.orders where restaurant_id = get_my_restaurant_id()
    )
  );

create policy "order_items: staff crea"
  on public.order_items for insert to authenticated
  with check (
    order_id in (
      select id from public.orders where restaurant_id = get_my_restaurant_id()
    )
  );

create policy "order_items: staff actualiza"
  on public.order_items for update to authenticated
  using (
    order_id in (
      select id from public.orders where restaurant_id = get_my_restaurant_id()
    )
  )
  with check (
    order_id in (
      select id from public.orders where restaurant_id = get_my_restaurant_id()
    )
  );

create policy "order_items: staff elimina"
  on public.order_items for delete to authenticated
  using (
    order_id in (
      select id from public.orders where restaurant_id = get_my_restaurant_id()
    )
  );

-- ----------------------------------------------------------
-- payments
-- Lectura: todos. Crear: cajeros y admin.
-- Sin UPDATE ni DELETE (inmutables).
-- Para corregir un pago: el admin elimina y vuelve a crear.
-- ----------------------------------------------------------

create policy "payments: ver del restaurante"
  on public.payments for select to authenticated
  using (restaurant_id = get_my_restaurant_id());

create policy "payments: cajero/admin crea"
  on public.payments for insert to authenticated
  with check (
    restaurant_id = get_my_restaurant_id()
    and get_my_role() in ('admin', 'cashier')
  );

create policy "payments: admin elimina"
  on public.payments for delete to authenticated
  using (restaurant_id = get_my_restaurant_id() and get_my_role() = 'admin');

-- ----------------------------------------------------------
-- cash_shifts
-- Lectura: todos. Abrir/cerrar turno: cajeros y admin.
-- El índice único idx_cash_shifts_one_open garantiza
-- que solo haya un turno abierto por restaurante a la vez.
-- ----------------------------------------------------------

create policy "cash_shifts: ver del restaurante"
  on public.cash_shifts for select to authenticated
  using (restaurant_id = get_my_restaurant_id());

create policy "cash_shifts: cajero/admin abre turno"
  on public.cash_shifts for insert to authenticated
  with check (
    restaurant_id = get_my_restaurant_id()
    and get_my_role() in ('admin', 'cashier')
    and opened_by = auth.uid()
  );

create policy "cash_shifts: cajero/admin cierra turno"
  on public.cash_shifts for update to authenticated
  using  (restaurant_id = get_my_restaurant_id() and get_my_role() in ('admin', 'cashier'))
  with check (restaurant_id = get_my_restaurant_id());
