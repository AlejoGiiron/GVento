-- supabase/mesas-servidor.sql
-- ============================================================================
-- PASO 9 — MESAS EN EL SERVIDOR (diseño aprobado el 2026-10-08: docs/diseno-mesas-servidor.md).
--
-- QUÉ AGREGA (todo aditivo; el frontend en producción no llama nada de esto):
--   1. 'merma' en stock_movements.type (el CHECK). Signo negativo, como 'sale'.
--   2. orders.close_id (único) · cobrada_por · cobrada_at — el cierre de mesa y quién cobró.
--   3. tables.archived_at · archived_by — mesas archivadas (las que vendieron no se borran).
--   4. order_item_bajas — cada ítem quitado de una mesa: quién, cuándo, motivo, monto, y si
--      se alcanzó a preparar (merma) o no (devuelto al inventario). Lectura por sede; sin
--      escritura directa: solo quitar_item_mesa.
--   5. _stock_inverso_item / _mover_stock_inverso — el camino inverso de stock, COMPARTIDO.
--   6. register_sale_void — la misma anulación, ahora por el camino compartido (decisión 4),
--      y con la orden bloqueada: dos anulaciones simultáneas de la misma venta devolvían el
--      stock DOS veces (medido el 2026-10-08 en Docker con la versión 2e9d312e…, la de
--      producción: la segunda esperaba el UPDATE de la primera y seguía, sin error).
--   7. close_table_sale — el cobro de mesa en una transacción (cierra H2).
--   8. quitar_item_mesa — quitar un ítem (cierra H3): pos.anular + motivo + "¿Se alcanzó a
--      preparar?" (Sí → merma: return + merma, el stock no cambia; No → devuelve stock).
--      "Enviado" = la tanda quedó en la base con "Agregar a la mesa" (opción A): todo ítem
--      guardado está enviado; lo de antes se corrige en el carrito del selector.
--   9. cerrar_mesa_sin_consumo — lo mismo que hoy (orden cancelada, mesa libre), en una
--      transacción.
--  10. eliminar_mesa — config.acceder: con ventas → se archiva; sin ventas → se borra.
--
-- PROTOCOLO DE LOCKS (close-cash-shift.sql): close_table_sale toma turno FOR SHARE → orden
-- FOR UPDATE → mesa FOR UPDATE. quitar_item_mesa y cerrar_mesa_sin_consumo NO tocan plata
-- (una orden viva no tiene pagos): solo orden → mesa, nunca el turno, así que no hay ciclo.
--
-- PRECONDICIÓN (bloque 0, aborta sin cambiar nada): A aplicada (register_sale_payment =
-- 3dbb2ea5…, permisos-cobro.sql), el 5.0 aplicado (_venta_pos_respuesta existe) y
-- register_sale_void = 2e9d312e… (la de close-cash-shift.sql, que este archivo reemplaza).
--
-- RE-APLICAR: falla en la precondición (register_sale_void ya no es la de antes) y hace
-- rollback: no cambia nada. 🔴 Re-aplicar después close-cash-shift.sql o register-sale-void.sql
-- devuelve register_sale_void a su versión sin el camino compartido (R5).
--
-- NO DEDUZCAS EL ESTADO DE ESTE COMENTARIO — correlo (normalización de Q-FUNCIONES):
--   select p.oid::regprocedure, md5(regexp_replace(regexp_replace(pg_get_functiondef(p.oid), E'\r','','g'), E'[ \t]+\n', E'\n','g')),
--          has_function_privilege('authenticated', p.oid, 'execute')
--     from pg_proc p where p.pronamespace = 'public'::regnamespace
--      and p.proname in ('register_sale_void', 'close_table_sale', 'quitar_item_mesa',
--                        'cerrar_mesa_sin_consumo', 'eliminar_mesa', '_stock_inverso_item',
--                        '_mover_stock_inverso', '_cierre_mesa_respuesta') order by 1;
--   select to_regclass('public.order_item_bajas');   -- no nulo = aplicada
-- ============================================================================

begin;

