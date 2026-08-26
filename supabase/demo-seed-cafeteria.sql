-- ============================================================
-- 🔴 ESTO NO ES UNA MIGRACIÓN. NO APLICAR EN PRODUCCIÓN.
--
-- Es una SEMILLA DE DEMO: datos de mentira para mostrar el producto en vivo.
-- No define ni altera el esquema. Se anota así de fuerte porque un `.sql`
-- suelto dentro de `supabase/` se lee como migración —todo el resto de la
-- carpeta lo es— y en este proyecto ya pasó que se aplique algo sin entender
-- del todo qué hacía.
-- ============================================================

-- ============================================================
-- G-Vento — SEMILLA DE DEMO · CAFETERÍA ("Café Aroma")
--
-- Variante de demo-seed.sql para un negocio de MOSTRADOR: se pide en barra y
-- se lleva. Sin mesas, sin domicilios, sin cocina.
--
-- ── DÓNDE VIVE Y POR QUÉ ────────────────────────────────────────────────────
-- En su propia ORGANIZACIÓN ("Café Aroma"), no en una sede de LAB. Dos motivos:
--   1. CREDIBILIDAD: el sidebar muestra el nombre del negocio limpio. Un
--      "Sede Demo" dentro de "LAB" delata que es un laboratorio.
--   2. AISLAMIENTO REAL: una organización propia es inmune por construcción al
--      residuo del lab. Ya nos costó una tarde que 5 categorías `E2E NumFail`
--      acumuladas empujaran el carrito del POS fuera de pantalla y tumbaran 3
--      tests ajenos. En plena demo eso no se diagnostica: se sufre.
--
-- REQUIERE, EN ESTE ORDEN:
--   1. supabase/onboard-org-paso1.sql   (organización + sede + roles)
--   2. la cuenta de Auth del owner      (paso 2 — ver onboard-org-paso3.sql)
--   3. supabase/onboard-org-paso3.sql   (role_id + user_stores)
--   4. este archivo
--
-- ── QUÉ SE HEREDÓ DE demo-seed.sql (y qué no) ───────────────────────────────
-- SE REUSA la arquitectura, que es lo valioso: catálogo declarado como tabla
-- de datos recorrida con un `for`; generación DETERMINISTA por aritmética
-- modular sobre un contador (sin `random()`: dos corridas producen las mismas
-- ventas); turnos cerrados con arqueo calculado de sus propios pagos; y el
-- bloque de INVENTARIO COHERENTE, que garantiza el invariante
-- `stock_qty = suma de movimientos` (sin eso, Niveles y Movimientos cuentan
-- historias distintas y la pantalla se cae sola si el dueño la mira dos veces).
--
-- NO SE TRAE nada de mesas ocupadas, delivery en curso, couriers, KDS ni
-- comanda: en un mostrador no existen.
--
-- ── IDEMPOTENTE ─────────────────────────────────────────────────────────────
-- Lo transaccional de la sede se purga al inicio y el catálogo se busca por
-- nombre. Correrlo N veces deja exactamente el mismo escenario.
--
-- ── ALCANCE ─────────────────────────────────────────────────────────────────
-- ⚠️ BD ÚNICA COMPARTIDA (LAB / G-10 / Salchimelo / Café Aroma son
--    ORGANIZACIONES de una sola base). TODO INSERT, UPDATE y DELETE de este
--    archivo está acotado por `restaurant_id = v_sede`, y v_sede es un UUID
--    FIJADO en _params, no un nombre resuelto en tiempo de ejecución. Antes de
--    borrar nada, tres guards verifican que ese id sea de la organización
--    esperada (ver PARTE 1). No hay una sola sentencia sin ese filtro. "Sede
--    Lab Norte" —donde corre la suite E2E— no se toca ni se lee.
--
-- ⏱️ Tarda entre 10 y 40 s: son ~1.100 ventas con sus ítems y ~3.500
--    movimientos de inventario. Que el SQL Editor "se quede pensando" es
--    normal; no lo canceles a la mitad (es una transacción: cancelar no deja
--    nada a medias, pero perdés el tiempo).
--
-- Ejecutar en: Supabase Dashboard > SQL Editor.
-- ============================================================

begin;

-- ============================================================
-- PARÁMETROS
-- ============================================================
-- 🔴 EL OBJETIVO SE FIJA POR UUID, NO POR NOMBRE. El nombre es solo una
--    VERIFICACIÓN CRUZADA.
--
--    Por qué: este archivo hace DELETE. Resolver el objetivo por nombre
--    significa que un typo, un nombre duplicado o un copy/paste de otro
--    contexto pueden apuntar el borrado a otra organización. El guard anterior
--    era `if v_org_name in ('G-10','Salchimelo')` — una DENY-LIST, que solo
--    ataja los nombres que alguien se acordó de escribir y no conoce al
--    cliente que se onboardee mañana.
--
--    Es la misma falla de categoría que se cerró en el filtro de PII de Sentry
--    (ver el bloque de allowlist en CLAUDE.md): una lista de lo prohibido no
--    puede proteger de lo que no está en la lista. La forma correcta es
--    declarar POSITIVAMENTE el único objetivo válido —un UUID— y hacer que
--    todo lo demás falle.
--
--    Con el id fijado, para que el borrado caiga en el lugar equivocado harían
--    falta DOS errores simultáneos: un UUID mal pegado QUE ADEMÁS pertenezca a
--    una organización llamada exactamente igual. La deny-list se conserva
--    igual, evaluada aparte: un chequeo fail-closed de más no cuesta nada.
--
--    ⚠️ Para reusar este seed con OTRA cafetería: creá la organización con
--       onboard-org-paso1.sql, copiá los dos UUID de su grilla de salida y
--       pegalos acá. Cambiar solo los nombres NO alcanza — y es a propósito.
create temporary table _params on commit drop as
select
  '992420af-4484-4b69-8fbb-547a69c137af'::uuid as v_org_id,
  'd29f22aa-a6ea-4436-9d47-a0cffe5c1a61'::uuid as v_sede_id,
  'Café Aroma'::text as v_org_name,   -- verificación cruzada, NO resolutor
  'Café Aroma'::text as v_sede_name,  -- idem
  30                 as v_dias,        -- días de histórico cerrado
  6                  as v_hora_abre,   -- 06:30 Bogotá
  30                 as v_min_abre,
  19                 as v_hora_cierra, -- 19:30 Bogotá
  30                 as v_min_cierra;


-- ============================================================
-- PARTE 1 — Resolver la sede, verificar el onboarding y purgar
-- ============================================================
do $$
declare
  v_org_name text; v_sede_name text;
  v_org uuid; v_sede uuid; v_n_perfiles integer;
  v_real_org text; v_real_sede text; v_sede_org uuid;
  v_ordenes integer; v_pagos integer;
