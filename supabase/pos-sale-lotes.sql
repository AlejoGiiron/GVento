-- supabase/pos-sale-lotes.sql
-- ============================================================================
-- PASO 2: la venta del POS en UNA transacción, y las tandas de Mesas sin duplicar.
--
-- 1. public.order_item_lotes + add_order_items_with_extras(p_order_id, p_items,
--    p_lote uuid DEFAULT NULL):
--    · CLAVE POR TANDA: si p_lote ya se registró para esa orden, no hace nada y
--      devuelve éxito (no error). Cubre el reenvío automático de Chromium
--      (docs/DEUDAS.md → "El navegador ejecuta DOS VECES"): en Mesas, una tanda
--      reenviada duplicaba la comanda y el stock.
--    · RECALCULA orders.total DESDE LAS LÍNEAS (ítems + extras − discount_amount)
--      dentro de la misma transacción. Antes lo escribía el cliente en valor
--      absoluto (currentTotal + addedTotal, con su copia del total): dos equipos
--      agregando a la misma mesa se pisaban y la mesa cobraba DE MENOS (H1,
--      mesas-total-anomalias.sql).
--    · BLOQUEA LA ORDEN al empezar (for update): dos tandas simultáneas se
--      serializan y la segunda recalcula viendo las líneas de la primera.
--    · Se BORRA la versión de 2 argumentos en este mismo archivo: con las dos
--      vivas, una llamada con (p_order_id, p_items) falla con PGRST203 ("Could
--      not choose the best candidate function") — medido en Docker el 2026-10-04.
--      Con DEFAULT NULL, las llamadas viejas de 2 argumentos (el frontend
--      anterior a este paso) caen en la nueva y siguen funcionando.
--
-- 2. public.register_pos_sale(p_sale_id, p_order, p_items, p_payments): la venta
--    del POS completa en UNA transacción (diseño aprobado 2026-10-01/04):
--    · IDEMPOTENTE por p_sale_id (lo genera el cliente; es el id de la orden).
--      Si la venta ya existe, devuelve la venta hecha con ya_existia = true, con
--      ÉXITO. Esto se mira PRIMERO, antes de exigir turno: un reenvío que llega
--      después de un cierre de turno igual tiene que ver su venta, no un error.
--    · TURNO obligatorio (también fiado y venta gratis), FOR SHARE, primer lock.
--    · Ítems por add_order_items_with_extras (el mismo camino que descuenta stock).
--    · B1: el total que calcula la base desde las líneas tiene que coincidir con
--      el del carrito; si no, RECHAZA y dice qué no coincide (no lo corrige).
--    · Descuento > 0 exige has_permission('pos.descuento'); fiado exige
--      has_permission('fiado.gestionar').
--    · Pago por register_sale_payment (valida Σ pagos = total y el turno).
--    · Número de venta AL FINAL (next_order_number): store_sequences es una tabla,
--      así que si algo falla el rollback devuelve el número; sin huecos.
--    · Si cualquier paso falla: no queda NADA (ni orden, ni ítems, ni stock, ni
--      pago, ni número).
--
-- PROTOCOLO DE LOCKS (close-cash-shift.sql): turno (FOR SHARE) → orden.
--
-- FRONTEND: register_pos_sale es NUEVA; el frontend anterior a este paso no la
-- llama, y su llamada de 2 argumentos a add_order_items_with_extras sigue
-- funcionando. Aplicar ANTES del frontend que llama a register_pos_sale / manda
-- p_lote (useSaleCheckout, useAgregarTanda).
-- ⚠️ El frontend ANTERIOR de Mesas, después de agregar, escribe el total desde el
-- cliente (updateOrderTotal): mientras siga abierto en algún equipo, esa escritura
-- pisa el total recalculado. El frontend de este paso ya no la hace.
--
-- RE-APLICAR: idempotente (if not exists, drop if exists, create or replace).
-- 🔴 Re-aplicar DESPUÉS de este archivo order-items-stock-recipes.sql u
-- order-extras-rpc.sql recrea la versión de 2 argumentos AL LADO de la de 3.
-- Medido en Docker el 2026-10-04 con las dos vivas: la llamada de 2 argumentos
-- (frontend ANTERIOR a este paso: POS y Mesas) falla con PGRST203; la de 3 con
-- p_lote (Mesas nueva) y register_pos_sale siguen andando. Se arregla
-- re-aplicando ESTE archivo, que borra la de 2 (DEUDAS → "Re-aplicar una
-- migración vieja").
--
-- NO DEDUZCAS EL ESTADO DE ESTE COMENTARIO — correlo:
--   select oid::regprocedure from pg_proc
--    where proname in ('add_order_items_with_extras', 'register_pos_sale') order by 1;
--   -- esperado: add_order_items_with_extras(uuid,jsonb,uuid) y
--   --           register_pos_sale(uuid,jsonb,jsonb,jsonb). NINGUNA (uuid,jsonb).
-- ============================================================================

begin;

-- ── 1. Tandas ────────────────────────────────────────────────────────────────
create table if not exists public.order_item_lotes (
  id         uuid        primary key,                    -- lo genera el cliente por tanda
  order_id   uuid        not null references public.orders(id) on delete cascade,
  created_by uuid        references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.order_item_lotes enable row level security;
-- Sin policies a propósito: solo se escribe desde add_order_items_with_extras.
revoke all on table public.order_item_lotes from anon, authenticated;

drop function if exists public.add_order_items_with_extras(uuid, jsonb);

create or replace function public.add_order_items_with_extras(
  p_order_id uuid,
  p_items    jsonb,
  p_lote     uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id     uuid;
  v_order_created_by  uuid;
  v_created_by        uuid;
  v_item              jsonb;
  v_item_id           uuid;
  v_item_qty          integer;
  v_product_id        uuid;
  v_kind              text;
  v_stock_tracking    boolean;
  v_comp              record;
  v_comp_total        integer;
  v_extra             jsonb;
  v_extra_id          uuid;
  v_extra_qty         integer;
  v_extra_price       numeric(12, 2);
  v_extra_linked      uuid;
  v_total_qty         integer;
  v_lote_orden        uuid;
begin
  -- 1. La orden debe existir y pertenecer a la sede activa del llamante.
  --    FOR UPDATE: las tandas de una misma orden se serializan, y el total que
  --    se recalcula al final ve las líneas de la tanda anterior.
  select restaurant_id, created_by
  into v_restaurant_id, v_order_created_by
  from public.orders
  where id = p_order_id
  for update;

  if v_restaurant_id is null then
    raise exception 'La orden % no existe', p_order_id;
  end if;
  if v_restaurant_id <> get_my_restaurant_id() then
    raise exception 'La orden no pertenece a tu sede';
  end if;

  -- 1b. CLAVE POR TANDA: si esta tanda ya se registró, no se repite. Devuelve
  --     éxito: es el reenvío de algo que ya está hecho.
  if p_lote is not null then
    insert into public.order_item_lotes (id, order_id, created_by)
    values (p_lote, p_order_id, auth.uid())
    on conflict (id) do nothing;
    if not found then
      select order_id into v_lote_orden from public.order_item_lotes where id = p_lote;
      if v_lote_orden is distinct from p_order_id then
        raise exception 'La tanda % es de otra orden', p_lote;
      end if;
      return;
    end if;
  end if;

  -- Autor de los movimientos de stock: el usuario actual; si por algún motivo
  -- no hay sesión (no debería en DEFINER llamado por authenticated), cae al
  -- created_by de la orden.
  v_created_by := coalesce(auth.uid(), v_order_created_by);

  -- 2. Cada ítem con sus extras.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_qty   := (v_item->>'qty')::integer;
    v_product_id := (v_item->>'product_id')::uuid;

    select kind, stock_tracking
    into v_kind, v_stock_tracking
    from public.products
    where id = v_product_id and restaurant_id = v_restaurant_id;
    if not found then
      raise exception 'El producto % no pertenece a tu sede', v_product_id;
    end if;

    insert into public.order_items (order_id, product_id, qty, unit_price, notes)
    values (
      p_order_id,
      v_product_id,
      v_item_qty,
      (v_item->>'unit_price')::numeric,
      nullif(v_item->>'notes', '')
    )
    returning id into v_item_id;

    -- DESCUENTO DE STOCK POR PRODUCTO (inventario por recetas). SIN piso.
    if v_item_qty > 0 then
      if v_kind = 'simple' then
        if v_stock_tracking then
          update public.products
          set stock_qty = coalesce(stock_qty, 0) - v_item_qty
          where id = v_product_id and restaurant_id = v_restaurant_id;

          insert into public.stock_movements
            (restaurant_id, product_id, type, qty, reference_id, created_by)
          values
            (v_restaurant_id, v_product_id, 'sale', -v_item_qty, p_order_id, v_created_by);
        end if;

      elsif v_kind = 'composite' then
        for v_comp in
          select pc.component_id, pc.qty as recipe_qty
          from public.product_components pc
          join public.products p on p.id = pc.component_id
          where pc.parent_id = v_product_id
            and pc.restaurant_id = v_restaurant_id
            and p.stock_tracking = true
        loop
          v_comp_total := v_comp.recipe_qty * v_item_qty;

          update public.products
          set stock_qty = coalesce(stock_qty, 0) - v_comp_total
          where id = v_comp.component_id and restaurant_id = v_restaurant_id;

          insert into public.stock_movements
            (restaurant_id, product_id, type, qty, reference_id, created_by)
          values
            (v_restaurant_id, v_comp.component_id, 'sale', -v_comp_total, p_order_id, v_created_by);
        end loop;
      end if;
    end if;

    -- EXTRAS: precio y producto vinculado se LEEN de la BD, no del JSON.
    for v_extra in
      select * from jsonb_array_elements(coalesce(v_item->'extras', '[]'::jsonb))
    loop
      v_extra_id  := (v_extra->>'extra_id')::uuid;
      v_extra_qty := (v_extra->>'qty')::integer;

      if v_extra_qty <= 0 then
        continue;
      end if;

      select price, linked_product_id
      into v_extra_price, v_extra_linked
      from public.extras
      where id = v_extra_id
        and restaurant_id = v_restaurant_id
        and is_active = true;

      if not found then
        raise exception 'Extra % no es válido para esta sede', v_extra_id;
      end if;

      perform 1 from public.product_extras
      where product_id = v_product_id and extra_id = v_extra_id;
      if not found then
        raise exception 'El extra % no está asignado al producto %', v_extra_id, v_product_id;
      end if;

      v_total_qty := v_extra_qty * v_item_qty;

      insert into public.order_item_extras (order_item_id, extra_id, qty, unit_price)
      values (v_item_id, v_extra_id, v_total_qty, v_extra_price);

      if v_extra_linked is not null then
        update public.products
        set stock_qty = coalesce(stock_qty, 0) - v_total_qty
        where id = v_extra_linked
          and restaurant_id = v_restaurant_id
          and stock_tracking = true;
      end if;
    end loop;
  end loop;

  -- 3. TOTAL DESDE LAS LÍNEAS (la base es la dueña del total, no el cliente):
  --    ítems + extras − el descuento ya aplicado a la orden. Mismo invariante que
  --    usa el checkout de Mesas (subtotal = total + discount_amount).
  update public.orders o
     set total = greatest(0,
           coalesce((select sum(i.qty * i.unit_price) from public.order_items i where i.order_id = o.id), 0)
         + coalesce((select sum(e.qty * e.unit_price) from public.order_item_extras e
                       join public.order_items i on i.id = e.order_item_id where i.order_id = o.id), 0)
         - coalesce(o.discount_amount, 0))
   where o.id = p_order_id;
end;
$$;

revoke execute on function public.add_order_items_with_extras(uuid, jsonb, uuid) from public, anon;
grant  execute on function public.add_order_items_with_extras(uuid, jsonb, uuid) to authenticated;

-- ── 2. La venta del POS en una transacción ──────────────────────────────────
create or replace function public.register_pos_sale(
  p_sale_id  uuid,
  p_order    jsonb,
  p_items    jsonb,
  p_payments jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sede        uuid;
  v_existente   record;
  v_tipo        text    := coalesce(p_order->>'type', 'takeaway');
  v_fiado       boolean := coalesce((p_order->>'fiado')::boolean, false);
  v_total_carro numeric := (p_order->>'total')::numeric;
  v_descuento   numeric := coalesce((p_order->>'discount_amount')::numeric, 0);
  v_cliente     uuid    := nullif(p_order->>'customer_id', '')::uuid;
  v_total_base  numeric;
  v_items_base  numeric;
  v_extras_base numeric;
  v_numero      integer;
  v_pagos       jsonb   := coalesce(p_payments, '[]'::jsonb);
begin
  if p_sale_id is null then raise exception 'Falta el id de la venta'; end if;
  if auth.uid() is null then raise exception 'No hay sesión'; end if;

  v_sede := get_my_restaurant_id();
  if v_sede is null then raise exception 'No tienes una sede activa'; end if;

  -- 1. IDEMPOTENCIA, ANTES que todo lo demás: ¿esta venta ya se hizo? Un reenvío
  --    (del navegador o un reintento del cajero) recibe la venta hecha, con
  --    éxito, aunque el turno se haya cerrado en el medio. No escribe nada.
  select id, restaurant_id, order_number, total into v_existente
    from public.orders where id = p_sale_id;
  if found then
    if v_existente.restaurant_id <> v_sede then
      raise exception 'La venta % no es de tu sede', p_sale_id;
    end if;
    return jsonb_build_object('order_id', v_existente.id, 'order_number', v_existente.order_number,
                              'total', v_existente.total, 'ya_existia', true);
  end if;

  -- 2. Permisos (los mismos que el cobro de hoy: register_sale_payment).
  if get_my_role() not in ('admin', 'cashier') then
    raise exception 'No autorizado para registrar ventas';
  end if;
  if v_descuento > 0 and not has_permission('pos.descuento') then
    raise exception 'No tienes permiso para aplicar descuentos';
  end if;
  if v_fiado and not has_permission('fiado.gestionar') then
    raise exception 'No tienes permiso para vender a fiado';
  end if;
  if v_tipo not in ('takeaway', 'delivery') then
    raise exception 'Tipo de venta inválido para el POS: %', v_tipo;
  end if;
  if v_total_carro is null then raise exception 'Falta el total del carrito'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta no tiene ítems';
  end if;
  if v_fiado then
    if v_cliente is null then raise exception 'Selecciona un cliente para la venta a fiado'; end if;
    perform 1 from public.customers where id = v_cliente and restaurant_id = v_sede;
    if not found then raise exception 'El cliente no es de tu sede'; end if;
    if jsonb_array_length(v_pagos) > 0 then raise exception 'Una venta a fiado no lleva pagos'; end if;
  end if;

  -- 3. PROTOCOLO: el turno, PRIMER lock. Obligatorio también para fiado y gratis.
  perform 1 from public.cash_shifts
   where restaurant_id = v_sede and closed_at is null
   limit 1
   for share;
  if not found then
    raise exception 'No hay un turno de caja abierto. Abrí el turno antes de cobrar.';
  end if;

  -- 4. La orden, con el id que mandó el cliente. on conflict: dos llamadas
  --    SIMULTÁNEAS con el mismo id; la segunda espera a la primera y, si ésta
  --    confirmó, devuelve la venta hecha.
  insert into public.orders
    (id, restaurant_id, created_by, type, status, total,
     discount_amount, discount_type, discount_kind, discount_reason,
     payment_status, customer_id, customer_name)
  values
    (p_sale_id, v_sede, auth.uid(), v_tipo::order_type, 'pending', v_total_carro,
     v_descuento,
     case when v_descuento > 0 then nullif(p_order->>'discount_type', '') end,
     case when v_descuento > 0 then coalesce(nullif(p_order->>'discount_kind', ''), 'normal') else 'normal' end,
     case when v_descuento > 0 then nullif(btrim(coalesce(p_order->>'discount_reason', '')), '') end,
     case when v_fiado then 'pending' else 'paid' end,
     case when v_fiado then v_cliente end,
     case when v_fiado then nullif(p_order->>'customer_name', '') end)
  on conflict (id) do nothing;
  if not found then
    select id, restaurant_id, order_number, total into v_existente from public.orders where id = p_sale_id;
    if v_existente.restaurant_id <> v_sede then
      raise exception 'La venta % no es de tu sede', p_sale_id;
    end if;
    return jsonb_build_object('order_id', v_existente.id, 'order_number', v_existente.order_number,
                              'total', v_existente.total, 'ya_existia', true);
  end if;

  -- 5. Ítems: el MISMO camino que descuenta stock. Recalcula orders.total desde
  --    las líneas (menos el descuento).
  perform public.add_order_items_with_extras(p_sale_id, p_items, null);

  -- 6. B1: el total de la base contra el del carrito. VALIDA, no corrige.
  select o.total,
         coalesce((select sum(i.qty * i.unit_price) from public.order_items i where i.order_id = o.id), 0),
         coalesce((select sum(e.qty * e.unit_price) from public.order_item_extras e
                     join public.order_items i on i.id = e.order_item_id where i.order_id = o.id), 0)
    into v_total_base, v_items_base, v_extras_base
    from public.orders o where o.id = p_sale_id;
  if round(v_total_base, 2) <> round(v_total_carro, 2) then
    raise exception 'No se cobró: el total del carrito (%) no coincide con el de las líneas (% = ítems % + extras % − descuento %). Probablemente cambió el precio de un extra: actualizá el carrito y volvé a cobrar.',
      v_total_carro, v_total_base, v_items_base, v_extras_base, v_descuento;
  end if;

  -- 7. Pago. Fiado: sin pago. Total 0 (vale del 100%): sin pago. Si no, el
  --    cobro de siempre, que valida Σ pagos = total y el turno.
  if not v_fiado then
    if v_total_base > 0 then
      perform public.register_sale_payment(p_sale_id, v_pagos);
    elsif jsonb_array_length(v_pagos) > 0 then
      raise exception 'Una venta con total 0 no lleva pagos';
    end if;
  end if;

  -- 8. Número de venta, AL FINAL (sin huecos: el rollback lo devuelve).
  v_numero := public.next_order_number(v_sede);
  update public.orders set order_number = v_numero where id = p_sale_id;

  return jsonb_build_object('order_id', p_sale_id, 'order_number', v_numero,
                            'total', v_total_base, 'ya_existia', false);
end;
$$;

revoke execute on function public.register_pos_sale(uuid, jsonb, jsonb, jsonb) from public, anon;
grant  execute on function public.register_pos_sale(uuid, jsonb, jsonb, jsonb) to authenticated;

commit;
