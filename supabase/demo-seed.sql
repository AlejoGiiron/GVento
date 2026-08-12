-- ============================================================
-- 🔴 ESTO NO ES UNA MIGRACIÓN. NO APLICAR EN PRODUCCIÓN.
--
-- Es una SEMILLA DE DEMO: datos de mentira para mostrar el producto. No define
-- ni altera el esquema, y no hay ningún motivo para correrlo contra una
-- organización de un cliente real (G-10, Salchimelo). Está acotado a LAB por
-- construcción y ABORTA si esa organización no existe, pero la regla es previa
-- al guard: no se ejecuta fuera del laboratorio.
--
-- Se anota así de fuerte porque un `.sql` suelto dentro de `supabase/` se lee
-- como migración —todo el resto de la carpeta lo es— y en este proyecto ya
-- pasó que se aplique algo sin entender del todo qué hacía.
--
-- PARA QUÉ SIRVE: dejar el POS con aspecto de negocio en funcionamiento para
-- una demo comercial o para revisar pantallas a ojo, sin que Reportes,
-- Historial, Inventario, Delivery o Cocina aparezcan vacíos. No lo necesita ni
-- la suite E2E (que siembra lo suyo) ni ningún flujo de la app.
-- ============================================================

-- ============================================================
-- G-Vento — SEMILLA DE DEMO ("Sede Demo", organización LAB)
--
-- Crea una sede con aspecto de negocio REAL en funcionamiento: menú completo,
-- inventario coherente, 14 días de ventas numeradas con sus turnos cerrados y
-- arqueo, un turno ABIERTO ahora mismo, mesas ocupadas, delivery en curso y
-- cartera de fiado. Sirve para mostrar el producto sin que ninguna pantalla
-- (Reportes, Historial, Inventario, Delivery, Cocina) aparezca vacía.
--
-- ── DÓNDE VIVE Y POR QUÉ ────────────────────────────────────────────────────
-- Sede NUEVA ("Sede Demo") dentro de la organización LAB. NO toca "Sede Lab
-- Norte" a propósito: Norte es la sede de trabajo de casi toda la suite E2E y
-- meterle categorías/productos nuevos contamina el default del ProductPicker
-- (el mismo riesgo que lab-seed.sql:124-133 ya combate desactivando residuo).
-- Con sede propia, la demo y los tests no se pisan.
--
-- ⚠️  BD ÚNICA COMPARTIDA: LAB, G-10 y Salchimelo son ORGANIZACIONES de una
--     sola base. Todo INSERT/DELETE de este archivo se acota a la sede Demo,
--     resuelta desde la organización LAB. Ninguna sentencia puede alcanzar
--     datos reales: si la org LAB no existiera, el script ABORTA (ver guardas).
--
-- ── IDEMPOTENTE ─────────────────────────────────────────────────────────────
-- Se puede correr las veces que haga falta. El catálogo se busca por nombre
-- (patrón de lab-seed) y lo TRANSACCIONAL de la sede Demo se purga al inicio,
-- así que cada corrida deja exactamente el mismo escenario. Los datos son
-- DETERMINISTAS (aritmética modular sobre el contador, sin random()): dos
-- corridas producen las mismas ventas.
--
-- ── ORDEN RESPECTO A lab-seed.sql ───────────────────────────────────────────
-- lab-seed.sql purga lo transaccional de TODAS las sedes de LAB, incluida esta.
-- Por eso el orden es: 1) lab-seed.sql (reset del lab)  2) este archivo.
-- Si corrés lab-seed después, el catálogo de la demo sobrevive pero las ventas,
-- turnos y mesas abiertas se van: volvé a correr este archivo para replantarlo.
--
-- REQUIERE: lab-seed.sql ya corrido al menos una vez (necesita la org LAB y los
-- profiles owner.test / cajero.test para poblar created_by).
--
-- Ejecutar en: Supabase Dashboard > SQL Editor.
-- ============================================================

begin;

-- ============================================================
-- PARTE 1 — Sede, accesos y purga del escenario anterior
-- ============================================================

do $$
declare
  v_org    uuid;
  v_demo   uuid;
  v_owner  uuid;
  v_cajero uuid;
begin
  -- ── Guardas: sin org LAB o sin profiles del lab, no se hace nada ─────────
  select id into v_org from public.organizations where name = 'LAB' limit 1;
  if v_org is null then
    raise exception 'No existe la organización LAB. Corré supabase/lab-seed.sql primero.';
  end if;

  select id into v_owner
    from public.profiles
   where email = 'owner.test@gvento.com' and organization_id = v_org limit 1;
  select id into v_cajero
    from public.profiles
   where email = 'cajero.test@gvento.com' and organization_id = v_org limit 1;

  if v_owner is null or v_cajero is null then
    raise exception
      'Faltan los profiles owner.test/cajero.test en LAB. Corré supabase/lab-seed.sql primero.';
  end if;

  -- ── Sede Demo ────────────────────────────────────────────────────────────
  select id into v_demo
    from public.restaurants
   where organization_id = v_org and name = 'Sede Demo' limit 1;

  if v_demo is null then
    insert into public.restaurants (organization_id, name, address, phone)
    values (v_org, 'Sede Demo', 'Cra. 43A # 7-50, El Poblado', '3001234567')
    returning id into v_demo;
  end if;

  -- Baseline reescrito en cada corrida (revierte cualquier deriva de la demo).
  update public.restaurants
     set uses_kitchen = true,
         address      = 'Cra. 43A # 7-50, El Poblado',
         phone        = '3001234567',
         config       = coalesce(config, '{}'::jsonb) || jsonb_build_object(
           'cash_out_reasons', jsonb_build_array(
             'Compra de insumos', 'Pago a proveedor', 'Retiro de caja',
             'Domicilios', 'Servicios', 'Otro'),
           'payment_methods',  jsonb_build_array('cash', 'card', 'transfer', 'nequi'),
           'default_delivery_time', 35,
           'kitchen_pin', '2468'
         )
   where id = v_demo;

  -- ── Acceso de los usuarios del lab a la sede Demo ────────────────────────
  insert into public.user_stores (user_id, restaurant_id)
  values (v_owner, v_demo), (v_cajero, v_demo)
  on conflict (user_id, restaurant_id) do nothing;

  -- mozo.test, si existe la cuenta.
  insert into public.user_stores (user_id, restaurant_id)
  select p.id, v_demo
    from public.profiles p
   where p.email = 'mozo.test@gvento.com' and p.organization_id = v_org
  on conflict (user_id, restaurant_id) do nothing;

  -- ========================================================
  -- PURGA de lo transaccional SOLO de la sede Demo.
  -- Acotado por restaurant_id = v_demo (una sola sede, dentro de LAB).
  -- El orden respeta las FK: hijos antes que padres.
  -- ========================================================
  delete from public.order_item_extras
   where order_item_id in (
     select oi.id from public.order_items oi
      join public.orders o on o.id = oi.order_id
     where o.restaurant_id = v_demo);

  delete from public.debt_payments where restaurant_id = v_demo;
  delete from public.payments      where restaurant_id = v_demo;

  delete from public.order_items
   where order_id in (select id from public.orders where restaurant_id = v_demo);

  delete from public.orders         where restaurant_id = v_demo;
  delete from public.cash_movements where restaurant_id = v_demo;
  delete from public.cash_shifts    where restaurant_id = v_demo;
  delete from public.stock_movements where restaurant_id = v_demo;
  delete from public.customers      where restaurant_id = v_demo;

  update public.tables set status = 'free' where restaurant_id = v_demo;

  raise notice 'Sede Demo lista (%). Escenario anterior purgado.', v_demo;