begin
  select p.v_org_id, p.v_sede_id, p.v_org_name, p.v_sede_name
    into v_org, v_sede, v_org_name, v_sede_name
    from _params p;

  -- ── GUARD 1 (allowlist): la organización FIJADA existe y se llama como
  --    esperamos. Si el UUID apunta a otra cosa, el nombre no va a coincidir
  --    y esto aborta ANTES de tocar una sola fila.
  select name into v_real_org from public.organizations where id = v_org;
  if not found then
    raise exception
      'No existe ninguna organización con id %. Corré onboard-org-paso1.sql y pegá su UUID en _params.', v_org;
  end if;
  if v_real_org is distinct from v_org_name then
    raise exception
      'ABORTA: el id % pertenece a la organización "%", no a "%". Revisá los UUID de _params antes de seguir: este script BORRA.',
      v_org, v_real_org, v_org_name;
  end if;

  -- ── GUARD 2: la sede FIJADA existe, se llama como esperamos y pertenece a
  --    esa organización. Sin el tercer chequeo, un UUID de sede de otro tenant
  --    con nombre homónimo pasaría.
  select name, organization_id into v_real_sede, v_sede_org
    from public.restaurants where id = v_sede;
  if not found then
    raise exception 'No existe ninguna sede con id %.', v_sede;
  end if;
  if v_real_sede is distinct from v_sede_name then
    raise exception
      'ABORTA: el id % es la sede "%", no "%".', v_sede, v_real_sede, v_sede_name;
  end if;
  if v_sede_org is distinct from v_org then
    raise exception
      'ABORTA: la sede % pertenece a la organización % y no a la fijada (%).',
      v_sede, v_sede_org, v_org;
  end if;

  -- ── GUARD 3 (deny-list, redundante A PROPÓSITO): aunque los ids cuadren,
  --    nunca contra un cliente real. Es fail-closed de más y no cuesta nada;
  --    mismo criterio que conservar la deny-list del filtro de Sentry al
  --    invertirlo a allowlist.
  if v_org_name in ('G-10', 'Salchimelo') or v_real_org in ('G-10', 'Salchimelo') then
    raise exception
      'ABORTA: el objetivo es un cliente REAL (%). Esta semilla BORRA ventas.', v_real_org;
  end if;

  -- Sin profiles no hay a quién atribuirle las ventas (orders.created_by es
  -- NOT NULL). Que falte significa que el onboarding quedó a medias.
  select count(*) into v_n_perfiles from public.profiles where organization_id = v_org;
  if v_n_perfiles = 0 then
    raise exception
      'La organización "%" no tiene ningún profile. Faltan los pasos 2 y 3 del onboarding (cuenta de Auth + onboard-org-paso3.sql).',
      v_org_name;
  end if;

  -- Baseline de la sede, reescrito en cada corrida (revierte cualquier deriva
  -- de haber estado mostrando el producto).
  --   uses_kitchen = false  → Cocina desaparece del sidebar (AppLayout.tsx:126)
  --   sin kitchen_pin       → no hay KDS que configurar
  update public.restaurants
     set uses_kitchen = false,
         config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
           'cash_out_reasons', jsonb_build_array(
             'Compra de insumos', 'Pago a proveedor', 'Retiro de caja',
             'Servicios', 'Otro'),
           'payment_methods', jsonb_build_array('cash', 'card', 'transfer', 'nequi'))
   where id = v_sede;

  -- ── PURGA de lo transaccional, SOLO de esta sede ─────────────────────────
  -- Se anuncia QUÉ se va a borrar antes de borrarlo. En una primera corrida
  -- son ceros; si alguna vez sale un número que no esperabas, ese es el aviso
  -- de que el objetivo no era el que creías — y todavía estás en transacción.
  select count(*) into v_ordenes from public.orders   where restaurant_id = v_sede;
  select count(*) into v_pagos   from public.payments where restaurant_id = v_sede;
  raise notice 'Purga sobre "%" (%): % órdenes y % pagos.',
    v_real_org, v_sede, v_ordenes, v_pagos;

  -- El orden respeta las FK: hijos antes que padres.
  delete from public.order_item_extras
   where order_item_id in (
     select oi.id from public.order_items oi
      join public.orders o on o.id = oi.order_id
     where o.restaurant_id = v_sede);

  delete from public.debt_payments  where restaurant_id = v_sede;
  delete from public.payments       where restaurant_id = v_sede;

  delete from public.order_items
   where order_id in (select id from public.orders where restaurant_id = v_sede);

  delete from public.orders          where restaurant_id = v_sede;
  delete from public.cash_movements  where restaurant_id = v_sede;
  delete from public.cash_shifts     where restaurant_id = v_sede;
  delete from public.stock_movements where restaurant_id = v_sede;
  delete from public.customers       where restaurant_id = v_sede;

  raise notice 'Sede "%" lista (%). Escenario anterior purgado.', v_sede_name, v_sede;
end $$;


-- ============================================================
-- PARTE 2 — Catálogo
--
-- El menú va en una TABLA TEMPORAL (no en una variable jsonb como
-- demo-seed.sql) porque la Parte 3 necesita releer tres columnas suyas:
--   · `pop`    peso de popularidad → arma la bolsa ponderada de ventas
--   · `bake`   producción diaria de los perecederos
--   · `target` stock objetivo, para el cuadre final de inventario
-- Con una variable local habría que declararla dos veces y mantener las dos
-- copias sincronizadas a mano: exactamente el tipo de duplicación que después
-- diverge en silencio.
--
-- Columnas:
--   cat     categoría
--   name    nombre
--   price   precio COP
--   pop     peso en la bolsa de ventas. 0 = NUNCA se vende suelto (insumo puro).
--           Es lo que hace que el reporte "Top productos" muestre americanos y
--           lattes arriba y no una tostada de aguacate: con selección uniforme
--           el ranking sale plano y no se parece a ninguna cafetería.
--   kind    'simple' | 'composite'
--   track   lleva inventario
--   target  stock objetivo al final del seed (solo si track)
--   min     stock mínimo (umbral de "Reponer")
--   bake    unidades producidas por día. Su presencia marca al producto como
--           PERECEDERO: se hornea cada mañana y lo que sobra se da de baja
--           cada noche, en vez de una compra inicial única.
-- ============================================================
-- Ojo con la sintaxis: en la forma `create table (columnas)` el `on commit
-- drop` va DESPUÉS del paréntesis. Solo va antes en la forma
-- `create table ... on commit drop as select`, que es la que usa _params.
create temporary table _menu (
  cat text, name text, price numeric, pop integer,
  kind text, track boolean, target integer, min_stock integer, bake integer
) on commit drop;

