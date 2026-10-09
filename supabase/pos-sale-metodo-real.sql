-- supabase/pos-sale-metodo-real.sql
-- ============================================================================
-- register_pos_sale devuelve el MÉTODO REAL de la venta (M1.1 / B, 2026-10-08).
--
-- POR QUÉ: el cliente conserva el id de la venta (p_sale_id) entre reintentos del
-- MISMO carrito, aunque cambie el método de pago — también de efectivo a fiado
-- (useSaleCheckout). Si el primer intento ya entró y su respuesta se perdió, el
-- reintento recibe la venta existente (ya_existia) en vez de crear otra. Hasta acá
-- la respuesta no decía CÓMO había quedado esa venta, y la pantalla mostraba el
-- método del reintento, no el real. Ahora la pantalla dice "Esta venta ya quedó
-- registrada como <método>" con el dato de la base.
--
-- QUÉ CAMBIA (y nada más — el resto de register_pos_sale es copia literal de
-- pos-sale-lotes.sql, md5 ac43ad79bc637799fc194f7ebaff839b con finales LF):
--   1. NUEVA public._venta_pos_respuesta(p_order_id, p_ya_existia): arma la
--      respuesta DESDE LA BASE. Mismas claves de siempre (order_id, order_number,
--      total, ya_existia) MÁS:
--        · metodos: los métodos de sus pagos, en el orden en que se registraron
--          (vacío si es fiado, total 0, o si una anulación borró los pagos);
--        · fiado:   la orden tiene cliente (en el POS, customer_id solo se llena
--          si es a fiado — paso 4 de register_pos_sale);
--        · cliente: el nombre del cliente (el de customers; si no, el guardado);
--        · anulada: cancelled_at no es null.
--      SIN execute para public/anon/authenticated: solo se llama desde
--      register_pos_sale (SECURITY DEFINER, corre como su dueño). No mira sede:
--      quien la llama ya validó que la orden es de la sede del usuario.
--   2. register_pos_sale: sus TRES return (ya existía antes de empezar, ya existía
--      por la carrera del on conflict, y la venta nueva) usan esa función.
--   3. Dos mensajes de error pasan de voseo a "tú": "Abre el turno antes de
--      cobrar" y "actualiza el carrito y vuelve a cobrar" (los ve el usuario en el
--      toast de /m y del POS).
--
-- COMPATIBILIDAD: el frontend anterior lee solo las claves de siempre, que no
-- cambian. El frontend nuevo usa metodos/fiado/cliente si vienen y, si no (esta
-- migración sin aplicar), dice "ya quedó registrada" sin el método. Se puede
-- aplicar antes o después del frontend; se recomienda ANTES.
--
-- PRECONDICIÓN: pos-sale-lotes.sql aplicada (register_pos_sale existe).
--   select oid::regprocedure from pg_proc where proname = 'register_pos_sale';
--   -- esperado: register_pos_sale(uuid,jsonb,jsonb,jsonb)
--
-- RE-APLICAR: idempotente (create or replace; los grants se re-emiten).
-- 🔴 Re-aplicar pos-sale-lotes.sql DESPUÉS de este archivo devuelve
-- register_pos_sale a la versión sin método real (R5, DEUDAS → "Re-aplicar una
-- migración vieja revierte en silencio"). Se arregla re-aplicando ESTE archivo.
--
-- NO DEDUZCAS EL ESTADO DE ESTE COMENTARIO — correlo (misma normalización que
-- Q-FUNCIONES de docs/plan-despliegue-m1.md):
--   select p.oid::regprocedure,
--          md5(regexp_replace(regexp_replace(pg_get_functiondef(p.oid), E'\r','','g'), E'[ \t]+\n', E'\n','g')),
--          has_function_privilege('authenticated', p.oid, 'execute')
--     from pg_proc p where p.pronamespace = 'public'::regnamespace
--      and p.proname in ('register_pos_sale', '_venta_pos_respuesta') order by 1;
--   -- _venta_pos_respuesta presente = aplicada; sin esa fila = no aplicada.
--   -- Lo que deja ESTE archivo (medido en Docker el 2026-10-08):
--   --   _venta_pos_respuesta(uuid,boolean)        e4fb984b02c176d6f877d5fbdf2f1c9d  false
--   --   register_pos_sale(uuid,jsonb,jsonb,jsonb) 5c0e0d9eee8b2ad8fb5ecba549ab9d32  true
--   -- Y el de pos-sale-lotes.sql, el que reemplaza: register_pos_sale 23e946e81c11f9486b04f9d53432e933.
-- ============================================================================

begin;

-- ── 1. La respuesta de una venta del POS, desde la base ──────────────────────
create or replace function public._venta_pos_respuesta(p_order_id uuid, p_ya_existia boolean)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'order_id',     o.id,
    'order_number', o.order_number,
    'total',        o.total,
    'ya_existia',   p_ya_existia,
    'metodos',      coalesce((select jsonb_agg(m.method order by m.primero)
                                from (select p.method, min(p.created_at) as primero
                                        from public.payments p
                                       where p.order_id = o.id
                                       group by p.method) m), '[]'::jsonb),
    'fiado',        o.customer_id is not null,
    'cliente',      coalesce(c.name, o.customer_name),
    'anulada',      o.cancelled_at is not null)
    from public.orders o
    left join public.customers c on c.id = o.customer_id
   where o.id = p_order_id
$$;

revoke execute on function public._venta_pos_respuesta(uuid, boolean) from public, anon, authenticated;

-- ── 2. register_pos_sale (copia de pos-sale-lotes.sql + los 3 return + 2 mensajes) ──
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
    return public._venta_pos_respuesta(v_existente.id, true);
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
    raise exception 'No hay un turno de caja abierto. Abre el turno antes de cobrar.';
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
    return public._venta_pos_respuesta(v_existente.id, true);
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
    raise exception 'No se cobró: el total del carrito (%) no coincide con el de las líneas (% = ítems % + extras % − descuento %). Probablemente cambió el precio de un extra: actualiza el carrito y vuelve a cobrar.',
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

  return public._venta_pos_respuesta(p_sale_id, false);
end;
$$;

revoke execute on function public.register_pos_sale(uuid, jsonb, jsonb, jsonb) from public, anon;
grant  execute on function public.register_pos_sale(uuid, jsonb, jsonb, jsonb) to authenticated;

commit;
