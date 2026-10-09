-- supabase/diag/mesas-preflight.sql — SOLO LECTURA (no escribe nada).
-- ============================================================================
-- PRE-FLIGHT del paquete "Mesas en el servidor" (docs/diseno-mesas-servidor.md), en
-- TODAS las organizaciones. Corre cada consulta POR SEPARADO: el SQL Editor muestra solo
-- el último resultado. Fechas y fronteras de día en America/Bogota (R7).
--
-- Consulta 1 — mesas abiertas AHORA: con qué quedan las órdenes vivas cuando entre el
--              paquete (ítems, ítems sin mandar a cocina, pagos, descuentos).
--              ⚠️ NO es un reporte de mesas viejas: las mesas abiertas largas son un flujo
--              INTENCIONAL (CLAUDE.md). Esto es para saber qué datos toca la migración.
-- Consulta 2 — órdenes de MESA SIN PAGOS de los últimos 60 días, por organización, estado
--              y tipo (resumen); y la 2b, el detalle de las cerradas (delivered) sin pagos.
-- Consulta 3 — stock_movements.type: valores actuales, cantidades y signos, y el CHECK
--              vigente. La migración agrega 'merma' al CHECK.
-- ============================================================================

-- ── Consulta 1: mesas abiertas ahora ──
select coalesce(o.name, '(sin organización)')              as organizacion,
       s.name                                              as sede,
       t.name                                              as mesa,
       t.status::text                                      as estado_mesa,
       x.id                                                as orden_id,
       x.status::text                                      as estado_orden,
       (x.created_at at time zone 'America/Bogota')::timestamp(0) as abierta_bogota,
       x.total,
       coalesce(x.discount_amount, 0)                      as descuento,
       x.payment_status::text                              as estado_pago,
       (select count(*) from public.order_items i where i.order_id = x.id)                       as items,
       (select count(*) from public.order_items i join public.products p on p.id = i.product_id
         where i.order_id = x.id and p.routes_to_kitchen and not i.sent_to_kitchen)               as items_cocina_sin_enviar,
       (select count(*) from public.order_items i join public.products p on p.id = i.product_id
         where i.order_id = x.id and not p.routes_to_kitchen)                                    as items_que_no_van_a_cocina,
       (select count(*) from public.payments pa where pa.order_id = x.id)                        as pagos
  from public.tables t
  join public.restaurants s on s.id = t.restaurant_id
  left join public.organizations o on o.id = s.organization_id
  left join public.orders x on x.table_id = t.id and x.status in ('pending', 'preparing', 'ready')
 where t.status <> 'free' or x.id is not null
 order by organizacion, sede, mesa;
-- Lectura: una fila con estado_mesa 'free' y orden viva (o 'occupied' sin orden) es una
-- inconsistencia que la migración no debe empeorar: anótala. pagos > 0 en una orden viva
-- tampoco debería existir (el cobro la cierra).

-- ── Consulta 2: órdenes de mesa sin pagos, últimos 60 días (resumen) ──
select coalesce(o.name, '(sin organización)') as organizacion,
       x.status::text                         as estado_orden,
       x.payment_status::text                 as estado_pago,
       case when x.total = 0 then 'total 0' else 'total > 0' end as total,
       count(*)                               as ordenes,
       sum(x.total)                           as suma_total,
       count(*) filter (where coalesce(x.discount_amount, 0) > 0) as con_descuento
  from public.orders x
  join public.restaurants s on s.id = x.restaurant_id
  left join public.organizations o on o.id = s.organization_id
 where x.type = 'dine_in'
   and x.created_at >= (((now() at time zone 'America/Bogota')::date - 60)::timestamp at time zone 'America/Bogota')
   and not exists (select 1 from public.payments pa where pa.order_id = x.id)
 group by 1, 2, 3, 4
 order by 1, 2, 3, 4;
-- Lectura: 'delivered' + 'paid' + total 0 son las cortesías (a propósito, DEUDAS → H2);
-- 'pending'/'partial' son fiados; 'delivered' + 'paid' + total > 0 SIN pagos es lo que
-- close_table_sale tiene que hacer imposible (H2): esas filas van en la 2b.

-- ── Consulta 2b: cerradas (delivered), de contado, total > 0 y SIN pagos: el hueco de H2 ──
select coalesce(o.name, '(sin organización)') as organizacion,
       x.order_number,
       (x.created_at at time zone 'America/Bogota')::timestamp(0) as creada_bogota,
       x.total, coalesce(x.discount_amount, 0) as descuento, x.discount_kind, x.discount_reason
  from public.orders x
  join public.restaurants s on s.id = x.restaurant_id
  left join public.organizations o on o.id = s.organization_id
 where x.type = 'dine_in' and x.status = 'delivered' and x.payment_status = 'paid' and x.total > 0
   and x.created_at >= (((now() at time zone 'America/Bogota')::date - 60)::timestamp at time zone 'America/Bogota')
   and not exists (select 1 from public.payments pa where pa.order_id = x.id)
 order by organizacion, x.created_at desc
 limit 200;