end $$;


-- ============================================================
-- PARTE 2 — Catálogo: categorías, productos, recetas, extras, mesas
-- ============================================================

do $$
declare
  v_org  uuid;
  v_demo uuid;

  v_cat_entradas  uuid;
  v_cat_burgers   uuid;
  v_cat_fuertes   uuid;
  v_cat_picadas   uuid;
  v_cat_cocteles  uuid;
  v_cat_cervezas  uuid;
  v_cat_bebidas   uuid;
  v_cat_postres   uuid;

  v_club   uuid;  -- Cerveza Club Colombia (insumo de Michelada/Refajo)
  v_colomb uuid;  -- Gaseosa Colombiana     (insumo de Refajo)
  v_shot   uuid;  -- Shot de Aguardiente    (insumo del extra "Shot adicional")
  v_miche  uuid;
  v_refajo uuid;

  v_e_queso    uuid;
  v_e_tocineta uuid;
  v_e_carne    uuid;
  v_e_salsa    uuid;
  v_e_shot     uuid;

  r record;
  i integer;

  -- Catálogo declarado como tabla de datos: cada fila es
  -- (categoría, nombre, precio, kind, tracking, stock, min_stock, va a cocina)
  -- Recorrerla con un for evita 30 bloques if/insert repetidos.
  v_menu jsonb := '[
    {"cat":"entradas","name":"Papas a la francesa","price":12000,"kitchen":true},
    {"cat":"entradas","name":"Aros de cebolla","price":14000,"kitchen":true},
    {"cat":"entradas","name":"Nachos con queso","price":18000,"kitchen":true},
    {"cat":"entradas","name":"Alitas BBQ x8","price":26000,"kitchen":true},

    {"cat":"burgers","name":"Hamburguesa clásica","price":24000,"kitchen":true},
    {"cat":"burgers","name":"Hamburguesa doble carne","price":32000,"kitchen":true},
    {"cat":"burgers","name":"Hamburguesa de pollo","price":26000,"kitchen":true},
    {"cat":"burgers","name":"Hamburguesa vegetariana","price":23000,"kitchen":true},

    {"cat":"fuertes","name":"Churrasco 250g","price":38000,"kitchen":true},
    {"cat":"fuertes","name":"Pechuga a la plancha","price":30000,"kitchen":true},
    {"cat":"fuertes","name":"Mojarra frita","price":34000,"kitchen":true},
    {"cat":"fuertes","name":"Bandeja paisa","price":36000,"kitchen":true},

    {"cat":"picadas","name":"Picada personal","price":28000,"kitchen":true},
    {"cat":"picadas","name":"Picada para dos","price":52000,"kitchen":true},
    {"cat":"picadas","name":"Chorizo santarrosano","price":9000,"kitchen":true},

    {"cat":"cocteles","name":"Mojito","price":20000,"kitchen":false},
    {"cat":"cocteles","name":"Margarita","price":22000,"kitchen":false},
    {"cat":"cocteles","name":"Gin tonic","price":24000,"kitchen":false},

    {"cat":"cervezas","name":"Cerveza Club Colombia","price":7000,"kitchen":false,
     "track":true,"stock":48,"min":24},
    {"cat":"cervezas","name":"Cerveza Águila","price":6000,"kitchen":false,
     "track":true,"stock":60,"min":24},
    {"cat":"cervezas","name":"Cerveza Corona","price":11000,"kitchen":false,
     "track":true,"stock":18,"min":24},
    {"cat":"cervezas","name":"Cerveza Poker","price":6000,"kitchen":false,
     "track":true,"stock":0,"min":12},

    {"cat":"bebidas","name":"Gaseosa Coca-Cola 350ml","price":5000,"kitchen":false,
     "track":true,"stock":40,"min":12},
    {"cat":"bebidas","name":"Gaseosa Colombiana 350ml","price":5000,"kitchen":false,
     "track":true,"stock":30,"min":12},
    {"cat":"bebidas","name":"Agua sin gas 600ml","price":4000,"kitchen":false,
     "track":true,"stock":25,"min":10},
    {"cat":"bebidas","name":"Limonada de coco","price":12000,"kitchen":true},
    {"cat":"bebidas","name":"Jugo natural de mora","price":8000,"kitchen":true},

    {"cat":"postres","name":"Brownie con helado","price":14000,"kitchen":true},
    {"cat":"postres","name":"Torta de chocolate","price":11000,"kitchen":true}
  ]'::jsonb;

  v_cat_ids jsonb;
  v_pid uuid;
