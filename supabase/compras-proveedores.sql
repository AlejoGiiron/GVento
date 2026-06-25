-- ============================================================
-- G-Vento — Compras / Proveedores (F5) · Parte 1: BD
--
-- MVP aprobado:
--   • Proveedores (suppliers) por sede.
--   • Factura de compra (purchase_invoices + purchase_invoice_items) que
--     SUBE el stock de los insumos comprados.
--   • La compra ACTUALIZA el precio de costo del producto (cost_price =
--     último costo conocido).
--   • Pago COMPLETO al registrar (sin pagos parciales ni cuentas por pagar).
--   • Si el pago es en efectivo Y hay turno abierto → egreso de caja (F1),
--     impacta el cuadre. Si no hay turno → la compra se registra igual,
--     SIN tocar caja (ver nota de diseño abajo y el flag de retorno).
--   • Permiso nuevo: compras.gestionar (owner/admin).
--
-- Patrones del repo respetados:
--   • Migración NUEVA, atómica (begin/commit). No edita migraciones aplicadas.
--   • RLS por sede; escritura con has_permission('compras.gestionar').
--   • Función de registro SECURITY DEFINER + search_path fijo + revoke
--     public/anon + grant authenticated (aprendizaje Fase 0).
--   • No se confía en el JSON del cliente para datos sensibles: restaurant_id,
--     total y subtotales se DERIVAN en la BD; del JSON se usan supplier_id,
--     invoice_number, payment_method, notes y, por ítem, product_id/qty/unit_cost
--     (unit_cost es legítimamente capturado del documento físico).
--
-- Ejecutar en: Supabase Dashboard > SQL Editor. NO aplicada todavía.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 0. products.cost_price — precio de costo (último costo conocido).
--    NO existía. Nullable: desconocido hasta la primera compra del producto.
--    No bloquea nada de inventario; es informativo (margen, reportes futuros).
-- ------------------------------------------------------------
alter table public.products
  add column if not exists cost_price numeric(12, 2) check (cost_price >= 0);

comment on column public.products.cost_price is
  'Último costo de compra conocido del producto (lo actualiza register_purchase). '
  'Nulo hasta la primera compra. Informativo: no afecta el descuento de stock.';

