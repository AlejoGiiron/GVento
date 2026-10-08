-- supabase/permisos-cobro.sql
-- ============================================================================
-- A — PERMISOS DE COBRO (2026-10-08). Cobrar deja de depender del rol viejo
-- (profiles.role / get_my_role) y pasa a los permisos del rol de cada usuario:
--   · register_pos_sale: vender en el POS (y en /m) exige pos.vender.
--   · register_sale_payment: según el TIPO de la orden, ALLOWLIST —
--       dine_in → mesas.cobrar · takeaway, delivery → pos.vender · otro → se rechaza.
--   · La copia de roles de CADA organización gana, por UNIÓN (nunca se quita nada):
--       admin  + pos.vender, mesas.cobrar     cajero + pos.vender, mesas.cobrar
--       mozo   + mesas.cobrar  (pos.vender ya lo tenía y se queda: decidido 2026-10-07)
--     Solo roles de sistema (is_system) con esos nombres; el owner ('*') no se toca;
--     los roles personalizados no se tocan. Lo que se agrega queda anotado, por role_id,
--     en public.permisos_cobro_agregados: la reversa quita EXACTAMENTE eso.
--   · Mensajes en "tú": "Abre el turno antes de cobrar" (decía "Abrí").
--
-- QUÉ CAMBIA EN LA PRÁCTICA: quien tenga pos.vender puede vender aunque su rol viejo
-- sea 'waiter' (el mozo puede vender en el POS); quien tenga mesas.cobrar puede cobrar
-- mesas (el mozo cobra la mesa). /m sigue decidiendo por el rol viejo hasta el frontend
-- de A, y el mozo no se redirige a /m hasta M2. El pre-flight
-- (supabase/diag/permisos-cobro-preflight.sql) da, por usuario, quién PIERDE (tiene que
-- quedar vacío), quién GANA y quién queda IGUAL.
--
-- BASE: las dos funciones son copia literal de las vigentes, con solo los cambios de
-- arriba: register_pos_sale de pos-sale-metodo-real.sql (md5 5c0e0d9e…, el 5.0 del
-- Paso 5) y register_sale_payment de cobro-turno.sql (md5 8fc041a9…). La PRECONDICIÓN
-- (bloque 0) lo exige: si la base tiene otras versiones, ABORTA sin cambiar nada.
--
-- RE-APLICAR: falla en la precondición (las funciones ya no son las de antes) y hace
-- rollback: no cambia nada. Para volver a correrla, primero la reversa.
-- 🔴 Re-aplicar DESPUÉS pos-sale-lotes.sql, pos-sale-metodo-real.sql o cobro-turno.sql
-- devuelve la función que redefinen a su versión por rol viejo, en silencio (R5).
--
-- NO DEDUZCAS EL ESTADO DE ESTE COMENTARIO — correlo (misma normalización que Q-FUNCIONES):
--   select p.oid::regprocedure, md5(regexp_replace(regexp_replace(pg_get_functiondef(p.oid), E'\r','','g'), E'[ \t]+\n', E'\n','g')),
--          has_function_privilege('authenticated', p.oid, 'execute')
--     from pg_proc p where p.pronamespace = 'public'::regnamespace
--      and p.proname in ('register_pos_sale', 'register_sale_payment') order by 1;
--   select to_regclass('public.permisos_cobro_agregados');   -- no nulo = aplicada
-- ============================================================================

begin;

-- ── 0. PRECONDICIÓN (falla cerrado) ──────────────────────────────────────────
do $$
declare
  v_pos  text := md5(regexp_replace(regexp_replace(pg_get_functiondef('public.register_pos_sale(uuid,jsonb,jsonb,jsonb)'::regprocedure), E'\r','','g'), E'[ \t]+\n', E'\n','g'));
  v_pago text := md5(regexp_replace(regexp_replace(pg_get_functiondef('public.register_sale_payment(uuid,jsonb)'::regprocedure), E'\r','','g'), E'[ \t]+\n', E'\n','g'));
begin
  if v_pos is distinct from '5c0e0d9eee8b2ad8fb5ecba549ab9d32' then
    raise exception 'Precondición: register_pos_sale no es la de pos-sale-metodo-real.sql (md5 %, se esperaba 5c0e0d9e…). Aplica primero el 5.0 del Paso 5. No se cambió nada.', v_pos;
  end if;
  if v_pago is distinct from '8fc041a9f9bdf535f309f6576eb058e5' then
    raise exception 'Precondición: register_sale_payment no es la de cobro-turno.sql (md5 %, se esperaba 8fc041a9…). No se cambió nada.', v_pago;
  end if;
end $$;

-- ── 1. Registro de lo que se agrega (para que la reversa quite solo eso) ─────
create table public.permisos_cobro_agregados (
  role_id     uuid        not null references public.roles(id) on delete cascade,
  clave       text        not null,
  agregado_at timestamptz not null default now(),
  primary key (role_id, clave)
);
alter table public.permisos_cobro_agregados enable row level security;
revoke all on table public.permisos_cobro_agregados from anon, authenticated;

