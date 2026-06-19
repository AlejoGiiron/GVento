-- ============================================================
-- G-Vento — Extras parte 2: RPC atómica para vender con extras
--
-- Inserta order_items + order_item_extras y descuenta stock de los
-- productos vinculados, todo en UNA transacción. Si algo falla, nada
-- queda a medias (ni ítems huérfanos ni stock descontado sin venta).
--
-- ¿Por qué SECURITY DEFINER?
--   El descuento de stock hace UPDATE sobre products, cuya RLS solo
--   permite a 'admin' ('products: admin actualiza'). Un cajero que vende
--   legítimamente debe poder descontar el stock del producto vinculado al
--   extra, pero NO editar productos en general. DEFINER ejecuta el UPDATE
--   con privilegios de la función (no del cajero).
--   (Aprendizaje Fase 0: revocar EXECUTE a public/anon, conceder a authenticated.)
--
-- SEGURIDAD — no confiar en el JSON del cliente:
--   Como DEFINER salta el RLS, NO se confía en price ni linked_product_id
--   que vengan en el JSON. Del JSON se usa SOLO extra_id y qty. El precio y
--   el producto vinculado se LEEN de la tabla extras dentro de la función.
--   Además se valida que el extra exista, esté activo, sea de la sede y esté
--   asignado al producto del ítem (product_extras).
--
-- Semántica de cantidades:
--   El cliente envía la qty del extra POR UNIDAD del ítem. La función guarda
--   en order_item_extras.qty el total de la línea (qty_extra × qty_item) y
--   descuenta esa misma cantidad del stock vinculado.
--
-- Ejecutar en: Supabase Dashboard > SQL Editor. Migración NUEVA.
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
  v_restaurant_id uuid;
  v_item          jsonb;
  v_item_id       uuid;
  v_item_qty      integer;
  v_product_id    uuid;
  v_extra         jsonb;
  v_extra_id      uuid;
  v_extra_qty     integer;
  v_extra_price   numeric(12, 2);
  v_extra_linked  uuid;
  v_total_qty     integer;
begin
  -- 1. La orden debe existir y pertenecer a la sede activa del llamante.
  select restaurant_id into v_restaurant_id
  from public.orders
  where id = p_order_id;

  if v_restaurant_id is null then
    raise exception 'La orden % no existe', p_order_id;
  end if;
  if v_restaurant_id <> get_my_restaurant_id() then
    raise exception 'La orden no pertenece a tu sede';
  end if;

  -- 2. Cada ítem con sus extras.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_qty   := (v_item->>'qty')::integer;
    v_product_id := (v_item->>'product_id')::uuid;

    -- El producto debe pertenecer a la sede.
    perform 1 from public.products
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

revoke execute on function public.add_order_items_with_extras(uuid, jsonb) from public;
revoke execute on function public.add_order_items_with_extras(uuid, jsonb) from anon;
grant  execute on function public.add_order_items_with_extras(uuid, jsonb) to authenticated;

commit;
