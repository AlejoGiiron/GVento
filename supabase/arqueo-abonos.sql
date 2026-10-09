-- supabase/arqueo-abonos.sql
-- ============================================================================
-- El esperado de TARJETA, TRANSFERENCIA y NEQUI en el cierre de turno incluye los abonos de
-- fiado de ese método cobrados en el turno (decidido el 2026-10-09). Antes solo contaba las
-- ventas (payments), así que un abono por Nequi que el cajero declaraba salía como sobrante
-- (G-10: el 3/10 y el 23/9, medido con supabase/diag consultas de arqueo por método).
-- El EFECTIVO no cambia: un abono en efectivo ya entra al esperado como ingreso de caja.
--
-- QUÉ CAMBIA:
--   1. debt_payments.shift_id: el turno al que entra el abono. Lo pone la función del abono,
--      con el turno BLOQUEADO; null si no había turno abierto. Los abonos viejos quedan en
--      null: los cierres históricos NO se recalculan (son una foto congelada).
--   2. register_debt_payment y register_debt_payments_batch: toman el turno abierto FOR SHARE
--      con CUALQUIER método (protocolo de locks de close-cash-shift.sql: el turno es el primer
--      lock de todo escritor de las cifras del turno) y guardan shift_id. Solo el efectivo
--      sigue EXIGIENDO turno.
--   3. close_cash_shift: el esperado de cada método no efectivo = sus ventas + sus abonos con
--      shift_id = el turno; el snapshot agrega 'abonos' por método. expected_amount (solo
--      efectivo) no cambia. Todo numeric(12,2): los 4 valores que mira el precheck de la
--      fase 2 siguen con 2 decimales ('servidor').
-- R1: los lados de la fórmula son este archivo, src/lib/shiftCalc.ts (esperadoMetodo) +
-- CloseShiftModal, y el invariante de tests/helpers/db-local.ts (invarianteTurno).
--
-- PRECONDICIÓN (bloque 0, aborta sin cambiar nada): las tres funciones son las de hoy
-- (close-cash-shift.sql 433e2d78…, cobro-turno.sql f90d210f… y d6d090a2…).
-- RE-APLICAR: falla en la precondición (las funciones ya no son las de antes) y no cambia nada.
-- 🔴 Re-aplicar después close-cash-shift.sql o cobro-turno.sql devolvería las funciones a su
-- versión sin abonos, en silencio (R5).
--
-- NO DEDUZCAS EL ESTADO DE ESTE COMENTARIO — correlo:
--   select p.proname, md5(regexp_replace(regexp_replace(pg_get_functiondef(p.oid), E'\r','','g'), E'[ \t]+\n', E'\n','g'))
--     from pg_proc p where p.pronamespace = 'public'::regnamespace
--      and p.proname in ('close_cash_shift', 'register_debt_payment', 'register_debt_payments_batch') order by 1;
--   select column_name from information_schema.columns where table_name = 'debt_payments' and column_name = 'shift_id';
-- ============================================================================

begin;

do $$
declare
  v_cerrar text := md5(regexp_replace(regexp_replace(pg_get_functiondef('public.close_cash_shift(uuid,jsonb,text)'::regprocedure), E'\r','','g'), E'[ \t]+\n', E'\n','g'));
  v_abono  text := md5(regexp_replace(regexp_replace(pg_get_functiondef('public.register_debt_payment(uuid,numeric,text)'::regprocedure), E'\r','','g'), E'[ \t]+\n', E'\n','g'));
  v_lote   text := md5(regexp_replace(regexp_replace(pg_get_functiondef('public.register_debt_payments_batch(uuid[],numeric,text)'::regprocedure), E'\r','','g'), E'[ \t]+\n', E'\n','g'));
begin
  if v_cerrar is distinct from '433e2d781efb73df033b58d549dc3d5b' then
    raise exception 'Precondición: close_cash_shift no es la de close-cash-shift.sql (md5 %, se esperaba 433e2d78…). No se cambió nada.', v_cerrar;
  end if;
  if v_abono is distinct from 'f90d210f8f69c53ba809440933f0d29c' then
    raise exception 'Precondición: register_debt_payment no es la de cobro-turno.sql (md5 %, se esperaba f90d210f…). No se cambió nada.', v_abono;
  end if;
  if v_lote is distinct from 'd6d090a2df4e0589d4b279ad3b4742f8' then
    raise exception 'Precondición: register_debt_payments_batch no es la de cobro-turno.sql (md5 %, se esperaba d6d090a2…). No se cambió nada.', v_lote;
  end if;
end $$;

-- ── 1. El turno de cada abono ─────────────────────────────────────────────────
alter table public.debt_payments
  add column shift_id uuid references public.cash_shifts(id) on delete set null;
create index debt_payments_shift_id on public.debt_payments (shift_id) where shift_id is not null;
comment on column public.debt_payments.shift_id is
  'Turno al que entra el abono en el arqueo (lo pone register_debt_payment(_batch) con el turno bloqueado). Null = sin turno abierto, o anterior a arqueo-abonos.sql.';

