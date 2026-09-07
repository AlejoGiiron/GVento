-- ============================================================
-- fiado-abono-lote.sql
-- register_debt_payments_batch: UN pago del cliente repartido entre VARIAS
--   ventas a fiado suyas, FIFO por antigüedad, en una sola transacción.
--
-- QUÉ HACE
--   1. Agrega `debt_payments.batch_id uuid` (nullable) + índice parcial.
--   2. Crea la función `register_debt_payments_batch(uuid[], numeric, text)`.
--   3. Revoca EXECUTE de public/anon y lo concede solo a authenticated.
--
-- PRECONDICIONES (aplicadas antes que esto)
--   · fiado-clientes.sql      → debt_payments, orders.payment_status,
--                               register_debt_payment
--   · cash-movements.sql      → cash_movements
--   · multi-tenant-rbac.sql   → get_my_restaurant_id(), has_permission()
--
-- MODO DE FALLO AL RE-APLICAR: IDEMPOTENTE.
--   `add column if not exists` + `create index if not exists` +
--   `create or replace function`. No hay DELETE, ni UPDATE de datos existentes,
--   ni DROP. Re-aplicarla no toca un solo abono ya registrado.
--
-- NO DEDUZCAS EL ESTADO DE ESTE COMENTARIO — correlo:
--   select 1 from pg_proc where proname = 'register_debt_payments_batch';
--   select column_name from information_schema.columns
--    where table_schema='public' and table_name='debt_payments'
--      and column_name='batch_id';
--
-- ── DECISIONES, Y POR QUÉ ───────────────────────────────────────────────────
--
-- UN cash_movement POR LOTE, NO UNO POR ORDEN. El cajero recibe UN billete; el
--   arqueo tiene que mostrar UNA entrada. Con N movimientos la suma da igual
--   pero la lista de caja miente sobre lo que pasó en el mostrador.
--   `debt_payments.cash_movement_id` es una FK SIN unique, así que los N abonos
--   del lote pueden apuntar al mismo movimiento sin tocar el esquema. La
--   trazabilidad inversa queda intacta: desde el movimiento,
--   `select … from debt_payments where cash_movement_id = X` dice qué ventas
--   cubrió.
--
-- `batch_id` EXISTE PORQUE cash_movement_id NO ALCANZA. Un lote pagado con
--   tarjeta, transferencia o Nequi no genera movimiento de caja, y un lote en
--   efectivo SIN turno abierto tampoco. En esos casos los abonos quedarían
--   sueltos, sin nada que diga que fueron un solo pago. `batch_id` los agrupa
--   siempre, independiente del método y del turno.
--
-- SOBREPAGO: SE RECHAZA, no se genera vuelto. Una deuda no da cambio; si el
--   cliente entrega de más, el cajero cobra el saldo exacto y el resto no es
--   asunto de esta función.
--
-- UN SOLO CLIENTE: SE VALIDA, NO SE ASUME. La UI llama desde el detalle de un
--   cliente, pero la RPC no puede confiar en eso — es la superficie de escritura
--   y la validación cuesta una consulta. La clave de agrupación es la MISMA que
--   usa la Cartera (`customer_id`, y si es null el nombre), porque hay fiados
--   viejos sin `customer_id` y agrupar distinto que la pantalla haría que la UI
--   ofrezca lotes que la RPC rechaza.
--
-- FIFO POR `created_at ASC`, DESEMPATE POR `id`. `created_at` es la fecha de la
--   VENTA, que es la columna "Fecha" que el cajero ve en pantalla: lo que está
--   arriba se cobra primero. El desempate por id hace el orden total y
--   determinista — sin él, dos ventas del mismo instante se repartirían en un
--   orden que Postgres no garantiza, y la previsualización de la UI podría no
--   coincidir con lo que se persiste.
--
-- EL ORDEN LO IMPONE LA RPC, NO EL CLIENTE. `p_order_ids` es un conjunto; el
--   orden del array se ignora a propósito. Si el reparto siguiera el orden que
--   manda el cliente, un llamador podría saldar la venta nueva y dejar viva la
--   vieja, que es exactamente lo que FIFO viene a impedir.
--
-- `for update` SOBRE LAS ÓRDENES. La RPC de un solo abono no lo tiene, y por eso
--   dos cajeros abonando a la vez sobre la misma venta pueden pasarse del saldo:
--   los dos leen el mismo `sum(amount)` antes de que el otro inserte. Acá se
--   bloquean las filas antes de calcular. (La de una orden se corrige aparte,
--   volviéndola un wrapper de esta — commit separado, es refactor de código
--   vivo.)
--
-- ATOMICIDAD: una función plpgsql corre dentro de una transacción. Cualquier
--   `raise exception` revierte el lote entero, incluido el cash_movement. No
--   existe el estado "se aplicaron 2 de 3".
--
-- PAGO MIXTO: FUERA DE ALCANCE. Un lote tiene UN método. Dividir un abono entre
--   métodos es otra función y otra UI.
--
-- Ejecutar en: Supabase Dashboard > SQL Editor. Migración NUEVA: no edita
--   fiado-clientes.sql ni ninguna otra ya aplicada (R5).
-- ============================================================