begin
  select id into v_org  from public.organizations where name = 'LAB' limit 1;
  select id into v_demo from public.restaurants
   where organization_id = v_org and name = 'Sede Demo' limit 1;

  -- ── Categorías (sort_order fija el orden de los tabs del POS) ────────────
  -- Patrón de lab-seed: buscar por nombre; insertar si no existe.
  select id into v_cat_entradas from public.categories
   where restaurant_id = v_demo and name = 'Entradas' limit 1;
  if v_cat_entradas is null then
    insert into public.categories (restaurant_id, name, color, sort_order)
    values (v_demo, 'Entradas', '#f59e0b', 1) returning id into v_cat_entradas;
  end if;

  select id into v_cat_burgers from public.categories
   where restaurant_id = v_demo and name = 'Hamburguesas' limit 1;
  if v_cat_burgers is null then
    insert into public.categories (restaurant_id, name, color, sort_order)
    values (v_demo, 'Hamburguesas', '#ef4444', 2) returning id into v_cat_burgers;
  end if;

  select id into v_cat_fuertes from public.categories
   where restaurant_id = v_demo and name = 'Platos fuertes' limit 1;
  if v_cat_fuertes is null then
    insert into public.categories (restaurant_id, name, color, sort_order)
    values (v_demo, 'Platos fuertes', '#10b981', 3) returning id into v_cat_fuertes;
  end if;

  select id into v_cat_picadas from public.categories
   where restaurant_id = v_demo and name = 'Picadas' limit 1;
  if v_cat_picadas is null then
    insert into public.categories (restaurant_id, name, color, sort_order)
    values (v_demo, 'Picadas', '#8b5cf6', 4) returning id into v_cat_picadas;
  end if;

  select id into v_cat_cocteles from public.categories
   where restaurant_id = v_demo and name = 'Cócteles' limit 1;
  if v_cat_cocteles is null then
    insert into public.categories (restaurant_id, name, color, sort_order)
    values (v_demo, 'Cócteles', '#ec4899', 5) returning id into v_cat_cocteles;
  end if;

  select id into v_cat_cervezas from public.categories
   where restaurant_id = v_demo and name = 'Cervezas' limit 1;
  if v_cat_cervezas is null then
    insert into public.categories (restaurant_id, name, color, sort_order)
    values (v_demo, 'Cervezas', '#f97316', 6) returning id into v_cat_cervezas;
  end if;

  select id into v_cat_bebidas from public.categories
   where restaurant_id = v_demo and name = 'Bebidas' limit 1;
  if v_cat_bebidas is null then
    insert into public.categories (restaurant_id, name, color, sort_order)
    values (v_demo, 'Bebidas', '#06b6d4', 7) returning id into v_cat_bebidas;
  end if;

  select id into v_cat_postres from public.categories
   where restaurant_id = v_demo and name = 'Postres' limit 1;
  if v_cat_postres is null then
    insert into public.categories (restaurant_id, name, color, sort_order)
    values (v_demo, 'Postres', '#a855f7', 8) returning id into v_cat_postres;
  end if;

  v_cat_ids := jsonb_build_object(
    'entradas', v_cat_entradas, 'burgers',  v_cat_burgers,
    'fuertes',  v_cat_fuertes,  'picadas',  v_cat_picadas,
    'cocteles', v_cat_cocteles, 'cervezas', v_cat_cervezas,
    'bebidas',  v_cat_bebidas,  'postres',  v_cat_postres);

  -- ── Productos simples ────────────────────────────────────────────────────
  for r in select * from jsonb_array_elements(v_menu) as e(j) loop
    select id into v_pid from public.products
     where restaurant_id = v_demo and name = (r.j->>'name') limit 1;

    if v_pid is null then
      insert into public.products
        (restaurant_id, category_id, name, price, kind,
         stock_tracking, stock_qty, min_stock, routes_to_kitchen, cost_price)
      values (
        v_demo,
        (v_cat_ids->>(r.j->>'cat'))::uuid,
        r.j->>'name',
        (r.j->>'price')::numeric,
        'simple',
        coalesce((r.j->>'track')::boolean, false),
        case when coalesce((r.j->>'track')::boolean, false)
             then coalesce((r.j->>'stock')::integer, 0) else null end,
        coalesce((r.j->>'min')::integer, 0),
        coalesce((r.j->>'kitchen')::boolean, false),
        round((r.j->>'price')::numeric * 0.38)
      );
    else
      -- Baseline reescrito: precio, ruteo a cocina y umbrales vuelven al valor
      -- de la demo aunque alguien los haya tocado mostrando el producto.
      update public.products
         set price             = (r.j->>'price')::numeric,
             category_id       = (v_cat_ids->>(r.j->>'cat'))::uuid,
             routes_to_kitchen = coalesce((r.j->>'kitchen')::boolean, false),
             stock_tracking    = coalesce((r.j->>'track')::boolean, false),
             min_stock         = coalesce((r.j->>'min')::integer, 0),
             is_active         = true
       where id = v_pid;
    end if;
  end loop;

  -- Shot de Aguardiente: producto vendible Y insumo del extra "Shot adicional".
  -- Va aparte del menú declarativo porque lo referencia el extra vinculado.
  select id into v_shot from public.products
   where restaurant_id = v_demo and name = 'Shot de Aguardiente' limit 1;
  if v_shot is null then
    insert into public.products
      (restaurant_id, category_id, name, price, kind,
       stock_tracking, stock_qty, min_stock, routes_to_kitchen, cost_price)
    values (v_demo, v_cat_cocteles, 'Shot de Aguardiente', 6000, 'simple',
            true, 60, 20, false, 2200)
    returning id into v_shot;
  end if;

  -- ── Productos COMPUESTOS (receta de insumos reales del menú) ─────────────
  select id into v_club   from public.products
   where restaurant_id = v_demo and name = 'Cerveza Club Colombia' limit 1;
  select id into v_colomb from public.products
   where restaurant_id = v_demo and name = 'Gaseosa Colombiana 350ml' limit 1;

  select id into v_miche from public.products
   where restaurant_id = v_demo and name = 'Michelada' limit 1;
  if v_miche is null then
    insert into public.products
      (restaurant_id, category_id, name, price, kind,
       stock_tracking, routes_to_kitchen)
    values (v_demo, v_cat_cocteles, 'Michelada', 14000, 'composite', false, false)
    returning id into v_miche;
  end if;

  select id into v_refajo from public.products
   where restaurant_id = v_demo and name = 'Refajo jarra' limit 1;
  if v_refajo is null then
    insert into public.products
      (restaurant_id, category_id, name, price, kind,
       stock_tracking, routes_to_kitchen)
    values (v_demo, v_cat_cocteles, 'Refajo jarra', 22000, 'composite', false, false)
    returning id into v_refajo;
  end if;

  -- Recetas (1 nivel, cantidades enteras: el componente se descuenta por unidad).
  insert into public.product_components (restaurant_id, parent_id, component_id, qty)
  values (v_demo, v_miche,  v_club,   1),
         (v_demo, v_refajo, v_club,   2),
         (v_demo, v_refajo, v_colomb, 1)
  on conflict (parent_id, component_id) do update set qty = excluded.qty;

  -- ── Extras ───────────────────────────────────────────────────────────────
  select id into v_e_queso from public.extras
   where restaurant_id = v_demo and name = 'Queso extra' limit 1;
  if v_e_queso is null then
    insert into public.extras (restaurant_id, name, price, is_active)
    values (v_demo, 'Queso extra', 3000, true) returning id into v_e_queso;
  end if;

  select id into v_e_tocineta from public.extras
   where restaurant_id = v_demo and name = 'Tocineta extra' limit 1;
  if v_e_tocineta is null then
    insert into public.extras (restaurant_id, name, price, is_active)
    values (v_demo, 'Tocineta extra', 4000, true) returning id into v_e_tocineta;
  end if;

  select id into v_e_carne from public.extras
   where restaurant_id = v_demo and name = 'Carne extra' limit 1;
  if v_e_carne is null then
    insert into public.extras (restaurant_id, name, price, is_active)
    values (v_demo, 'Carne extra', 8000, true) returning id into v_e_carne;
  end if;

  select id into v_e_salsa from public.extras
   where restaurant_id = v_demo and name = 'Salsa de la casa' limit 1;
  if v_e_salsa is null then
    insert into public.extras (restaurant_id, name, price, is_active)
    values (v_demo, 'Salsa de la casa', 1000, true) returning id into v_e_salsa;
  end if;

  -- Extra VINCULADO a inventario: vender el extra descuenta el shot.
  select id into v_e_shot from public.extras
   where restaurant_id = v_demo and name = 'Shot adicional' limit 1;
  if v_e_shot is null then
    insert into public.extras (restaurant_id, name, price, linked_product_id, is_active)
    values (v_demo, 'Shot adicional', 6000, v_shot, true) returning id into v_e_shot;
  else
    update public.extras set linked_product_id = v_shot where id = v_e_shot;
  end if;

  -- Asignación de extras a productos (sin unique → check de existencia).
  for r in
    select p.id as product_id, x.extra_id
      from public.products p
      -- Los ::uuid son necesarios: en un VALUES de una sola columna alimentado
      -- por variables plpgsql (que viajan como parámetros), Postgres no puede
      -- inferir el tipo y falla con "could not determine data type".
      cross join (values (v_e_queso::uuid), (v_e_tocineta::uuid),
                         (v_e_carne::uuid), (v_e_salsa::uuid)) as x(extra_id)
     where p.restaurant_id = v_demo
       and p.category_id in (v_cat_burgers, v_cat_picadas)
  loop
    if not exists (select 1 from public.product_extras
                    where product_id = r.product_id and extra_id = r.extra_id) then
      insert into public.product_extras (product_id, extra_id)
      values (r.product_id, r.extra_id);
    end if;
  end loop;

  for r in
    select p.id as product_id
      from public.products p
     where p.restaurant_id = v_demo and p.category_id = v_cat_cocteles
  loop
    if not exists (select 1 from public.product_extras
                    where product_id = r.product_id and extra_id = v_e_shot) then
      insert into public.product_extras (product_id, extra_id)
      values (r.product_id, v_e_shot);
    end if;
  end loop;

  -- ── Mesas: 10 en salón/terraza + 2 en barra ─────────────────────────────
  for i in 1..10 loop
    if not exists (select 1 from public.tables
                    where restaurant_id = v_demo and name = 'Mesa ' || i) then
      insert into public.tables (restaurant_id, name, capacity, zone)
      values (v_demo, 'Mesa ' || i, case when i % 3 = 0 then 6 else 4 end,
              case when i <= 6 then 'Salón' else 'Terraza' end);
    end if;
  end loop;

  for i in 1..2 loop
    if not exists (select 1 from public.tables
                    where restaurant_id = v_demo and name = 'Barra ' || i) then
      insert into public.tables (restaurant_id, name, capacity, zone)
      values (v_demo, 'Barra ' || i, 2, 'Barra');
    end if;
  end loop;

  -- ── Repartidores (Delivery) ──────────────────────────────────────────────
  insert into public.couriers (restaurant_id, name, phone, is_active)
  select v_demo, x.name, x.phone, true
    from (values ('Andrés Motos', '3105558841'),
                 ('Julián Vélez', '3129940275'),
                 ('Domicilios Poblado', '3004417720')) as x(name, phone)
   where not exists (select 1 from public.couriers c
                      where c.restaurant_id = v_demo and c.name = x.name);

  raise notice 'Catálogo de la demo sembrado.';
