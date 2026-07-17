-- ============================================================
-- G-Vento — Anulación de ventas (Fase 2 BD): RPC register_sale_void
--
-- Anula UNA venta del TURNO ACTUAL de forma ATÓMICA:
--   • valida 6 guardas server-side EN ORDEN (nada se modifica hasta pasarlas)
--   • revierte el stock POR ESPEJO EXACTO de add_order_items_with_extras
--   • borra los payments de la orden (sale del cuadre; sin crear cash_movement)
--   • marca la orden como anulada + rastro (no la borra); NO toca payment_status
--
-- Requiere aplicada antes: sale-void.sql (Fase 1: columnas de rastro + permiso
-- ventas.anular + índice único de turno abierto).
--
-- ¿Por qué SECURITY DEFINER?
--   Toca products (RLS solo-admin), stock_movements (append-only sin INSERT de
--   cliente), payments (DELETE sin política) y orders. Un admin con permiso
--   ventas.anular debe poder hacerlo sin UPDATE/DELETE generales. La función
--   valida sede + permiso ANTES de tocar nada y deriva todo de la BD.
--   (Aprendizaje Fase 0: revoke public/anon, grant authenticated.)
--
-- La reversión es el ESPEJO de la deducción de order-items-stock-recipes.sql,
-- pero re-leyendo las FILAS PERSISTIDAS (order_items / order_item_extras) en vez
-- del JSON de venta:
--
--   DEDUCCIÓN (add_order_items_with_extras)      REVERSIÓN (esta RPC)
--   ─────────────────────────────────────────   ──────────────────────────────
--   simple + tracking → stock -= item_qty        simple + tracking → stock += oi.qty
--     movement('sale', -item_qty)                  movement('return', +oi.qty)
--   composite → explota product_components       composite → explota product_components
--     (insumos tracking) stock -= receta*qty       (insumos tracking) stock += receta*qty
--     movement('sale', -receta*qty) por insumo     movement('return', +receta*qty) por insumo
--   extra linked (tracking) → stock -= total     extra linked (tracking) → stock += oie.qty
--     (oie.qty guarda el total = extra*item)       (oie.qty YA es ese total; NO re-multiplicar)
--     SIN movement (asimetría histórica)           CON movement('return') (mejora auditoría)
--
-- Nota de simetría: oie.qty se persiste al vender como (extra_qty × item_qty),
-- así que al revertir se suma oie.qty tal cual (no se vuelve a multiplicar por
-- oi.qty). El compuesto NUNCA toca su propio stock (no tiene). Solo insumos con
-- stock_tracking=true, igual que la deducción.
--
-- Caveat aceptado v1: si la receta cambió entre la venta y la anulación, el
-- espejo usa la receta ACTUAL (la venta es de minutos atrás, mismo turno).
--
-- Ejecutar en: Supabase Dashboard > SQL Editor. Migración NUEVA.
-- ============================================================

