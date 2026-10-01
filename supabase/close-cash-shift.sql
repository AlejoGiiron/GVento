-- supabase/close-cash-shift.sql
-- ============================================================================
-- QUÉ HACE: el CIERRE DE TURNO pasa del navegador al servidor, y los caminos
-- que cambian las cifras de un turno se coordinan con él por locks.
--
--   1. close_cash_shift(p_shift_id, p_declarado, p_comentario): calcula en el
--      servidor el esperado de cada método, sales_count y vouchers_total, con la
--      MISMA fórmula que el cliente (contrato R1 en dos lados, ver abajo), y
--      congela el arqueo. El navegador solo manda lo DECLARADO.
--   2. (FASE 2, archivo aparte: close-cash-shift-revoke.sql) authenticated y
--      anon pierden el UPDATE sobre cash_shifts.
--   3. Trigger en cash_movements (INSERT/UPDATE): rechaza movimientos en un
--      turno cerrado. NO en DELETE: los seeds purgan movimientos de turnos
--      cerrados (lab-seed, demo-seed*), y la app nunca borra ni edita
--      movimientos (grep de from('cash_movements') en src/: solo insert).
--   4. register_debt_payment, register_debt_payments_batch y register_sale_void
--      toman el turno con FOR SHARE (ver el protocolo).
--
-- POR QUÉ (medido en la nube el 2026-09-21, antes de pasar las pruebas a Docker):
-- registrar un egreso y cerrar enseguida persistió 100.000 en vez de 89.466 con
-- la red lenta (3/3), y con dos dispositivos SIEMPRE: cash_movements no tiene
-- realtime ni polling, así que el modal de A nunca se enteraba del egreso de B.
-- El arqueo se congela al cerrar a propósito, así que el error quedaba para siempre.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 PROTOCOLO DE LOCKS DEL TURNO — regla para TODO camino que cambie las cifras
--    de un turno (hoy: cierre, movimientos, abonos en efectivo, anulación; y el
--    cobro cuando llegue el cambio (1) de register_sale_payment):
--
--    · EL PRIMER LOCK O ESCRITURA DE CADA CAMINO ES LA FILA DEL TURNO.
--      Escritores: `select … from cash_shifts where … and closed_at is null
--      for share`. Cierre: `select … for update`. Recién DESPUÉS se tocan
--      orders / payments / debt_payments / cash_movements.
--    · Leer antes del turno (validar la orden, calcular un saldo) está bien:
--      leer no bloquea. Lo que no puede pasar es BLOQUEAR o ESCRIBIR otra cosa
--      antes del turno.
--    · Por qué alcanza: FOR SHARE de los escritores es compatible entre sí (dos
--      cajeros cobrando no se esperan) e incompatible con el FOR UPDATE del
--      cierre. Si el cierre llegó primero, el escritor ESPERA; cuando el cierre
--      confirma, Postgres re-evalúa el WHERE (READ COMMITTED) y la fila ya no
--      cumple `closed_at is null` ⇒ el escritor ve "no hay turno abierto" y NO
--      escribe en un turno congelado. Si el escritor llegó primero, el cierre
--      espera a que termine y lo incluye.
--    · Por qué no hay deadlock: el cierre toma UNA sola fila (el turno) y no
--      bloquea nada más; todos los escritores toman esa fila PRIMERO. No hay dos
--      caminos que tomen dos recursos en orden inverso. Medido en
--      tests/cierre-turno-servidor.spec.ts (cierre + abono + lote + anulación +
--      movimiento a la vez, sin 40P01).
--    · El lote (register_debt_payments_batch) bloqueaba las ÓRDENES antes del
--      turno: acá se invierte. Es el único cambio de orden; los demás solo
--      agregan FOR SHARE a la consulta del turno que ya tenían.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- CONTRATO R1 — la fórmula vive en DOS lados y no hay nada que los sincronice
-- salvo el test: src/lib/shiftCalc.ts (availableCash / calcShiftBalance, la
-- vista previa del modal) y close_cash_shift (lo que se congela):
--   efectivo esperado = apertura + ventas efectivo + ingresos − egresos
--   otro método       = ventas de ese método
--   ventas            = payments de la sede con created_at >= opened_at
--   movimientos       = cash_movements por shift_id
--   sales_count       = órdenes distintas con pago en la ventana + ventas
--                       gratis (total 0, con número, no anuladas)
--   vouchers_total    = vales (discount_kind 'vale') de órdenes con pago en la
--                       ventana + vales de ventas gratis
-- tests/cierre-turno-servidor.spec.ts verifica que el arqueo congelado sea el
-- que se recalcula desde la base.
--
-- PERMISO: caja.cerrar (el que gatea el botón: ShiftBanner → can('caja.cerrar'),
-- y la ruta /historial-turnos).
--
-- LO QUE ESTO NO CUBRE: el COBRO (register_sale_payment) todavía no toma el
-- turno. Un pago que confirma mientras se cierra puede quedar dentro de la
-- ventana [opened_at, closed_at] y fuera del arqueo congelado. Lo cierra el
-- cambio (1) con el mismo protocolo (for share).
--
-- 🔴 DESPLIEGUE EN DOS FASES — el orden importa:
--   FASE 1 = ESTE archivo. COMPATIBLE con el frontend viejo: agrega la RPC, el
--            trigger y los locks, y NO quita el UPDATE directo. El frontend de
--            prod sigue cerrando como antes hasta que se despliegue el nuevo.
--   (deploy del frontend nuevo, que cierra por close_cash_shift; los clientes
--    recargan la página)
--   FASE 2 = close-cash-shift-revoke.sql: quita el UPDATE directo. Recién ahí
--            una pestaña vieja deja de poder cerrar (42501).
--   Aplicar todo junto antes del deploy dejaría a los clientes SIN poder cerrar
--   turno hasta que llegue el frontend; desplegar el frontend antes de la fase 1,
--   también (llamaría a una RPC que no existe).
--
-- RE-APLICAR: idempotente (create or replace, drop trigger if exists). En una
-- transacción: si algo falla, rollback total.
-- SALVO DESPUÉS DE supabase/cobro-turno.sql: ese archivo redefine después
-- register_debt_payment y register_debt_payments_batch con el turno
-- obligatorio para el efectivo, y re-aplicar ESTE las devolvería a la versión
-- sin turno sin dar ningún error. El GUARD del paso 0 lo impide: aborta antes
-- de tocar nada, con un mensaje que dice por qué.
--
-- NO DEDUZCAS EL ESTADO DE ESTE COMENTARIO — correlo:
--   select proname from pg_proc where proname = 'close_cash_shift';           -- 1 fila
--   select tgname from pg_trigger where tgname = 'trg_cash_movements_turno_abierto';  -- 1 fila
--   select count(*) from pg_proc where proname in ('register_debt_payment',
--     'register_debt_payments_batch','register_sale_void')
--     and prosrc ilike '%for share%';                                         -- 3
-- ============================================================================

