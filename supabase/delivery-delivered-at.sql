-- ============================================================
-- delivery-delivered-at.sql
-- orders.delivered_at: CUÁNDO se marcó entregada una orden. Lo fija el reloj
--   del SERVIDOR, igual que cash_shifts.closed_at.
--
-- QUÉ HACE
--   1. Agrega la columna `delivered_at timestamptz` (nullable) a public.orders.
--   2. Un trigger BEFORE UPDATE la fija en now() cuando `status` entra a
--      'delivered', y la vuelve a null si la orden SALE de 'delivered'.
--   3. Índice parcial para la consulta del tablero.
--
-- PRECONDICIONES
--   public.orders con la columna `status` de tipo public.order_status
--   (supabase/schema.sql). No depende de delivery-couriers.sql.
--
-- MODO DE FALLO AL RE-APLICAR: IDEMPOTENTE.
--   `add column if not exists` + `create or replace function` +
--   `drop trigger if exists` antes de crearlo + `create index if not exists`.
--   No hay DELETE, UPDATE de datos ni DROP de nada que tenga contenido: esta
--   migración no puede perder una fila. Re-aplicarla es un no-op.
--
-- NO DEDUZCAS EL ESTADO DE ESTE COMENTARIO — correlo:
--   select column_name from information_schema.columns
--    where table_schema='public' and table_name='orders'
--      and column_name='delivered_at';
--   select tgname from pg_trigger
--    where tgrelid='public.orders'::regclass and tgname='trg_order_delivered_at';
--
-- ── POR QUÉ UN TRIGGER Y NO UN `update ... set delivered_at = ...` DESDE EL CLIENTE
-- Es la MISMA clase que shift-closed-at-server-time.sql, y esa ya se decidió:
-- un instante que se compara contra otro instante de la BD no puede venir del
-- reloj del navegador. Acá `delivered_at` se compara contra
-- `cash_shifts.opened_at`, que lo pone `default now()` del servidor. Con el
-- reloj del cliente atrasado, un delivery entregado recién podría quedar ANTES
-- de la apertura del turno y no aparecer en "Entregados" — que es exactamente
-- el bug que esta columna viene a cerrar.
--
-- El segundo motivo es de alcance: el trigger vale para CUALQUIER camino que
-- ponga status='delivered' (el tablero de hoy, la cocina, la app de mozos, un
-- update a mano desde el Dashboard). Un `set` en el cliente vale solo para el
-- camino que lo escribió, y el día que aparezca otro nace sin la columna. Ese
-- es el defecto de CLASE que R3 pide barrer de una vez.
--
-- ── POR QUÉ SE LIMPIA AL SALIR DE 'delivered'
-- Para que la columna signifique UNA sola cosa: "está entregada, y lo está
-- desde este instante". Si quedara pegada, una orden devuelta a 'ready'
-- seguiría contando como entregada en la ventana del turno. Hoy la UI no tiene
-- cómo des-entregar (el tablero solo avanza), así que esta rama es defensiva:
-- cubre el update a mano y cualquier flujo futuro.
--
-- ── QUÉ PASA CON LAS ÓRDENES YA ENTREGADAS: se quedan en null. A PROPÓSITO.
-- No hay dato del cual derivar cuándo se entregaron. `updated_at` NO sirve: en
-- public.orders es un `default now()` sin trigger que lo mantenga, así que vale
-- la hora de INSERCIÓN, no la del último cambio (verificado en schema.sql).
-- Inventar un valor sería peor que no tenerlo: se vería como dato medido.
-- Consecuencia concreta y aceptada: las órdenes entregadas ANTES de aplicar
-- esto no vuelven a aparecer en la columna "Entregados". Son de turnos ya
-- cerrados, y con el filtro por día calendario de hoy tampoco aparecerían.
-- Se corrige solo con el primer delivery que se entregue después.
--
-- Ejecutar en: Supabase Dashboard > SQL Editor. Migración NUEVA, no edita
--   ninguna migración aplicada (R5).
-- ============================================================

begin;

-- ── 1. La columna ───────────────────────────────────────────────────────────
alter table public.orders
  add column if not exists delivered_at timestamptz;

comment on column public.orders.delivered_at is
  'Instante en que la orden pasó a status=''delivered'', puesto por el trigger '
  'trg_order_delivered_at con el reloj del SERVIDOR (nunca por el cliente). '
  'Vuelve a null si la orden sale de ''delivered''. null también en las órdenes '
  'entregadas antes de esta migración: no hay dato del cual derivarlo '
  '(orders.updated_at es un default now() sin trigger, o sea la hora de '
  'inserción). Lo usa el tablero de Delivery para mostrar los entregados del '
  'turno abierto en vez de los del día calendario, que se vaciaban a medianoche '
  'en un bar que cruza las 12.';

-- ── 2. El trigger ───────────────────────────────────────────────────────────
create or replace function public.set_order_delivered_at()
returns trigger
language plpgsql
as $$
begin
  -- Entra a 'delivered' → reloj del servidor. La comparación es contra el
  -- estado ANTERIOR, así que un update que ya venía en 'delivered' y toca otra
  -- columna NO repisa la marca original.
  if new.status = 'delivered' and old.status is distinct from 'delivered' then
    new.delivered_at := now();

  -- Sale de 'delivered' → deja de estar entregada, la marca se va con ella.
  elsif new.status is distinct from 'delivered' and old.status = 'delivered' then
    new.delivered_at := null;
  end if;

  return new;
end;
$$;

-- No es SECURITY DEFINER: solo fija un valor de columna dentro del statement
-- que lo dispara, con los permisos de quien hace el update. No requiere
-- revoke/grant (a diferencia de las funciones DEFINER, ver
-- security-definer-revoke.sql).

drop trigger if exists trg_order_delivered_at on public.orders;

create trigger trg_order_delivered_at
  before update on public.orders
  for each row
  execute function public.set_order_delivered_at();

-- ── 3. Índice ───────────────────────────────────────────────────────────────
-- El tablero pide los entregados de la ventana del turno: filtra por
-- restaurant_id + type='delivery' + delivered_at >= opened_at. Parcial sobre
-- las filas que tienen marca — que son las entregadas y nada más.
create index if not exists idx_orders_delivered_at
  on public.orders (restaurant_id, type, delivered_at desc)
  where delivered_at is not null;

commit;

-- ============================================================
-- VERIFICACIÓN (read-only). Correr DESPUÉS del commit de arriba.
-- ============================================================

-- (A) La columna existe y es nullable.
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public' and table_name = 'orders'
   and column_name = 'delivered_at';

-- (B) El trigger quedó registrado y habilitado ('O' = enabled, origin).
select tgname, tgenabled
  from pg_trigger
 where tgrelid = 'public.orders'::regclass
   and not tgisinternal
   and tgname = 'trg_order_delivered_at';

-- (C) El índice quedó.
select indexname from pg_indexes
 where schemaname = 'public' and tablename = 'orders'
   and indexname = 'idx_orders_delivered_at';

-- (D) Cuántas órdenes de delivery quedan entregadas SIN marca. Es el conteo de
--     lo que no se puede recuperar, y se espera > 0 en una base con historia.
--     No hay que "arreglarlo": ver el encabezado.
select count(*) as entregadas_sin_marca
  from public.orders
 where type = 'delivery' and status = 'delivered' and delivered_at is null;