end $$;


-- ============================================================
-- PARTE 3 — Operación: 14 días de ventas, turnos con arqueo,
--           mesas abiertas, delivery en curso y cartera de fiado.
--
-- Todo DETERMINISTA: los "azares" (qué producto, cuántos, con qué método)
-- salen de aritmética modular sobre un contador, no de random(). Dos corridas
-- generan exactamente las mismas ventas.
-- ============================================================

do $$
declare
  v_org   uuid;
  v_demo  uuid;
  v_owner uuid;
  v_cajero uuid;

  -- Catálogo cargado a arrays (orden por nombre = determinista).
  v_ids     uuid[];
  v_prices  numeric[];
  v_kinds   text[];
  v_track   boolean[];
  v_kitchen boolean[];
  v_n       integer;

  v_tables  uuid[];
  v_nt      integer;

  v_today   date;
  v_shift   uuid;
  v_open_at timestamptz;
  v_close_at timestamptz;

  v_order   uuid;
  v_item    uuid;
  v_seq     integer := 0;   -- correlativo de venta (order_number)
  v_lines   integer;
  v_idx     integer;
  v_qty     integer;
  v_sub     numeric;        -- subtotal de líneas de la orden
  v_disc    numeric;
  v_kind    text;
  v_total   numeric;
  v_at      timestamptz;
  v_by      uuid;
  v_type    public.order_type;
  v_table   uuid;
  v_a1      numeric;

  v_cust_carlos uuid;
  v_cust_maria  uuid;
  v_cust_torre  uuid;

  v_courier1 uuid;
  v_courier2 uuid;

  v_e_queso uuid;
  v_e_shot  uuid;
  v_shot_id uuid;

  d integer;
  k integer;
  j integer;
  r record;

  -- Arqueo del turno (segunda pasada)
  v_cash numeric; v_card numeric; v_transfer numeric; v_nequi numeric;
  v_in numeric; v_out numeric; v_exp numeric; v_declared numeric;
  v_sales_count integer; v_vouchers numeric;
