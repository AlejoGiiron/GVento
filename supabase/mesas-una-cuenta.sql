-- supabase/mesas-una-cuenta.sql
-- ============================================================================
-- UNA SOLA CUENTA VIVA POR MESA, y "Abrir mesa" en una sola llamada al servidor.
--
-- POR QUÉ (Salchimelo, mesa 10, 2026-10-14/15; supabase/diag/mesas-pegadas.sql): la mesa quedó
-- con DOS cuentas vivas. Desde ahí cada "Cerrar mesa" sobre la más antigua (la que muestra el
-- aviso) LIBERABA la mesa con la otra viva y escondida, y el siguiente "Abrir mesa" creaba otra:
-- 7 cuentas en 25 horas, y el ciclo no se cerraba solo. La MESA 12 tenía lo mismo.
-- El origen probable es "Abrir mesa" desde el navegador en DOS escrituras (ocupar la mesa,
-- después crear la orden): si la orden se guardó y la respuesta se perdió, la pantalla deshacía
-- la ocupación (desocuparMesa) y dejaba la orden viva con la mesa libre. NO medido en prod: es el
-- único camino del código que libera una mesa con una cuenta viva sin releer la base.
--
-- QUÉ HACE (y nada más):
--   1. orders.open_id — la clave de apertura (como close_id en el cobro): un reintento con la
--      misma clave devuelve la cuenta ya creada en vez de otra. Chromium REENVÍA solo un POST
--      cortado (docs/DEUDAS.md → "El navegador ejecuta DOS VECES").
--   2. orders_una_cuenta_viva_por_mesa — índice único parcial: a lo sumo UNA orden
--      pending/preparing/ready por mesa. Es el invariante; vale para TODO escritor (la RPC, un
--      frontend viejo en caché que inserta directo, un script). Con esto cobrar o cerrar una
--      cuenta ya no puede dejar otra escondida, así que close_table_sale y
--      cerrar_mesa_sin_consumo NO se tocan.
--   3. abrir_mesa(p_table_id, p_open_id, p_waiter_name) — ocupar la mesa y crear la cuenta en
--      UNA transacción. Responde jsonb { resultado, order_id, ... }:
--        'abierta'    — se creó la cuenta (o, con ya_existia = true, el reintento de la misma clave;
--                       si la cuenta de esa clave ya se cerró, rechaza: la clave no sirve para otra);
--        'recuperada' — la mesa estaba libre con una cuenta viva escondida (datos de antes de
--                       esto, o de un frontend viejo): se ocupa la mesa con ESA cuenta, no se crea otra;
--        'no_libre'   — la mesa ya no estaba libre (otro equipo la abrió, está pegada o reservada).
--      Quién puede: los mismos que la política "orders: staff crea" (get_my_role() admin, cashier
--      o waiter, activo), en su sede. No amplía ni recorta a nadie.
--
-- PROTOCOLO DE LOCKS: abrir_mesa toma SOLO la mesa (FOR UPDATE) e inserta la orden nueva; nunca
-- bloquea una orden existente ni el turno (no toca plata). Los demás: close_table_sale toma
-- turno → orden → mesa; cerrar_mesa_sin_consumo, orden → mesa; quitar_item_mesa, solo la orden;
-- eliminar_mesa, solo la mesa. Un INSERT directo de una orden con mesa (frontend viejo) toma KEY
-- SHARE sobre la mesa por la llave foránea, así que también se pone en fila con abrir_mesa
-- (medido en tests/mesas-una-cuenta.spec.ts). Lo único que abrir_mesa puede esperar además de la
-- mesa es el índice único, cuando un UPDATE directo revive otra cuenta de esa mesa sin confirmar
-- (no toca la llave foránea): una sentencia que no espera nada. Sin ciclo — razonado para los
-- escritores de arriba; medidas las carreras abrir/abrir, abrir/insert y abrir/update.
--
-- PRECONDICIÓN (bloque 0, aborta sin cambiar nada): NINGUNA mesa con más de una cuenta viva (si
-- hay, el índice no se puede crear: límpialas antes con supabase/diag/mesas-pegadas.sql, consulta
-- 3); no existen todavía abrir_mesa, orders.open_id ni el índice; existe close_table_sale
-- (mesas-servidor.sql: la pantalla nueva usa las dos).
-- ORDEN DE DESPLIEGUE: primero este SQL, después el frontend (que llama abrir_mesa). El frontend
-- viejo sigue funcionando con esto aplicado: inserta directo y el índice lo frena si ya hay cuenta.
-- RE-APLICAR: falla en la precondición (abrir_mesa ya existe) y hace rollback: no cambia nada.
-- REVERSA: mesas-una-cuenta-revertir.sql (fuera de git, en la raíz). Antes de correrla se revierte
-- el frontend: sin abrir_mesa la pantalla nueva no puede abrir mesas.
--
-- NO DEDUZCAS EL ESTADO DE ESTE COMENTARIO — correlo:
--   select to_regprocedure('public.abrir_mesa(uuid,uuid,text)') is not null as funcion,
--          to_regclass('public.orders_una_cuenta_viva_por_mesa') is not null as indice;
--   El ANTES y el DESPUÉS completos: supabase/diag/mesas-una-cuenta-preflight.sql.
-- ============================================================================