insert into _menu (cat, name, price, pop, kind, track, target, min_stock, bake) values
  -- ── Café caliente ────────────────────────────────────────────────────────
  ('cafe_cal', 'Tinto campesino',            2500, 5, 'simple',    false, null, 0,  null),
  ('cafe_cal', 'Espresso',                   5000, 2, 'simple',    false, null, 0,  null),
  ('cafe_cal', 'Espresso doble',             7000, 2, 'simple',    false, null, 0,  null),
  ('cafe_cal', 'Americano 12 oz',            6500, 5, 'simple',    false, null, 0,  null),
  ('cafe_cal', 'Americano 16 oz',            8000, 4, 'simple',    false, null, 0,  null),
  ('cafe_cal', 'Latte 12 oz',                8500, 4, 'simple',    false, null, 0,  null),
  ('cafe_cal', 'Latte 16 oz',               10500, 5, 'composite', false, null, 0,  null),
  ('cafe_cal', 'Cappuccino 12 oz',           8500, 3, 'simple',    false, null, 0,  null),
  ('cafe_cal', 'Cappuccino 16 oz',          10500, 3, 'composite', false, null, 0,  null),
  ('cafe_cal', 'Mocca',                     11000, 2, 'simple',    false, null, 0,  null),
  -- Insumo que además se vende suelto (un shot es un ítem real de carta).
  ('cafe_cal', 'Shot de espresso',           5000, 1, 'simple',    true,  200, 60, null),

  -- ── Café frío ────────────────────────────────────────────────────────────
  ('cafe_frio', 'Cold brew',                12000, 3, 'simple', false, null, 0, null),
  ('cafe_frio', 'Latte helado',             11000, 2, 'simple', false, null, 0, null),
  ('cafe_frio', 'Frappé de café',           14000, 3, 'simple', false, null, 0, null),
  ('cafe_frio', 'Affogato',                 12000, 1, 'simple', false, null, 0, null),

  -- ── Panadería (perecedera: se hornea a diario) ───────────────────────────
  -- Pan de bono termina en 0 A PROPÓSITO: es lo que le pasa a una cafetería a
  -- media tarde, y es el ejemplo que le habla al dueño en la demo.
  ('panaderia', 'Pan de bono',               3500, 5, 'simple', true,  0, 12, 24),
  ('panaderia', 'Almojábana',                3500, 3, 'simple', true,  6, 12, 14),
  ('panaderia', 'Buñuelo',                   3000, 3, 'simple', true, 18, 10, 16),
  ('panaderia', 'Croissant de mantequilla',  5500, 3, 'simple', true, 14,  8, 12),
  ('panaderia', 'Croissant jamón y queso',   9500, 2, 'simple', true,  9,  6,  8),
  ('panaderia', 'Palito de queso',           4000, 2, 'simple', true, 20, 10, 10),

  -- ── Repostería (perecedera, volumen bajo) ────────────────────────────────
  ('reposteria', 'Torta de zanahoria',      11000, 2, 'simple', true,  4, 6, 3),
  ('reposteria', 'Cheesecake de maracuyá',  12500, 2, 'simple', true,  7, 6, 3),
  ('reposteria', 'Brownie',                  8500, 2, 'simple', true, 11, 6, 4),
  ('reposteria', 'Galleta de avena',         4500, 3, 'simple', true, 25, 10, 8),

  -- ── Desayunos ────────────────────────────────────────────────────────────
  ('desayunos', 'Huevos al gusto con arepa', 14000, 2, 'simple', false, null, 0, null),
  ('desayunos', 'Sándwich jamón y queso',    13000, 2, 'simple', false, null, 0, null),
  ('desayunos', 'Tostada de aguacate',       16000, 1, 'simple', false, null, 0, null),
  ('desayunos', 'Bowl de yogur con granola', 13500, 1, 'simple', false, null, 0, null),

  -- ── Otras bebidas ────────────────────────────────────────────────────────
  ('bebidas', 'Chocolate caliente',           8000, 2, 'simple', false, null,  0, null),
  ('bebidas', 'Chai latte',                  10000, 1, 'simple', false, null,  0, null),
  ('bebidas', 'Jugo de naranja natural',      9000, 2, 'simple', false, null,  0, null),
  ('bebidas', 'Agua 600 ml',                  4000, 3, 'simple', true,   30, 12, null),
  ('bebidas', 'Gaseosa 350 ml',               4500, 2, 'simple', true,   24, 12, null),
  -- Insumos puros (pop = 0): existen para que las recetas y los extras tengan
  -- de dónde descontar. Nunca se venden solos.
  ('bebidas', 'Leche entera 250 ml',          3000, 0, 'simple', true,   90, 30, null),
  ('bebidas', 'Leche deslactosada 250 ml',    3500, 0, 'simple', true,   40, 15, null),
  ('bebidas', 'Leche de almendras 250 ml',    4500, 0, 'simple', true,   22, 10, null);


do $$
declare
  v_org uuid; v_sede uuid;
  v_cats jsonb := '{}'::jsonb;
  v_pid uuid;
  v_shot uuid; v_leche uuid; v_deslac uuid; v_almen uuid;
  v_latte uuid; v_capp uuid;
  r record;