begin
  select id into v_org  from public.organizations where name = 'LAB' limit 1;
  select id into v_demo from public.restaurants
   where organization_id = v_org and name = 'Sede Demo' limit 1;
  select id into v_owner  from public.profiles
   where email = 'owner.test@gvento.com'  and organization_id = v_org limit 1;
  select id into v_cajero from public.profiles
   where email = 'cajero.test@gvento.com' and organization_id = v_org limit 1;

  v_today := (now() at time zone 'America/Bogota')::date;

  -- Catálogo vendible (excluye los insumos puros: acá todos lo son también).
  select array_agg(id order by name), array_agg(price order by name),
         array_agg(kind order by name), array_agg(stock_tracking order by name),
         array_agg(routes_to_kitchen order by name)
    into v_ids, v_prices, v_kinds, v_track, v_kitchen
    from public.products
   where restaurant_id = v_demo and is_active = true;
  v_n := array_length(v_ids, 1);

  select array_agg(id order by name) into v_tables
    from public.tables where restaurant_id = v_demo;
  v_nt := array_length(v_tables, 1);

  select id into v_e_queso from public.extras
   where restaurant_id = v_demo and name = 'Queso extra' limit 1;
  select id into v_e_shot from public.extras
   where restaurant_id = v_demo and name = 'Shot adicional' limit 1;
  select id into v_shot_id from public.products
   where restaurant_id = v_demo and name = 'Shot de Aguardiente' limit 1;

  select id into v_courier1 from public.couriers
   where restaurant_id = v_demo and name = 'Andrés Motos' limit 1;
  select id into v_courier2 from public.couriers
   where restaurant_id = v_demo and name = 'Julián Vélez' limit 1;

  -- ── Clientes de la cartera de fiado ──────────────────────────────────────
  insert into public.customers (restaurant_id, name, phone, document, notes)
  values (v_demo, 'Carlos Restrepo', '3115540982', 'CC 71234567', 'Cliente frecuente'),
         (v_demo, 'María Fernanda Ruiz', '3007719043', 'CC 43987654', null),
         (v_demo, 'Oficina Torre 90', '6045551212', 'NIT 900123456-7',
          'Consumo corporativo, corte mensual');

  select id into v_cust_carlos from public.customers
   where restaurant_id = v_demo and name = 'Carlos Restrepo' limit 1;
  select id into v_cust_maria from public.customers
   where restaurant_id = v_demo and name = 'María Fernanda Ruiz' limit 1;
  select id into v_cust_torre from public.customers
   where restaurant_id = v_demo and name = 'Oficina Torre 90' limit 1;

  -- ========================================================
  -- 3.1 — 14 días de operación cerrada (turno por día)
  -- ========================================================
  for d in reverse 14..1 loop
    v_open_at  := ((v_today - d)::timestamp + interval '15 hours 30 minutes')
                    at time zone 'America/Bogota';
    v_close_at := ((v_today - d)::timestamp + interval '23 hours 45 minutes')
                    at time zone 'America/Bogota';

    insert into public.cash_shifts (restaurant_id, opened_by, opening_amount, opened_at)
    values (v_demo, case when d % 2 = 0 then v_cajero else v_owner end,
            200000, v_open_at)
    returning id into v_shift;

    -- Movimientos de caja del turno (uno de cada tipo).
    insert into public.cash_movements
      (restaurant_id, shift_id, type, amount, reason, created_by, created_at)
    values
      (v_demo, v_shift, 'out', 30000 + (d % 4) * 5000, 'Compra de insumos',
       v_cajero, v_open_at + interval '2 hours'),
      (v_demo, v_shift, 'in', 50000, 'Base adicional',
       v_owner,  v_open_at + interval '3 hours');

    -- Ventas del día: entre 6 y 10 según el día (fin de semana más movido).
    for k in 1..(6 + (d % 5)) loop
      v_seq := v_seq + 1;
      v_at  := ((v_today - d)::timestamp
                 + make_interval(hours => 16 + ((v_seq * 3) % 7),
                                 mins  => (v_seq * 17) % 60))
                 at time zone 'America/Bogota';
      v_by  := case when v_seq % 3 = 0 then v_owner else v_cajero end;

      -- Canal: 60% salón, 20% para llevar, 20% domicilio.
      if (v_seq % 10) < 6 then
        v_type  := 'dine_in';
        v_table := v_tables[1 + (v_seq % v_nt)];
      elsif (v_seq % 10) < 8 then
        v_type  := 'takeaway';
        v_table := null;
      else
        v_type  := 'delivery';
        v_table := null;
      end if;

      insert into public.orders
        (restaurant_id, type, status, table_id, created_by, created_at,
         payment_status, total, waiter_name)
      values (v_demo, v_type, 'delivered', v_table, v_by, v_at, 'paid', 0,
              case when v_type = 'dine_in'
                   then (array['Laura','Sebastián','Daniela','Camilo'])[1 + (v_seq % 4)]
                   else null end)
      returning id into v_order;

      -- ── Líneas ──────────────────────────────────────────────────────────
      v_sub   := 0;
      v_lines := 1 + (v_seq % 4);
      for j in 1..v_lines loop
        v_idx := 1 + ((v_seq * 7 + j * 13) % v_n);
        v_qty := 1 + ((v_seq + j) % 3);

        insert into public.order_items
          (order_id, product_id, qty, unit_price, sent_to_kitchen, created_at)
        values (v_order, v_ids[v_idx], v_qty, v_prices[v_idx], v_kitchen[v_idx], v_at)
        returning id into v_item;

        v_sub := v_sub + v_prices[v_idx] * v_qty;

        -- Descuento de inventario, replicando add_order_items_with_extras:
        -- simple con tracking descuenta lo propio; compuesto explota su receta.
        if v_kinds[v_idx] = 'simple' and v_track[v_idx] then
          insert into public.stock_movements
            (restaurant_id, product_id, qty, type, reference_id, created_by, created_at)
          values (v_demo, v_ids[v_idx], -v_qty, 'sale', v_order, v_by, v_at);
        elsif v_kinds[v_idx] = 'composite' then
          insert into public.stock_movements
            (restaurant_id, product_id, qty, type, reference_id, created_by, created_at)
          select v_demo, pc.component_id, -(v_qty * pc.qty), 'sale', v_order, v_by, v_at
            from public.product_components pc
            join public.products p on p.id = pc.component_id
           where pc.parent_id = v_ids[v_idx] and p.stock_tracking;
        end if;

        -- Cada 5ª venta lleva un extra en su primera línea, SOLO si ese extra
        -- está realmente asignado al producto (es lo que valida la RPC real;
        -- si no, saldría un "Queso extra" pegado a una cerveza en el recibo).
        if j = 1 and v_seq % 5 = 0 and exists (
             select 1 from public.product_extras pe
              where pe.product_id = v_ids[v_idx] and pe.extra_id = v_e_queso) then
          insert into public.order_item_extras (order_item_id, extra_id, qty, unit_price)
          values (v_item, v_e_queso, v_qty, 3000);
          v_sub := v_sub + 3000 * v_qty;
        end if;
      end loop;

      -- ── Descuentos: uno normal cada 9, un VALE (ruletazo) cada 23 ────────
      v_disc := 0;
      v_kind := 'normal';
      if v_seq % 23 = 0 and v_sub > 20000 then
        v_disc := 10000;
        v_kind := 'vale';
      elsif v_seq % 9 = 0 and v_sub > 12000 then
        v_disc := 2000;
      end if;

      v_total := v_sub - v_disc;

      update public.orders
         set total           = v_total,
             order_number    = v_seq,
             discount_amount = v_disc,
             discount_type   = case when v_disc > 0 then 'fixed' else null end,
             discount_kind   = v_kind,
             discount_reason = case when v_kind = 'vale' then 'Ruletazo'
                                    when v_disc > 0 then 'Cliente frecuente'
                                    else null end,
             courier_id      = case when v_type = 'delivery'
                                    then case when v_seq % 2 = 0 then v_courier1
                                              else v_courier2 end
                                    else null end,
             estimated_delivery_minutes = case when v_type = 'delivery' then 35 else null end
       where id = v_order;

      -- ── Pagos: uno por método rotando; cada 11ª venta va dividida ────────
      if v_seq % 11 = 0 and v_total >= 20000 then
        v_a1 := round(v_total * 0.6);
        insert into public.payments (restaurant_id, order_id, method, amount, created_at)
        values (v_demo, v_order, 'cash',  v_a1,            v_at + interval '40 minutes'),
               (v_demo, v_order, 'nequi', v_total - v_a1,  v_at + interval '40 minutes');
      else
        insert into public.payments (restaurant_id, order_id, method, amount, created_at)
        values (v_demo, v_order,
                (case v_seq % 5
                   when 0 then 'cash' when 1 then 'cash' when 2 then 'card'
                   when 3 then 'nequi' else 'transfer' end)::public.payment_method,
                v_total, v_at + interval '40 minutes');
      end if;
    end loop;

    -- ── Cierre del turno con arqueo (calculado de sus propios pagos) ───────
    select coalesce(sum(p.amount) filter (where p.method = 'cash'), 0),
           coalesce(sum(p.amount) filter (where p.method = 'card'), 0),
           coalesce(sum(p.amount) filter (where p.method = 'transfer'), 0),
           coalesce(sum(p.amount) filter (where p.method = 'nequi'), 0),
           count(distinct p.order_id)
      into v_cash, v_card, v_transfer, v_nequi, v_sales_count
      from public.payments p
     where p.restaurant_id = v_demo
       and p.created_at >= v_open_at and p.created_at <= v_close_at;

    select coalesce(sum(amount) filter (where type = 'in'), 0),
           coalesce(sum(amount) filter (where type = 'out'), 0)
      into v_in, v_out
      from public.cash_movements where shift_id = v_shift;

    select coalesce(sum(o.discount_amount), 0) into v_vouchers
      from public.orders o
     where o.restaurant_id = v_demo and o.discount_kind = 'vale'
       and o.created_at >= v_open_at and o.created_at <= v_close_at;

    v_exp := 200000 + v_cash + v_in - v_out;
    -- Casi todos cuadran exacto; dos días con faltante chico para que el
    -- historial de arqueo no parezca de laboratorio.
    v_declared := v_exp + case when d = 3 then -2000 when d = 9 then -5000 else 0 end;

    update public.cash_shifts
       set closed_at       = v_close_at,
           closed_by       = case when d % 2 = 0 then v_cajero else v_owner end,
           closing_amount  = v_declared,
           expected_amount = v_exp,
           difference      = v_declared - v_exp,
           close_comment   = case when d = 3 then 'Faltante menor, se revisa mañana.'
                                  when d = 9 then 'Diferencia por vuelto mal entregado.'
                                  else null end,
           close_reconciliation = jsonb_build_object(
             'methods', jsonb_build_object(
               'cash',     jsonb_build_object('expected', v_exp,      'declared', v_declared, 'difference', v_declared - v_exp),
               'card',     jsonb_build_object('expected', v_card,     'declared', v_card,     'difference', 0),
               'transfer', jsonb_build_object('expected', v_transfer, 'declared', v_transfer, 'difference', 0),
               'nequi',    jsonb_build_object('expected', v_nequi,    'declared', v_nequi,    'difference', 0)),
             'expected_total',   v_exp + v_card + v_transfer + v_nequi,
             'declared_total',   v_declared + v_card + v_transfer + v_nequi,
             'difference_total', v_declared - v_exp,
             'sales_count',      v_sales_count,
             'vouchers_total',   v_vouchers)
     where id = v_shift;
  end loop;

  -- ========================================================
  -- 3.2 — HOY: turno abierto + ventas de la jornada en curso
  -- ========================================================
  -- El turno abre 5 h atrás, PERO nunca antes de que cerrara el de ayer
  -- (v_close_at quedó en la última vuelta del loop). Sin ese greatest, correr
  -- el seed de madrugada abriría un turno solapado con el cierre anterior.
  v_open_at := greatest(now() - interval '5 hours', v_close_at + interval '15 minutes');

  insert into public.cash_shifts (restaurant_id, opened_by, opening_amount, opened_at)
  values (v_demo, v_cajero, 200000, v_open_at)
  returning id into v_shift;

  insert into public.cash_movements
    (restaurant_id, shift_id, type, amount, reason, created_by, created_at)
  values (v_demo, v_shift, 'out', 25000, 'Domicilios', v_cajero,
          v_open_at + (now() - v_open_at) * 0.15);

  for k in 1..9 loop
    v_seq := v_seq + 1;
    -- Repartidas entre la apertura y AHORA, no a intervalos fijos: así ninguna
    -- venta queda fechada en el futuro cuando la ventana del turno es corta.
    v_at  := v_open_at + (now() - v_open_at) * (k::double precision / 10);
    v_by  := case when k % 3 = 0 then v_owner else v_cajero end;

    if (k % 5) < 3 then
      v_type := 'dine_in'; v_table := v_tables[1 + (k % v_nt)];
    elsif (k % 5) = 3 then
      v_type := 'takeaway'; v_table := null;
    else
      v_type := 'delivery'; v_table := null;
    end if;

    insert into public.orders
      (restaurant_id, type, status, table_id, created_by, created_at,
       payment_status, total, waiter_name, courier_id, estimated_delivery_minutes)
    values (v_demo, v_type, 'delivered', v_table, v_by, v_at, 'paid', 0,
            case when v_type = 'dine_in'
                 then (array['Laura','Sebastián','Daniela','Camilo'])[1 + (k % 4)]
                 else null end,
            case when v_type = 'delivery' then v_courier1 else null end,
            case when v_type = 'delivery' then 35 else null end)
    returning id into v_order;

    v_sub := 0;
    for j in 1..(1 + (k % 3)) loop
      v_idx := 1 + ((k * 11 + j * 5) % v_n);
      v_qty := 1 + (k + j) % 2;

      insert into public.order_items
        (order_id, product_id, qty, unit_price, sent_to_kitchen, created_at)
      values (v_order, v_ids[v_idx], v_qty, v_prices[v_idx], v_kitchen[v_idx], v_at);

      v_sub := v_sub + v_prices[v_idx] * v_qty;

      if v_kinds[v_idx] = 'simple' and v_track[v_idx] then
        insert into public.stock_movements
          (restaurant_id, product_id, qty, type, reference_id, created_by, created_at)
        values (v_demo, v_ids[v_idx], -v_qty, 'sale', v_order, v_by, v_at);
      elsif v_kinds[v_idx] = 'composite' then
        insert into public.stock_movements
          (restaurant_id, product_id, qty, type, reference_id, created_by, created_at)
        select v_demo, pc.component_id, -(v_qty * pc.qty), 'sale', v_order, v_by, v_at
          from public.product_components pc
          join public.products p on p.id = pc.component_id
         where pc.parent_id = v_ids[v_idx] and p.stock_tracking;
      end if;
    end loop;

    update public.orders set total = v_sub, order_number = v_seq where id = v_order;

    -- El cobro cae entre el pedido y ahora (nunca en el futuro, aunque la
    -- ventana del turno sea corta).
    insert into public.payments (restaurant_id, order_id, method, amount, created_at)
    values (v_demo, v_order,
            (case k % 4 when 0 then 'cash' when 1 then 'card'
                        when 2 then 'nequi' else 'cash' end)::public.payment_method,
            v_sub, v_at + (now() - v_at) * 0.5);
  end loop;

  -- ========================================================
  -- 3.3 — Mesas ABIERTAS ahora (consumo en curso, sin cobrar)
  -- ========================================================
  for k in 1..4 loop
    v_table := v_tables[k];
    v_at    := now() - make_interval(mins => 18 * k + 10);

    insert into public.orders
      (restaurant_id, type, status, table_id, created_by, created_at,
       payment_status, total, waiter_name)
    values (v_demo, 'dine_in',
            -- El ::order_status es obligatorio: un literal suelto se coerce al
            -- enum, pero un CASE resuelve a text y Postgres NO castea solo.
            (case when k <= 2 then 'preparing' else 'pending' end)::public.order_status,
            v_table, v_cajero, v_at, 'paid', 0,
            (array['Laura','Sebastián','Daniela','Camilo'])[k])
    returning id into v_order;

    v_sub := 0;
    for j in 1..(2 + (k % 2)) loop
      v_idx := 1 + ((k * 13 + j * 3) % v_n);
      v_qty := 1 + (j % 2);

      insert into public.order_items
        (order_id, product_id, qty, unit_price, sent_to_kitchen, notes, created_at)
      values (v_order, v_ids[v_idx], v_qty, v_prices[v_idx],
              -- Las dos primeras mesas ya mandaron a cocina (alimenta el KDS).
              case when k <= 2 then v_kitchen[v_idx] else false end,
              case when j = 1 and k = 2 then 'Sin cebolla, alérgico'
                   when j = 1 and k = 3 then 'Término medio' else null end,
              v_at)
      returning id into v_item;

      v_sub := v_sub + v_prices[v_idx] * v_qty;

      if v_kinds[v_idx] = 'simple' and v_track[v_idx] then
        insert into public.stock_movements
          (restaurant_id, product_id, qty, type, reference_id, created_by, created_at)
        values (v_demo, v_ids[v_idx], -v_qty, 'sale', v_order, v_cajero, v_at);
      elsif v_kinds[v_idx] = 'composite' then
        insert into public.stock_movements
          (restaurant_id, product_id, qty, type, reference_id, created_by, created_at)
        select v_demo, pc.component_id, -(v_qty * pc.qty), 'sale', v_order, v_cajero, v_at
          from public.product_components pc
          join public.products p on p.id = pc.component_id
         where pc.parent_id = v_ids[v_idx] and p.stock_tracking;
      end if;
    end loop;

    update public.orders set total = v_sub where id = v_order;

    -- La mesa 4 ya pidió la cuenta.
    update public.tables
       set status = (case when k = 4 then 'waiting_bill' else 'occupied' end)::public.table_status
     where id = v_table;
  end loop;

  -- ========================================================
  -- 3.4 — Delivery en curso (kanban de 3 columnas)
  --   "Nuevos" = pending/preparing · "En camino" = ready
  --   Los entregados de hoy ya salieron en 3.2.
  -- ========================================================
  for k in 1..5 loop
    v_at := now() - make_interval(mins => case when k <= 2 then 8 * k else 34 + 6 * k end);

    insert into public.orders
      (restaurant_id, type, status, created_by, created_at, payment_status, total,
       customer_name, courier_id, estimated_delivery_minutes)
    values (v_demo, 'delivery',
            (case when k <= 2 then 'pending' when k = 3 then 'preparing'
                  else 'ready' end)::public.order_status,
            v_cajero, v_at, 'paid', 0,
            (array['Andrea Gómez','Juan Pablo Mesa','Sara Ochoa',
                   'Felipe Arango','Natalia Cano'])[k],
            case when k >= 4 then v_courier1 else null end,
            35)
    returning id into v_order;

    v_sub := 0;
    for j in 1..2 loop
      v_idx := 1 + ((k * 17 + j * 7) % v_n);
      v_qty := 1 + (k % 2);

      insert into public.order_items
        (order_id, product_id, qty, unit_price, sent_to_kitchen, created_at)
      values (v_order, v_ids[v_idx], v_qty, v_prices[v_idx], v_kitchen[v_idx], v_at);

      v_sub := v_sub + v_prices[v_idx] * v_qty;

      if v_kinds[v_idx] = 'simple' and v_track[v_idx] then
        insert into public.stock_movements
          (restaurant_id, product_id, qty, type, reference_id, created_by, created_at)
        values (v_demo, v_ids[v_idx], -v_qty, 'sale', v_order, v_cajero, v_at);
      elsif v_kinds[v_idx] = 'composite' then
        insert into public.stock_movements
          (restaurant_id, product_id, qty, type, reference_id, created_by, created_at)
        select v_demo, pc.component_id, -(v_qty * pc.qty), 'sale', v_order, v_cajero, v_at
          from public.product_components pc
          join public.products p on p.id = pc.component_id
         where pc.parent_id = v_ids[v_idx] and p.stock_tracking;
      end if;
    end loop;

    update public.orders set total = v_sub where id = v_order;
  end loop;

  -- ========================================================
  -- 3.5 — Cartera de fiado (ventas sin pago / con abono parcial)
  -- ========================================================

  -- (a) Carlos Restrepo — fiado PENDIENTE completo.
  v_seq := v_seq + 1;
  v_at  := now() - interval '3 days';
  insert into public.orders
    (restaurant_id, type, status, created_by, created_at, payment_status,
     total, order_number, customer_id, customer_name)
  values (v_demo, 'takeaway', 'delivered', v_cajero, v_at, 'pending',
          86000, v_seq, v_cust_carlos, 'Carlos Restrepo')
  returning id into v_order;

  insert into public.order_items (order_id, product_id, qty, unit_price, created_at)
  values (v_order, v_ids[1 + (3 % v_n)], 2, 38000, v_at),
         (v_order, v_ids[1 + (7 % v_n)], 1, 10000, v_at);

  -- (b) Oficina Torre 90 — fiado con ABONO parcial.
  v_seq := v_seq + 1;
  v_at  := now() - interval '6 days';
  insert into public.orders
    (restaurant_id, type, status, created_by, created_at, payment_status,
     total, order_number, customer_id, customer_name)
  values (v_demo, 'delivery', 'delivered', v_owner, v_at, 'partial',
          240000, v_seq, v_cust_torre, 'Oficina Torre 90')
  returning id into v_order;

  insert into public.order_items (order_id, product_id, qty, unit_price, created_at)
  values (v_order, v_ids[1 + (2 % v_n)], 6, 30000, v_at),
         (v_order, v_ids[1 + (5 % v_n)], 4, 15000, v_at);

  insert into public.debt_payments
    (restaurant_id, order_id, amount, payment_method, created_by, created_at)
  values (v_demo, v_order, 100000, 'transfer', v_cajero, v_at + interval '2 days');

  -- (c) María Fernanda Ruiz — fiado pendiente reciente.
  v_seq := v_seq + 1;
  v_at  := now() - interval '1 day';
  -- table_id va EN EL INSERT, no en un update posterior: chk_dine_in_has_table
  -- se evalúa en el INSERT y una orden dine_in sin mesa lo viola de entrada.
  insert into public.orders
    (restaurant_id, type, status, table_id, created_by, created_at, payment_status,
     total, order_number, customer_id, customer_name)
  values (v_demo, 'dine_in', 'delivered', v_tables[6], v_cajero, v_at, 'pending',
          54000, v_seq, v_cust_maria, 'María Fernanda Ruiz')
  returning id into v_order;

  insert into public.order_items (order_id, product_id, qty, unit_price, created_at)
  values (v_order, v_ids[1 + (9 % v_n)], 2, 27000, v_at);

  -- ========================================================
  -- 3.6 — Correlativo de la sede al día
  -- ========================================================
  insert into public.store_sequences (restaurant_id, last_order_number)
  values (v_demo, v_seq)
  on conflict (restaurant_id) do update set last_order_number = excluded.last_order_number;

  -- ========================================================
  -- 3.7 — INVENTARIO COHERENTE
  --
  -- Las ventas de arriba ya emitieron sus movimientos 'sale' (negativos). Para
  -- que Inventario cuadre —que la suma de movimientos sea el stock actual— se
  -- emite una COMPRA inicial por producto rastreado, fechada antes de la primera
  -- venta, de tamaño: stock_objetivo + lo vendido. Luego se fija stock_qty al
  -- objetivo. Así "Niveles" y "Movimientos" cuentan la misma historia.
  -- ========================================================
  for r in
    select p.id,
           p.name,
           -- Objetivo por producto: el declarado en el catálogo de la Parte 2.
           case p.name
             when 'Cerveza Club Colombia'    then 48
             when 'Cerveza Águila'           then 60
             when 'Cerveza Corona'           then 18   -- bajo mínimo (24) → "Reponer"
             when 'Cerveza Poker'            then 0    -- sin stock
             when 'Gaseosa Coca-Cola 350ml'  then 40
             when 'Gaseosa Colombiana 350ml' then 30
             when 'Agua sin gas 600ml'       then 25
             when 'Shot de Aguardiente'      then 60
             else 0
           end as objetivo,
           coalesce((select -sum(sm.qty) from public.stock_movements sm
                      where sm.product_id = p.id and sm.type = 'sale'), 0) as vendido
      from public.products p
     where p.restaurant_id = v_demo and p.stock_tracking and p.kind = 'simple'
  loop
    -- stock_movements exige qty <> 0. Un producto con objetivo 0 que además
    -- nunca se vendió (posible con "Cerveza Poker", que arranca sin stock)
    -- daría qty 0 y abortaría el seed entero: se omite el movimiento.
    if (r.objetivo + r.vendido) <> 0 then
      insert into public.stock_movements
        (restaurant_id, product_id, qty, type, notes, created_by, created_at)
      values (v_demo, r.id, (r.objetivo + r.vendido)::integer, 'purchase',
              'Inventario inicial de la sede', v_owner,
              ((v_today - 15)::timestamp + interval '9 hours') at time zone 'America/Bogota');
    end if;

    update public.products set stock_qty = r.objetivo where id = r.id;
  end loop;

  -- Un ajuste manual reciente, para que la pestaña Movimientos muestre los
  -- tres tipos (sale / purchase / adjustment) y no solo ventas.
  insert into public.stock_movements
    (restaurant_id, product_id, qty, type, notes, created_by, created_at)
  select v_demo, p.id, -2, 'adjustment', 'Rotura en barra', v_owner,
         now() - interval '2 days'
    from public.products p
   where p.restaurant_id = v_demo and p.name = 'Cerveza Corona';

  update public.products
     set stock_qty = stock_qty - 2
   where restaurant_id = v_demo and name = 'Cerveza Corona';

  raise notice 'Operación sembrada: % ventas numeradas, 15 turnos (14 cerrados + 1 abierto).', v_seq;