begin;

-- ── 0. PRECONDICIÓN (falla cerrado) ──────────────────────────────────────────
do $$
declare
  v_mesas int;
begin
  if to_regprocedure('public.close_table_sale(uuid,uuid,numeric,jsonb,jsonb,jsonb)') is null then
    raise exception 'Precondición: falta close_table_sale (mesas-servidor.sql, Paso 9). No se cambió nada.';
  end if;
  if to_regprocedure('public.abrir_mesa(uuid,uuid,text)') is not null then
    raise exception 'mesas-una-cuenta.sql ya se aplicó (existe abrir_mesa). No se cambió nada.';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'orders' and column_name = 'open_id') then
    raise exception 'Precondición: orders.open_id ya existe. No se cambió nada.';
  end if;
  if to_regclass('public.orders_una_cuenta_viva_por_mesa') is not null then
    raise exception 'Precondición: el índice orders_una_cuenta_viva_por_mesa ya existe. No se cambió nada.';
  end if;

  select count(*) into v_mesas from (
    select table_id from public.orders
     where table_id is not null and status in ('pending', 'preparing', 'ready')
     group by table_id having count(*) > 1) x;
  if v_mesas > 0 then
    raise exception 'Hay % mesa(s) con más de una cuenta viva: el índice no se puede crear. Límpialas antes (supabase/diag/mesas-pegadas.sql, consulta 3). No se cambió nada.', v_mesas;
  end if;
end $$;

-- ── 1. orders.open_id: la clave de apertura ──────────────────────────────────
alter table public.orders add column open_id uuid;
alter table public.orders add constraint orders_open_id_key unique (open_id);
comment on column public.orders.open_id is
  'Clave de "Abrir mesa" (abrir_mesa): un reintento con la misma clave devuelve la cuenta ya creada.';

-- ── 2. El invariante: una sola cuenta viva por mesa ──────────────────────────
-- Toma un lock SHARE sobre orders mientras se construye (bloquea escrituras unos milisegundos con
-- el tamaño de hoy): aplicar con los locales cerrados.
create unique index orders_una_cuenta_viva_por_mesa
  on public.orders (table_id)
  where table_id is not null and status in ('pending', 'preparing', 'ready');
comment on index public.orders_una_cuenta_viva_por_mesa is
  'A lo sumo una cuenta viva por mesa (mesas-una-cuenta.sql). Con dos, cerrar una liberaba la mesa con la otra escondida.';

