-- ============================================================
-- G-Vento — Compra NO toca la caja (fix de raíz)
--
-- Regla del cliente: registrar una compra NUNCA debe generar un egreso de
-- caja automático. El efectivo que sale del cajón lo registra el cajero como
-- egreso MANUAL (Movimientos → egreso), que admite monto PARCIAL y motivo.
--
-- Cambio: register_purchase deja de crear cash_movement('out'). Sigue creando
-- factura + ítems, subiendo stock y actualizando cost_price. payment_method se
-- sigue guardando (informativo: cómo se pagó), pero ya no dispara caja.
--
-- create or replace (NO edita compras-proveedores.sql ya aplicada). El retorno
-- pierde cash_movement_created/shift_open (ya no hay egreso). Se quitan las
-- declaraciones v_shift_id / v_cash_amount / v_cash_created.
--
-- ORDEN DE DEPLOY: desplegar JUNTO al frontend que consume el nuevo shape. Si
-- el SQL va antes que el front viejo, éste leería shift_open=undefined y
-- mostraría la advertencia falsa "no se registró en caja".
--
-- Ejecutar en: Supabase Dashboard > SQL Editor.
-- ============================================================

begin;

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
begin
  -- 1. Permiso + sede.
  if v_restaurant_id is null then
    raise exception 'No tienes una sede activa';
  end if;
  if not has_permission('compras.gestionar') then
    raise exception 'No autorizado para registrar compras';
  end if;

  -- 2. Validar método de pago (informativo) y proveedor (debe ser de la sede).
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

  -- La compra NO toca la caja. Si salió efectivo del cajón, se registra como
  -- egreso MANUAL (Movimientos → egreso), que admite monto parcial.
  return jsonb_build_object(
    'invoice_id', v_invoice_id,
    'total',      v_total
  );
end;
$$;

revoke execute on function public.register_purchase(jsonb, jsonb) from public;
revoke execute on function public.register_purchase(jsonb, jsonb) from anon;
grant  execute on function public.register_purchase(jsonb, jsonb) to authenticated;

commit;