-- ── 2. Roles de cada organización: UNIÓN ─────────────────────────────────────
do $$
declare
  v_roles int;
  v_claves int;
begin
  with agregar(rol, clave) as (
  -- AGREGAR:inicio (la MISMA lista en permisos-cobro.sql y en el pre-flight; la compara un test)
  values ('admin',  'mesas.cobrar'), ('admin',  'pos.vender'),
         ('cajero', 'mesas.cobrar'), ('cajero', 'pos.vender'),
         ('mozo',   'mesas.cobrar')
  -- AGREGAR:fin
  ),
  faltan as (
    select r.id as role_id, a.clave
      from public.roles r
      join agregar a on a.rol = r.name
     where r.is_system
       and not (r.permissions ? a.clave)
       and not (r.permissions ? '*')
  ),
  anotadas as (
    insert into public.permisos_cobro_agregados (role_id, clave)
    select role_id, clave from faltan
    returning role_id, clave
  )
  update public.roles r
     set permissions = r.permissions || x.claves
    from (select role_id, jsonb_agg(clave order by clave) as claves from anotadas group by role_id) x
   where r.id = x.role_id;
  get diagnostics v_roles = row_count;
  select count(*) into v_claves from public.permisos_cobro_agregados;
  raise notice 'permisos-cobro: % rol(es) actualizados, % clave(s) agregadas (detalle en permisos_cobro_agregados)', v_roles, v_claves;
end $$;

-- ── 3. register_pos_sale (copia de pos-sale-metodo-real.sql + compuerta pos.vender) ──
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

  -- 2. Permisos (A, permisos-cobro.sql): vender en el POS exige pos.vender — ya no el
  --    rol viejo (get_my_role). register_sale_payment exige lo mismo para takeaway/delivery.
  if not has_permission('pos.vender') then
    raise exception 'No tienes permiso para vender';
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

-- ── 4. register_sale_payment (copia de cobro-turno.sql + compuerta por tipo) ──
CREATE OR REPLACE FUNCTION public.register_sale_payment(p_order_id uuid, p_payments jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_restaurant_id uuid := get_my_restaurant_id();
  v_order_total   numeric(12,2);
  v_pay_status    text;
  v_sum           numeric(12,2);
  v_bad           int;
  v_count         int;
  v_tipo          text;
  v_permiso       text;
begin
  -- 1. Sede activa + PERMISO SEGÚN EL TIPO DE ORDEN (A, permisos-cobro.sql). ALLOWLIST:
  --    dine_in → mesas.cobrar · takeaway, delivery → pos.vender. Un tipo que no está
  --    en la lista se RECHAZA (falla cerrado). Antes: get_my_role() in ('admin','cashier').
  --    El tipo se lee SIN lock (no cambia nunca): así el primer lock sigue siendo el
  --    turno (protocolo de cobro-turno.sql) y un rechazo no toma ningún lock.
  if v_restaurant_id is null then
    raise exception 'No tienes una sede activa';
  end if;
  select o.type::text into v_tipo
    from public.orders o
   where o.id = p_order_id and o.restaurant_id = v_restaurant_id;
  if not found then
    raise exception 'La orden no existe o no pertenece a tu sede';
  end if;
  v_permiso := case v_tipo
                 when 'dine_in'  then 'mesas.cobrar'
                 when 'takeaway' then 'pos.vender'
                 when 'delivery' then 'pos.vender'
               end;
  if v_permiso is null then
    raise exception 'Este tipo de orden (%) no tiene un permiso de cobro definido', v_tipo;
  end if;
  if not has_permission(v_permiso) then
    raise exception '%', case v_permiso when 'mesas.cobrar' then 'No tienes permiso para cobrar mesas'
                                        else 'No tienes permiso para vender' end;
  end if;

  -- 1b. PROTOCOLO (cobro-turno.sql): TURNO OBLIGATORIO, y es el PRIMER lock.
  --     Sin turno, el pago no cae en ningún arqueo. FOR SHARE: compatible con
  --     otros cobros, incompatible con el FOR UPDATE del cierre (si cierra
  --     mientras esperamos, el turno deja de calificar y se rechaza).
  perform 1
     from public.cash_shifts
    where restaurant_id = v_restaurant_id and closed_at is null
    limit 1
    for share;
  if not found then
    raise exception 'No hay un turno de caja abierto. Abre el turno antes de cobrar.';
  end if;

  -- 2. La orden debe ser de la sede; cargamos total y estado de pago.
  --    PROTOCOLO (cobro-turno.sql): FOR UPDATE (DESPUÉS del turno): dos terminales
  --    cobrando la misma orden se serializan acá, y la segunda ve el pago de la
  --    primera en el paso 4. Antes era un check-then-act sin lock.
  select o.total, o.payment_status
    into v_order_total, v_pay_status
  from public.orders o
  where o.id = p_order_id and o.restaurant_id = v_restaurant_id
  for update;
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
$function$;

revoke execute on function public.register_sale_payment(uuid, jsonb) from public, anon;
grant  execute on function public.register_sale_payment(uuid, jsonb) to authenticated;

commit;