-- ── 3. abrir_mesa ────────────────────────────────────────────────────────────
create function public.abrir_mesa(p_table_id uuid, p_open_id uuid, p_waiter_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sede uuid := get_my_restaurant_id();
  v_uid  uuid := auth.uid();
  v_t    record;
  v_o    record;
  v_id   uuid;
  v_restr text;
begin
  if p_table_id is null or p_open_id is null then raise exception 'Falta la mesa o la clave de apertura'; end if;
  if v_uid is null then raise exception 'No hay sesión'; end if;
  if v_sede is null then raise exception 'No tienes una sede activa'; end if;
  -- Los mismos que la política "orders: staff crea" (get_my_role() ya exige is_active).
  if coalesce(get_my_role()::text, '') not in ('admin', 'cashier', 'waiter') then
    raise exception 'No tienes permiso para abrir mesas';
  end if;

  -- La mesa primero: dos aperturas de la misma mesa se ponen en fila aquí.
  select id, restaurant_id, status, archived_at into v_t
    from public.tables where id = p_table_id for update;
  if not found or v_t.restaurant_id <> v_sede then raise exception 'La mesa no existe o no es de tu sede'; end if;

  -- Reintento de la misma apertura (DESPUÉS del lock: un reenvío simultáneo espera al primero).
  select id, restaurant_id, table_id, status into v_o from public.orders where open_id = p_open_id;
  if found then
    if v_o.restaurant_id <> v_sede or v_o.table_id is distinct from p_table_id then
      raise exception 'La clave de apertura es de otra mesa';
    end if;
    if v_o.status not in ('pending', 'preparing', 'ready') then
      raise exception 'Esa apertura ya se cerró. Cierra esta ventana y vuelve a abrir la mesa.';
    end if;
    return jsonb_build_object('resultado', 'abierta', 'order_id', v_o.id, 'ya_existia', true);
  end if;

  if v_t.archived_at is not null then raise exception 'La mesa está archivada'; end if;

  -- ¿Ya tiene una cuenta viva? (con el índice, a lo sumo una)
  select id, created_at into v_o
    from public.orders
   where table_id = p_table_id and status in ('pending', 'preparing', 'ready');
  if found then
    if v_t.status = 'free' then
      -- Libre con una cuenta escondida: se recupera esa, no se crea otra.
      update public.tables set status = 'occupied' where id = p_table_id;
      return jsonb_build_object('resultado', 'recuperada', 'order_id', v_o.id, 'abierta_at', v_o.created_at);
    end if;
    return jsonb_build_object('resultado', 'no_libre', 'order_id', v_o.id);
  end if;
  if v_t.status <> 'free' then
    return jsonb_build_object('resultado', 'no_libre', 'order_id', null);
  end if;

  begin
    insert into public.orders (type, status, table_id, total, waiter_name, restaurant_id, created_by, open_id)
    values ('dine_in', 'pending', p_table_id, 0, nullif(btrim(coalesce(p_waiter_name, '')), ''), v_sede, v_uid, p_open_id)
    returning id into v_id;
  exception when unique_violation then
    -- Otra cuenta de esta mesa revivió en el mismo instante (un UPDATE directo: un INSERT ya
    -- habría esperado en la mesa). Solo ESE índice se traduce; cualquier otra violación sale
    -- tal cual (fail-closed).
    get stacked diagnostics v_restr = constraint_name;
    if v_restr is distinct from 'orders_una_cuenta_viva_por_mesa' then raise; end if;
    return jsonb_build_object('resultado', 'no_libre', 'order_id',
      (select id from public.orders where table_id = p_table_id and status in ('pending', 'preparing', 'ready')));
  end;
  update public.tables set status = 'occupied' where id = p_table_id;

  return jsonb_build_object('resultado', 'abierta', 'order_id', v_id, 'ya_existia', false);
end;
$$;

revoke execute on function public.abrir_mesa(uuid, uuid, text) from public, anon;
grant  execute on function public.abrir_mesa(uuid, uuid, text) to authenticated;

-- ── 4. Verificación, en la MISMA transacción (si falla, no queda nada) ───────
do $$
declare
  v_pred text;
begin
  if not exists (select 1 from pg_index i where i.indexrelid = 'public.orders_una_cuenta_viva_por_mesa'::regclass
                  and i.indisunique and i.indisvalid) then
    raise exception 'El índice orders_una_cuenta_viva_por_mesa no quedó único y válido. No se cambió nada.';
  end if;
  v_pred := pg_get_expr((select indpred from pg_index where indexrelid = 'public.orders_una_cuenta_viva_por_mesa'::regclass),
                        'public.orders'::regclass);
  if v_pred not like '%pending%' or v_pred not like '%preparing%' or v_pred not like '%ready%'
     or v_pred like '%delivered%' or v_pred like '%cancelled%' then
    raise exception 'El predicado del índice no es el de las cuentas vivas (%). No se cambió nada.', v_pred;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_open_id_key'
                  and conrelid = 'public.orders'::regclass and contype = 'u') then
    raise exception 'Falta el unique orders_open_id_key. No se cambió nada.';
  end if;
  if not exists (select 1 from pg_proc where oid = 'public.abrir_mesa(uuid,uuid,text)'::regprocedure
                  and prosecdef and proconfig @> array['search_path=public']) then
    raise exception 'abrir_mesa no quedó SECURITY DEFINER con search_path = public. No se cambió nada.';
  end if;
  if has_function_privilege('anon', 'public.abrir_mesa(uuid,uuid,text)', 'execute') then
    raise exception 'abrir_mesa quedó ejecutable por anon. No se cambió nada.';
  end if;
  if not has_function_privilege('authenticated', 'public.abrir_mesa(uuid,uuid,text)', 'execute') then
    raise exception 'abrir_mesa no quedó ejecutable por authenticated. No se cambió nada.';
  end if;
end $$;

commit;