-- ── Consulta 3: stock_movements.type — valores, cantidades, signos y el CHECK vigente ──
select m.type,
       count(*)                                    as movimientos,
       count(*) filter (where m.created_at >= (((now() at time zone 'America/Bogota')::date - 60)::timestamp at time zone 'America/Bogota')) as ultimos_60_dias,
       min(m.qty) as qty_min, max(m.qty) as qty_max,
       (select pg_get_constraintdef(c.oid) from pg_constraint c
         where c.conrelid = 'public.stock_movements'::regclass and c.conname = 'stock_movements_type_check') as check_vigente
  from public.stock_movements m
 group by m.type
 order by m.type;
-- Esperado: solo sale, adjustment, return, purchase, y el CHECK con esos cuatro. Un valor
-- fuera de esa lista haría fallar el nuevo CHECK: se decide antes de la migración.

-- ── Consulta 4: las funciones de las que parte mesas-servidor.sql, y si ya hay algo con sus nombres ──
-- md5 con la normalización de Q-FUNCIONES (sin CR ni espacios al final de línea).
select 'funcion' as que, p.proname as nombre,
       md5(regexp_replace(regexp_replace(pg_get_functiondef(p.oid), E'\r','','g'), E'[ \t]+\n', E'\n','g')) as estado
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.proname in ('register_sale_void', 'register_sale_payment', '_venta_pos_respuesta',
                     'close_table_sale', 'quitar_item_mesa', 'cerrar_mesa_sin_consumo', 'eliminar_mesa',
                     '_stock_inverso_item', '_mover_stock_inverso', '_cierre_mesa_respuesta')
union all
select 'columna', c.table_name || '.' || c.column_name, c.data_type
  from information_schema.columns c
 where c.table_schema = 'public'
   and ((c.table_name = 'orders' and c.column_name in ('close_id', 'cobrada_por', 'cobrada_at'))
     or (c.table_name = 'tables' and c.column_name in ('archived_at', 'archived_by')))
union all
select 'tabla', 'order_item_bajas', coalesce(to_regclass('public.order_item_bajas')::text, 'no existe')
 order by 1, 2;
-- Esperado ANTES del Paso 7 (A):  register_sale_void 2e9d312e…, register_sale_payment 8fc041a9…,
--   _venta_pos_respuesta presente (el 5.0), ninguna de las funciones nuevas, ninguna columna, y
--   "tabla | order_item_bajas | no existe".
-- Esperado DESPUÉS del Paso 7: lo mismo, pero register_sale_payment 3dbb2ea5… (es la que exige
--   la precondición de mesas-servidor.sql: el Paso 9 va después del 7).
-- Si register_sale_void NO es 2e9d312e…, alguien la redefinió en producción: la precondición
--   de mesas-servidor.sql va a abortar. Se mira qué cambió ANTES de tocar la migración.
-- Si aparece alguna función nueva, una columna o la tabla: algo con esos nombres ya existe en
--   producción y la migración fallaría. Se para y se revisa.

-- ── Consulta 5: ¿alguna venta se ANULÓ DOS VECES? (el stock habría vuelto dos veces) ──
-- register_sale_void (2e9d312e…) lee "ya está anulada" sin bloquear la orden: dos anulaciones
-- simultáneas pasan las dos (medido en Docker el 2026-10-08). Cada anulación escribe sus
-- devoluciones en UNA transacción, así que comparten created_at (= now() de esa transacción):
-- dos created_at distintos con la nota de anulación en la misma orden = dos anulaciones.
-- (Señal verificada en Docker: 2 con la versión de producción, 1 con la de mesas-servidor.sql.)
select coalesce(o.name, '(sin organización)') as organizacion,
       x.order_number,
       count(distinct m.created_at) as anulaciones_de_stock,
       count(*) as movimientos,
       (min(m.created_at) at time zone 'America/Bogota')::timestamp(0) as primera_bogota,
       (max(m.created_at) at time zone 'America/Bogota')::timestamp(0) as ultima_bogota
  from public.stock_movements m
  join public.orders x on x.id = m.reference_id
  join public.restaurants s on s.id = x.restaurant_id
  left join public.organizations o on o.id = s.organization_id
 where m.type = 'return' and m.notes like 'Anulación de venta%'
 group by o.name, x.id, x.order_number
having count(distinct m.created_at) > 1
 order by organizacion, primera_bogota desc;
-- Esperado: ninguna fila. Una fila = esa venta devolvió su stock más de una vez (dos clics en
-- "Anular", o dos equipos): el inventario de esos productos quedó inflado en lo que vendió.
-- No se corrige solo: pégame la salida y se decide el ajuste con el dueño.