-- ── 2. El abono simple ────────────────────────────────────────────────────────
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

  -- 2b. PROTOCOLO (close-cash-shift.sql + arqueo-abonos.sql): el turno abierto, PRIMER
  --     lock, con CUALQUIER método: el abono entra al arqueo de ese turno (efectivo, como
  --     ingreso de caja; los demás, por debt_payments.shift_id). Solo el EFECTIVO lo
  --     EXIGE. Si un cierre está en curso, se espera; al confirmarse ya no hay turno abierto
  --     y el abono queda sin turno (los otros métodos) o se rechaza (efectivo).
  select id into v_shift_id
    from public.cash_shifts
   where restaurant_id = v_restaurant_id and closed_at is null
   limit 1
   for share;
  if p_payment_method = 'cash' and v_shift_id is null then
    raise exception 'No hay un turno de caja abierto: para recibir efectivo hay que abrir el turno. Otros métodos (tarjeta, transferencia, Nequi) sí se pueden registrar.';
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
    (restaurant_id, order_id, amount, payment_method, cash_movement_id, shift_id, created_by)
  values
    (v_restaurant_id, p_order_id, p_amount, p_payment_method, v_cash_mov_id, v_shift_id, auth.uid());

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

-- ── 3. El abono en lote ───────────────────────────────────────────────────────
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

  -- 2b. PROTOCOLO (close-cash-shift.sql + arqueo-abonos.sql): el turno abierto, PRIMER
  --     lock, con CUALQUIER método: el abono entra al arqueo de ese turno (efectivo, como
  --     ingreso de caja; los demás, por debt_payments.shift_id). Solo el EFECTIVO lo
  --     EXIGE. Si un cierre está en curso, se espera; al confirmarse ya no hay turno abierto
  --     y el abono queda sin turno (los otros métodos) o se rechaza (efectivo).
  select id into v_shift_id
    from public.cash_shifts
   where restaurant_id = v_restaurant_id and closed_at is null
   limit 1
   for share;
  if p_payment_method = 'cash' and v_shift_id is null then
    raise exception 'No hay un turno de caja abierto: para recibir efectivo hay que abrir el turno. Otros métodos (tarjeta, transferencia, Nequi) sí se pueden registrar.';
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
       cash_movement_id, batch_id, shift_id, created_by)
    values
      (v_restaurant_id, r.id, v_apply, p_payment_method,
       v_cash_mov_id, v_batch_id, v_shift_id, auth.uid());

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

