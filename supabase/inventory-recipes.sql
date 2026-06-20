-- ============================================================
-- G-Vento — Inventario por recetas (BOM de un nivel)
-- Parte 1 (BD): schema de inventario + ajuste manual de stock.
--
-- Modelo (coctelería):
--   • products.kind = 'simple'    → tiene stock propio; al venderse descuenta
--                                    1 × qty de su stock_qty (si stock_tracking).
--   • products.kind = 'composite' → NO tiene stock propio; al venderse explota
--                                    su receta (product_components) y descuenta
--                                    cada insumo según qty_receta × qty_vendida.
--   • Los insumos son productos 'simple' (ej: "vaso 12onz").
--   • El licor NO se inventaría (no hay recetas de licor): queda como producto
--     sin control de stock (stock_tracking = false).
--   • Stock ENTERO. Stock NEGATIVO permitido (ver
--     products-allow-negative-stock.sql): la venta nunca se bloquea; el negativo
--     es la señal visible de "reponer". Es estimación, no verdad de caja.
--   • stock_tracking sigue siendo el interruptor maestro de "¿se inventaría?":
--       - simple + stock_tracking=true  → descuenta su propio stock
--       - simple + stock_tracking=false → no descuenta (ej: licor)
--       - composite                     → descuenta insumos (cada insumo decide
--                                          por su propio stock_tracking)
--
-- Convivencia con add_order_items_with_extras (extras parte 2):
--   La función de descuento de stock POR RECETA al vender (deduct_stock_for_order)
--   NO se incluye aquí: su enfoque de integración con la RPC de extras está
--   PENDIENTE DE APROBACIÓN (ver bloque comentado al final, sección 4).
--   Los extras siguen igual: solo suman precio + descuentan su producto vinculado.
--
-- Ejecutar en: Supabase Dashboard > SQL Editor. Migración NUEVA.
-- No edita migraciones aplicadas.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. products.kind — tipo de producto (simple | composite)
-- ------------------------------------------------------------
alter table public.products
  add column if not exists kind text not null default 'simple'
    check (kind in ('simple', 'composite'));

comment on column public.products.kind is
  'simple = stock propio (descuenta su stock_qty al vender); '
  'composite = stock derivado de insumos (descuenta product_components al vender). '
  'Insumos son productos simple. El licor queda simple sin stock_tracking.';

-- ------------------------------------------------------------
-- 2. stock_movements — auditoría append-only de movimientos de stock.
--    qty CON SIGNO: negativo = salida (venta/ajuste de merma),
--                   positivo = entrada (reposición/devolución).
--    NO se escribe directo desde el cliente: solo vía funciones SECURITY
--    DEFINER (adjust_stock, y la futura deduct_stock_for_order), que saltan
--    RLS. Por eso NO hay política de INSERT, ni de UPDATE/DELETE (append-only).
-- ------------------------------------------------------------
create table public.stock_movements (
  id            uuid        primary key default gen_random_uuid(),
  restaurant_id uuid        not null references public.restaurants on delete cascade,
  product_id    uuid        not null references public.products    on delete restrict,
  type          text        not null check (type in ('sale', 'adjustment', 'return')),
  qty           integer     not null check (qty <> 0),
  reference_id  uuid,       -- FK lógico (apunta a orders.id u otra entidad); sin declarar
  notes         text,
  created_by    uuid        references public.profiles on delete set null,
  created_at    timestamptz not null default now()
);

comment on table public.stock_movements is
  'Auditoría append-only de movimientos de stock. qty con signo: '
  '- salida, + entrada. type: sale (venta), adjustment (ajuste manual), '
  'return (devolución/reverso). Se escribe SOLO vía funciones SECURITY DEFINER.';
comment on column public.stock_movements.reference_id is
  'FK lógico (no declarado): para type=sale apunta a orders.id.';

create index idx_stock_movements_restaurant_created
  on public.stock_movements (restaurant_id, created_at desc);
create index idx_stock_movements_product
  on public.stock_movements (product_id);

-- ------------------------------------------------------------
-- 3. product_components — receta / BOM de un nivel.
--    parent_id (composite) se compone de N component_id (insumos simple).
--    qty: cuántas unidades del insumo consume UNA unidad del producto padre.
--    ON DELETE CASCADE en parent: borrar el producto compuesto borra su receta.
--    ON DELETE RESTRICT en component: no se borra un insumo usado en recetas.
-- ------------------------------------------------------------
create table public.product_components (
  id            uuid        primary key default gen_random_uuid(),
  restaurant_id uuid        not null references public.restaurants on delete cascade,
  parent_id     uuid        not null references public.products    on delete cascade,
  component_id  uuid        not null references public.products    on delete restrict,
  qty           integer     not null check (qty > 0),
  created_at    timestamptz not null default now(),
  unique (parent_id, component_id),
  check (parent_id <> component_id)
);

