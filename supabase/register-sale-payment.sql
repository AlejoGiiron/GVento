-- register-sale-payment.sql
-- Registra atómicamente N pagos de una venta de CONTADO (pago mixto) validando
-- que la suma cuadre con el total de la orden. Rechaza órdenes a fiado (esas se
-- saldan con register_debt_payment). NO crea cash_movement: el efectivo se deriva
-- de payments en el cuadre de caja. Ejecutar en: Supabase Dashboard > SQL Editor.

create or replace function public.register_sale_payment(
  p_order_id  uuid,
  p_payments  jsonb        -- [{ "method": "cash", "amount": 10000 }, ...]
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid := get_my_restaurant_id();
  v_order_total   numeric(12,2);
  v_pay_status    text;
  v_sum           numeric(12,2);
  v_bad           int;
  v_count         int;
begin
  -- 1. Sede activa + gate de cobro (calca el RLS de INSERT de payments:
  --    get_my_role() in ('admin','cashier'). Deuda anotada: pasar a has_permission
  --    cuando se elimine el enum profiles.role).
  if v_restaurant_id is null then
    raise exception 'No tienes una sede activa';
  end if;
  if get_my_role() not in ('admin', 'cashier') then
    raise exception 'No autorizado para registrar cobros';
  end if;

  -- 2. La orden debe ser de la sede; cargamos total y estado de pago.
  select o.total, o.payment_status
    into v_order_total, v_pay_status
  from public.orders o
  where o.id = p_order_id and o.restaurant_id = v_restaurant_id;
  if not found then
    raise exception 'La orden no existe o no pertenece a tu sede';
  end if;

  -- 3. Solo ventas de CONTADO. El fiado (pending/partial) se salda con
  --    register_debt_payment: no debe crear payments por esta vía.
  if v_pay_status <> 'paid' then
    raise exception
      'La orden no es venta de contado (estado de pago: %). El fiado se salda con abonos.',
      v_pay_status;
  end if;

  -- 4. Sin pagos previos (evita doble cobro de una venta ya cobrada).
  if exists (select 1 from public.payments where order_id = p_order_id) then
    raise exception 'La orden ya tiene pagos registrados';
  end if;

  -- 5. Estructura del arreglo.
  if p_payments is null or jsonb_typeof(p_payments) <> 'array'
     or jsonb_array_length(p_payments) = 0 then
    raise exception 'Debe enviar al menos una línea de pago';
  end if;

  -- 6. Cada línea: método válido del enum + monto > 0.
  select count(*) into v_bad
  from jsonb_array_elements(p_payments) e
  where coalesce(e->>'method','') not in ('cash','card','transfer','nequi')
     or coalesce((e->>'amount')::numeric, 0) <= 0;
  if v_bad > 0 then
    raise exception 'Líneas con método inválido o monto no positivo';
  end if;

  -- 7. Σ amounts = total (derivado de BD, no del JSON).
  select coalesce(sum((e->>'amount')::numeric), 0) into v_sum
  from jsonb_array_elements(p_payments) e;
  if round(v_sum, 2) <> round(v_order_total, 2) then
    raise exception 'La suma de pagos (%) no cuadra con el total (%)', v_sum, v_order_total;
  end if;

  -- 8. Insertar todas las filas (atómico).
  insert into public.payments (order_id, method, amount, restaurant_id)
  select p_order_id,
         (e->>'method')::public.payment_method,
         (e->>'amount')::numeric(12,2),
         v_restaurant_id
  from jsonb_array_elements(p_payments) e;
  get diagnostics v_count = row_count;

  return jsonb_build_object(
    'order_id', p_order_id,
    'payments_created', v_count,
    'total', v_order_total
  );
end;
$$;

revoke execute on function public.register_sale_payment(uuid, jsonb) from public;
revoke execute on function public.register_sale_payment(uuid, jsonb) from anon;
grant  execute on function public.register_sale_payment(uuid, jsonb) to authenticated;