-- ── 4. El cierre de turno ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.close_cash_shift(p_shift_id uuid, p_declarado jsonb, p_comentario text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sede        uuid := get_my_restaurant_id();
  v_shift       public.cash_shifts%rowtype;
  v_decl        jsonb;
  v_bad         text;
  v_cash        numeric(12,2);
  v_card        numeric(12,2);
  v_transfer    numeric(12,2);
  v_nequi       numeric(12,2);
  v_in          numeric(12,2);
  v_out         numeric(12,2);
  v_exp_cash    numeric(12,2);
  v_d_cash      numeric(12,2);
  v_d_card      numeric(12,2);
  v_d_transfer  numeric(12,2);
  v_d_nequi     numeric(12,2);
  v_sales_count integer;
  v_vouchers    numeric(12,2);
  v_ab_card     numeric(12,2);
  v_ab_transfer numeric(12,2);
  v_ab_nequi    numeric(12,2);
  v_rec         jsonb;
begin
  if v_sede is null then
    raise exception 'No tienes una sede activa';
  end if;
  if not has_permission('caja.cerrar') then
    raise exception 'No autorizado para cerrar el turno';
  end if;

  -- PROTOCOLO: el cierre toma el turno FOR UPDATE ANTES de leer nada. Desde acá
  -- ningún escritor del protocolo puede cambiar las cifras de este turno.
  select * into v_shift
    from public.cash_shifts
   where id = p_shift_id and restaurant_id = v_sede
     for update;
  if not found then
    raise exception 'El turno no existe o no pertenece a tu sede';
  end if;
  if v_shift.closed_at is not null then
    raise exception 'El turno ya está cerrado';
  end if;

  -- Declarado: allowlist de claves; lo ausente vale 0; nada negativo.
  v_decl := coalesce(p_declarado, '{}'::jsonb);
  if jsonb_typeof(v_decl) <> 'object' then
    raise exception 'El declarado tiene que ser un objeto';
  end if;
  select string_agg(k, ', ') into v_bad
    from jsonb_object_keys(v_decl) k
   where k not in ('cash', 'card', 'transfer', 'nequi');
  if v_bad is not null then
    raise exception 'Métodos declarados inválidos: %', v_bad;
  end if;
  if not (v_decl ? 'cash') then
    raise exception 'Falta el efectivo declarado';
  end if;
  v_d_cash     := coalesce((v_decl->>'cash')::numeric, 0);
  v_d_card     := coalesce((v_decl->>'card')::numeric, 0);
  v_d_transfer := coalesce((v_decl->>'transfer')::numeric, 0);
  v_d_nequi    := coalesce((v_decl->>'nequi')::numeric, 0);
  if least(v_d_cash, v_d_card, v_d_transfer, v_d_nequi) < 0 then
    raise exception 'Un monto declarado no puede ser negativo';
  end if;

  -- Ventas por método en la ventana del turno (= getShiftPayments + salesSummary).
  select coalesce(sum(amount) filter (where method = 'cash'),     0),
         coalesce(sum(amount) filter (where method = 'card'),     0),
         coalesce(sum(amount) filter (where method = 'transfer'), 0),
         coalesce(sum(amount) filter (where method = 'nequi'),    0)
    into v_cash, v_card, v_transfer, v_nequi
    from public.payments
   where restaurant_id = v_sede and created_at >= v_shift.opened_at;

  -- Abonos de fiado NO en efectivo de ESTE turno (arqueo-abonos.sql): ligados por
  -- debt_payments.shift_id, que pone la función del abono con el turno bloqueado. El
  -- efectivo NO se suma acá: un abono en efectivo ya entra como ingreso de caja (v_in).
  select coalesce(sum(amount) filter (where payment_method = 'card'),     0),
         coalesce(sum(amount) filter (where payment_method = 'transfer'), 0),
         coalesce(sum(amount) filter (where payment_method = 'nequi'),    0)
    into v_ab_card, v_ab_transfer, v_ab_nequi
    from public.debt_payments
   where shift_id = p_shift_id;

  -- Movimientos manuales del turno (= getCashMovements, por shift_id).
  select coalesce(sum(amount) filter (where type = 'in'),  0),
         coalesce(sum(amount) filter (where type = 'out'), 0)
    into v_in, v_out
    from public.cash_movements
   where shift_id = p_shift_id;

  -- = availableCash() de src/lib/shiftCalc.ts
  v_exp_cash := v_shift.opening_amount + v_cash + v_in - v_out;

  -- = getShiftSalesCount: órdenes con pago en la ventana ∪ ventas gratis.
  select count(*) into v_sales_count from (
    select order_id as id from public.payments
     where restaurant_id = v_sede and created_at >= v_shift.opened_at
    union
    select id from public.orders
     where restaurant_id = v_sede and total = 0 and order_number is not null
       and cancelled_at is null and created_at >= v_shift.opened_at
  ) u;

  -- = getShiftVouchersTotal: vales de órdenes con pago en la ventana + vales gratis.
  select coalesce(sum(o.discount_amount), 0) into v_vouchers
    from public.orders o
   where o.discount_kind = 'vale'
     and (   o.id in (select order_id from public.payments
                       where restaurant_id = v_sede and created_at >= v_shift.opened_at)
          or (o.restaurant_id = v_sede and o.total = 0 and o.order_number is not null
              and o.cancelled_at is null and o.created_at >= v_shift.opened_at));

  -- = el snapshot que armaba CloseShiftModal.handleClose (+ sales_count/vouchers).
  v_rec := jsonb_build_object(
    'methods', jsonb_build_object(
      'cash',     jsonb_build_object('expected', v_exp_cash, 'declared', v_d_cash,     'difference', v_d_cash - v_exp_cash),
      'card',     jsonb_build_object('expected', v_card + v_ab_card,         'declared', v_d_card,     'difference', v_d_card - (v_card + v_ab_card),             'abonos', v_ab_card),
      'transfer', jsonb_build_object('expected', v_transfer + v_ab_transfer, 'declared', v_d_transfer, 'difference', v_d_transfer - (v_transfer + v_ab_transfer), 'abonos', v_ab_transfer),
      'nequi',    jsonb_build_object('expected', v_nequi + v_ab_nequi,       'declared', v_d_nequi,    'difference', v_d_nequi - (v_nequi + v_ab_nequi),          'abonos', v_ab_nequi)
    ),
    'expected_total',   v_exp_cash + v_card + v_ab_card + v_transfer + v_ab_transfer + v_nequi + v_ab_nequi,
    'declared_total',   v_d_cash + v_d_card + v_d_transfer + v_d_nequi,
    'difference_total', (v_d_cash + v_d_card + v_d_transfer + v_d_nequi)
                      - (v_exp_cash + v_card + v_ab_card + v_transfer + v_ab_transfer + v_nequi + v_ab_nequi),
    'sales_count',      v_sales_count,
    'vouchers_total',   v_vouchers
  );

  update public.cash_shifts
     set closing_amount       = v_d_cash,
         expected_amount      = v_exp_cash,
         difference           = v_d_cash - v_exp_cash,
         closed_by            = auth.uid(),
         closed_at            = now(),          -- trg_shift_closed_at lo fija igual
         close_reconciliation = v_rec,
         close_comment        = nullif(btrim(coalesce(p_comentario, '')), '')
   where id = p_shift_id;

  -- Lo que el comprobante necesita y el navegador ya no calcula.
  return jsonb_build_object(
    'id',                   p_shift_id,
    'expected_amount',      v_exp_cash,
    'difference',           v_d_cash - v_exp_cash,
    'movements_in',         v_in,
    'movements_out',        v_out,
    'close_reconciliation', v_rec
  );
end;
$function$;

commit;