comment on table public.product_components is
  'Receta (BOM de un nivel): qué insumos y en qué cantidad consume un producto '
  'compuesto. qty = unidades de insumo por UNA unidad del producto padre.';

create index idx_product_components_parent on public.product_components (parent_id);

-- ------------------------------------------------------------
-- 4. RLS
--    Patrón del repo (extras): ver por sede; editar con
--    has_permission('productos.editar').
-- ------------------------------------------------------------
alter table public.stock_movements    enable row level security;
alter table public.product_components enable row level security;

-- stock_movements -----------------------------------------
-- Solo SELECT de la propia sede. Sin INSERT/UPDATE/DELETE: la escritura
-- ocurre exclusivamente vía funciones SECURITY DEFINER (append-only).
create policy "stock_movements: ver de mi sede"
  on public.stock_movements for select to authenticated
  using (restaurant_id = get_my_restaurant_id());

-- product_components ---------------------------------------
create policy "product_components: ver de mi sede"
  on public.product_components for select to authenticated
  using (restaurant_id = get_my_restaurant_id());

create policy "product_components: crear con permiso"
  on public.product_components for insert to authenticated
  with check (
    restaurant_id = get_my_restaurant_id()
    and has_permission('productos.editar')
  );

create policy "product_components: editar con permiso"
  on public.product_components for update to authenticated
  using  (restaurant_id = get_my_restaurant_id() and has_permission('productos.editar'))
  with check (restaurant_id = get_my_restaurant_id());

create policy "product_components: borrar con permiso"
  on public.product_components for delete to authenticated
  using (restaurant_id = get_my_restaurant_id() and has_permission('productos.editar'));

-- ------------------------------------------------------------
-- 5. adjust_stock(p_product_id, p_qty, p_reason) → void
--    Ajuste manual de inventario. qty CON SIGNO (+entrada / -salida).
--    UPDATE de stock + INSERT del movimiento en UNA función (atómico):
--    no se hace en 2 llamadas del cliente (aprendizaje del spec G-Mura).
--
--    ¿Por qué SECURITY DEFINER?
--      El UPDATE sobre products tiene RLS solo-admin; un usuario con permiso
--      'productos.editar' debe poder ajustar stock sin tener UPDATE general.
--      La función valida sede + permiso explícitamente antes de tocar nada.
--      (Aprendizaje Fase 0: revoke a public/anon, grant a authenticated.)
-- ------------------------------------------------------------
create or replace function public.adjust_stock(
  p_product_id uuid,
  p_qty        integer,
  p_reason     text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid;
  v_kind          text;
begin
  if p_qty = 0 then
    raise exception 'El ajuste de stock no puede ser 0';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'El ajuste de stock requiere un motivo';
  end if;

  -- El producto debe existir y ser de la sede activa del llamante.
  select restaurant_id, kind into v_restaurant_id, v_kind
  from public.products
  where id = p_product_id;

  if v_restaurant_id is null then
    raise exception 'El producto % no existe', p_product_id;
  end if;
  if v_restaurant_id <> get_my_restaurant_id() then
    raise exception 'El producto no pertenece a tu sede';
  end if;
  if not has_permission('productos.editar') then
    raise exception 'No autorizado para ajustar inventario';
  end if;
  -- Los productos compuestos no tienen stock propio (su stock es derivado).
  if v_kind <> 'simple' then
    raise exception 'Solo los productos simples (insumos) tienen stock ajustable';
  end if;

  -- UPDATE + movimiento, atómico. Sin piso: el stock puede quedar negativo
  -- a propósito (señal de sobreventa / merma).
  update public.products
  set stock_qty = coalesce(stock_qty, 0) + p_qty
  where id = p_product_id;

  insert into public.stock_movements
    (restaurant_id, product_id, type, qty, reference_id, notes, created_by)
  values
    (v_restaurant_id, p_product_id, 'adjustment', p_qty, null, p_reason, auth.uid());
end;
$$;

revoke execute on function public.adjust_stock(uuid, integer, text) from public;
revoke execute on function public.adjust_stock(uuid, integer, text) from anon;
grant  execute on function public.adjust_stock(uuid, integer, text) to authenticated;

-- ------------------------------------------------------------
-- 6. [PENDIENTE DE APROBACIÓN] deduct_stock_for_order — descuento por receta
--    al vender. NO se incluye todavía: hay que decidir el enfoque de
--    integración con add_order_items_with_extras para evitar:
--      - doble descuento (extras + receta sobre el mismo insumo, o doble
--        invocación), y
--      - desfase de tiempo entre POS (un solo add al cobrar) y Mesas (adds
--        incrementales; el cobro NO reinserta ítems).
--    Ver la recomendación de diseño entregada junto a esta migración.
--    Se añadirá en este mismo archivo una vez aprobado el enfoque.
-- ------------------------------------------------------------

commit;