-- ------------------------------------------------------------
-- 1. suppliers — proveedores por sede.
-- ------------------------------------------------------------
create table public.suppliers (
  id            uuid        primary key default gen_random_uuid(),
  restaurant_id uuid        not null references public.restaurants on delete cascade,
  name          text        not null,
  contact_name  text,
  phone         text,
  document      text,       -- NIT / cédula / documento del proveedor
  notes         text,
  is_active     boolean     not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.suppliers is
  'Proveedores de la sede. Borrado lógico vía is_active (no se borra si tiene '
  'facturas: purchase_invoices.supplier_id es ON DELETE RESTRICT).';

create index idx_suppliers_restaurant on public.suppliers (restaurant_id);

create trigger trg_suppliers_updated_at
  before update on public.suppliers
  for each row execute function public.handle_updated_at();

-- ------------------------------------------------------------
-- 2. purchase_invoices — cabecera de la factura de compra.
--    total se DERIVA en register_purchase (suma de subtotales); no se confía
--    en el total del cliente. created_by = quién registró la compra.
-- ------------------------------------------------------------
create table public.purchase_invoices (
  id             uuid           primary key default gen_random_uuid(),
  restaurant_id  uuid           not null references public.restaurants on delete cascade,
  supplier_id    uuid           not null references public.suppliers   on delete restrict,
  invoice_number text,          -- número de la factura física del proveedor (opcional)
  total          numeric(12, 2) not null default 0 check (total >= 0),
  payment_method text           not null check (payment_method in ('cash', 'card', 'transfer', 'nequi')),
  notes          text,
  created_by     uuid           references public.profiles on delete set null,
  created_at     timestamptz    not null default now()
);

comment on table public.purchase_invoices is
  'Factura de compra a proveedor. Pago COMPLETO al registrar (sin cuentas por '
  'pagar). total derivado de los ítems por register_purchase.';

create index idx_purchase_invoices_restaurant_created
  on public.purchase_invoices (restaurant_id, created_at desc);
create index idx_purchase_invoices_supplier
  on public.purchase_invoices (supplier_id);

-- ------------------------------------------------------------
-- 3. purchase_invoice_items — líneas de la factura.
--    subtotal = qty * unit_cost (lo calcula register_purchase).
--    product_id ON DELETE RESTRICT: no se borra un producto con historial de compra.
-- ------------------------------------------------------------
create table public.purchase_invoice_items (
  id          uuid           primary key default gen_random_uuid(),
  invoice_id  uuid           not null references public.purchase_invoices on delete cascade,
  product_id  uuid           not null references public.products          on delete restrict,
  qty         integer        not null check (qty > 0),
  unit_cost   numeric(12, 2) not null check (unit_cost >= 0),
  subtotal    numeric(12, 2) not null check (subtotal >= 0),
  created_at  timestamptz    not null default now()
);

comment on table public.purchase_invoice_items is
  'Líneas de una factura de compra. subtotal = qty * unit_cost. La pertenencia '
  'a la sede se hereda vía purchase_invoices (RLS por la fila padre).';

create index idx_purchase_invoice_items_invoice on public.purchase_invoice_items (invoice_id);
create index idx_purchase_invoice_items_product on public.purchase_invoice_items (product_id);

-- ------------------------------------------------------------
-- 4. stock_movements.type — agregar 'purchase' al check.
--    Hoy el check inline es ('sale','adjustment','return'). Se resuelve el
--    constraint por su definición (no por nombre fijo) y se reemplaza, igual
--    que en products-allow-negative-stock.sql.
-- ------------------------------------------------------------
do $$
declare
  v_constraint text;
begin
  select conname into v_constraint
  from pg_constraint
  where conrelid = 'public.stock_movements'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%adjustment%';  -- identifica el check de type

  if v_constraint is not null then
    execute format('alter table public.stock_movements drop constraint %I', v_constraint);
  end if;
end $$;

alter table public.stock_movements
  add constraint stock_movements_type_check
  check (type in ('sale', 'adjustment', 'return', 'purchase'));

comment on column public.stock_movements.reference_id is
  'FK lógico (no declarado): type=sale apunta a orders.id; '
  'type=purchase apunta a purchase_invoices.id.';

-- ------------------------------------------------------------
-- 5. RLS
--    Patrón del repo: ver por sede; escribir con has_permission('compras.gestionar').
-- ------------------------------------------------------------
alter table public.suppliers              enable row level security;
alter table public.purchase_invoices      enable row level security;
alter table public.purchase_invoice_items enable row level security;

-- suppliers ------------------------------------------------
create policy "suppliers: ver de mi sede"
  on public.suppliers for select to authenticated
  using (restaurant_id = get_my_restaurant_id());

create policy "suppliers: crear con permiso"
  on public.suppliers for insert to authenticated
  with check (restaurant_id = get_my_restaurant_id() and has_permission('compras.gestionar'));

create policy "suppliers: editar con permiso"
  on public.suppliers for update to authenticated
  using  (restaurant_id = get_my_restaurant_id() and has_permission('compras.gestionar'))
  with check (restaurant_id = get_my_restaurant_id());

create policy "suppliers: borrar con permiso"
  on public.suppliers for delete to authenticated
  using (restaurant_id = get_my_restaurant_id() and has_permission('compras.gestionar'));

-- purchase_invoices ----------------------------------------
-- Lectura por sede. La creación ocurre vía register_purchase (DEFINER, salta
-- RLS); se deja la política de INSERT por consistencia/defensa en profundidad.
-- Sin UPDATE/DELETE: una factura registrada es inmutable (append-only de compra).
create policy "purchase_invoices: ver de mi sede"
  on public.purchase_invoices for select to authenticated
  using (restaurant_id = get_my_restaurant_id());

create policy "purchase_invoices: crear con permiso"
  on public.purchase_invoices for insert to authenticated
  with check (restaurant_id = get_my_restaurant_id() and has_permission('compras.gestionar'));

-- purchase_invoice_items -----------------------------------
-- RLS heredada de la factura padre (patrón order_item_extras).
create policy "purchase_invoice_items: ver de mi sede"
  on public.purchase_invoice_items for select to authenticated
  using (
    exists (
      select 1 from public.purchase_invoices i
      where i.id = invoice_id and i.restaurant_id = get_my_restaurant_id()
    )
  );

-- ------------------------------------------------------------
-- 6. Permiso nuevo: compras.gestionar
--    Catálogo (ver multi-tenant-rbac.sql):
--      compras.gestionar   registrar compras y gestionar proveedores
--    Se siembra SOLO en admin (no cajero/mozo). El owner NO se incluye: ya
--    hereda compras.gestionar (y cualquier permiso futuro) vía el comodín "*"
--    de su rol (ver owner-wildcard-permission.sql). Sembrarlo en owner sería
--    redundante. Idempotente: aplica a todas las organizaciones (G-10 y LAB)
--    y no duplica si admin ya lo tiene.
-- ------------------------------------------------------------
update public.roles
   set permissions = permissions || '["compras.gestionar"]'::jsonb
 where name = 'admin'
   and not (permissions ? 'compras.gestionar');

-- ------------------------------------------------------------
-- 7. register_purchase(p_invoice jsonb, p_items jsonb) → jsonb
--    Registra una compra completa de forma ATÓMICA:
--      · crea purchase_invoice + purchase_invoice_items
--      · por ítem: sube stock (si stock_tracking) + stock_movement('purchase',+qty)
--        + actualiza cost_price (último costo)
--      · si pago efectivo y hay turno abierto → cash_movement('out') por el total
--
--    ¿Por qué SECURITY DEFINER?
--      Sube stock (UPDATE products, RLS solo-admin), escribe stock_movements
--      (append-only, sin política de INSERT) e inserta cash_movements. Un usuario
--      con compras.gestionar debe poder hacerlo sin tener UPDATE general. La
--      función valida sede + permiso explícitamente antes de tocar nada.
--
--    Retorna jsonb para que la UI sepa qué pasó con la caja:
--      { invoice_id, total, cash_movement_created, shift_open }
--    (clave para advertir "compra registrada pero NO impactó la caja: sin turno").
--
--    DECISIÓN — efectivo sin turno abierto: NO se bloquea la compra. La compra
--    es un hecho real (la mercancía entró); bloquearla por no haber turno frenaría
--    la operación. Se registra la factura y se sube el stock, pero NO se crea el
--    movimiento de caja (no hay turno al cual atribuirlo; ese efectivo no salió de
--    una caja abierta). shift_open=false en el retorno → la UI advierte.
-- ------------------------------------------------------------
create or replace function public.register_purchase(
  p_invoice jsonb,
  p_items   jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id  uuid := get_my_restaurant_id();
  v_supplier_id    uuid := (p_invoice->>'supplier_id')::uuid;
  v_payment_method text := p_invoice->>'payment_method';
  v_invoice_number text := nullif(p_invoice->>'invoice_number', '');
  v_notes          text := nullif(p_invoice->>'notes', '');
  v_supplier_name  text;
  v_invoice_id     uuid;
  v_total          numeric(12, 2) := 0;
  v_item           jsonb;
  v_product_id     uuid;
  v_qty            integer;
  v_unit_cost      numeric(12, 2);
  v_subtotal       numeric(12, 2);
  v_tracking       boolean;
  v_shift_id       uuid;
  v_cash_amount    integer;
  v_cash_created   boolean := false;
begin
  -- 1. Permiso + sede.
  if v_restaurant_id is null then
    raise exception 'No tienes una sede activa';
  end if;
  if not has_permission('compras.gestionar') then
    raise exception 'No autorizado para registrar compras';
  end if;

  -- 2. Validar método de pago y proveedor (debe ser de la sede).
  if v_payment_method is null
     or v_payment_method not in ('cash', 'card', 'transfer', 'nequi') then
    raise exception 'Método de pago inválido: %', coalesce(v_payment_method, '(null)');
  end if;

  select name into v_supplier_name
  from public.suppliers
  where id = v_supplier_id and restaurant_id = v_restaurant_id;
  if v_supplier_name is null then
    raise exception 'El proveedor no existe o no pertenece a tu sede';
  end if;

  -- 3. Debe haber al menos un ítem.
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'La compra no tiene ítems';
  end if;

  -- 4. Crear la cabecera (total se actualiza al final con la suma real).
  insert into public.purchase_invoices
    (restaurant_id, supplier_id, invoice_number, total, payment_method, notes, created_by)
  values
    (v_restaurant_id, v_supplier_id, v_invoice_number, 0, v_payment_method, v_notes, auth.uid())
  returning id into v_invoice_id;

  -- 5. Procesar cada ítem.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty        := (v_item->>'qty')::integer;
    v_unit_cost  := (v_item->>'unit_cost')::numeric;

    if v_qty is null or v_qty <= 0 then
      raise exception 'Cantidad inválida para el producto %', v_product_id;
    end if;
    if v_unit_cost is null or v_unit_cost < 0 then
      raise exception 'Costo unitario inválido para el producto %', v_product_id;
    end if;

    -- El producto debe ser de la sede. Leemos stock_tracking de la BD (confianza).
    select stock_tracking into v_tracking
    from public.products
    where id = v_product_id and restaurant_id = v_restaurant_id;
    if not found then
      raise exception 'El producto % no pertenece a tu sede', v_product_id;
    end if;

    v_subtotal := v_qty * v_unit_cost;
    v_total    := v_total + v_subtotal;

    insert into public.purchase_invoice_items
      (invoice_id, product_id, qty, unit_cost, subtotal)
    values
      (v_invoice_id, v_product_id, v_qty, v_unit_cost, v_subtotal);

    -- Sube stock SOLO si el producto se inventaría. El compuesto (stock_tracking
    -- normalmente false) no recibe stock propio; se compran sus insumos (simple).
    if v_tracking then
      update public.products
         set stock_qty = coalesce(stock_qty, 0) + v_qty
       where id = v_product_id;

      insert into public.stock_movements
        (restaurant_id, product_id, type, qty, reference_id, notes, created_by)
      values
        (v_restaurant_id, v_product_id, 'purchase', v_qty, v_invoice_id,
         'Compra a ' || v_supplier_name, auth.uid());
    end if;

    -- Actualiza el último costo conocido (aplica a todo producto comprado).
    update public.products
       set cost_price = v_unit_cost
     where id = v_product_id;
  end loop;

  -- 6. Persistir el total derivado.
  update public.purchase_invoices
     set total = v_total
   where id = v_invoice_id;

  -- 7. Pago en efectivo → egreso de caja si hay turno abierto.
  --    amount es integer > 0; el total se redondea a peso (COP no usa decimales).
  v_shift_id := null;
  if v_payment_method = 'cash' then
    select id into v_shift_id
    from public.cash_shifts
    where restaurant_id = v_restaurant_id and closed_at is null
    limit 1;  -- idx_cash_shifts_one_open garantiza a lo sumo uno

    v_cash_amount := round(v_total)::integer;
    if v_shift_id is not null and v_cash_amount > 0 then
      insert into public.cash_movements
        (shift_id, restaurant_id, type, amount, reason, created_by)
      values
        (v_shift_id, v_restaurant_id, 'out', v_cash_amount,
         'Compra a proveedor ' || v_supplier_name
           || coalesce(' (factura ' || v_invoice_number || ')', ''),
         auth.uid());
      v_cash_created := true;
    end if;
  end if;

  return jsonb_build_object(
    'invoice_id',            v_invoice_id,
    'total',                 v_total,
    'cash_movement_created', v_cash_created,
    'shift_open',            (v_shift_id is not null)
  );
end;
$$;

revoke execute on function public.register_purchase(jsonb, jsonb) from public;
revoke execute on function public.register_purchase(jsonb, jsonb) from anon;
grant  execute on function public.register_purchase(jsonb, jsonb) to authenticated;

commit;