end $$;


-- ============================================================
-- OPCIONAL — entrar directo a la sede Demo al iniciar sesión.
--
-- Descomentá si querés que owner.test caiga en la Demo sin usar el selector
-- de sede del sidebar.
--
-- 🔴 DESCOMENTAR ESTE BLOQUE DEJA LA SUITE E2E EN ROJO, y no de a poco: casi
--     TODOS los specs asumen que la sede activa de owner.test es "Sede Lab
--     Norte" (ahí crean sus mesas, productos y turnos). Con la sede activa en
--     Demo, empiezan a fallar en masa y por motivos que no parecen tener nada
--     que ver — mesas que no aparecen, productos que no existen, turnos de otra
--     sede. Volvés al verde recién cuando corrés lab-seed.sql de nuevo o
--     devolvés la sede activa a Norte.
--
--     LA VÍA RECOMENDADA ES EL SELECTOR DE SEDE DEL SIDEBAR: hace exactamente
--     este mismo UPDATE, con un clic, y volvés con otro clic.
--
-- update public.profiles p
--    set restaurant_id = r.id
--   from public.restaurants r
--   join public.organizations o on o.id = r.organization_id
--  where o.name = 'LAB' and r.name = 'Sede Demo'
--    and p.email = 'owner.test@gvento.com';