begin;

-- ── 1. Agrupador del lote ───────────────────────────────────────────────────
alter table public.debt_payments
  add column if not exists batch_id uuid;

comment on column public.debt_payments.batch_id is
  'Agrupa los abonos nacidos de UN pago repartido entre varias ventas '
  '(register_debt_payments_batch). null en los abonos individuales. Es lo que '
  'permite reconstruir "el cliente pagó $150.000 y se repartió así" incluso '
  'cuando no hubo cash_movement — pago con tarjeta/transferencia/Nequi, o '
  'efectivo sin turno abierto.';

create index if not exists idx_debt_payments_batch
  on public.debt_payments (batch_id)
  where batch_id is not null;

-- ── 2. La función ───────────────────────────────────────────────────────────
create or replace function public.register_debt_payments_batch(
  p_order_ids      uuid[],
  p_amount         numeric,
  p_payment_method text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
    select id into v_shift_id
      from public.cash_shifts
     where restaurant_id = v_restaurant_id and closed_at is null
     limit 1;  -- a lo sumo un turno abierto por sede

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
$$;

-- ── 3. Permisos ─────────────────────────────────────────────────────────────
-- Postgres concede EXECUTE a PUBLIC por defecto en toda función nueva. En una
-- SECURITY DEFINER eso hay que revocarlo explícitamente (ver
-- security-definer-revoke.sql).
revoke execute on function public.register_debt_payments_batch(uuid[], numeric, text) from public;
revoke execute on function public.register_debt_payments_batch(uuid[], numeric, text) from anon;
grant  execute on function public.register_debt_payments_batch(uuid[], numeric, text) to authenticated;

commit;

-- ============================================================
-- VERIFICACIÓN (read-only). Correr DESPUÉS del commit.
-- ============================================================

-- (A) La columna y su índice.
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public' and table_name = 'debt_payments'
   and column_name = 'batch_id';

select indexname from pg_indexes
 where schemaname = 'public' and tablename = 'debt_payments'
   and indexname = 'idx_debt_payments_batch';

-- (B) La función existe y es SECURITY DEFINER (prosecdef = t).
select proname, prosecdef
  from pg_proc
 where proname = 'register_debt_payments_batch';

-- (C) Los permisos quedaron como se quiere: authenticated SÍ, public y anon NO.
--     Las tres columnas esperadas: t / f / f.
select has_function_privilege('authenticated',
         'public.register_debt_payments_batch(uuid[], numeric, text)', 'execute') as authenticated_puede,
       has_function_privilege('anon',
         'public.register_debt_payments_batch(uuid[], numeric, text)', 'execute') as anon_puede,
       has_function_privilege('public',
         'public.register_debt_payments_batch(uuid[], numeric, text)', 'execute') as public_puede;
