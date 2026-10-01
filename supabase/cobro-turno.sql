-- supabase/cobro-turno.sql
-- ============================================================================
-- CAMBIO (1). QUÉ HACE, en las RPC que meten plata a un turno:
--   · register_sale_payment (cobro): TURNO OBLIGATORIO (FOR SHARE, primer lock)
--     y la ORDEN con FOR UPDATE después. Cierra dos huecos medidos en Docker:
--     cobro con la caja cerrada (aceptado 20/20) y doble cobro de la misma
--     orden (check-then-act sin lock; por red no se observaba, forzado sí).
--   · register_debt_payment y register_debt_payments_batch (abonos de fiado):
--     EFECTIVO exige turno abierto (decidido 2026-09-30; prod: Salchimelo, 2
--     abonos por $48.000 el 31/08 fuera de todo arqueo). Otros métodos no.
--   · register_debt_payment además bloquea la ORDEN (FOR UPDATE, después del
--     turno): dos abonos simultáneos a la misma venta ya no se pasan del saldo.
--
-- PROTOCOLO DE LOCKS: el de supabase/close-cash-shift.sql — el primer lock o
-- escritura de todo camino que cambie las cifras de un turno es la fila del
-- turno (FOR SHARE); recién después la orden. Con esto el cobro, el último
-- escritor que faltaba, también lo cumple.
--
-- PRECONDICIÓN: supabase/close-cash-shift.sql (fase 1) aplicada — este archivo
-- parte del texto de esas funciones CON el protocolo.
-- FRONTEND: misma firma en las tres RPC (no hacen falta fases por eso). Lo que
-- cambia es que el efectivo sin turno ahora se RECHAZA. El POS y Mesas ya
-- exigían turno antes de cobrar; los modales de abono nuevos
-- (AvisoEfectivoRequiereTurno) lo dicen ANTES de confirmar.
-- PESTAÑA VIEJA (frontend sin los modales nuevos, medido en Docker): un abono
-- en efectivo sin turno muestra "Error al registrar el abono" (lote: "Error al
-- registrar el pago"), el modal queda abierto y NO se registra nada.
--
-- RE-APLICAR: idempotente (create or replace). En una transacción.
-- ORDEN: SIEMPRE después de close-cash-shift.sql. Aquel redefine estas mismas 3
-- funciones; si se corre después, revierte este cambio sin dar error.
--
-- NO DEDUZCAS EL ESTADO DE ESTE COMENTARIO — correlo:
--   select proname, prosrc ilike '%No hay un turno de caja abierto%' as exige_turno
--     from pg_proc where proname in ('register_sale_payment',
--       'register_debt_payment', 'register_debt_payments_batch');   -- 3 filas, true
-- ============================================================================

begin;

-- Texto VIGENTE (base local = prod + close-cash-shift.sql), con las ediciones
-- marcadas "PROTOCOLO (cobro-turno.sql)". create or replace conserva los grants.

-- 1. Cobro
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
    raise exception 'No hay un turno de caja abierto. Abrí el turno antes de cobrar.';
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

-- 2. Abono de fiado (uno)
CREATE OR REPLACE FUNCTION public.register_debt_payment(p_order_id uuid, p_amount numeric, p_payment_method text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- 2b. PROTOCOLO (cobro-turno.sql): EFECTIVO exige turno abierto, y el turno es el
  --     PRIMER lock. Sin turno, la plata no entraba a ningún arqueo (prod: 2
  --     abonos de Salchimelo, $48.000, el 31/08). Los otros métodos no tocan
  --     la caja y siguen sin exigirlo.
  if p_payment_method = 'cash' then
    select id into v_shift_id
      from public.cash_shifts
     where restaurant_id = v_restaurant_id and closed_at is null
     limit 1
     for share;
    if v_shift_id is null then
      raise exception 'No hay un turno de caja abierto: para recibir efectivo hay que abrir el turno. Otros métodos (tarjeta, transferencia, Nequi) sí se pueden registrar.';
    end if;
  end if;

  -- 3. Cargar la orden (debe ser de la sede y estar a fiado).
  --    PROTOCOLO (cobro-turno.sql): FOR UPDATE de la orden (DESPUÉS del turno). Antes
  --    se leía sin lock: dos abonos simultáneos a la misma venta leían el mismo
  --    saldo y entre los dos podían pasarse. El lote ya lo hacía (su paso 3).
  select o.total, o.payment_status, o.order_number, c.name
    into v_order_total, v_pay_status, v_order_number, v_customer_name
  from public.orders o
  left join public.customers c on c.id = o.customer_id
  where o.id = p_order_id and o.restaurant_id = v_restaurant_id
  for update of o;

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
    -- v_shift_id ya se tomó (FOR SHARE, obligatorio) en el paso 2b.
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
$function$;

-- 3. Abono de fiado en lote
CREATE OR REPLACE FUNCTION public.register_debt_payments_batch(p_order_ids uuid[], p_amount numeric, p_payment_method text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_restaurant_id uuid := get_my_restaurant_id();
  v_batch_id      uuid := gen_random_uuid();
  v_n_ids         int;
  v_n_found       int;
  v_n_customers   int;
  v_customer_name text;
  v_saldo_total   numeric(12, 2);
  v_remaining     numeric(12, 2);
  v_apply         numeric(12, 2);
  v_new_status    text;
  v_shift_id      uuid;
  v_cash_mov_id   uuid := null;
  v_numbers       text;
  v_results       jsonb := '[]'::jsonb;
  r               record;
begin
  -- 1. Permiso + sede. Mismo par de guardas que register_debt_payment.
  if v_restaurant_id is null then
    raise exception 'No tienes una sede activa';
  end if;
  if not has_permission('fiado.gestionar') then
    raise exception 'No autorizado para registrar abonos de fiado';
  end if;

  -- 2. Forma de la entrada.
  v_n_ids := coalesce(array_length(p_order_ids, 1), 0);
  if v_n_ids = 0 then
    raise exception 'Selecciona al menos una venta';
  end if;
  if v_n_ids <> (select count(distinct x) from unnest(p_order_ids) x) then
    raise exception 'Hay ventas repetidas en la selección';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'El abono debe ser mayor a cero';
  end if;
  -- Allowlist de métodos: lo que no está enumerado NO pasa.
  if p_payment_method is null
     or p_payment_method not in ('cash', 'card', 'transfer', 'nequi') then
    raise exception 'Método de pago inválido: %', coalesce(p_payment_method, '(null)');
  end if;

  -- 2b. PROTOCOLO (close-cash-shift.sql): el turno, PRIMERO (antes de bloquear las
  --     órdenes del paso 3). Solo si es efectivo: es el único caso que escribe
  --     en la caja. El paso 7 usa v_shift_id sin volver a buscarlo.
  if p_payment_method = 'cash' then
    select id into v_shift_id
      from public.cash_shifts
     where restaurant_id = v_restaurant_id and closed_at is null
     limit 1
     for share;
    -- PROTOCOLO (cobro-turno.sql): EFECTIVO exige turno abierto (igual que el abono simple).
    if v_shift_id is null then
      raise exception 'No hay un turno de caja abierto: para recibir efectivo hay que abrir el turno. Otros métodos (tarjeta, transferencia, Nequi) sí se pueden registrar.';
    end if;
  end if;

  -- 3. Bloquear las órdenes ANTES de leer saldos. Sin esto, dos abonos
  --    simultáneos sobre la misma venta leen el mismo total abonado y entre los
  --    dos pueden pasarse del saldo.
  perform 1
    from public.orders o
   where o.id = any(p_order_ids)
     and o.restaurant_id = v_restaurant_id
   for update;

  -- 4. Fotografía del saldo por orden. El filtro es POSITIVO: solo entra lo que
  --    es de MI sede, no está anulado y es un fiado pendiente. Cualquier fila
  --    que no cumpla simplemente no aparece — y el conteo de abajo lo detecta.
  --
  --    El `drop if exists` NO es decorativo: `on commit drop` limpia al COMMIT,
  --    así que dos llamadas dentro de una MISMA transacción chocarían con
  --    "relation tmp_lote already exists". Vía PostgREST cada llamada es su
  --    propia transacción y no pasa, pero eso es una propiedad del llamador y no
  --    de la función. Sin esto, el día que alguien la llame dos veces desde otra
  --    función plpgsql, falla por una razón que no tiene nada que ver con fiado.
  drop table if exists tmp_lote;
  create temp table tmp_lote on commit drop as
    select o.id,
           o.order_number,
           o.created_at,
           o.customer_id,
           o.customer_name,
           c.name as customer_display,
           o.total - coalesce((select sum(dp.amount)
                                 from public.debt_payments dp
                                where dp.order_id = o.id), 0) as saldo
      from public.orders o
      left join public.customers c on c.id = o.customer_id
     where o.id = any(p_order_ids)
       and o.restaurant_id = v_restaurant_id
       and o.cancelled_at is null
       and o.payment_status in ('pending', 'partial');

  select count(*) into v_n_found from tmp_lote;
  if v_n_found <> v_n_ids then
    raise exception
      'Alguna venta no existe, no es de tu sede, está anulada o no es un fiado pendiente (% de % válidas)',
      v_n_found, v_n_ids;
  end if;

  -- 5. Un solo cliente. La clave de agrupación es la MISMA que usa la Cartera:
  --    customer_id, y si es null el nombre normalizado.
  select count(distinct coalesce(customer_id::text,
                                 'name:' || lower(coalesce(customer_name, '')))),
         min(coalesce(customer_display, customer_name, 'cliente'))
    into v_n_customers, v_customer_name
    from tmp_lote;
  if v_n_customers <> 1 then
    raise exception 'Las ventas seleccionadas no son del mismo cliente';
  end if;

  -- 6. Sobrepago: se rechaza. Una deuda no da vuelto.
  select sum(saldo) into v_saldo_total from tmp_lote;
  if p_amount > v_saldo_total then
    raise exception 'El abono (%) excede el saldo seleccionado (%)',
      p_amount, v_saldo_total;
  end if;

  -- 7. Efectivo + turno abierto → UN ingreso de caja por el TOTAL del lote.
  --    amount es integer > 0; se redondea a peso (COP no usa decimales).
  if p_payment_method = 'cash' then
    -- v_shift_id ya se tomó (FOR SHARE) en el paso 2b, antes que las órdenes.

    if v_shift_id is not null and round(p_amount)::integer > 0 then
      select string_agg('#' || order_number, ', ' order by created_at)
        into v_numbers
        from tmp_lote
       where order_number is not null;

      insert into public.cash_movements
        (shift_id, restaurant_id, type, amount, reason, created_by)
      values
        (v_shift_id, v_restaurant_id, 'in', round(p_amount)::integer,
         'Abono de ' || v_customer_name
           || coalesce(' (ventas ' || v_numbers || ')', ''),
         auth.uid())
      returning id into v_cash_mov_id;
    end if;
  end if;

  -- 8. Reparto FIFO: la más vieja primero, desempate por id. La última tocada
  --    puede quedar parcial. El orden del array de entrada NO se usa.
  v_remaining := p_amount;
  for r in select * from tmp_lote order by created_at asc, id asc loop
    exit when v_remaining <= 0;

    v_apply := least(v_remaining, r.saldo);
    if v_apply <= 0 then
      continue;   -- saldo 0 (no debería llegar acá, pero no se asume)
    end if;

    v_new_status := case when r.saldo - v_apply <= 0 then 'paid' else 'partial' end;

    insert into public.debt_payments
      (restaurant_id, order_id, amount, payment_method,
       cash_movement_id, batch_id, created_by)
    values
      (v_restaurant_id, r.id, v_apply, p_payment_method,
       v_cash_mov_id, v_batch_id, auth.uid());

    update public.orders
       set payment_status = v_new_status
     where id = r.id;

    v_results := v_results || jsonb_build_object(
      'order_id',       r.id,
      'order_number',   r.order_number,
      'applied',        v_apply,
      'saldo_restante', r.saldo - v_apply,
      'new_status',     v_new_status);

    v_remaining := v_remaining - v_apply;
  end loop;

  -- 9. Invariante: el monto se repartió ENTERO. Si sobra algo acá hay un error
  --    de lógica, no un caso de negocio — y se revierte todo en vez de dejar
  --    plata cobrada sin imputar.
  if v_remaining <> 0 then
    raise exception 'Reparto incompleto: quedaron % sin imputar de %',
      v_remaining, p_amount;
  end if;

  return jsonb_build_object(
    'batch_id',              v_batch_id,
    'orders',                v_results,
    'cash_movement_created', v_cash_mov_id is not null,
    'shift_open',            v_shift_id is not null);
end;
$function$;

commit;