-- ============================================================
-- VERIFICACIÓN (read-only) — corre dentro de la misma transacción.
--
-- ⚠️ TODA consulta de acá resuelve la sede con el CTE `demo`, que filtra por
--    organización ADEMÁS de por nombre. Buscar solo por `name = 'Sede Demo'`
--    contaría de más si otra organización llegara a tener una sede homónima:
--    no es riesgo de datos (son select), pero **un conteo equivocado en una
--    salida de verificación es peor que no tener ninguna** — alguien lo lee,
--    concluye que está bien y sigue.
--
--    El CTE existe además para que el filtro se escriba UNA vez por consulta y
--    no una vez por subconsulta: la repetición anterior (13 subselects con el
--    mismo `where` copiado) fue exactamente el motivo por el que a la mayoría
--    le faltaba el join a organizations.
-- ============================================================

select 'sede' as check, r.name, r.uses_kitchen, r.address, r.id as restaurant_id
  from public.restaurants r
  join public.organizations o on o.id = r.organization_id
 where o.name = 'LAB' and r.name = 'Sede Demo';

with demo as (
  select r.id
    from public.restaurants r
    join public.organizations o on o.id = r.organization_id
   where o.name = 'LAB' and r.name = 'Sede Demo'
)
select 'catálogo' as check,
  (select count(*) from public.categories c
    where c.restaurant_id in (select id from demo) and c.is_active) as categorias,
  (select count(*) from public.products p
    where p.restaurant_id in (select id from demo) and p.is_active) as productos,
  (select count(*) from public.products p
    where p.restaurant_id in (select id from demo) and p.kind = 'composite') as compuestos,
  (select count(*) from public.extras e
    where e.restaurant_id in (select id from demo) and e.is_active) as extras,
  (select count(*) from public.tables t
    where t.restaurant_id in (select id from demo)) as mesas;