-- ── 0. PRECONDICIÓN (falla cerrado) ──────────────────────────────────────────
do $$
declare
  v_pago text := md5(regexp_replace(regexp_replace(pg_get_functiondef('public.register_sale_payment(uuid,jsonb)'::regprocedure), E'\r','','g'), E'[ \t]+\n', E'\n','g'));
  v_void text := md5(regexp_replace(regexp_replace(pg_get_functiondef('public.register_sale_void(uuid,text)'::regprocedure), E'\r','','g'), E'[ \t]+\n', E'\n','g'));
begin
  if v_pago is distinct from '3dbb2ea5b7810c6ec718fca9dc962a3d' then
    raise exception 'Precondición: register_sale_payment no es la de permisos-cobro.sql (md5 %). Aplica antes el Paso 7 (A). No se cambió nada.', v_pago;
  end if;
  if to_regprocedure('public._venta_pos_respuesta(uuid,boolean)') is null then
    raise exception 'Precondición: falta _venta_pos_respuesta (pos-sale-metodo-real.sql, el 5.0). No se cambió nada.';
  end if;
  if v_void is distinct from '2e9d312e315597f70796a9fc9cafbb7c' then
    raise exception 'Precondición: register_sale_void no es la de close-cash-shift.sql (md5 %, se esperaba 2e9d312e…). No se cambió nada.', v_void;
  end if;
end $$;

-- ── 1. 'merma' en stock_movements ─────────────────────────────────────────────
alter table public.stock_movements drop constraint stock_movements_type_check;
alter table public.stock_movements add constraint stock_movements_type_check
  check (type = any (array['sale', 'adjustment', 'return', 'purchase', 'merma']));

-- ── 2. orders: el cierre de mesa y quién cobró ────────────────────────────────
alter table public.orders
  add column close_id    uuid,
  add column cobrada_por uuid references public.profiles(id) on delete set null,
  add column cobrada_at  timestamptz;
alter table public.orders add constraint orders_close_id_key unique (close_id);
comment on column public.orders.close_id is
  'Clave del cobro de mesa (close_table_sale): un reintento con la misma clave devuelve la venta hecha.';
comment on column public.orders.cobrada_por is
  'Quién cobró la mesa (lo pone close_table_sale con auth.uid(), no el cliente). En el POS, created_by.';

-- ── 3. tables: archivo ────────────────────────────────────────────────────────
alter table public.tables
  add column archived_at timestamptz,
  add column archived_by uuid references public.profiles(id) on delete set null;
comment on column public.tables.archived_at is
  'Mesa archivada (eliminar_mesa con ventas): fuera de las pantallas de operación; los reportes la siguen nombrando.';

