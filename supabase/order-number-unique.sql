-- supabase/order-number-unique.sql
-- ============================================================================
-- Numeración de ventas: UNIQUE (restaurant_id, order_number) en orders.
--
-- QUÉ HACE: agrega la garantía que hoy solo da el contador. next_order_number
-- ya es atómico (upsert sobre store_sequences), pero NADA en la base impide dos
-- órdenes con el mismo número en la misma sede: un seed que reinicie la
-- secuencia sin purgar, un UPDATE a mano o un bug futuro lo harían en silencio.
-- Con varios celulares cobrando al mismo turno (POS móvil), el número es lo que
-- el cliente ve en el ticket: si se repite, se repite frente a él.
-- `order_number` sigue siendo NULLABLE: las ventas cobradas sin número (la
-- ventana de la "opción C") no chocan entre sí (en Postgres los NULL son
-- distintos para un UNIQUE).
--
-- PRECONDICIÓN (verificada el 2026-09-30 con supabase/diag/numeracion-duplicados.sql
-- en prod: 0 números repetidos en las 5 organizaciones). El bloque la
-- re-verifica ADENTRO de la transacción, así que si alguien duplicó un número
-- entre esa medición y esta aplicación, aborta sin crear nada.
--
-- CÓMO CORRERLO (SQL Editor): el archivo ENTERO, una sola vez. Corre en UNA
-- transacción. Sin CONCURRENTLY a propósito:
--   · CONCURRENTLY no puede ir dentro de una transacción, y si falla deja un
--     índice INVALID que hay que detectar y borrar a mano;
--   · con el tamaño actual de orders, el bloqueo de escrituras mientras se
--     construye el índice es de fracciones de segundo.
-- El riesgo real de un CREATE INDEX es QUEDARSE ESPERANDO el lock detrás de una
-- transacción larga: mientras espera, bloquea a todas las ventas que llegan
-- detrás. `lock_timeout` lo corta a los 3 s: si no consigue el lock, aborta y se
-- reintenta en otro momento (fuera de hora pico). Nada queda a medias.
--
-- RE-APLICAR: idempotente. Si el constraint ya existe, no hace nada.
--
-- NO DEDUZCAS EL ESTADO DE ESTE COMENTARIO — correlo:
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.orders'::regclass and conname = 'orders_restaurant_order_number_key';
--   (1 fila = aplicada · 0 filas = no)
--
-- NO se agrega a ORDEN de scripts/capturas/preparar-local.mjs hasta estar
-- aplicada en PROD: la base local tiene que ser igual a prod (deriva = 0), no
-- ir por delante.
--
-- Lo que esto NO toca: el índice no único idx_orders_restaurant_order_number
-- (restaurant_id, order_number desc) queda. Pasa a ser redundante para buscar;
-- sacarlo es una migración aparte, con evidencia de uso (pg_stat_user_indexes).
-- ============================================================================

begin;

set local lock_timeout = '3s';
set local statement_timeout = '60s';

do $$
declare
  v_dups int;
begin
  -- Ya aplicada ⇒ nada que hacer (idempotente).
  if exists (select 1 from pg_constraint
              where conrelid = 'public.orders'::regclass
                and conname = 'orders_restaurant_order_number_key') then
    raise notice 'orders_restaurant_order_number_key ya existe: no se hace nada.';
    return;
  end if;

  -- Precondición, re-verificada adentro de la transacción.
  select count(*) into v_dups from (
    select 1 from public.orders
     where order_number is not null
     group by restaurant_id, order_number
    having count(*) > 1
  ) d;
  if v_dups > 0 then
    raise exception 'ABORTA: % números de venta repetidos por sede. Correr supabase/diag/numeracion-duplicados.sql (detalle) y decidir antes.', v_dups;
  end if;

  create unique index orders_restaurant_order_number_key
    on public.orders (restaurant_id, order_number);

  -- Promoverlo a constraint: queda visible como regla de la tabla (y en la
  -- deriva de esquema), no solo como índice.
  alter table public.orders
    add constraint orders_restaurant_order_number_key
    unique using index orders_restaurant_order_number_key;

  raise notice 'OK: orders_restaurant_order_number_key creado.';
end $$;

commit;