begin;

-- ── 0. GUARD: no revertir supabase/cobro-turno.sql ─────────────────────────
-- Marcador: el mensaje con que cobro-turno.sql rechaza el efectivo sin turno.
-- La versión de las dos funciones en ESTE archivo no lo tiene, ni la de prod
-- anterior a D (grep: la frase solo está en cobro-turno.sql y, en otra función,
-- register_sale_void). Si alguna ya lo tiene, se aborta acá: el raise deja la
-- transacción abortada y ningún paso de abajo se aplica.
do $guard$
declare
  v_ya text;
begin
  select string_agg(proname, ', ' order by proname) into v_ya
    from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname in ('register_debt_payment', 'register_debt_payments_batch')
     and prosrc ilike '%No hay un turno de caja abierto%';
  if v_ya is not null then
    raise exception 'close-cash-shift.sql NO se aplicó (no cambió nada). Estas funciones ya tienen la versión de supabase/cobro-turno.sql, que exige turno para recibir efectivo: %. Re-aplicar este archivo las revertiría sin error.', v_ya
      using hint = 'No hace falta re-aplicarlo: cobro-turno.sql ya está encima. Para ver qué hay, correr las queries "NO DEDUZCAS EL ESTADO" de los dos encabezados.';
  end if;
end
$guard$;