create or replace function public.register_sale_void(
  p_order_id uuid,
  p_reason   text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sede             uuid := get_my_restaurant_id();
  v_actor            uuid := auth.uid();
  v_order_sede       uuid;
  v_created_at       timestamptz;
  v_cancelled_at     timestamptz;
  v_pay_status       text;
  v_shift_opened     timestamptz;
  v_oi               record;
  v_comp             record;
  v_ex               record;
  v_kind             text;
  v_tracking         boolean;
  v_ex_tracking      boolean;
  v_comp_total       integer;
  v_stock_returned   integer := 0;
  v_payments_deleted integer := 0;
begin
  -- ========================================================
  -- GUARDAS (en orden estricto; NADA se modifica hasta pasar las 6)
  -- ========================================================

  -- 1. Permiso. has_permission lee el rol del llamante (auth.uid()); el owner
  --    lo cumple por el comodín "*". El cajero NO tiene ventas.anular.
  if not has_permission('ventas.anular') then
    raise exception 'No autorizado para anular ventas';
  end if;

  -- 2. La orden existe Y es de la sede activa. Se lee por id (DEFINER salta RLS)
  --    y se compara restaurant_id contra la sede: mismo mensaje si no existe o si
  --    es de otra sede (no filtra existencia entre tenants).
  select o.restaurant_id, o.created_at, o.cancelled_at, o.payment_status
    into v_order_sede, v_created_at, v_cancelled_at, v_pay_status
  from public.orders o
  where o.id = p_order_id;

  if not found or v_sede is null or v_order_sede <> v_sede then
    raise exception 'La orden no existe o no pertenece a tu sede';
  end if;

  -- 3. No re-anular.
  if v_cancelled_at is not null then
    raise exception 'La venta ya está anulada';
  end if;

  -- 4. Debe haber un turno abierto de la sede. El índice único parcial
  --    idx_one_open_shift_per_store garantiza como máximo uno → lectura
  --    determinista (limit 1 defensivo).
  select cs.opened_at
    into v_shift_opened
  from public.cash_shifts cs
  where cs.restaurant_id = v_sede
    and cs.closed_at is null
  order by cs.opened_at desc
  limit 1;

  if not found then
    raise exception 'No hay un turno de caja abierto';
  end if;

  -- 5. La venta es del turno ACTUAL (cae en la ventana del turno abierto). Si es
  --    anterior a la apertura, pertenece a un turno ya cerrado → no se anula.
  if v_created_at < v_shift_opened then
    raise exception 'Esta venta pertenece a un turno cerrado y no puede anularse; para corregirla se necesita una devolución';
  end if;

  -- 6. Fiado con abonos: bloqueado en v1 (revertir abonos + sus ingresos de caja
  --    es otro flujo). Un fiado SIN abonos sí se anula (no tiene payments; el
  --    stock se revierte igual porque la mercancía salió).
  if exists (select 1 from public.debt_payments where order_id = p_order_id) then
    raise exception 'La venta a fiado ya tiene abonos; anúlala mediante una devolución';
  end if;

  -- ========================================================
  -- EFECTOS (todo en la misma transacción de la función)
  -- ========================================================

  -- a. REVERSIÓN DE STOCK POR ESPEJO — recorre las líneas persistidas.
  for v_oi in
    select id, product_id, qty
    from public.order_items
    where order_id = p_order_id
  loop
    -- Nivel producto (order_items.product_id es ON DELETE RESTRICT → existe).
    select kind, stock_tracking
      into v_kind, v_tracking
    from public.products
    where id = v_oi.product_id and restaurant_id = v_sede;

    if found and v_oi.qty > 0 then
      if v_kind = 'simple' then
        -- Espejo de: simple + tracking → stock -= item_qty
        if v_tracking then
          update public.products
          set stock_qty = coalesce(stock_qty, 0) + v_oi.qty
          where id = v_oi.product_id and restaurant_id = v_sede;

          insert into public.stock_movements
            (restaurant_id, product_id, type, qty, reference_id, notes, created_by)
          values
            (v_sede, v_oi.product_id, 'return', v_oi.qty, p_order_id, 'Anulación de venta', v_actor);
          v_stock_returned := v_stock_returned + 1;
        end if;

      elsif v_kind = 'composite' then
        -- Espejo de: composite → explota la receta (insumos con tracking).
        for v_comp in
          select pc.component_id, pc.qty as recipe_qty
          from public.product_components pc
          join public.products p on p.id = pc.component_id
          where pc.parent_id = v_oi.product_id
            and pc.restaurant_id = v_sede
            and p.stock_tracking = true
        loop
          v_comp_total := v_comp.recipe_qty * v_oi.qty;

          update public.products
          set stock_qty = coalesce(stock_qty, 0) + v_comp_total
          where id = v_comp.component_id and restaurant_id = v_sede;

          insert into public.stock_movements
            (restaurant_id, product_id, type, qty, reference_id, notes, created_by)
          values
            (v_sede, v_comp.component_id, 'return', v_comp_total, p_order_id, 'Anulación de venta', v_actor);
          v_stock_returned := v_stock_returned + 1;
        end loop;
      end if;
    end if;

    -- Nivel extras — oie.qty YA es el total de línea (extra_qty × item_qty).
    -- Espejo de: extra con linked_product_id + tracking → stock -= total.
    for v_ex in
      select oie.qty as ex_qty, e.linked_product_id
      from public.order_item_extras oie
      join public.extras e on e.id = oie.extra_id
      where oie.order_item_id = v_oi.id
    loop
      if v_ex.linked_product_id is not null and v_ex.ex_qty > 0 then
        select stock_tracking
          into v_ex_tracking
        from public.products
        where id = v_ex.linked_product_id and restaurant_id = v_sede;

        if found and v_ex_tracking then
          update public.products
          set stock_qty = coalesce(stock_qty, 0) + v_ex.ex_qty
          where id = v_ex.linked_product_id and restaurant_id = v_sede;

          insert into public.stock_movements
            (restaurant_id, product_id, type, qty, reference_id, notes, created_by)
          values
            (v_sede, v_ex.linked_product_id, 'return', v_ex.ex_qty, p_order_id, 'Anulación de venta (extra)', v_actor);
          v_stock_returned := v_stock_returned + 1;
        end if;
      end if;
    end loop;
  end loop;

  -- b. Borrar payments de la orden → baja el esperado por método en el cuadre
  --    (mixto: todas las filas). NO se crea cash_movement (el efectivo se deriva
  --    de payments). Un fiado sin abonos no tiene filas → borra 0.
  delete from public.payments where order_id = p_order_id;
  get diagnostics v_payments_deleted = row_count;

  -- c. Marcar anulada + rastro. NO se toca payment_status (fuente de verdad de la
  --    exclusión = cancelled_at; ver Fase 3). La venta NO se borra.
  update public.orders
  set status        = 'cancelled',
      cancelled_at  = now(),
      cancelled_by  = v_actor,
      cancel_reason = nullif(btrim(p_reason), '')
  where id = p_order_id;

  return jsonb_build_object(
    'order_id',         p_order_id,
    'was_fiado',        (v_pay_status <> 'paid'),
    'payments_deleted', v_payments_deleted,
    'stock_returned',   v_stock_returned
  );
end;
$$;

revoke execute on function public.register_sale_void(uuid, text) from public;
revoke execute on function public.register_sale_void(uuid, text) from anon;
grant  execute on function public.register_sale_void(uuid, text) to authenticated;
