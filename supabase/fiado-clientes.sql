-- ============================================================
-- G-Vento — Fiado / Cuentas por cobrar + CRM básico · Parte 1: BD
--
-- MVP aprobado:
--   • CRM básico: clientes (customers) por sede.
--   • Venta a fiado = ESTADO en la orden (orders.payment_status), no una
--     entidad separada. La orden apunta al cliente (orders.customer_id).
--   • Abonos parciales permitidos → tabla debt_payments (mayor de abonos por orden).
--   • La venta a fiado NO toca caja (no entró dinero).
--   • Un abono en EFECTIVO con turno abierto SÍ entra como INGRESO de caja
--     ('in') de ese turno; otros métodos (o sin turno) no tocan caja.
--   • Permiso nuevo: fiado.gestionar (admin; el owner lo hereda por comodín "*").
--
-- Patrones del repo respetados (idénticos a compras-proveedores.sql):
--   • Migración NUEVA, atómica (begin/commit). No edita migraciones aplicadas.
--   • RLS por sede; escritura con has_permission('fiado.gestionar').
--   • Función de registro SECURITY DEFINER + search_path fijo + revoke
--     public/anon + grant authenticated (aprendizaje Fase 0).
--   • No se confía en el JSON/args del cliente para datos sensibles: el
--     restaurant_id, el total y el saldo se DERIVAN en la BD a partir de la orden.
--
-- DECISIONES DE DISEÑO (ver recomendaciones en el chat):
--   • Permiso ÚNICO fiado.gestionar cubre CRM + fiado (MVP).
--   • El abono NO puede exceder el saldo pendiente → se BLOQUEA (invariante:
--     suma de abonos <= total; el saldo nunca es negativo). El abono exacto
--     (= saldo) liquida la deuda → payment_status = 'paid'.
--   • La venta a fiado NO crea fila en `payments` ni cash_movement. El abono
--     en efectivo crea SOLO un cash_movement('in') (no una fila en `payments`),
--     para no duplicar el efectivo en el cuadre del turno. debt_payments es el
--     mayor de liquidación del fiado; `payments` queda para el cobro en el POS.
--
-- Ejecutar en: Supabase Dashboard > SQL Editor. NO aplicada todavía.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. customers — clientes (CRM básico) por sede.
--    Borrado lógico vía is_active (no se borra si tiene órdenes a fiado:
--    orders.customer_id es ON DELETE SET NULL, pero conservamos el cliente
--    para no perder la trazabilidad de la deuda).
-- ------------------------------------------------------------
create table public.customers (
  id            uuid        primary key default gen_random_uuid(),
  restaurant_id uuid        not null references public.restaurants on delete cascade,
  name          text        not null,
  phone         text,
  document      text,       -- cédula / NIT (opcional)
  notes         text,
  is_active     boolean     not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.customers is
  'Clientes (CRM básico) de la sede. Soportan la venta a fiado (orders.customer_id). '
  'Borrado lógico vía is_active.';

create index idx_customers_restaurant on public.customers (restaurant_id);

create trigger trg_customers_updated_at
  before update on public.customers
  for each row execute function public.handle_updated_at();

-- ------------------------------------------------------------
-- 2. orders — soporte de fiado.
--    Columnas hoy (confirmado contra database.types.ts): courier_id, created_at,
--    created_by, customer_name, customer_phone, delivery_address,
--    estimated_delivery_minutes, id, notes, order_number, restaurant_id, status,
--    table_id, total, type, updated_at, waiter_name. NO existe customer_id ni
--    payment_status → sin colisión.
--
--    payment_status default 'paid' para no romper ninguna venta existente
--    (todas las órdenes ya registradas pasan a 'paid' automáticamente). Solo la
--    venta a fiado usa 'pending'/'partial'. Es un eje ORTOGONAL a orders.status
--    (pending/preparing/.../cancelled), que sigue describiendo el ciclo de cocina.
-- ------------------------------------------------------------
alter table public.orders
  add column if not exists customer_id uuid references public.customers on delete set null;

alter table public.orders
  add column if not exists payment_status text not null default 'paid'
    check (payment_status in ('paid', 'pending', 'partial'));

comment on column public.orders.customer_id is
  'Cliente de la venta a fiado (nullable: la mayoría de ventas no son fiado).';
comment on column public.orders.payment_status is
  'Estado de pago de la orden: paid (default, ventas normales) | pending (fiado sin '
  'abonos) | partial (fiado con abonos < total). Lo recalcula register_debt_payment. '
  'Ortogonal a orders.status (ciclo de cocina).';

create index idx_orders_payment_status
  on public.orders (restaurant_id, payment_status)
  where payment_status <> 'paid';   -- índice parcial: solo el fiado pendiente

-- ------------------------------------------------------------
-- 3. debt_payments — abonos a una venta a fiado.
--    El saldo de una deuda = orders.total − suma(debt_payments.amount) de esa orden.
--    cash_movement_id: si el abono fue en efectivo CON turno abierto, apunta al
--    ingreso de caja generado; nulo en otro caso. Append-only (sin update/delete).
-- ------------------------------------------------------------
create table public.debt_payments (
  id               uuid           primary key default gen_random_uuid(),
  restaurant_id    uuid           not null references public.restaurants on delete cascade,
  order_id         uuid           not null references public.orders      on delete cascade,
  amount           numeric(12, 2) not null check (amount > 0),
  payment_method   text           not null check (payment_method in ('cash', 'card', 'transfer', 'nequi')),
  cash_movement_id uuid           references public.cash_movements on delete set null,
  created_by       uuid           references public.profiles on delete set null,
  created_at       timestamptz    not null default now()
);

comment on table public.debt_payments is
  'Abonos a una venta a fiado (orders con payment_status pending/partial). El saldo '
  'pendiente = orders.total − suma de abonos. cash_movement_id apunta al ingreso de '
  'caja si el abono fue en efectivo con turno abierto. Append-only.';

create index idx_debt_payments_order on public.debt_payments (order_id);
create index idx_debt_payments_restaurant_created
  on public.debt_payments (restaurant_id, created_at desc);

-- ------------------------------------------------------------
-- 4. RLS
--    Patrón del repo: ver por sede; escribir con has_permission('fiado.gestionar').
-- ------------------------------------------------------------
alter table public.customers     enable row level security;
alter table public.debt_payments enable row level security;

-- customers ------------------------------------------------
create policy "customers: ver de mi sede"
  on public.customers for select to authenticated
  using (restaurant_id = get_my_restaurant_id());

create policy "customers: crear con permiso"
  on public.customers for insert to authenticated
  with check (restaurant_id = get_my_restaurant_id() and has_permission('fiado.gestionar'));

create policy "customers: editar con permiso"
  on public.customers for update to authenticated
  using  (restaurant_id = get_my_restaurant_id() and has_permission('fiado.gestionar'))
  with check (restaurant_id = get_my_restaurant_id());

create policy "customers: borrar con permiso"
  on public.customers for delete to authenticated
  using (restaurant_id = get_my_restaurant_id() and has_permission('fiado.gestionar'));

-- debt_payments --------------------------------------------
-- Lectura por sede. La creación ocurre vía register_debt_payment (DEFINER, salta
-- RLS); se deja la política de INSERT por consistencia/defensa en profundidad.
-- Sin UPDATE/DELETE: un abono registrado es inmutable (mayor append-only).
create policy "debt_payments: ver de mi sede"
  on public.debt_payments for select to authenticated
  using (restaurant_id = get_my_restaurant_id());

create policy "debt_payments: crear con permiso"
  on public.debt_payments for insert to authenticated
  with check (restaurant_id = get_my_restaurant_id() and has_permission('fiado.gestionar'));

-- ------------------------------------------------------------
-- 5. Permiso nuevo: fiado.gestionar
--    Catálogo (ver multi-tenant-rbac.sql):
--      fiado.gestionar   gestionar clientes (CRM) y la cuenta de fiado (abonos)
--    Se siembra en admin Y cajero. El owner lo hereda por el comodín "*" de su
--    rol (no se incluye: sería redundante); admin y cajero lo reciben explícito
--    (el cajero opera el fiado en mostrador: vende a fiado y registra abonos).
--    Idempotente: aplica a todas las organizaciones (G-10 y LAB) y no duplica si
--    el rol ya lo tiene.
-- ------------------------------------------------------------
update public.roles
   set permissions = permissions || '["fiado.gestionar"]'::jsonb
 where name in ('admin', 'cajero')
   and not (permissions ? 'fiado.gestionar');

-- ------------------------------------------------------------
-- 6. register_debt_payment(p_order_id uuid, p_amount numeric, p_payment_method text)
--      → jsonb · SECURITY DEFINER
--
--    Registra un abono a una venta a fiado de forma ATÓMICA:
--      · valida sede + permiso + que la orden sea fiado de la sede
--      · valida que el abono no exceda el saldo pendiente (BLOQUEA si excede)
--      · inserta debt_payment
--      · si efectivo Y hay turno abierto → cash_movement('in') por el abono
--        (motivo "Abono de [cliente]…") y guarda el cash_movement_id en el abono
--      · recalcula y actualiza orders.payment_status (paid | partial)
--
--    ¿Por qué SECURITY DEFINER?
--      Inserta en cash_movements (sin política de INSERT general) y actualiza
--      orders (status de pago). Un usuario con fiado.gestionar debe poder hacerlo
--      sin permisos UPDATE generales. La función valida sede + permiso antes de
--      tocar nada y deriva el restaurant_id/saldo de la BD (no del cliente).
--
--    Retorna jsonb para que la UI sepa qué pasó:
--      { new_status, saldo_restante, cash_movement_created, shift_open }
--    (clave para advertir "abono registrado pero NO impactó la caja: sin turno").
--
--    DECISIÓN — efectivo sin turno abierto: NO se bloquea el abono (el cliente
--    pagó de verdad; bloquear frenaría la operación). Se registra el debt_payment
--    pero NO se crea el movimiento de caja (no hay turno al cual atribuirlo).
--    shift_open=false en el retorno → la UI advierte.
-- ------------------------------------------------------------
create or replace function public.register_debt_payment(
  p_order_id       uuid,
  p_amount         numeric,
  p_payment_method text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid := get_my_restaurant_id();
  v_order_total   numeric(12, 2);
  v_pay_status    text;
  v_customer_name text;
  v_order_number  int;
  v_paid          numeric(12, 2);
  v_saldo         numeric(12, 2);
  v_new_paid      numeric(12, 2);
  v_new_saldo     numeric(12, 2);
  v_new_status    text;
  v_shift_id      uuid;
  v_cash_amount   integer;
  v_cash_mov_id   uuid := null;
  v_cash_created  boolean := false;
begin
  -- 1. Permiso + sede.
  if v_restaurant_id is null then
    raise exception 'No tienes una sede activa';
  end if;
  if not has_permission('fiado.gestionar') then
    raise exception 'No autorizado para registrar abonos de fiado';
  end if;

  -- 2. Validar monto y método.
  if p_amount is null or p_amount <= 0 then
    raise exception 'El abono debe ser mayor a cero';
  end if;
  if p_payment_method is null
     or p_payment_method not in ('cash', 'card', 'transfer', 'nequi') then
    raise exception 'Método de pago inválido: %', coalesce(p_payment_method, '(null)');
  end if;

  -- 3. Cargar la orden (debe ser de la sede y estar a fiado).
  select o.total, o.payment_status, o.order_number, c.name
    into v_order_total, v_pay_status, v_order_number, v_customer_name
  from public.orders o
  left join public.customers c on c.id = o.customer_id
  where o.id = p_order_id and o.restaurant_id = v_restaurant_id;

  if not found then
    raise exception 'La orden no existe o no pertenece a tu sede';
  end if;
  if v_pay_status not in ('pending', 'partial') then
    raise exception 'La orden no es una venta a fiado pendiente (estado: %)', v_pay_status;
  end if;

  -- 4. Saldo pendiente = total − abonos previos. El abono no puede excederlo.
  select coalesce(sum(amount), 0) into v_paid
  from public.debt_payments
  where order_id = p_order_id;

  v_saldo := v_order_total - v_paid;
  if p_amount > v_saldo then
    raise exception 'El abono (%) excede el saldo pendiente (%)', p_amount, v_saldo;
  end if;

  -- 5. Efectivo + turno abierto → ingreso de caja ('in') por el abono.
  --    amount es integer > 0; se redondea a peso (COP no usa decimales).
  if p_payment_method = 'cash' then
    select id into v_shift_id
    from public.cash_shifts
    where restaurant_id = v_restaurant_id and closed_at is null
    limit 1;  -- a lo sumo un turno abierto por sede

    v_cash_amount := round(p_amount)::integer;
    if v_shift_id is not null and v_cash_amount > 0 then
      insert into public.cash_movements
        (shift_id, restaurant_id, type, amount, reason, created_by)
      values
        (v_shift_id, v_restaurant_id, 'in', v_cash_amount,
         'Abono de ' || coalesce(v_customer_name, 'cliente')
           || coalesce(' (venta #' || v_order_number || ')', ''),
         auth.uid())
      returning id into v_cash_mov_id;
      v_cash_created := true;
    end if;
  end if;

  -- 6. Registrar el abono (con el cash_movement_id si se creó).
  insert into public.debt_payments
    (restaurant_id, order_id, amount, payment_method, cash_movement_id, created_by)
  values
    (v_restaurant_id, p_order_id, p_amount, p_payment_method, v_cash_mov_id, auth.uid());

  -- 7. Recalcular estado de pago de la orden.
  v_new_paid  := v_paid + p_amount;
  v_new_saldo := v_order_total - v_new_paid;
  v_new_status := case when v_new_saldo <= 0 then 'paid' else 'partial' end;

  update public.orders
     set payment_status = v_new_status
   where id = p_order_id;

  return jsonb_build_object(
    'new_status',            v_new_status,
    'saldo_restante',        v_new_saldo,
    'cash_movement_created', v_cash_created,
    'shift_open',            (v_shift_id is not null)
  );
end;
$$;

revoke execute on function public.register_debt_payment(uuid, numeric, text) from public;
revoke execute on function public.register_debt_payment(uuid, numeric, text) from anon;
grant  execute on function public.register_debt_payment(uuid, numeric, text) to authenticated;

commit;