begin
  -- Los ids vienen FIJADOS de _params. La Parte 1 ya verificó que existen,
  -- que se llaman como corresponde y que la sede es de esa organización.
  select p.v_org_id, p.v_sede_id into v_org, v_sede from _params p;

  -- ── Categorías (sort_order fija el orden de los tabs del POS) ────────────
  -- Seis: a 1024 px entran sin comprimir. El bug de desborde del POS
  -- (minWidth:0 en el panel del catálogo) está arreglado, pero el umbral
  -- depende del ANCHO DEL TEXTO, no del conteo: nombres cortos a propósito.
  for r in
    select * from (values
      ('cafe_cal',   'Café caliente', '#b45309', 1),
      ('cafe_frio',  'Café frío',     '#0891b2', 2),
      ('panaderia',  'Panadería',     '#f59e0b', 3),
      ('reposteria', 'Repostería',    '#db2777', 4),
      ('desayunos',  'Desayunos',     '#10b981', 5),
      ('bebidas',    'Bebidas',       '#8b5cf6', 6)
    ) as c(key, nombre, color, orden)
  loop
    select id into v_pid from public.categories
     where restaurant_id = v_sede and name = r.nombre limit 1;
    if v_pid is null then
      insert into public.categories (restaurant_id, name, color, sort_order)
      values (v_sede, r.nombre, r.color, r.orden) returning id into v_pid;
    else
      update public.categories
         set color = r.color, sort_order = r.orden, is_active = true
       where id = v_pid;
    end if;
    v_cats := v_cats || jsonb_build_object(r.key, v_pid);
  end loop;

  -- ── Productos ────────────────────────────────────────────────────────────
  -- routes_to_kitchen va en FALSE en todos: la sede tiene uses_kitchen=false,
  -- así que el flag de producto se ignora, pero dejarlo en su default `true`
  -- sería una mentira en la ficha si algún día alguien enciende la cocina.
  for r in select * from _menu order by name loop
    select id into v_pid from public.products
     where restaurant_id = v_sede and name = r.name limit 1;

    if v_pid is null then
      insert into public.products
        (restaurant_id, category_id, name, price, kind,
         stock_tracking, stock_qty, min_stock, routes_to_kitchen, cost_price)
      values (v_sede, (v_cats->>r.cat)::uuid, r.name, r.price, r.kind,
              r.track,
              case when r.track then 0 else null end,
              r.min_stock, false,
              -- Margen de cafetería: el costo ronda el 32 % del precio.
              round(r.price * 0.32));
    else
      -- Baseline reescrito: si alguien tocó un precio mostrando el producto,
      -- la corrida siguiente lo devuelve al valor de la demo.
      update public.products
         set category_id       = (v_cats->>r.cat)::uuid,
             price             = r.price,
             kind              = r.kind,
             stock_tracking    = r.track,
             min_stock         = r.min_stock,
             routes_to_kitchen = false,
             cost_price        = round(r.price * 0.32),
             is_active         = true
       where id = v_pid;
    end if;
  end loop;

  -- ── Recetas de los compuestos ────────────────────────────────────────────
  -- ⚠️ product_components.qty es INTEGER (inventory-recipes.sql): no hay medias
  --    unidades. Por eso los insumos están definidos en UNIDAD DE CONSUMO
  --    (un shot, una porción de 250 ml) y no en presentación de compra ("café
  --    en grano 500 g"), que obligaría a fracciones.
  select id into v_shot   from public.products where restaurant_id = v_sede and name = 'Shot de espresso' limit 1;
  select id into v_leche  from public.products where restaurant_id = v_sede and name = 'Leche entera 250 ml' limit 1;
  select id into v_deslac from public.products where restaurant_id = v_sede and name = 'Leche deslactosada 250 ml' limit 1;
  select id into v_almen  from public.products where restaurant_id = v_sede and name = 'Leche de almendras 250 ml' limit 1;
  select id into v_latte  from public.products where restaurant_id = v_sede and name = 'Latte 16 oz' limit 1;
  select id into v_capp   from public.products where restaurant_id = v_sede and name = 'Cappuccino 16 oz' limit 1;

  insert into public.product_components (restaurant_id, parent_id, component_id, qty)
  values (v_sede, v_latte, v_shot,  2),
         (v_sede, v_latte, v_leche, 2),
         (v_sede, v_capp,  v_shot,  2),
         (v_sede, v_capp,  v_leche, 1)
  on conflict (parent_id, component_id) do update set qty = excluded.qty;

  -- ── Extras ───────────────────────────────────────────────────────────────
  -- Los tres primeros están VINCULADOS a un insumo: venderlos descuenta
  -- inventario. Los tres últimos no (un sirope no se lleva stock).
  for r in
    select * from (values
      ('Leche deslactosada', 1500, 'Leche deslactosada 250 ml'),
      ('Leche de almendras', 3000, 'Leche de almendras 250 ml'),
      ('Shot adicional',     2500, 'Shot de espresso'),
      ('Crema batida',       2000, null),
      ('Sirope de vainilla', 1500, null),
      ('Sirope de caramelo', 1500, null)
    ) as e(nombre, precio, insumo)
  loop
    select id into v_pid from public.extras
     where restaurant_id = v_sede and name = r.nombre limit 1;

    if v_pid is null then
      insert into public.extras (restaurant_id, name, price, linked_product_id, is_active)
      values (v_sede, r.nombre, r.precio,
              (select id from public.products
                where restaurant_id = v_sede and name = r.insumo limit 1),
              true);
    else
      update public.extras
         set price = r.precio,
             linked_product_id = (select id from public.products
                                   where restaurant_id = v_sede and name = r.insumo limit 1),
             is_active = true
       where id = v_pid;
    end if;
  end loop;

  -- Asignación: los 6 extras a todo el café (caliente y frío). Sin esto el
  -- POS no ofrece el modal de extras y la demo del descuento vinculado no sale.
  for r in
    select p.id as product_id, e.id as extra_id
      from public.products p
     cross join public.extras e
     where p.restaurant_id = v_sede
       and e.restaurant_id = v_sede
       and p.category_id in ((v_cats->>'cafe_cal')::uuid, (v_cats->>'cafe_frio')::uuid)
       -- El insumo no lleva extras: un "shot de espresso con shot adicional"
       -- es un sinsentido que el dueño va a notar.
       and p.name <> 'Shot de espresso'
  loop
    if not exists (select 1 from public.product_extras
                    where product_id = r.product_id and extra_id = r.extra_id) then
      insert into public.product_extras (product_id, extra_id) values (r.product_id, r.extra_id);
    end if;
  end loop;

  -- ── SIN mesas y SIN repartidores ─────────────────────────────────────────
  -- Es mostrador. Mesas queda con su estado vacío limpio ("Sin mesas. Usa
  -- Configurar para agregar", TablesPage.tsx:1802) y Delivery con el kanban en
  -- cero. Ninguna de las dos se visita en la demo.
  raise notice 'Catálogo sembrado: % productos en 6 categorías.',
    (select count(*) from public.products where restaurant_id = v_sede);
end $$;


-- ============================================================
-- PARTE 3 — Operación
--
-- Todo DETERMINISTA: los "azares" (qué se vende, cuánto, con qué método, a qué
-- hora) salen de aritmética modular sobre un contador, nunca de random(). Dos
-- corridas generan exactamente las mismas ventas — que es lo que permite
-- ensayar la demo el lunes y darla el jueves sobre los mismos números.
-- ============================================================
do $$
declare
  v_dias integer; v_ha integer; v_ma integer; v_hc integer; v_mc integer;
  v_org uuid; v_sede uuid;
  v_owner uuid; v_cajero uuid;

  -- Catálogo en arrays paralelos, ordenado por nombre (determinista).
  v_ids    uuid[];    v_prices numeric[]; v_kinds text[];
  v_track  boolean[]; v_pop    integer[];
  v_n integer;

  -- Bolsa ponderada: índices repetidos `pop` veces. Sortear un índice de acá
  -- es sortear un producto con su probabilidad real.
  v_bag integer[] := '{}';
  v_nb  integer;

  -- Distribución horaria de una CAFETERÍA: 45 % entre 7 y 10, valle al
  -- mediodía, repunte flojo a media tarde. Es la diferencia que más se nota
  -- respecto del seed del bar (que concentra de noche): si la gráfica horaria
  -- le muestra un pico nocturno, el dueño deja de creer que el sistema
  -- entiende su negocio.
  v_horas integer[] := array[7,7,8,8,8,9,9,9,10,11,12,13,14,15,15,16,16,17,18,18];

  v_today date;
  v_shift uuid; v_open_at timestamptz; v_close_at timestamptz;
  v_prev_close timestamptz := null;

  v_order uuid; v_item uuid;
  v_seq integer := 0;
  v_lines integer; v_idx integer; v_qty integer;
  v_sub numeric; v_disc numeric; v_kind text; v_total numeric;
  v_at timestamptz; v_by uuid;
  v_extra uuid; v_extra_price numeric;

  v_cust uuid;

  -- Arqueo
  v_cash numeric; v_card numeric; v_transfer numeric; v_nequi numeric;
  v_in numeric; v_out numeric; v_exp numeric; v_declared numeric;
  v_sales_count integer; v_vouchers numeric;

  d integer; k integer; j integer; i integer;
  r record;
  v_delta integer; v_sold integer; v_surplus integer;
begin
  -- ids FIJADOS (ver el guard de la Parte 1), no resueltos por nombre.
  select p.v_org_id, p.v_sede_id, p.v_dias,
         p.v_hora_abre, p.v_min_abre, p.v_hora_cierra, p.v_min_cierra
    into v_org, v_sede, v_dias, v_ha, v_ma, v_hc, v_mc
    from _params p;

  -- Quién atiende. Con un solo profile (el owner recién onboardeado) las dos
  -- variables apuntan al mismo usuario y las ventas salen todas a su nombre —
  -- correcto para una cafetería de dueño-en-barra. Si más adelante creás una
  -- cuenta de cajero y volvés a correr esto, se reparten solas.
  select id into v_owner from public.profiles
   where organization_id = v_org order by created_at limit 1;
  select id into v_cajero from public.profiles
   where organization_id = v_org and id <> v_owner order by created_at limit 1;
  v_cajero := coalesce(v_cajero, v_owner);

  v_today := (now() at time zone 'America/Bogota')::date;

  -- ── Catálogo a arrays + bolsa ponderada ──────────────────────────────────
  select array_agg(p.id order by p.name), array_agg(p.price order by p.name),
         array_agg(p.kind order by p.name), array_agg(p.stock_tracking order by p.name),
         array_agg(coalesce(m.pop, 0) order by p.name)
    into v_ids, v_prices, v_kinds, v_track, v_pop
    from public.products p
    left join _menu m on m.name = p.name
   where p.restaurant_id = v_sede and p.is_active;
  v_n := array_length(v_ids, 1);

  for i in 1..v_n loop
    for j in 1..v_pop[i] loop
      v_bag := v_bag || i;
    end loop;
  end loop;
  v_nb := array_length(v_bag, 1);

  select id into v_extra from public.extras
   where restaurant_id = v_sede and name = 'Leche deslactosada' limit 1;
  select price into v_extra_price from public.extras where id = v_extra;

  -- ── Cliente corporativo (único, para la cartera de fiado) ────────────────
  -- Uno solo y a propósito: "la oficina de al lado, corte mensual" es el caso
  -- real de una cafetería. Tres clientes como en el seed del bar convertirían
  -- el fiado en protagonista, y en esta demo es una respuesta a una pregunta,
  -- no un capítulo.
  insert into public.customers (restaurant_id, name, phone, document, notes)
  values (v_sede, 'Nova Group (oficina 402)', '604 448 9930', 'NIT 901447882-3',
          'Pedido diario de la oficina. Corte y pago el último viernes del mes.')
  returning id into v_cust;

  -- ========================================================
  -- 3.1 — Histórico cerrado: un turno por día
  -- ========================================================
  for d in reverse v_dias..1 loop
    v_open_at  := ((v_today - d)::timestamp + make_interval(hours => v_ha, mins => v_ma))
                    at time zone 'America/Bogota';
    v_close_at := ((v_today - d)::timestamp + make_interval(hours => v_hc, mins => v_mc))
                    at time zone 'America/Bogota';

    insert into public.cash_shifts (restaurant_id, opened_by, opening_amount, opened_at)
    values (v_sede, case when d % 2 = 0 then v_cajero else v_owner end, 150000, v_open_at)
    returning id into v_shift;

    -- Egreso diario (la compra de leche y pan del día) + una base extra
    -- ocasional. Sin movimientos, el arqueo del cierre es una resta trivial y
    -- la demo del cuadre pierde el punto.
    insert into public.cash_movements
      (restaurant_id, shift_id, type, amount, reason, created_by, created_at)
    values (v_sede, v_shift, 'out', 35000 + (d % 5) * 5000, 'Compra de insumos',
            v_cajero, v_open_at + interval '90 minutes');

    if d % 5 = 0 then
      insert into public.cash_movements
        (restaurant_id, shift_id, type, amount, reason, created_by, created_at)
      values (v_sede, v_shift, 'in', 50000, 'Base adicional', v_owner,
              v_open_at + interval '3 hours');
    end if;

    -- Ventas del día: 28 a 45. Mostrador = muchas ventas de ticket bajo, al
    -- revés de un bar. Sábado (dow 6) es el día fuerte; domingo (0), corto.
    for k in 1..(28 + ((d * 7) % 18)
                 + case extract(dow from (v_today - d)) when 6 then 6 when 0 then -8 else 0 end) loop
      v_seq := v_seq + 1;

      v_at := ((v_today - d)::timestamp
               + make_interval(hours => v_horas[1 + ((v_seq * 13 + d * 7) % 20)],
                               mins  => (v_seq * 37) % 60))
              at time zone 'America/Bogota';
      v_by := case when v_seq % 3 = 0 then v_owner else v_cajero end;

      -- SIEMPRE takeaway: no hay mesas (dine_in exige table_id por
      -- chk_dine_in_has_table) ni domicilios. La gráfica "por canal" del
      -- reporte va a mostrar un solo canal, y eso es CORRECTO para un
      -- mostrador: no es un dato faltante.
      insert into public.orders
        (restaurant_id, type, status, created_by, created_at, payment_status, total)
      values (v_sede, 'takeaway', 'delivered', v_by, v_at, 'paid', 0)
      returning id into v_order;

      v_sub   := 0;
      v_lines := 1 + (v_seq % 3);          -- 1 a 3 líneas
      for j in 1..v_lines loop
        v_idx := v_bag[1 + ((v_seq * 7 + j * 13) % v_nb)];
        v_qty := 1 + ((v_seq + j) % 2);    -- 1 o 2

        insert into public.order_items
          (order_id, product_id, qty, unit_price, sent_to_kitchen, created_at)
        values (v_order, v_ids[v_idx], v_qty, v_prices[v_idx], false, v_at)
        returning id into v_item;

        v_sub := v_sub + v_prices[v_idx] * v_qty;

        -- Descuento de inventario replicando add_order_items_with_extras:
        -- el simple con tracking descuenta lo propio; el compuesto explota su
        -- receta y NO descuenta de su propio stock.
        if v_kinds[v_idx] = 'simple' and v_track[v_idx] then
          insert into public.stock_movements
            (restaurant_id, product_id, qty, type, reference_id, created_by, created_at)
          values (v_sede, v_ids[v_idx], -v_qty, 'sale', v_order, v_by, v_at);
        elsif v_kinds[v_idx] = 'composite' then
          insert into public.stock_movements
            (restaurant_id, product_id, qty, type, reference_id, created_by, created_at)
          select v_sede, pc.component_id, -(v_qty * pc.qty), 'sale', v_order, v_by, v_at
            from public.product_components pc
            join public.products p on p.id = pc.component_id
           where pc.parent_id = v_ids[v_idx] and p.stock_tracking;
        end if;

        -- Extra de leche deslactosada cada 7ª venta, solo si está asignado a
        -- ese producto (es lo que valida la RPC real; si no, saldría un
        -- "leche deslactosada" pegado a un buñuelo en el recibo).
        if j = 1 and v_seq % 7 = 0 and exists (
             select 1 from public.product_extras pe
              where pe.product_id = v_ids[v_idx] and pe.extra_id = v_extra) then
          insert into public.order_item_extras (order_item_id, extra_id, qty, unit_price)
          values (v_item, v_extra, v_qty, v_extra_price);
          v_sub := v_sub + v_extra_price * v_qty;

          -- El extra vinculado también descuenta inventario.
          insert into public.stock_movements
            (restaurant_id, product_id, qty, type, reference_id, created_by, created_at)
          select v_sede, e.linked_product_id, -v_qty, 'sale', v_order, v_by, v_at
            from public.extras e
           where e.id = v_extra and e.linked_product_id is not null;
        end if;
      end loop;

      -- ── Descuentos ──────────────────────────────────────────────────────
      -- Una cafetería descuenta poco. El VALE va framedo como tarjeta de
      -- sellos, que es la promo que sí existe en este rubro (el "ruletazo" del
      -- bar no le dice nada a un dueño de cafetería).
      v_disc := 0;
      v_kind := 'normal';
      if v_seq % 60 = 0 and v_sub > 8000 then
        v_disc := least(5000, v_sub);
        v_kind := 'vale';
      elsif v_seq % 25 = 0 and v_sub > 10000 then
        v_disc := 1000;
      end if;

      v_total := v_sub - v_disc;

      update public.orders
         set total           = v_total,
             order_number    = v_seq,
             discount_amount = v_disc,
             discount_type   = case when v_disc > 0 then 'fixed' else null end,
             discount_kind   = v_kind,
             discount_reason = case when v_kind = 'vale' then 'Tarjeta de sellos completa'
                                    when v_disc > 0 then 'Cliente frecuente'
                                    else null end
       where id = v_order;

      -- ── Pago ────────────────────────────────────────────────────────────
      -- Mezcla 2026 de un mostrador colombiano: efectivo 35 %, Nequi 30 %,
      -- tarjeta 25 %, transferencia 10 %. Cada 40ª venta va dividida (el
      -- clásico "te pago una parte en efectivo y el resto por Nequi").
      if v_seq % 40 = 0 and v_total >= 10000 then
        insert into public.payments (restaurant_id, order_id, method, amount, created_at)
        values (v_sede, v_order, 'cash',  round(v_total * 0.5),               v_at + interval '2 minutes'),
               (v_sede, v_order, 'nequi', v_total - round(v_total * 0.5),     v_at + interval '2 minutes');
      else
        insert into public.payments (restaurant_id, order_id, method, amount, created_at)
        values (v_sede, v_order,
                (case
                   when (v_seq % 20) < 7  then 'cash'
                   when (v_seq % 20) < 13 then 'nequi'
                   when (v_seq % 20) < 18 then 'card'
                   else 'transfer' end)::public.payment_method,
                v_total, v_at + interval '2 minutes');
      end if;
    end loop;

    -- ── Cierre con arqueo, calculado de los pagos del propio turno ─────────
    select coalesce(sum(p.amount) filter (where p.method = 'cash'), 0),
           coalesce(sum(p.amount) filter (where p.method = 'card'), 0),
           coalesce(sum(p.amount) filter (where p.method = 'transfer'), 0),
           coalesce(sum(p.amount) filter (where p.method = 'nequi'), 0),
           count(distinct p.order_id)
      into v_cash, v_card, v_transfer, v_nequi, v_sales_count
      from public.payments p
     where p.restaurant_id = v_sede
       and p.created_at >= v_open_at and p.created_at <= v_close_at;

    select coalesce(sum(amount) filter (where type = 'in'), 0),
           coalesce(sum(amount) filter (where type = 'out'), 0)
      into v_in, v_out
      from public.cash_movements where shift_id = v_shift;

    select coalesce(sum(o.discount_amount), 0) into v_vouchers
      from public.orders o
     where o.restaurant_id = v_sede and o.discount_kind = 'vale'
       and o.created_at >= v_open_at and o.created_at <= v_close_at;

    v_exp := 150000 + v_cash + v_in - v_out;
    -- Casi todos cuadran exacto; tres días con diferencia chica para que el
    -- historial de arqueo no parezca de laboratorio (y para tener algo que
    -- mostrar en rojo sin inventarlo en vivo).
    v_declared := v_exp + case when d = 4 then -3000
                               when d = 12 then -5000
                               when d = 19 then 2000
                               else 0 end;

    update public.cash_shifts
       set closed_at       = v_close_at,
           closed_by       = case when d % 2 = 0 then v_cajero else v_owner end,
           closing_amount  = v_declared,
           expected_amount = v_exp,
           difference      = v_declared - v_exp,
           close_comment   = case when d = 4  then 'Faltante chico, se revisa mañana.'
                                  when d = 12 then 'Vuelto mal entregado en la mañana.'
                                  when d = 19 then 'Sobrante: propina que entró a la caja.'
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

    v_prev_close := v_close_at;
  end loop;

  -- ========================================================
  -- 3.2 — HOY: turno ABIERTO + ventas de la jornada en curso
  -- ========================================================
  -- 🔴 El turno se ancla a las 06:30 de BOGOTÁ, no a `now() - 5 horas` como el
  --    seed del bar. Con el offset, dar la demo a las 15:00 abriría el turno a
  --    las 10:00 — una cafetería que abrió a media mañana no le cuadra a nadie
  --    y es de las cosas que el dueño mira primero.
  --    El `least` cubre el caso de correr el seed ANTES de las 6:30 (madrugada):
  --    sin él, el turno quedaría abierto en el FUTURO.
  --    El `greatest` garantiza que no se solape con el cierre de ayer, que es
  --    lo que exige `idx_one_open_shift_per_store`.
  v_open_at := least(
                 (v_today::timestamp + make_interval(hours => v_ha, mins => v_ma))
                   at time zone 'America/Bogota',
                 now() - interval '30 minutes');
  v_open_at := greatest(v_open_at, v_prev_close + interval '15 minutes');

  insert into public.cash_shifts (restaurant_id, opened_by, opening_amount, opened_at)
  values (v_sede, v_cajero, 150000, v_open_at)
  returning id into v_shift;

  insert into public.cash_movements
    (restaurant_id, shift_id, type, amount, reason, created_by, created_at)
  values (v_sede, v_shift, 'out', 38000, 'Compra de insumos', v_cajero,
          v_open_at + (now() - v_open_at) * 0.2);

  -- Ventas repartidas entre la apertura y AHORA (nunca en el futuro, aunque la
  -- ventana sea corta porque el seed se corrió temprano).
  for k in 1..16 loop
    v_seq := v_seq + 1;
    v_at  := v_open_at + (now() - v_open_at) * (k::double precision / 17);
    v_by  := case when k % 3 = 0 then v_owner else v_cajero end;

    insert into public.orders
      (restaurant_id, type, status, created_by, created_at, payment_status, total)
    values (v_sede, 'takeaway', 'delivered', v_by, v_at, 'paid', 0)
    returning id into v_order;

    v_sub := 0;
    for j in 1..(1 + (k % 3)) loop
      v_idx := v_bag[1 + ((k * 11 + j * 5) % v_nb)];
      v_qty := 1 + ((k + j) % 2);

      insert into public.order_items
        (order_id, product_id, qty, unit_price, sent_to_kitchen, created_at)
      values (v_order, v_ids[v_idx], v_qty, v_prices[v_idx], false, v_at);

      v_sub := v_sub + v_prices[v_idx] * v_qty;

      if v_kinds[v_idx] = 'simple' and v_track[v_idx] then
        insert into public.stock_movements
          (restaurant_id, product_id, qty, type, reference_id, created_by, created_at)
        values (v_sede, v_ids[v_idx], -v_qty, 'sale', v_order, v_by, v_at);
      elsif v_kinds[v_idx] = 'composite' then
        insert into public.stock_movements
          (restaurant_id, product_id, qty, type, reference_id, created_by, created_at)
        select v_sede, pc.component_id, -(v_qty * pc.qty), 'sale', v_order, v_by, v_at
          from public.product_components pc
          join public.products p on p.id = pc.component_id
         where pc.parent_id = v_ids[v_idx] and p.stock_tracking;
      end if;
    end loop;

    update public.orders set total = v_sub, order_number = v_seq where id = v_order;

    insert into public.payments (restaurant_id, order_id, method, amount, created_at)
    values (v_sede, v_order,
            (case k % 4 when 0 then 'cash' when 1 then 'nequi'
                        when 2 then 'card' else 'cash' end)::public.payment_method,
            v_sub, v_at + (now() - v_at) * 0.5);
  end loop;

  -- ========================================================
  -- 3.3 — Cartera de fiado (un solo cliente corporativo)
  -- ========================================================
  -- (a) Consumo del mes pasado, con ABONO parcial → saldo vivo.
  v_seq := v_seq + 1;
  v_at  := now() - interval '9 days';
  insert into public.orders
    (restaurant_id, type, status, created_by, created_at, payment_status,
     total, order_number, customer_id, customer_name)
  values (v_sede, 'takeaway', 'delivered', v_owner, v_at, 'partial',
          192000, v_seq, v_cust, 'Nova Group (oficina 402)')
  returning id into v_order;

  insert into public.order_items (order_id, product_id, qty, unit_price, created_at)
  select v_order, p.id, 12, p.price, v_at
    from public.products p where p.restaurant_id = v_sede and p.name = 'Americano 12 oz'
  union all
  select v_order, p.id, 12, p.price, v_at
    from public.products p where p.restaurant_id = v_sede and p.name = 'Croissant jamón y queso';

  insert into public.debt_payments
    (restaurant_id, order_id, amount, payment_method, created_by, created_at)
  values (v_sede, v_order, 100000, 'transfer', v_cajero, v_at + interval '4 days');

  -- (b) Consumo reciente, PENDIENTE completo.
  v_seq := v_seq + 1;
  v_at  := now() - interval '2 days';
  insert into public.orders
    (restaurant_id, type, status, created_by, created_at, payment_status,
     total, order_number, customer_id, customer_name)
  values (v_sede, 'takeaway', 'delivered', v_cajero, v_at, 'pending',
          84000, v_seq, v_cust, 'Nova Group (oficina 402)')
  returning id into v_order;

  insert into public.order_items (order_id, product_id, qty, unit_price, created_at)
  select v_order, p.id, 8, p.price, v_at
    from public.products p where p.restaurant_id = v_sede and p.name = 'Latte 16 oz';

  -- ========================================================
  -- 3.4 — Correlativo de la sede al día
  -- ========================================================
  insert into public.store_sequences (restaurant_id, last_order_number)
  values (v_sede, v_seq)
  on conflict (restaurant_id) do update set last_order_number = excluded.last_order_number;

  -- ========================================================
  -- 3.5 — INVENTARIO COHERENTE
  --
  -- El invariante que sostiene la pantalla de Inventario es
  -- `stock_qty = suma de todos los movimientos`. Si no se cumple, Niveles y
  -- Movimientos cuentan historias distintas y el dueño lo nota apenas suma dos
  -- filas. Las ventas de arriba ya emitieron sus movimientos negativos; acá se
  -- emiten las ENTRADAS, con dos patrones según el tipo de producto:
  --
  --   PERECEDEROS (los que tienen `bake`): se hornean CADA MAÑANA y lo que
  --   sobra se da de baja CADA NOCHE. Es literalmente la operación de una
  --   cafetería, y de paso resuelve un problema de magnitud: una compra
  --   inicial única de 700 pan de bono fechada hace un mes sería absurda en la
  --   pestaña Movimientos, que es una pantalla de la demo.
  --
  --   NO PERECEDEROS (leches, shots, agua, gaseosa): UNA compra inicial, que
  --   es como se compran de verdad (por caja). Tamaño = objetivo + lo vendido.
  -- ========================================================

  -- (a) Perecederos: horneo diario + merma nocturna.
  for r in select * from _menu where bake is not null order by name loop
    for d in reverse v_dias..1 loop
      v_open_at  := ((v_today - d)::timestamp + make_interval(hours => v_ha, mins => v_ma))
                      at time zone 'America/Bogota';
      v_close_at := ((v_today - d)::timestamp + make_interval(hours => v_hc, mins => v_mc))
                      at time zone 'America/Bogota';

      -- Lo que ese día se vendió de ese producto.
      select coalesce(-sum(sm.qty), 0) into v_sold
        from public.stock_movements sm
        join public.products p on p.id = sm.product_id
       where p.restaurant_id = v_sede and p.name = r.name and sm.type = 'sale'
         and sm.created_at >= v_open_at and sm.created_at <= v_close_at;

      -- Se hornea lo del día más un excedente; a la noche el excedente se
      -- descarta. Así el stock vuelve a 0 cada madrugada, que es la verdad de
      -- una panadería, y el cuadre final no arrastra una deuda enorme.
      --
      -- 🔴 EL EXCEDENTE VARÍA, Y NO ES UN CAPRICHO. La primera versión usaba
      --    una constante (3), y eso deja la pestaña Movimientos con TODAS las
      --    filas de merma diciendo "−3": es el mismo tell que un Top Productos
      --    plano, delata datos sintéticos de un vistazo — y la merma es
      --    justamente una de las pantallas de la demo. Varía por día y por
      --    producto, y se escala con la producción para no descartar más de lo
      --    que se hornea (una torta produce 3 al día: una merma de 5 sería
      --    imposible). El `greatest(2, ...)` evita el módulo por cero de los
      --    productos de volumen bajo.
      v_surplus := 1 + ((d * 7 + r.pop * 3) % greatest(2, r.bake / 4));

      insert into public.stock_movements
        (restaurant_id, product_id, qty, type, notes, created_by, created_at)
      select v_sede, p.id, v_sold + v_surplus, 'purchase', 'Horneo del día', v_owner,
             v_open_at - interval '30 minutes'
        from public.products p
       where p.restaurant_id = v_sede and p.name = r.name and (v_sold + v_surplus) <> 0;

      -- Mismo v_surplus que el horneo: por eso las dos filas se cancelan y el
      -- stock del perecedero vuelve a cero cada noche.
      insert into public.stock_movements
        (restaurant_id, product_id, qty, type, notes, created_by, created_at)
      select v_sede, p.id, -v_surplus, 'adjustment', 'Merma del día', v_cajero,
             v_close_at - interval '10 minutes'
        from public.products p
       where p.restaurant_id = v_sede and p.name = r.name;
    end loop;
  end loop;

  -- (b) No perecederos: una compra inicial, fechada antes de la primera venta.
  for r in select * from _menu
            where track and bake is null and coalesce(target, 0) >= 0 order by name loop
    select coalesce(-sum(sm.qty), 0) into v_sold
      from public.stock_movements sm
      join public.products p on p.id = sm.product_id
     where p.restaurant_id = v_sede and p.name = r.name and sm.type = 'sale';

    -- stock_movements exige qty <> 0.
    insert into public.stock_movements
      (restaurant_id, product_id, qty, type, notes, created_by, created_at)
    select v_sede, p.id, coalesce(r.target, 0) + v_sold, 'purchase',
           'Inventario inicial', v_owner,
           ((v_today - v_dias - 1)::timestamp + interval '8 hours') at time zone 'America/Bogota'
      from public.products p
     where p.restaurant_id = v_sede and p.name = r.name
       and (coalesce(r.target, 0) + v_sold) <> 0;
  end loop;

  -- (c) Cuadre final: reposición de la mañana de HOY que deja cada producto
  -- exactamente en su objetivo. Absorbe cualquier diferencia acumulada, y se
  -- lee como lo que es —el pedido que entró hoy temprano— en vez de como un
  -- ajuste inventado. Si el saldo diera al revés (se produjo de más), sale
  -- como merma, que también es una fila legítima en una cafetería.
  for r in select * from _menu where track order by name loop
    select coalesce(r.target, 0) - coalesce(sum(sm.qty), 0) into v_delta
      from public.stock_movements sm
      join public.products p on p.id = sm.product_id
     where p.restaurant_id = v_sede and p.name = r.name;

    if v_delta <> 0 then
      insert into public.stock_movements
        (restaurant_id, product_id, qty, type, notes, created_by, created_at)
      select v_sede, p.id, v_delta,
             (case when v_delta > 0 then 'purchase' else 'adjustment' end),
             (case when v_delta > 0 then 'Reposición de barra' else 'Merma y descarte' end),
             v_owner,
             least(now() - interval '10 minutes',
                   (v_today::timestamp + make_interval(hours => v_ha, mins => v_ma + 10))
                     at time zone 'America/Bogota')
        from public.products p
       where p.restaurant_id = v_sede and p.name = r.name;
    end if;

    -- Y el stock queda igual a la suma de sus movimientos, por construcción.
    update public.products p
       set stock_qty = coalesce((select sum(sm.qty) from public.stock_movements sm
                                  where sm.product_id = p.id), 0)
     where p.restaurant_id = v_sede and p.name = r.name;
  end loop;

  raise notice 'Operación sembrada: % ventas numeradas · % turnos (% cerrados + 1 abierto).',
    v_seq, v_dias + 1, v_dias;
end $$;


-- ============================================================
-- VERIFICACIÓN (read-only) — dentro de la misma transacción.
--
-- ⚠️ Toda consulta resuelve la sede por ORGANIZACIÓN + nombre, no solo por
--    nombre. Un conteo equivocado en una salida de verificación es PEOR que no
--    tener ninguna: alguien lo lee, concluye que está bien y sigue.
-- ============================================================

select 'sede' as check, o.name as org, r.name as sede, r.uses_kitchen,
       r.address, r.phone, o.subscription_status, r.id as restaurant_id
  from public.restaurants r
  join public.organizations o on o.id = r.organization_id
 where r.id = 'd29f22aa-a6ea-4436-9d47-a0cffe5c1a61';

with sede as (
  select 'd29f22aa-a6ea-4436-9d47-a0cffe5c1a61'::uuid as id
)
select 'catálogo' as check,
  (select count(*) from public.categories c where c.restaurant_id in (select id from sede) and c.is_active) as categorias,
  (select count(*) from public.products p  where p.restaurant_id in (select id from sede) and p.is_active)  as productos,
  (select count(*) from public.products p  where p.restaurant_id in (select id from sede) and p.kind = 'composite') as compuestos,
  (select count(*) from public.extras e    where e.restaurant_id in (select id from sede) and e.is_active)  as extras,
  (select count(*) from public.extras e    where e.restaurant_id in (select id from sede) and e.linked_product_id is not null) as extras_vinculados,
  (select count(*) from public.tables t    where t.restaurant_id in (select id from sede)) as mesas_debe_ser_0;

with sede as (
  select 'd29f22aa-a6ea-4436-9d47-a0cffe5c1a61'::uuid as id
)
select 'operación' as check,
  (select count(*)            from public.orders o where o.restaurant_id in (select id from sede)) as ordenes,
  (select max(order_number)   from public.orders o where o.restaurant_id in (select id from sede)) as ultimo_numero,
  (select count(*)            from public.payments p where p.restaurant_id in (select id from sede)) as pagos,
  (select count(*) from public.cash_shifts cs where cs.restaurant_id in (select id from sede) and cs.closed_at is null)     as turnos_abiertos_debe_ser_1,
  (select count(*) from public.cash_shifts cs where cs.restaurant_id in (select id from sede) and cs.closed_at is not null) as turnos_cerrados,
  (select count(*) from public.orders o where o.restaurant_id in (select id from sede) and o.payment_status <> 'paid')      as fiados_abiertos,
  (select count(*) from public.orders o where o.restaurant_id in (select id from sede) and o.type <> 'takeaway')            as no_mostrador_debe_ser_0;

-- El turno abierto tiene que haber abierto HOY a las 06:30 de Bogotá.
select 'turno abierto' as check,
       cs.opened_at at time zone 'America/Bogota' as abrio_bogota,
       cs.opening_amount
  from public.cash_shifts cs
  join public.restaurants r   on r.id = cs.restaurant_id
  join public.organizations o on o.id = r.organization_id
 where r.id = 'd29f22aa-a6ea-4436-9d47-a0cffe5c1a61' and cs.closed_at is null;

-- 🔴 LA GRILLA QUE HAY QUE MIRAR DE VERDAD: `cuadre` debe decir OK en TODAS
--    las filas. Un solo DESCUADRE significa que Niveles y Movimientos se
--    contradicen, y esa es una pantalla de la demo.
--    Además: Pan de bono en 0 ("Agotado"), Almojábana y Torta de zanahoria
--    bajo mínimo ("Reponer"). Es el momento que le habla al dueño.
select 'inventario' as check, p.name, p.stock_qty, p.min_stock,
       (select coalesce(sum(sm.qty), 0) from public.stock_movements sm where sm.product_id = p.id) as suma_movimientos,
       case when p.stock_qty = (select coalesce(sum(sm.qty), 0) from public.stock_movements sm where sm.product_id = p.id)
            then 'OK' else 'DESCUADRE' end as cuadre,
       case when p.stock_qty <= 0 then 'AGOTADO'
            when p.stock_qty <= p.min_stock then 'REPONER'
            else 'ok' end as estado
  from public.products p
  join public.restaurants r   on r.id = p.restaurant_id
  join public.organizations o on o.id = r.organization_id
 where p.restaurant_id = 'd29f22aa-a6ea-4436-9d47-a0cffe5c1a61' and p.stock_tracking
 order by p.name;

-- Top productos: tiene que verse a café y panadería arriba. Si sale plano, la
-- bolsa ponderada no se aplicó y el reporte de la demo no va a convencer.
select 'top productos' as check, p.name, sum(oi.qty) as unidades
  from public.order_items oi
  join public.orders o        on o.id = oi.order_id
  join public.products p      on p.id = oi.product_id
  join public.restaurants r   on r.id = o.restaurant_id
  join public.organizations g on g.id = r.organization_id
 where o.restaurant_id = 'd29f22aa-a6ea-4436-9d47-a0cffe5c1a61'
 group by p.name order by unidades desc limit 10;

commit;
