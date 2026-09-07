-- ============================================================
-- fix-delivered-at-comentario.sql
-- Corrige el comentario de public.orders.delivered_at: la justificación que
--   dejó delivery-delivered-at.sql era FACTUALMENTE FALSA.
--
-- QUÉ HACE
--   Un solo `comment on column`. NO toca datos, NO toca el esquema, NO toca el
--   trigger. Es una corrección de documentación que vive dentro de la BD.
--
-- POR QUÉ UN ARCHIVO NUEVO Y NO UNA EDICIÓN
--   delivery-delivered-at.sql YA SE APLICÓ (en el laboratorio local y en la
--   nube). Editarla haría que el archivo del repo describa algo distinto de lo
--   que corrió, que es exactamente lo que R5 prohíbe. La afirmación falsa se
--   corrige acá, y el archivo original queda como el registro de lo que se
--   ejecutó — con su error incluido.
--
-- MODO DE FALLO AL RE-APLICAR: IDEMPOTENTE. `comment on column` reemplaza el
--   comentario anterior; correrlo N veces deja el mismo resultado que una.
--
-- NO DEDUZCAS EL ESTADO DE ESTE COMENTARIO — correlo:
--   select col_description('public.orders'::regclass, attnum) like '%el último cambio%'
--     from pg_attribute
--    where attrelid = 'public.orders'::regclass and attname = 'delivered_at';
--   -- t = ya corregido · f = todavía tiene el texto viejo
--
-- ── LO QUE SE AFIRMÓ, Y ERA MENTIRA ─────────────────────────────────────────
-- delivery-delivered-at.sql dice, en el encabezado y en el comentario de la
-- columna:
--
--     "orders.updated_at es un default now() sin trigger, o sea la hora de
--      INSERCIÓN, no la del último cambio (verificado en schema.sql)"
--
-- **Es falso, y el "verificado en schema.sql" lo empeora: da por comprobado algo
-- que no se comprobó.** `schema.sql` define `trg_orders_updated_at`, un
-- BEFORE UPDATE sobre public.orders que ejecuta `handle_updated_at()`, que hace
-- `new.updated_at = now()`. O sea que updated_at SÍ se mantiene en cada update.
--
-- CÓMO SE COLÓ, porque la forma del error importa más que el error: se buscó el
-- trigger por los nombres que uno espera (`set_updated_at`, `moddatetime`,
-- `update_updated_at`) y ninguno matcheó, porque acá se llama
-- `handle_updated_at`. Es una DENY-LIST de nombres imaginados en lugar de una
-- búsqueda de la clase — el mismo defecto que R2 describe, cometido al
-- verificar en vez de al codear. La búsqueda correcta era por la tabla
-- (`trigger.*public.orders`), no por el nombre que uno supone.
--
-- ── LA COLUMNA SIGUE SIENDO NECESARIA, POR OTRO MOTIVO ───────────────────────
-- Que updated_at se mantenga NO lo vuelve un sustituto: dice "cuándo se tocó por
-- última vez", no "cuándo se entregó". Coinciden solo si la entrega es la última
-- escritura, y nada lo garantiza (asignar repartidor, aplicar un descuento o
-- corregir el total son updates posteriores).
--
-- MEDIDO en el laboratorio local, con las dos marcas en la misma fila:
--
--   paso 0 · nace            delivered_at (null)              updated_at 19:53:00.144
--   paso 1 · entregada       delivered_at 19:53:00.149        updated_at 19:53:00.149
--   paso 2 · update ajeno    delivered_at 19:53:00.149  ←     updated_at 19:53:01.254
--                                         intacta                        se movió
--
-- Con updated_at como clave de la ventana, esa orden volvería a aparecer en
-- "Entregados" de un turno posterior por haber sido EDITADA, no por haber sido
-- entregada. Es la misma familia de fallo que la columna vino a cerrar: un
-- número plausible y equivocado, que no revienta.
--
-- ── LOS DOS TRIGGERS BEFORE UPDATE CONVIVEN ─────────────────────────────────
-- Sobre public.orders hay ahora dos, y Postgres los dispara por nombre:
-- `trg_order_delivered_at` y después `trg_orders_updated_at`. Escriben campos
-- DISTINTOS del mismo NEW, así que ninguno pisa al otro y el resultado no
-- depende del orden. Verificado ejecutando (ver la tabla de arriba: en el paso 2
-- updated_at avanzó y delivered_at no).
--
-- Detalle que hace falta para leer bien cualquier prueba de esto: `now()` es la
-- hora de la TRANSACCIÓN, no del reloj. Dentro de un mismo `begin/commit` todas
-- las marcas salen idénticas y una prueba de "no repisa" pasa sin probar nada
-- (`pg_sleep` no la mueve; lo que avanza es `clock_timestamp()`). Por eso la
-- medición de arriba usa sentencias de nivel superior, cada una en su propia
-- transacción.
--
-- Ejecutar en: Supabase Dashboard > SQL Editor.
-- ============================================================

comment on column public.orders.delivered_at is
  'Instante en que la orden pasó a status=''delivered'', puesto por el trigger '
  'trg_order_delivered_at con el reloj del SERVIDOR (nunca por el cliente). '
  'Vuelve a null si la orden sale de ''delivered''. '
  'NO se usa orders.updated_at en su lugar: updated_at SÍ se mantiene (lo pone '
  'trg_orders_updated_at → handle_updated_at en cada update), pero significa '
  '"cuándo se tocó por última vez", no "cuándo se entregó" — un descuento o una '
  'asignación de repartidor posteriores lo mueven, y la orden reaparecería en '
  '"Entregados" de un turno que no la entregó. '
  'null en las órdenes entregadas antes de la migración: no hay dato del cual '
  'derivarlo, e inventarlo se leería como dato medido. '
  'Lo usa el tablero de Delivery para mostrar los entregados del turno abierto '
  'en vez de los del día calendario, que se vaciaban a medianoche en un bar que '
  'cruza las 12.';

-- ============================================================
-- VERIFICACIÓN (read-only)
-- ============================================================

-- (A) El comentario quedó con el texto nuevo.
select col_description('public.orders'::regclass, attnum) as comentario
  from pg_attribute
 where attrelid = 'public.orders'::regclass and attname = 'delivered_at';

-- (B) La afirmación que motivó este archivo, comprobable de una: orders TIENE
--     un trigger que mantiene updated_at. Debe devolver una fila.
select t.tgname, p.proname
  from pg_trigger t
  join pg_proc p on p.oid = t.tgfoid
 where t.tgrelid = 'public.orders'::regclass
   and not t.tgisinternal
 order by t.tgname;
