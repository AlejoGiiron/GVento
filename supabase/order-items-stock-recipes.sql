-- ============================================================
-- G-Vento — Inventario por recetas (Parte 2 BD): descuento de stock al vender
--
-- Extiende add_order_items_with_extras para que, en LA MISMA transacción que
-- ya inserta order_items + order_item_extras y descuenta el stock de los extras
-- vinculados, descuente también el stock del PRODUCTO vendido según su tipo:
--   • simple + stock_tracking=true  → descuenta (qty del ítem) de su stock_qty
--   • simple + stock_tracking=false → no descuenta (ej: licor)
--   • composite                     → explota product_components y descuenta
--                                     (qty_receta × qty_ítem) por cada insumo;
--                                     el compuesto NO descuenta de su propio
--                                     stock (no tiene). Cada insumo decide por
--                                     su propio stock_tracking (interruptor
--                                     maestro de "¿se inventaría?").
--
-- Cada salida queda auditada en stock_movements('sale', -qty, reference_id =
-- order_id, created_by) → el reporte de "qué se consumió la noche" sale gratis.
--
-- Stock puede quedar NEGATIVO: nunca se valida ni se bloquea la venta (el
-- negativo es la señal visible de sobreventa; ver products-allow-negative-stock).
--
-- IMPORTANTE — convivencia con extras (enfoque INTEGRADO aprobado):
--   NO existe deduct_stock_for_order suelto. Todo el movimiento de stock (extras
--   + receta) ocurre aquí, atado a INSERTAR la línea, que pasa exactamente una
--   vez por ítem (POS: un solo batch al cobrar; Mesas: un batch por "Agregar").
--   Extras y receta descuentan de insumos distintos (o consumos aditivos sobre
--   el mismo): no hay doble descuento.
--
-- Requiere aplicar antes: inventory-recipes.sql (products.kind, stock_movements,
-- product_components).
--
-- Ejecutar en: Supabase Dashboard > SQL Editor. Migración NUEVA.
-- No edita order-extras-rpc.sql (ya aplicada).
-- ============================================================

begin;

create or replace function public.add_order_items_with_extras(
  p_order_id uuid,
  p_items    jsonb
) returns void
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
begin
  -- 1. La orden debe existir y pertenecer a la sede activa del llamante.
  select restaurant_id, created_by
  into v_restaurant_id, v_order_created_by
  from public.orders
  where id = p_order_id;

  if v_restaurant_id is null then
    raise exception 'La orden % no existe', p_order_id;
  end if;
  if v_restaurant_id <> get_my_restaurant_id() then
    raise exception 'La orden no pertenece a tu sede';
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

    -- El producto debe pertenecer a la sede. (Misma validación de antes;
    -- ahora además leemos kind y stock_tracking para el descuento de stock.)
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

    -- ========================================================
    -- DESCUENTO DE STOCK POR PRODUCTO (inventario por recetas)
    -- Atado a la inserción de la línea. SIN piso: stock puede quedar negativo.
    -- ========================================================
    if v_item_qty > 0 then
      if v_kind = 'simple' then
        -- Producto con stock propio. Solo descuenta si se inventaría.
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
        -- Stock derivado: explota la receta. El compuesto NO descuenta de su
        -- propio stock. Solo se tocan insumos con stock_tracking = true.
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

    -- ========================================================
    -- EXTRAS (sin cambios respecto a order-extras-rpc.sql)
    -- ========================================================
    for v_extra in
      select * from jsonb_array_elements(coalesce(v_item->'extras', '[]'::jsonb))
    loop
      v_extra_id  := (v_extra->>'extra_id')::uuid;
      v_extra_qty := (v_extra->>'qty')::integer;

      if v_extra_qty <= 0 then
        continue;  -- se ignoran extras con qty 0 o negativa
      end if;

      -- DATOS DE CONFIANZA: precio y producto vinculado se LEEN de la BD,
      -- no del JSON. Valida de paso que el extra existe, está activo y es
      -- de la sede.
      select price, linked_product_id
      into v_extra_price, v_extra_linked
      from public.extras
      where id = v_extra_id
        and restaurant_id = v_restaurant_id
        and is_active = true;

      if not found then
        raise exception 'Extra % no es válido para esta sede', v_extra_id;
      end if;

      -- El extra debe estar asignado al producto del ítem.
      perform 1 from public.product_extras
      where product_id = v_product_id and extra_id = v_extra_id;
      if not found then
        raise exception 'El extra % no está asignado al producto %', v_extra_id, v_product_id;
      end if;

      -- qty del extra por unidad × qty del ítem = total consumido en la línea.
      v_total_qty := v_extra_qty * v_item_qty;

      insert into public.order_item_extras (order_item_id, extra_id, qty, unit_price)
      values (v_item_id, v_extra_id, v_total_qty, v_extra_price);

      -- Descuento de stock CONDICIONAL: solo si el extra (según la BD) está
      -- vinculado a un producto con control de inventario. Acotado a la sede.
      -- SIN piso: el stock puede quedar negativo a propósito — el negativo es
      -- la señal visible de sobreventa (ver products-allow-negative-stock.sql).
      if v_extra_linked is not null then
        update public.products
        set stock_qty = coalesce(stock_qty, 0) - v_total_qty
        where id = v_extra_linked
          and restaurant_id = v_restaurant_id
          and stock_tracking = true;
      end if;
    end loop;
  end loop;
end;
$$;

-- Permisos: mismos que la versión original (create or replace no los resetea,
-- pero se reafirman por idempotencia y claridad de la migración).
revoke execute on function public.add_order_items_with_extras(uuid, jsonb) from public;
revoke execute on function public.add_order_items_with_extras(uuid, jsonb) from anon;
grant  execute on function public.add_order_items_with_extras(uuid, jsonb) to authenticated;

commit;