with demo as (
  select r.id
    from public.restaurants r
    join public.organizations o on o.id = r.organization_id
   where o.name = 'LAB' and r.name = 'Sede Demo'
)
select 'operación' as check,
  (select count(*) from public.orders o
    where o.restaurant_id in (select id from demo)) as ordenes,
  (select max(order_number) from public.orders o
    where o.restaurant_id in (select id from demo)) as ultimo_numero,
  (select count(*) from public.payments p
    where p.restaurant_id in (select id from demo)) as pagos,
  (select count(*) from public.cash_shifts cs
    where cs.restaurant_id in (select id from demo) and cs.closed_at is null) as turnos_abiertos,
  (select count(*) from public.cash_shifts cs
    where cs.restaurant_id in (select id from demo) and cs.closed_at is not null) as turnos_cerrados,
  (select count(*) from public.tables t
    where t.restaurant_id in (select id from demo) and t.status <> 'free') as mesas_ocupadas,
  (select count(*) from public.orders o
    where o.restaurant_id in (select id from demo) and o.payment_status <> 'paid') as fiados_abiertos;

-- Inventario: el stock actual debe coincidir con la suma de movimientos.
select 'inventario' as check, p.name, p.stock_qty, p.min_stock,
       (select coalesce(sum(sm.qty), 0) from public.stock_movements sm
         where sm.product_id = p.id) as suma_movimientos,
       case when p.stock_qty = (select coalesce(sum(sm.qty), 0)
                                  from public.stock_movements sm
                                 where sm.product_id = p.id)
            then 'OK' else 'DESCUADRE' end as cuadre
  from public.products p
  join public.restaurants r  on r.id = p.restaurant_id
  join public.organizations o on o.id = r.organization_id
 where o.name = 'LAB' and r.name = 'Sede Demo' and p.stock_tracking
 order by p.name;

commit;