-- ── 4. order_item_bajas ───────────────────────────────────────────────────────
create table public.order_item_bajas (
  id            uuid        primary key,                 -- = p_baja_id (idempotencia)
  restaurant_id uuid        not null references public.restaurants(id) on delete cascade,
  order_id      uuid        not null references public.orders(id) on delete cascade,
  table_id      uuid        references public.tables(id) on delete set null,
  order_item_id uuid        not null,                    -- la línea se borra: sin FK
  product_id    uuid        references public.products(id) on delete set null,
  producto      text        not null,                    -- copia del nombre
  qty           integer     not null check (qty > 0),
  unit_price    numeric     not null,
  extras        jsonb       not null default '[]'::jsonb, -- copia: [{nombre, qty, unit_price}]
  monto         numeric     not null,
  preparado     boolean     not null,                    -- true = merma; false = devuelto
  motivo        text        not null check (btrim(motivo) <> ''),
  created_by    uuid        references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index order_item_bajas_sede_fecha on public.order_item_bajas (restaurant_id, created_at desc);
alter table public.order_item_bajas enable row level security;
create policy "order_item_bajas: ver de mi sede" on public.order_item_bajas
  for select using (restaurant_id = get_my_restaurant_id());
-- Supabase da por defecto TODOS los privilegios a anon y authenticated en las tablas nuevas
-- de public: se quitan, y authenticated solo LEE (por la policy). Se COMPRUEBA.
revoke all on table public.order_item_bajas from anon, authenticated;
grant select on table public.order_item_bajas to authenticated;
do $$
declare v_mal text;
begin
  select string_agg(x, ', ') into v_mal from (
    select 'rls apagado' as x where not (select relrowsecurity from pg_class where oid = 'public.order_item_bajas'::regclass)
    union all select 'anon con privilegios'
      where has_table_privilege('anon', 'public.order_item_bajas', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         or has_any_column_privilege('anon', 'public.order_item_bajas', 'SELECT,INSERT,UPDATE,REFERENCES')
    union all select 'authenticated puede escribir'
      where has_table_privilege('authenticated', 'public.order_item_bajas', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         or has_any_column_privilege('authenticated', 'public.order_item_bajas', 'INSERT,UPDATE,REFERENCES')
    union all select 'policies distintas de 1 de lectura'
      where (select count(*) from pg_policies where schemaname = 'public' and tablename = 'order_item_bajas') <> 1
         or exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'order_item_bajas' and cmd <> 'SELECT')
  ) t;
  if v_mal is not null then
    raise exception 'order_item_bajas no quedó encerrada (%). No se cambió nada.', v_mal;
  end if;
end $$;

-- ── 5. El camino inverso de stock, COMPARTIDO ─────────────────────────────────
-- Mueve UN producto. p_merma = false: devuelve (stock_qty += q; un 'return' +q).
-- p_merma = true: el stock NO cambia (ya se descontó al agregar); un 'return' +q y una
-- 'merma' −q: el movimiento deja de contar como venta y queda como merma.
create or replace function public._mover_stock_inverso(
  p_sede uuid, p_producto uuid, p_qty integer, p_referencia uuid, p_nota text, p_actor uuid, p_merma boolean)
returns void
language plpgsql
set search_path = public
as $$
begin
  if not p_merma then
    update public.products
       set stock_qty = coalesce(stock_qty, 0) + p_qty
     where id = p_producto and restaurant_id = p_sede;
  end if;
  insert into public.stock_movements (restaurant_id, product_id, type, qty, reference_id, notes, created_by)
  values (p_sede, p_producto, 'return', p_qty, p_referencia, p_nota, p_actor);
  if p_merma then
    insert into public.stock_movements (restaurant_id, product_id, type, qty, reference_id, notes, created_by)
    values (p_sede, p_producto, 'merma', -p_qty, p_referencia, p_nota, p_actor);
  end if;
end;
$$;

-- El inverso de lo que descontó UNA línea: el MISMO recorrido que tenía register_sale_void
-- (producto simple con tracking; insumos con tracking de un compuesto, receta × qty;
-- productos vinculados con tracking de sus extras, oie.qty tal cual). Devuelve cuántos
-- productos movió (lo que register_sale_void informa como stock_returned).
create or replace function public._stock_inverso_item(
  p_order_item_id uuid, p_sede uuid, p_actor uuid, p_referencia uuid, p_nota text, p_merma boolean)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_oi          record;
  v_comp        record;
  v_ex          record;
  v_kind        text;
  v_tracking    boolean;
  v_ex_tracking boolean;
  v_n           integer := 0;
begin
  select id, product_id, qty into v_oi from public.order_items where id = p_order_item_id;
  if not found then return 0; end if;

  select kind, stock_tracking into v_kind, v_tracking
    from public.products where id = v_oi.product_id and restaurant_id = p_sede;

  if found and v_oi.qty > 0 then
    if v_kind = 'simple' then
      if v_tracking then
        perform public._mover_stock_inverso(p_sede, v_oi.product_id, v_oi.qty, p_referencia, p_nota, p_actor, p_merma);
        v_n := v_n + 1;
      end if;
    elsif v_kind = 'composite' then
      for v_comp in
        select pc.component_id, pc.qty as recipe_qty
          from public.product_components pc
          join public.products p on p.id = pc.component_id
         where pc.parent_id = v_oi.product_id
           and pc.restaurant_id = p_sede
           and p.stock_tracking = true
      loop
        perform public._mover_stock_inverso(p_sede, v_comp.component_id, v_comp.recipe_qty * v_oi.qty,
                                            p_referencia, p_nota, p_actor, p_merma);
        v_n := v_n + 1;
      end loop;
    end if;
  end if;

  for v_ex in
    select oie.qty as ex_qty, e.linked_product_id
      from public.order_item_extras oie
      join public.extras e on e.id = oie.extra_id
     where oie.order_item_id = v_oi.id
  loop
    if v_ex.linked_product_id is not null and v_ex.ex_qty > 0 then
      select stock_tracking into v_ex_tracking
        from public.products where id = v_ex.linked_product_id and restaurant_id = p_sede;
      if found and v_ex_tracking then
        perform public._mover_stock_inverso(p_sede, v_ex.linked_product_id, v_ex.ex_qty,
                                            p_referencia, p_nota || ' (extra)', p_actor, p_merma);
        v_n := v_n + 1;
      end if;
    end if;
  end loop;

  return v_n;
end;
$$;

revoke execute on function public._mover_stock_inverso(uuid, uuid, integer, uuid, text, uuid, boolean) from public, anon, authenticated;
revoke execute on function public._stock_inverso_item(uuid, uuid, uuid, uuid, text, boolean) from public, anon, authenticated;

-- ── 6. register_sale_void (copia de close-cash-shift.sql; el stock, por el camino compartido;
--       la orden FOR UPDATE después del turno, con la guarda 3 sobre la fila bloqueada) ──
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

  -- 4b. PROTOCOLO: la ORDEN, después del turno, FOR UPDATE, y la guarda 3 otra vez sobre la
  --     fila bloqueada. Sin esto, dos anulaciones simultáneas de la misma venta pasaban las dos
  --     la guarda 3 (leída sin lock) y devolvían el stock dos veces. Ahora la segunda espera
  --     aquí y ve la anulación. También ordena la guarda 6 contra un abono simultáneo (el
  --     abono bloquea la orden: cobro-turno.sql).
  select o.cancelled_at
    into v_cancelled_at
  from public.orders o
  where o.id = p_order_id
  for update;

  if v_cancelled_at is not null then
    raise exception 'La venta ya está anulada';
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

  -- a. REVERSIÓN DE STOCK — por la función COMPARTIDA con quitar_item_mesa (mesas-servidor.sql):
  --    el MISMO camino inverso (producto simple con tracking, componentes de la receta con
  --    tracking, productos vinculados a los extras), las mismas notas y el mismo orden.
  for v_oi in
    select id
    from public.order_items
    where order_id = p_order_id
  loop
    v_stock_returned := v_stock_returned
      + public._stock_inverso_item(v_oi.id, v_sede, v_actor, p_order_id, 'Anulación de venta', false);
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

revoke execute on function public.register_sale_void(uuid, text) from public, anon;
grant  execute on function public.register_sale_void(uuid, text) to authenticated;

-- ── 7. close_table_sale — el cobro de mesa en una transacción ─────────────────
-- La respuesta: la de _venta_pos_respuesta (número, total, métodos REALES, fiado, cliente)
-- más quién cobró, a qué hora, y si la cerró OTRO cobro (otra clave): así la pantalla no
-- presenta como propio un cobro que hizo otro equipo.
create or replace function public._cierre_mesa_respuesta(p_order_id uuid, p_ya_existia boolean, p_otro boolean)
returns jsonb
language sql
stable
set search_path = public
as $$
  select public._venta_pos_respuesta(o.id, p_ya_existia)
         || jsonb_build_object(
              'otro_cobro',   p_otro,
              'cobrada_por',  (select pr.full_name from public.profiles pr where pr.id = o.cobrada_por),
              'cobrada_at',   o.cobrada_at,
              'mesa',         (select t.name from public.tables t where t.id = o.table_id))
    from public.orders o
   where o.id = p_order_id
$$;
revoke execute on function public._cierre_mesa_respuesta(uuid, boolean, boolean) from public, anon, authenticated;

create or replace function public.close_table_sale(
  p_order_id       uuid,
  p_close_id       uuid,
  p_total_esperado numeric,
  p_payments       jsonb default '[]'::jsonb,
  p_descuento      jsonb default null,
  p_fiado          jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sede      uuid    := get_my_restaurant_id();
  v_o         record;
  v_existe    record;
  v_pagos     jsonb   := coalesce(p_payments, '[]'::jsonb);
  v_fiado     boolean := p_fiado is not null;
  v_cliente   uuid;
  v_desc      numeric := coalesce((p_descuento->>'amount')::numeric, 0);
  v_kind      text    := coalesce(nullif(p_descuento->>'kind', ''), 'normal');
  v_lineas    numeric;
  v_total     numeric;
  v_numero    integer;
begin
  if p_order_id is null or p_close_id is null then raise exception 'Falta la mesa o la clave del cobro'; end if;
  if auth.uid() is null then raise exception 'No hay sesión'; end if;
  if v_sede is null then raise exception 'No tienes una sede activa'; end if;

  -- 0. IDEMPOTENCIA, antes que todo (como register_pos_sale): ¿este cobro ya se hizo?
  --    Un reenvío o un reintento con la MISMA clave recibe la venta hecha, aunque el
  --    turno se haya cerrado en el medio. No escribe nada.
  select id, restaurant_id into v_existe from public.orders where close_id = p_close_id;
  if found then
    if v_existe.restaurant_id <> v_sede then raise exception 'La mesa no es de tu sede'; end if;
    return public._cierre_mesa_respuesta(v_existe.id, true, false);
  end if;

  -- 1. Permisos, en el servidor (A): cobrar la mesa; descuento; fiado.
  if not has_permission('mesas.cobrar') then
    raise exception 'No tienes permiso para cobrar mesas';
  end if;
  if v_desc < 0 then raise exception 'El descuento no puede ser negativo'; end if;
  if v_kind not in ('normal', 'vale') then raise exception 'Tipo de descuento inválido: %', v_kind; end if;
  if v_desc > 0 and not has_permission('pos.descuento') then
    raise exception 'No tienes permiso para aplicar descuentos';
  end if;
  if v_fiado then
    if not has_permission('fiado.gestionar') then raise exception 'No tienes permiso para vender a fiado'; end if;
    v_cliente := nullif(p_fiado->>'customer_id', '')::uuid;
    if v_cliente is null then raise exception 'Selecciona un cliente para la venta a fiado'; end if;
    perform 1 from public.customers where id = v_cliente and restaurant_id = v_sede;
    if not found then raise exception 'El cliente no es de tu sede'; end if;
    if jsonb_array_length(v_pagos) > 0 then raise exception 'Una venta a fiado no lleva pagos'; end if;
  end if;
  if p_total_esperado is null then raise exception 'Falta el total a cobrar'; end if;

  -- 2. PROTOCOLO: el turno, PRIMER lock (también para fiado y cortesía).
  perform 1 from public.cash_shifts
   where restaurant_id = v_sede and closed_at is null
   limit 1
   for share;
  if not found then
    raise exception 'No hay un turno de caja abierto. Abre el turno antes de cobrar.';
  end if;

  --    La orden, DESPUÉS del turno.
  select id, restaurant_id, type, status, table_id, order_number, close_id, customer_id, customer_name
    into v_o
    from public.orders where id = p_order_id
   for update;
  if not found or v_o.restaurant_id <> v_sede then
    raise exception 'La mesa no existe o no es de tu sede';
  end if;
  if v_o.type <> 'dine_in' then raise exception 'Esta orden no es de una mesa'; end if;

  --    Ya cerrada mientras esperábamos el lock: con ESTA clave (un reenvío simultáneo) es la
  --    misma venta; con otra (u otro equipo) se devuelve ESA venta, marcada como de otro cobro.
  if v_o.status = 'delivered' then
    return public._cierre_mesa_respuesta(p_order_id, true, v_o.close_id is distinct from p_close_id);
  end if;
  if v_o.status = 'cancelled' then
    raise exception 'La mesa ya se cerró sin consumo o se anuló';
  end if;

  --    La mesa, DESPUÉS de la orden.
  perform 1 from public.tables where id = v_o.table_id for update;

  -- 3. Validaciones.
  if exists (select 1 from public.payments where order_id = p_order_id) then
    raise exception 'La mesa ya tiene pagos registrados';
  end if;
  if not exists (select 1 from public.order_items where order_id = p_order_id) then
    raise exception 'La mesa no tiene consumo: ciérrala sin consumo';
  end if;
  --    B1: el total sale de las líneas (ítems + extras) menos el descuento, y tiene que ser el
  --    que vio la pantalla. VALIDA, no corrige (R6).
  select coalesce((select sum(i.qty * i.unit_price) from public.order_items i where i.order_id = p_order_id), 0)
       + coalesce((select sum(e.qty * e.unit_price) from public.order_item_extras e
                     join public.order_items i on i.id = e.order_item_id where i.order_id = p_order_id), 0)
    into v_lineas;
  if v_desc > v_lineas then
    raise exception 'El descuento (%) supera el total de la mesa (%)', v_desc, v_lineas;
  end if;
  v_total := v_lineas - v_desc;
  if round(v_total, 2) <> round(p_total_esperado, 2) then
    raise exception 'No se cobró: el total de la mesa (%) no coincide con el de la pantalla (%). Actualiza la mesa y vuelve a cobrar.',
      v_total, p_total_esperado;
  end if;

  -- 4. Escrituras, todas en esta transacción.
  update public.orders
     set discount_amount = v_desc,
         discount_type   = case when v_desc > 0 then 'fixed' end,
         discount_kind   = case when v_desc > 0 then v_kind else 'normal' end,
         discount_reason = case when v_desc > 0 then nullif(btrim(coalesce(p_descuento->>'reason', '')), '') end,
         total           = v_total,
         payment_status  = case when v_fiado then 'pending' else 'paid' end,
         customer_id     = case when v_fiado then v_cliente else v_o.customer_id end,
         customer_name   = case when v_fiado then nullif(p_fiado->>'customer_name', '') else v_o.customer_name end
   where id = p_order_id;

  if not v_fiado then
    if v_total > 0 then
      -- El cobro de siempre: valida Σ pagos = total y el permiso por tipo (mesas.cobrar).
      perform public.register_sale_payment(p_order_id, v_pagos);
    elsif jsonb_array_length(v_pagos) > 0 then
      raise exception 'Una mesa con total 0 no lleva pagos';
    end if;
  end if;

  v_numero := coalesce(v_o.order_number, public.next_order_number(v_sede));
  update public.orders
     set order_number = v_numero,
         status       = 'delivered',
         cobrada_por  = auth.uid(),
         cobrada_at   = now(),
         close_id     = p_close_id
   where id = p_order_id;
  update public.tables set status = 'free' where id = v_o.table_id;

  return public._cierre_mesa_respuesta(p_order_id, false, false);
end;
$$;

revoke execute on function public.close_table_sale(uuid, uuid, numeric, jsonb, jsonb, jsonb) from public, anon;
grant  execute on function public.close_table_sale(uuid, uuid, numeric, jsonb, jsonb, jsonb) to authenticated;

-- ── 8. quitar_item_mesa ───────────────────────────────────────────────────────
create or replace function public.quitar_item_mesa(
  p_item_id   uuid,
  p_baja_id   uuid,
  p_motivo    text,
  p_preparado boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sede   uuid := get_my_restaurant_id();
  v_actor  uuid := auth.uid();
  v_baja   record;
  v_order  uuid;
  v_o      record;
  v_it     record;
  v_extras jsonb;
  v_monto  numeric;
  v_movs   integer;
  v_total  numeric;
begin
  if p_item_id is null or p_baja_id is null then raise exception 'Falta el ítem o la clave de la baja'; end if;
  if v_actor is null then raise exception 'No hay sesión'; end if;
  if v_sede is null then raise exception 'No tienes una sede activa'; end if;

  -- Idempotencia: ¿esta baja ya se hizo?
  select * into v_baja from public.order_item_bajas where id = p_baja_id;
  if found then
    if v_baja.restaurant_id <> v_sede then raise exception 'La baja no es de tu sede'; end if;
    return jsonb_build_object('baja_id', v_baja.id, 'order_id', v_baja.order_id, 'preparado', v_baja.preparado,
                              'total', (select total from public.orders where id = v_baja.order_id), 'ya_existia', true);
  end if;

  -- Todo ítem guardado ya está ENVIADO (opción A): quitarlo exige pos.anular y un motivo.
  if not has_permission('pos.anular') then
    raise exception 'No tienes permiso para quitar ítems de la mesa';
  end if;
  if nullif(btrim(coalesce(p_motivo, '')), '') is null then
    raise exception 'Escribe el motivo';
  end if;
  if p_preparado is null then raise exception 'Indica si se alcanzó a preparar'; end if;

  select order_id into v_order from public.order_items where id = p_item_id;
  if not found then raise exception 'El ítem ya no está en la mesa'; end if;

  -- La orden FOR UPDATE (no toca plata: no entra en el protocolo del turno).
  select id, restaurant_id, type, status, table_id into v_o from public.orders where id = v_order for update;
  if v_o.restaurant_id <> v_sede then raise exception 'La mesa no es de tu sede'; end if;
  if v_o.type <> 'dine_in' then raise exception 'El ítem no es de una mesa'; end if;
  if v_o.status not in ('pending', 'preparing', 'ready') then
    raise exception 'La mesa ya está cerrada: para corregir una venta cobrada se anula';
  end if;
  if exists (select 1 from public.payments where order_id = v_order) then
    raise exception 'La mesa ya tiene pagos registrados';
  end if;

  select i.id, i.product_id, i.qty, i.unit_price, p.name as producto
    into v_it
    from public.order_items i
    left join public.products p on p.id = i.product_id
   where i.id = p_item_id;
  if not found then raise exception 'El ítem ya no está en la mesa'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('nombre', e.name, 'qty', oie.qty, 'unit_price', oie.unit_price)
                            order by oie.created_at), '[]'::jsonb),
         coalesce(sum(oie.qty * oie.unit_price), 0)
    into v_extras, v_monto
    from public.order_item_extras oie
    left join public.extras e on e.id = oie.extra_id
   where oie.order_item_id = p_item_id;
  v_monto := v_monto + v_it.qty * v_it.unit_price;

  -- Stock: el camino inverso compartido. Preparado → merma (el stock no cambia);
  -- no preparado → vuelve al inventario.
  v_movs := public._stock_inverso_item(
    p_item_id, v_sede, v_actor, v_order,
    case when p_preparado then 'Ítem quitado de la mesa: merma' else 'Ítem quitado de la mesa: no se preparó' end,
    p_preparado);

  insert into public.order_item_bajas
    (id, restaurant_id, order_id, table_id, order_item_id, product_id, producto, qty, unit_price,
     extras, monto, preparado, motivo, created_by)
  values
    (p_baja_id, v_sede, v_order, v_o.table_id, p_item_id, v_it.product_id, coalesce(v_it.producto, '(producto)'),
     v_it.qty, v_it.unit_price, v_extras, v_monto, p_preparado, btrim(p_motivo), v_actor);

  delete from public.order_item_extras where order_item_id = p_item_id;
  delete from public.order_items where id = p_item_id;

  -- El total, desde las líneas (la misma fórmula que add_order_items_with_extras).
  update public.orders o
     set total = greatest(0,
           coalesce((select sum(i.qty * i.unit_price) from public.order_items i where i.order_id = o.id), 0)
         + coalesce((select sum(e.qty * e.unit_price) from public.order_item_extras e
                       join public.order_items i on i.id = e.order_item_id where i.order_id = o.id), 0)
         - coalesce(o.discount_amount, 0))
   where o.id = v_order
  returning total into v_total;

  return jsonb_build_object('baja_id', p_baja_id, 'order_id', v_order, 'preparado', p_preparado,
                            'movimientos', v_movs, 'monto', v_monto, 'total', v_total, 'ya_existia', false);
end;
$$;

revoke execute on function public.quitar_item_mesa(uuid, uuid, text, boolean) from public, anon;
grant  execute on function public.quitar_item_mesa(uuid, uuid, text, boolean) to authenticated;

-- ── 9. cerrar_mesa_sin_consumo — lo de hoy, en una transacción ────────────────
create or replace function public.cerrar_mesa_sin_consumo(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sede uuid := get_my_restaurant_id();
  v_o    record;
begin
  if p_order_id is null then raise exception 'Falta la mesa'; end if;
  if auth.uid() is null then raise exception 'No hay sesión'; end if;
  if v_sede is null then raise exception 'No tienes una sede activa'; end if;
  if not has_permission('mesas.gestionar') then raise exception 'No tienes permiso para cerrar mesas'; end if;

  select id, restaurant_id, type, status, table_id into v_o from public.orders where id = p_order_id for update;
  if not found or v_o.restaurant_id <> v_sede then raise exception 'La mesa no existe o no es de tu sede'; end if;
  if v_o.type <> 'dine_in' then raise exception 'Esta orden no es de una mesa'; end if;
  if v_o.status = 'cancelled' then
    return jsonb_build_object('order_id', p_order_id, 'ya_existia', true);
  end if;
  if v_o.status = 'delivered' then raise exception 'La mesa ya se cobró'; end if;
  if exists (select 1 from public.order_items where order_id = p_order_id) then
    raise exception 'La mesa tiene consumo: cóbrala o quita los ítems';
  end if;
  if exists (select 1 from public.payments where order_id = p_order_id) then
    raise exception 'La mesa tiene pagos registrados';
  end if;

  -- Lo mismo que hacía la pantalla (handleCloseEmptyTable): orden cancelada y mesa libre.
  update public.orders set status = 'cancelled' where id = p_order_id;
  perform 1 from public.tables where id = v_o.table_id for update;
  update public.tables set status = 'free' where id = v_o.table_id;
  return jsonb_build_object('order_id', p_order_id, 'ya_existia', false);
end;
$$;

revoke execute on function public.cerrar_mesa_sin_consumo(uuid) from public, anon;
grant  execute on function public.cerrar_mesa_sin_consumo(uuid) to authenticated;

-- ── 10. eliminar_mesa — con ventas se archiva; sin ventas se borra ────────────
create or replace function public.eliminar_mesa(p_table_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sede uuid := get_my_restaurant_id();
  v_t    record;
begin
  if p_table_id is null then raise exception 'Falta la mesa'; end if;
  if auth.uid() is null then raise exception 'No hay sesión'; end if;
  if v_sede is null then raise exception 'No tienes una sede activa'; end if;
  if not has_permission('config.acceder') then raise exception 'No tienes permiso para eliminar mesas'; end if;

  select id, restaurant_id, archived_at into v_t from public.tables where id = p_table_id for update;
  if not found or v_t.restaurant_id <> v_sede then raise exception 'La mesa no existe o no es de tu sede'; end if;
  if v_t.archived_at is not null then
    return jsonb_build_object('table_id', p_table_id, 'accion', 'archivada', 'ya_existia', true);
  end if;
  if exists (select 1 from public.orders where table_id = p_table_id and status in ('pending', 'preparing', 'ready')) then
    raise exception 'La mesa tiene una orden abierta: ciérrala antes de eliminarla';
  end if;

  if exists (select 1 from public.orders where table_id = p_table_id) then
    -- Vendió alguna vez: no se puede borrar (chk_dine_in_has_table, DEUDAS). Se archiva.
    update public.tables set archived_at = now(), archived_by = auth.uid(), status = 'free' where id = p_table_id;
    return jsonb_build_object('table_id', p_table_id, 'accion', 'archivada', 'ya_existia', false);
  end if;
  delete from public.tables where id = p_table_id;
  return jsonb_build_object('table_id', p_table_id, 'accion', 'eliminada', 'ya_existia', false);
end;
$$;

revoke execute on function public.eliminar_mesa(uuid) from public, anon;
grant  execute on function public.eliminar_mesa(uuid) to authenticated;

commit;