-- ── 1. Movimientos: nunca en un turno cerrado ────────────────────────────────
-- SECURITY DEFINER: toma el turno FOR SHARE aunque el usuario ya no tenga
-- privilegio de UPDATE sobre cash_shifts (FOR SHARE lo exige).
create or replace function public.enforce_cash_movement_turno_abierto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- PROTOCOLO: el turno, primero y con FOR SHARE.
  perform 1
     from public.cash_shifts
    where id = new.shift_id
      and closed_at is null
      for share;
  if not found then
    raise exception 'El turno de caja ya está cerrado: no se pueden registrar movimientos en él'
      using errcode = 'P0001', hint = 'Recargá la página: el turno activo cambió.';
  end if;
  return new;
end;
$$;

revoke execute on function public.enforce_cash_movement_turno_abierto() from public, anon, authenticated;

drop trigger if exists trg_cash_movements_turno_abierto on public.cash_movements;
create trigger trg_cash_movements_turno_abierto
  before insert or update on public.cash_movements
  for each row
  execute function public.enforce_cash_movement_turno_abierto();

-- ── 2. El cierre, en el servidor ─────────────────────────────────────────────
create or replace function public.close_cash_shift(
  p_shift_id   uuid,
  p_declarado  jsonb,          -- {"cash": 123000, "card": 0, "transfer": 0, "nequi": 7000}
  p_comentario text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
      'card',     jsonb_build_object('expected', v_card,     'declared', v_d_card,     'difference', v_d_card - v_card),
      'transfer', jsonb_build_object('expected', v_transfer, 'declared', v_d_transfer, 'difference', v_d_transfer - v_transfer),
      'nequi',    jsonb_build_object('expected', v_nequi,    'declared', v_d_nequi,    'difference', v_d_nequi - v_nequi)
    ),
    'expected_total',   v_exp_cash + v_card + v_transfer + v_nequi,
    'declared_total',   v_d_cash + v_d_card + v_d_transfer + v_d_nequi,
    'difference_total', (v_d_cash + v_d_card + v_d_transfer + v_d_nequi) - (v_exp_cash + v_card + v_transfer + v_nequi),
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
$$;

revoke execute on function public.close_cash_shift(uuid, jsonb, text) from public;
revoke execute on function public.close_cash_shift(uuid, jsonb, text) from anon;
grant  execute on function public.close_cash_shift(uuid, jsonb, text) to authenticated;

-- ── 3. El camino viejo se cierra en la FASE 2 (close-cash-shift-revoke.sql) ──

-- ── 4. Los escritores que cambian cifras del turno: FOR SHARE sobre el turno ──
-- Texto VIGENTE tomado del catálogo (base local con deriva 0 contra prod), con
-- las ediciones mínimas marcadas "PROTOCOLO". create or replace conserva los
-- grants de cada función.

-- 4a. Abono de fiado (uno)
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

  -- 3. Cargar la orden (debe ser de la sede y estar a fiado).
  select o.total, o.payment_status, o.order_number, c.name
    into v_order_total, v_pay_status, v_order_number, v_customer_name
  from public.orders o
  left join public.customers c on c.id = o.customer_id
  where o.id = p_order_id and o.restaurant_id = v_restaurant_id;

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
    select id into v_shift_id
    from public.cash_shifts
    where restaurant_id = v_restaurant_id and closed_at is null
    limit 1   -- a lo sumo un turno abierto por sede
    for share;  -- PROTOCOLO (close-cash-shift.sql): primer lock = el turno; si un cierre lo tiene,
                --   se espera y, al confirmar, el turno ya no califica ⇒ sin ingreso.

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

-- 4b. Abono de fiado en lote
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

-- 4c. Anulación de venta
CREATE OR REPLACE FUNCTION public.register_sale_void(p_order_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  limit 1
  for share;  -- PROTOCOLO (close-cash-shift.sql): primer lock = el turno (lo anterior solo lee).
              --   Con un cierre en curso se espera; si cierra, "No hay turno abierto".

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
$function$;

commit;
