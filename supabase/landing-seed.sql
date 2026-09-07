-- ============================================================
-- 🔴 ESTO NO ES UNA MIGRACIÓN. NO APLICAR EN PRODUCCIÓN.
--
-- Es una SEMILLA DE VITRINA: datos de mentira para las capturas de la landing
-- comercial. No define ni altera el esquema, y no hay ningún motivo para
-- correrlo contra la organización de un cliente real (G-10, Salchimelo,
-- Café Aroma). Está acotado a una sede de LAB por construcción y ABORTA si esa
-- organización no existe, pero la regla es previa al guard: no se ejecuta
-- fuera del laboratorio.
--
-- Se anota así de fuerte porque un `.sql` suelto dentro de `supabase/` se lee
-- como migración —todo el resto de la carpeta lo es— y en este proyecto ya
-- pasó que se aplique algo sin entender del todo qué hacía.
-- ============================================================

-- ============================================================
-- G-Vento — SEMILLA DE VITRINA ("Bar La Ronda", organización LAB)
--
-- QUÉ HACE
-- Deja el POS en el estado EXACTO que retratan las 5 capturas de la landing.
-- Los montos no son decorativos: el texto de la landing los menciona, así que
-- se fijan a mano y se VERIFICAN al final (PARTE 4). Si la aritmética no da,
-- este archivo lanza excepción y hace rollback — antes que producir una captura
-- con un número equivocado.
--
--   turno abierto        base 200.000 · ventas 1.847.000 · esperado en caja 962.000
--   mesa 7 abierta       157.000 en dos rondas
--   fiado Wílmer Ospina  saldo 154.000 · 62.000 de hoy · último abono hace 11 días
--
-- ── DÓNDE VIVE Y POR QUÉ ────────────────────────────────────────────────────
-- Sede NUEVA ("Bar La Ronda") dentro de la organización LAB. Tres motivos, los
-- dos primeros heredados de demo-seed.sql:
--   1. CREDIBILIDAD: el sidebar muestra `restaurants.name`, no la organización
--      (ver AppLayout → brandName). Una sede con nombre comercial no delata el
--      laboratorio en la captura; "Sede Lab Norte" sí.
--   2. AISLAMIENTO: no toca "Sede Lab Norte", que es la sede de trabajo de casi
--      toda la suite E2E. Meterle catálogo nuevo contamina el default del
--      ProductPicker (a lab-seed.sql ya le costó una tarde ese residuo).
--   3. Tampoco toca "Sede Demo" (demo-seed.sql): esa es la demo comercial en
--      vivo, con 14 días de ventas generadas. Acá los números son fijos y
--      chicos porque tienen que coincidir con un texto, no parecer un negocio.
--
-- ⚠️  BD ÚNICA COMPARTIDA: LAB, G-10, Salchimelo y Café Aroma son
--     ORGANIZACIONES de una sola base. TODO INSERT/UPDATE/DELETE de este archivo
--     está acotado por `restaurant_id = v_sede`, y v_sede se resuelve UNA vez
--     desde la organización LAB y de ahí en adelante se usa como UUID. Si la org
--     LAB no existe, aborta (fail-closed). Ninguna sentencia puede alcanzar
--     datos de un cliente.
--
-- ── SIN DATOS PERSONALES ────────────────────────────────────────────────────
-- "Marcela", "Wílmer Ospina" y "Andrés" son personajes. `customers.document` y
-- `customers.phone` quedan en NULL A PROPÓSITO: la ficha de fiado los muestra
-- si existen, y una cédula o un teléfono —aunque sea inventado— no tiene por
-- qué salir en una pieza de marketing.
--
-- ── PRECONDICIONES ──────────────────────────────────────────────────────────
--   1. supabase/lab-seed.sql corrido al menos una vez (necesita la org LAB y
--      los profiles owner.test / cajero.test para poblar created_by).
--   2. Las migraciones de inventario/numeración/fiado/cocina aplicadas (este
--      archivo usa products.kind, products.routes_to_kitchen,
--      orders.payment_status, orders.order_number, orders.waiter_name,
--      customers y debt_payments).
--
-- ── MODO DE FALLO AL RE-APLICAR: IDEMPOTENTE ────────────────────────────────
-- Lo transaccional de la sede se purga al inicio y el catálogo se busca por
-- nombre. Correrlo N veces deja exactamente el mismo escenario. Los timestamps
-- son RELATIVOS a now(), así que el escenario nunca queda fechado en el futuro
-- (que es lo que pasaría clavando "hoy 22:45": corrido a las 10 a.m., la mesa
-- diría que se abrió dentro de 12 horas).
--
-- ── NO DEDUZCAS EL ESTADO DE ESTE COMENTARIO — correlo: ─────────────────────
--   select r.name, count(o.id) as ordenes
--     from public.restaurants r
--     left join public.orders o on o.restaurant_id = r.id
--    where r.name = 'Bar La Ronda'
--    group by r.name;
--
-- ── ORDEN RESPECTO A lab-seed.sql ───────────────────────────────────────────
-- lab-seed.sql purga lo transaccional de TODAS las sedes de LAB, incluida esta,
-- y además reescribe `profiles.full_name` de owner.test. Si lo corrés después,
-- el escenario y el nombre "Marcela" se van: volvé a correr ESTE archivo.
--
-- ── DÓNDE SE EJECUTA ────────────────────────────────────────────────────────
-- 🟢 CAMINO NORMAL: `pnpm capturas:preparar`, que lo aplica al Supabase LOCAL
--    de Docker sobre una base reconstruida desde cero. Es el único camino que
--    hace falta para generar las capturas, y no toca nada de la nube.
--
-- 🟡 Contra la base compartida (Dashboard > SQL Editor) también funciona, pero
--    ahí SÍ tiene efectos que sobreviven: mueve la sede activa de owner.test y
--    le cambia el full_name (ver la advertencia en la PARTE 1) y deja una sede
--    más en LAB. Solo vale la pena si querés ver el escenario desde la app
--    desplegada. Para las capturas, no hace falta.
-- ============================================================

begin;

-- ============================================================
-- PARTE 1 — Sede, accesos, identidad de la cajera y purga
-- ============================================================

do $$
declare
  v_org    uuid;
  v_sede   uuid;
  v_owner  uuid;
  v_cajero uuid;
  v_n      bigint;
begin
  -- ── Guardas fail-closed: sin org LAB o sin profiles del lab, no se toca nada
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

  -- ── Sede "Bar La Ronda" ──────────────────────────────────────────────────
  select id into v_sede
    from public.restaurants
   where organization_id = v_org and name = 'Bar La Ronda' limit 1;

  if v_sede is null then
    insert into public.restaurants (organization_id, name, address, phone)
    values (v_org, 'Bar La Ronda', 'Calle 10 # 40-22', null)
    returning id into v_sede;
  end if;

  -- Baseline reescrito en cada corrida (revierte cualquier deriva).
  update public.restaurants
     set uses_kitchen = true,
         address      = 'Calle 10 # 40-22',
         phone        = null,
         config       = coalesce(config, '{}'::jsonb) || jsonb_build_object(
           'cash_out_reasons', jsonb_build_array(
             'Compra de insumos', 'Pago a proveedor', 'Retiro de caja', 'Otro'),
           'payment_methods', jsonb_build_array('cash', 'card', 'transfer', 'nequi')
         )
   where id = v_sede;

  -- ── Acceso de los usuarios del lab a la sede de vitrina ──────────────────
  insert into public.user_stores (user_id, restaurant_id)
  values (v_owner, v_sede), (v_cajero, v_sede)
  on conflict (user_id, restaurant_id) do nothing;

  -- ── Identidad visible en la captura ──────────────────────────────────────
  -- ⚠️ EFECTO FUERA DE ESTA SEDE: estas dos líneas tocan el profile de
  --    owner.test, que la suite E2E también usa.
  --      · full_name  → el header muestra "Marcela". Ningún test asserta un
  --        nombre concreto (rbac-escalada.spec.ts lo snapshotea y lo restaura),
  --        así que es seguro, pero es un cambio real y por eso se dice acá.
  --      · restaurant_id → cambia la SEDE ACTIVA de owner.test. La suite E2E
  --        espera "Sede Lab Norte". Al final del archivo hay una consulta
  --        comentada para devolverla; desde la UI, el selector de sede del
  --        header hace lo mismo.
  update public.profiles
     set full_name     = 'Marcela',
         restaurant_id = v_sede
   where id = v_owner;

  -- ========================================================
  -- PURGA de lo transaccional SOLO de la sede de vitrina.
  -- Acotado por restaurant_id = v_sede (una sola sede, dentro de LAB).
  -- R0: se CUENTA antes de borrar, y el conteo se imprime.
  -- El orden respeta las FK: hijos antes que padres.
  -- ========================================================
  select count(*) into v_n from public.orders where restaurant_id = v_sede;
  raise notice 'Purga de "Bar La Ronda" (%): % órdenes previas.', v_sede, v_n;

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

  update public.tables set status = 'free' where restaurant_id = v_sede;

  raise notice 'Sede "Bar La Ronda" lista. Escenario anterior purgado.';
end $$;


-- ============================================================
-- PARTE 2 — Catálogo: categorías, productos y mesas
--
-- stock_tracking = false en TODO el catálogo, a propósito: sin tracking no hay
-- invariante `stock_qty = suma de movimientos` que mantener, y ninguna de las 5
-- capturas es de Inventario. demo-seed.sql sí lo mantiene porque ahí Inventario
-- es una de las pantallas que se muestran; acá sería complejidad sin uso.
-- ============================================================

do $$
declare
  v_org  uuid;
  v_sede uuid;

  v_cat_cocteles uuid;
  v_cat_cervezas uuid;
  v_cat_licores  uuid;
  v_cat_picadas  uuid;

  -- name, price, categoría, va a cocina
  v_menu jsonb := '[
    ["Old Fashioned",  28000, "cocteles", false],
    ["Gin Tonic",      26000, "cocteles", false],
    ["Mojito",         24000, "cocteles", false],
    ["Michelada",      12000, "cervezas", false],
    ["Club Colombia",   9000, "cervezas", false],
    ["Corona",         10000, "cervezas", false],
    ["Aguardiente",     9000, "licores",  false],
    ["Picada mixta",   38000, "picadas",  true],
    ["Alitas BBQ",     32000, "picadas",  true],
    ["Papas rústicas", 16000, "picadas",  true]
  ]'::jsonb;

  v_row  jsonb;
  v_cat  uuid;
  v_pid  uuid;
  i      integer;
begin
  select id into v_org from public.organizations where name = 'LAB' limit 1;
  select id into v_sede from public.restaurants
   where organization_id = v_org and name = 'Bar La Ronda' limit 1;
  if v_sede is null then
    raise exception 'No se resolvió la sede "Bar La Ronda". ¿Falló la PARTE 1?';
  end if;

  -- ── Categorías (identidad por nombre + sede: no hay unique) ──────────────
  select id into v_cat_cocteles from public.categories
   where restaurant_id = v_sede and name = 'Cocteles' limit 1;
  if v_cat_cocteles is null then
    insert into public.categories (restaurant_id, name, sort_order, color)
    values (v_sede, 'Cocteles', 1, '#8b5cf6') returning id into v_cat_cocteles;
  end if;

  select id into v_cat_cervezas from public.categories
   where restaurant_id = v_sede and name = 'Cervezas' limit 1;
  if v_cat_cervezas is null then
    insert into public.categories (restaurant_id, name, sort_order, color)
    values (v_sede, 'Cervezas', 2, '#f59e0b') returning id into v_cat_cervezas;
  end if;

  select id into v_cat_licores from public.categories
   where restaurant_id = v_sede and name = 'Licores' limit 1;
  if v_cat_licores is null then
    insert into public.categories (restaurant_id, name, sort_order, color)
    values (v_sede, 'Licores', 3, '#ef4444') returning id into v_cat_licores;
  end if;

  select id into v_cat_picadas from public.categories
   where restaurant_id = v_sede and name = 'Picadas' limit 1;
  if v_cat_picadas is null then
    insert into public.categories (restaurant_id, name, sort_order, color)
    values (v_sede, 'Picadas', 4, '#10b981') returning id into v_cat_picadas;
  end if;

  -- ── Productos ────────────────────────────────────────────────────────────
  for v_row in select * from jsonb_array_elements(v_menu) loop
    v_cat := case v_row->>2
               when 'cocteles' then v_cat_cocteles
               when 'cervezas' then v_cat_cervezas
               when 'licores'  then v_cat_licores
               else v_cat_picadas
             end;

    select id into v_pid from public.products
     where restaurant_id = v_sede and name = v_row->>0 limit 1;

    if v_pid is null then
      insert into public.products
        (restaurant_id, category_id, name, price, kind, stock_tracking)
      values (v_sede, v_cat, v_row->>0, (v_row->>1)::numeric, 'simple', false);
    else
      -- El precio es parte del contrato con el texto de la landing: se
      -- REESCRIBE en cada corrida, no se confía en lo que haya quedado.
      update public.products
         set price            = (v_row->>1)::numeric,
             category_id      = v_cat,
             is_active        = true,
             routes_to_kitchen = (v_row->>3)::boolean
       where id = v_pid;
    end if;

    update public.products
       set routes_to_kitchen = (v_row->>3)::boolean
     where restaurant_id = v_sede and name = v_row->>0;
  end loop;

  -- ── Mesas 1..10 (la 7 es la protagonista de la captura) ──────────────────
  for i in 1..10 loop
    if not exists (
      select 1 from public.tables where restaurant_id = v_sede and name = 'Mesa ' || i
    ) then
      insert into public.tables (restaurant_id, name, capacity)
      values (v_sede, 'Mesa ' || i, case when i % 3 = 0 then 6 else 4 end);
    end if;
  end loop;

  raise notice 'Catálogo y mesas de "Bar La Ronda" al día.';
end $$;


-- ============================================================
-- PARTE 3 — El escenario de las capturas
-- ============================================================

do $$
declare
  v_org    uuid;
  v_sede   uuid;
  v_owner  uuid;
  v_cajero uuid;

  v_shift  uuid;
  v_order  uuid;
  v_cust   uuid;
  v_table  uuid;

  v_at     timestamptz;
  v_opened timestamptz;
  v_sub    numeric;
  v_seq    integer := 0;

  v_spec   jsonb;
  v_line   jsonb;
  v_pid    uuid;
  v_price  numeric;
  v_qty    integer;

  -- ── VENTAS DEL TURNO ─────────────────────────────────────────────────────
  -- Cada entrada es UNA venta cobrada: método + líneas [producto, cantidad].
  -- Las cantidades están elegidas para que los subtotales den EXACTO:
  --   efectivo      120+96+148+74+132+88+104 =   762.000
  --   tarjeta       216+168+160+156          =   700.000
  --   transferencia 144+141                  =   285.000
  --   nequi         100                      =   100.000
  --                                   total  = 1.847.000
  -- Esperado en caja = base 200.000 + efectivo 762.000 = 962.000.
  -- La PARTE 4 vuelve a sumarlo desde la BD y aborta si no coincide: esta
  -- tabla es la intención, la verificación es la prueba.
  v_ventas jsonb := '[
    {"m":"cash",     "lines":[["Mojito",2],["Alitas BBQ",1],["Corona",4]]},
    {"m":"cash",     "lines":[["Alitas BBQ",2],["Corona",2],["Michelada",1]]},
    {"m":"cash",     "lines":[["Picada mixta",2],["Mojito",3]]},
    {"m":"cash",     "lines":[["Picada mixta",1],["Aguardiente",4]]},
    {"m":"cash",     "lines":[["Old Fashioned",3],["Papas rústicas",3]]},
    {"m":"cash",     "lines":[["Alitas BBQ",1],["Old Fashioned",2]]},
    {"m":"cash",     "lines":[["Corona",4],["Alitas BBQ",2]]},
    {"m":"card",     "lines":[["Picada mixta",2],["Old Fashioned",5]]},
    {"m":"card",     "lines":[["Alitas BBQ",3],["Mojito",3]]},
    {"m":"card",     "lines":[["Gin Tonic",4],["Papas rústicas",2],["Michelada",2]]},
    {"m":"card",     "lines":[["Old Fashioned",3],["Papas rústicas",3],["Michelada",2]]},
    {"m":"transfer", "lines":[["Alitas BBQ",3],["Papas rústicas",3]]},
    {"m":"transfer", "lines":[["Picada mixta",3],["Aguardiente",3]]},
    {"m":"nequi",    "lines":[["Alitas BBQ",2],["Club Colombia",4]]}
  ]'::jsonb;
begin
  select id into v_org from public.organizations where name = 'LAB' limit 1;
  select id into v_sede from public.restaurants
   where organization_id = v_org and name = 'Bar La Ronda' limit 1;
  select id into v_owner  from public.profiles
   where email = 'owner.test@gvento.com'  and organization_id = v_org limit 1;
  select id into v_cajero from public.profiles
   where email = 'cajero.test@gvento.com' and organization_id = v_org limit 1;

  if v_sede is null or v_owner is null then
    raise exception 'Sede o profile no resueltos. ¿Falló la PARTE 1?';
  end if;

  -- ========================================================
  -- 3.1 — Turno ABIERTO, base 200.000, abierto por Marcela
  --
  -- Timestamps RELATIVOS: el turno arrancó hace 6 horas y las ventas caen
  -- dentro de esa ventana. Importa porque salesSummary NO se agrupa por
  -- shift_id: useCashShift llama a getShiftPayments(restaurant, opened_at) y
  -- suma los pagos por VENTANA DE TIEMPO. Un pago fechado antes de opened_at
  -- no entra al arqueo — el turno se siembra primero por eso.
  -- ========================================================
  v_opened := now() - interval '6 hours';

  insert into public.cash_shifts (restaurant_id, opened_by, opening_amount, opened_at)
  values (v_sede, v_owner, 200000, v_opened)
  returning id into v_shift;

  -- ========================================================
  -- 3.2 — Las 14 ventas cobradas del turno
  -- ========================================================
  for v_spec in select * from jsonb_array_elements(v_ventas) loop
    v_seq := v_seq + 1;
    -- Repartidas por la ventana del turno, sin random(): determinista.
    v_at  := v_opened + make_interval(mins => 17 * v_seq + 6);

    insert into public.orders
      (restaurant_id, type, status, created_by, created_at,
       payment_status, total, order_number)
    values (v_sede, 'takeaway', 'delivered',
            case when v_seq % 3 = 0 then v_owner else v_cajero end,
            v_at, 'paid', 0, v_seq)
    returning id into v_order;

    v_sub := 0;
    for v_line in select * from jsonb_array_elements(v_spec->'lines') loop
      select id, price into v_pid, v_price
        from public.products
       where restaurant_id = v_sede and name = v_line->>0 limit 1;

      if v_pid is null then
        raise exception 'Producto "%" no existe en la sede de vitrina.', v_line->>0;
      end if;

      v_qty := (v_line->>1)::integer;

      insert into public.order_items
        (order_id, product_id, qty, unit_price, sent_to_kitchen, created_at)
      values (v_order, v_pid, v_qty, v_price, true, v_at);

      v_sub := v_sub + v_price * v_qty;
    end loop;

    update public.orders set total = v_sub where id = v_order;

    insert into public.payments (restaurant_id, order_id, method, amount, created_at)
    values (v_sede, v_order, (v_spec->>'m')::public.payment_method,
            v_sub, v_at + interval '3 minutes');
  end loop;

  -- ========================================================
  -- 3.3 — Mesa 7: la cuenta abierta de 157.000, en dos rondas
  --
  -- La UI NO tiene concepto de "ronda": el panel lista los ítems planos, sin
  -- hora por línea (ver TablesPage → data-testid="table-item"). Lo más cerca
  -- que llega es sent_to_kitchen, que marca la ronda 1 como "En cocina". Las
  -- dos marcas de tiempo se siembran igual porque son el dato honesto, aunque
  -- hoy ninguna pantalla las muestre.
  -- ========================================================
  select id into v_table from public.tables
   where restaurant_id = v_sede and name = 'Mesa 7' limit 1;

  v_at := now() - interval '95 minutes';   -- ronda 1

  insert into public.orders
    (restaurant_id, type, status, table_id, created_by, created_at,
     payment_status, total, waiter_name)
  values (v_sede, 'dine_in', 'preparing', v_table, v_cajero, v_at,
          'paid', 0, 'Andrés')
  returning id into v_order;

  -- Ronda 1 — 56.000 + 38.000 + 27.000 = 121.000 (ya despachada a cocina)
  insert into public.order_items
    (order_id, product_id, qty, unit_price, sent_to_kitchen, created_at)
  select v_order, p.id, x.qty, p.price, true, v_at
    from (values ('Old Fashioned', 2), ('Picada mixta', 1), ('Club Colombia', 3))
         as x(nombre, qty)
    join public.products p on p.restaurant_id = v_sede and p.name = x.nombre;

  -- Ronda 2 — 4 × Aguardiente = 36.000 (recién pedida, sin mandar a cocina)
  v_at := now() - interval '20 minutes';
  insert into public.order_items
    (order_id, product_id, qty, unit_price, sent_to_kitchen, created_at)
  select v_order, p.id, 4, p.price, false, v_at
    from public.products p
   where p.restaurant_id = v_sede and p.name = 'Aguardiente';

  update public.orders o
     set total = (select coalesce(sum(oi.qty * oi.unit_price), 0)
                    from public.order_items oi where oi.order_id = o.id)
   where o.id = v_order;

  update public.tables set status = 'occupied' where id = v_table;

  -- ========================================================
  -- 3.4 — Otras dos mesas ocupadas (un bar con 1 de 10 mesas parece cerrado).
  --       Sin cobrar ⇒ no generan pagos ⇒ no alteran el arqueo del turno.
  -- ========================================================
  for v_spec in
    select * from jsonb_array_elements('[
      {"mesa":"Mesa 2","mozo":"Andrés","lines":[["Corona",3],["Papas rústicas",1]]},
      {"mesa":"Mesa 5","mozo":"Valeria","lines":[["Gin Tonic",2],["Alitas BBQ",1]]}
    ]'::jsonb)
  loop
    select id into v_table from public.tables
     where restaurant_id = v_sede and name = v_spec->>'mesa' limit 1;

    v_at := now() - interval '40 minutes';

    insert into public.orders
      (restaurant_id, type, status, table_id, created_by, created_at,
       payment_status, total, waiter_name)
    values (v_sede, 'dine_in', 'preparing', v_table, v_cajero, v_at,
            'paid', 0, v_spec->>'mozo')
    returning id into v_order;

    v_sub := 0;
    for v_line in select * from jsonb_array_elements(v_spec->'lines') loop
      select id, price into v_pid, v_price
        from public.products
       where restaurant_id = v_sede and name = v_line->>0 limit 1;
      v_qty := (v_line->>1)::integer;

      insert into public.order_items
        (order_id, product_id, qty, unit_price, sent_to_kitchen, created_at)
      values (v_order, v_pid, v_qty, v_price, true, v_at);

      v_sub := v_sub + v_price * v_qty;
    end loop;

    update public.orders set total = v_sub where id = v_order;
    update public.tables  set status = 'occupied' where id = v_table;
  end loop;

  -- ========================================================
  -- 3.5 — Fiado de Wílmer Ospina: saldo 154.000
  --
  --   (a) hoy          62.000 pendiente, sin abonos      → saldo  62.000
  --   (b) hace 20 días 180.000 con un abono de 88.000    → saldo  92.000
  --                                                        total 154.000
  --   El abono se fecha hace 11 días → "último abono hace 11 días".
  --
  -- Sin document ni phone: la ficha los mostraría, y no van a una landing.
  -- Estas ventas NO generan `payments` (un fiado no mete plata a la caja),
  -- así que no tocan el arqueo del turno. El abono tampoco: es de hace 11
  -- días, fuera de la ventana del turno.
  -- ========================================================
  insert into public.customers (restaurant_id, name, phone, document, notes)
  values (v_sede, 'Wílmer Ospina', null, null, null)
  returning id into v_cust;

  -- (a) Consumo de hoy — 1 × Alitas BBQ (32.000) + 3 × Corona (30.000)
  v_seq := v_seq + 1;
  v_at  := now() - interval '3 hours';
  insert into public.orders
    (restaurant_id, type, status, created_by, created_at, payment_status,
     total, order_number, customer_id, customer_name)
  values (v_sede, 'takeaway', 'delivered', v_cajero, v_at, 'pending',
          62000, v_seq, v_cust, 'Wílmer Ospina')
  returning id into v_order;

  insert into public.order_items
    (order_id, product_id, qty, unit_price, sent_to_kitchen, created_at)
  select v_order, p.id, x.qty, p.price, true, v_at
    from (values ('Alitas BBQ', 1), ('Corona', 3)) as x(nombre, qty)
    join public.products p on p.restaurant_id = v_sede and p.name = x.nombre;

  -- (b) Deuda vieja con abono parcial — 3 × Alitas (96.000) + 3 × Old F. (84.000)
  v_seq := v_seq + 1;
  v_at  := now() - interval '20 days';
  insert into public.orders
    (restaurant_id, type, status, created_by, created_at, payment_status,
     total, order_number, customer_id, customer_name)
  values (v_sede, 'takeaway', 'delivered', v_cajero, v_at, 'partial',
          180000, v_seq, v_cust, 'Wílmer Ospina')
  returning id into v_order;

  insert into public.order_items
    (order_id, product_id, qty, unit_price, sent_to_kitchen, created_at)
  select v_order, p.id, 3, p.price, true, v_at
    from public.products p
   where p.restaurant_id = v_sede and p.name in ('Alitas BBQ', 'Old Fashioned');

  insert into public.debt_payments
    (restaurant_id, order_id, amount, payment_method, created_by, created_at)
  values (v_sede, v_order, 88000, 'transfer', v_cajero, now() - interval '11 days');

  -- ========================================================
  -- 3.6 — Correlativo de la sede al día
  -- ========================================================
  insert into public.store_sequences (restaurant_id, last_order_number)
  values (v_sede, v_seq)
  on conflict (restaurant_id) do update set last_order_number = excluded.last_order_number;

  raise notice 'Escenario sembrado: % ventas numeradas, mesa 7 abierta, fiado listo.', v_seq;
end $$;


-- ============================================================
-- PARTE 4 — VERIFICACIÓN FAIL-CLOSED
--
-- Por qué existe: la landing pone estos números al lado de la captura. Un seed
-- que "corre bien" pero deja 1.846.000 produce una captura creíble y
-- equivocada — el perfil exacto de fallo silencioso que este proyecto paga
-- caro (R7). Así que los montos se vuelven a leer DESDE LA BD y, si alguno no
-- coincide, se lanza excepción: el `begin` de arriba hace rollback y no queda
-- nada a medias.
--
-- Verifica contra la cosa real (R4): suma `payments` con la MISMA ventana que
-- usa la app (getShiftPayments desde opened_at), no contra la tabla de arriba.
-- ============================================================

do $$
declare
  v_org     uuid;
  v_sede    uuid;
  v_opened  timestamptz;
  v_base    numeric;
  v_cash    numeric;
  v_card    numeric;
  v_trans   numeric;
  v_nequi   numeric;
  v_total   numeric;
  v_esperado numeric;
  v_mesa7   numeric;
  v_saldo   numeric;
  v_hoy     numeric;
  v_abono   date;
begin
  select id into v_org  from public.organizations where name = 'LAB' limit 1;
  select id into v_sede from public.restaurants
   where organization_id = v_org and name = 'Bar La Ronda' limit 1;

  select opened_at, opening_amount into v_opened, v_base
    from public.cash_shifts
   where restaurant_id = v_sede and closed_at is null
   order by opened_at desc limit 1;

  if v_opened is null then
    raise exception 'VERIFICACIÓN: no quedó ningún turno abierto en la sede de vitrina.';
  end if;

  select coalesce(sum(amount) filter (where method = 'cash'),     0),
         coalesce(sum(amount) filter (where method = 'card'),     0),
         coalesce(sum(amount) filter (where method = 'transfer'), 0),
         coalesce(sum(amount) filter (where method = 'nequi'),    0),
         coalesce(sum(amount), 0)
    into v_cash, v_card, v_trans, v_nequi, v_total
    from public.payments
   where restaurant_id = v_sede and created_at >= v_opened;

  v_esperado := v_base + v_cash;

  if v_base <> 200000 then
    raise exception 'VERIFICACIÓN base de caja: se esperaba 200000, hay %.', v_base;
  end if;
  if v_total <> 1847000 then
    raise exception 'VERIFICACIÓN ventas del turno: se esperaba 1847000, hay %.', v_total;
  end if;
  if v_cash <> 762000 then
    raise exception 'VERIFICACIÓN ventas en efectivo: se esperaba 762000, hay %.', v_cash;
  end if;
  if v_esperado <> 962000 then
    raise exception 'VERIFICACIÓN esperado en caja: se esperaba 962000, da %.', v_esperado;
  end if;
  if v_card <> 700000 or v_trans <> 285000 or v_nequi <> 100000 then
    raise exception
      'VERIFICACIÓN otros métodos: tarjeta % / transferencia % / nequi % (esperado 700000/285000/100000).',
      v_card, v_trans, v_nequi;
  end if;

  -- Mesa 7 — total de la cuenta abierta
  select o.total into v_mesa7
    from public.orders o
    join public.tables t on t.id = o.table_id
   where o.restaurant_id = v_sede and t.name = 'Mesa 7' and o.payment_status = 'paid'
     and o.status <> 'cancelled'
   order by o.created_at desc limit 1;

  if v_mesa7 is distinct from 157000 then
    raise exception 'VERIFICACIÓN mesa 7: se esperaba 157000, hay %.', v_mesa7;
  end if;

  -- Fiado de Wílmer — saldo total, consumo de hoy y fecha del último abono
  select coalesce(sum(o.total - coalesce(ab.pagado, 0)), 0)
    into v_saldo
    from public.orders o
    join public.customers c on c.id = o.customer_id
    left join lateral (
      select sum(dp.amount) as pagado
        from public.debt_payments dp where dp.order_id = o.id
    ) ab on true
   where o.restaurant_id = v_sede and c.name = 'Wílmer Ospina'
     and o.payment_status in ('pending', 'partial');

  select coalesce(sum(o.total), 0) into v_hoy
    from public.orders o
    join public.customers c on c.id = o.customer_id
   where o.restaurant_id = v_sede and c.name = 'Wílmer Ospina'
     and o.payment_status in ('pending', 'partial')
     and (o.created_at at time zone 'America/Bogota')::date
         = (now() at time zone 'America/Bogota')::date;

  select max((dp.created_at at time zone 'America/Bogota')::date) into v_abono
    from public.debt_payments dp
    join public.orders o     on o.id = dp.order_id
    join public.customers c  on c.id = o.customer_id
   where dp.restaurant_id = v_sede and c.name = 'Wílmer Ospina';

  if v_saldo <> 154000 then
    raise exception 'VERIFICACIÓN saldo de fiado: se esperaba 154000, hay %.', v_saldo;
  end if;
  if v_hoy <> 62000 then
    raise exception 'VERIFICACIÓN consumo de hoy: se esperaba 62000, hay %.', v_hoy;
  end if;
  if v_abono <> ((now() at time zone 'America/Bogota')::date - 11) then
    raise exception 'VERIFICACIÓN último abono: se esperaba hace 11 días, quedó en %.', v_abono;
  end if;

  raise notice '✅ Los 5 escenarios cuadran contra la BD.';
  raise notice '   turno: base % · ventas % · esperado en caja %', v_base, v_total, v_esperado;
  raise notice '   mesa 7: % · fiado Wílmer: saldo % (hoy %)', v_mesa7, v_saldo, v_hoy;
end $$;

commit;


-- ============================================================
-- VERIFICACIÓN (read-only) — para mirar a ojo después del commit
-- ============================================================

select 'sede' as check, r.name as sede, o.name as org, r.uses_kitchen
  from public.restaurants r
  join public.organizations o on o.id = r.organization_id
 where r.name = 'Bar La Ronda';

select 'turno' as check, cs.opening_amount, cs.opened_at, p.full_name as abrio
  from public.cash_shifts cs
  join public.profiles p on p.id = cs.opened_by
  join public.restaurants r on r.id = cs.restaurant_id
 where r.name = 'Bar La Ronda' and cs.closed_at is null;

select 'ventas del turno' as check, pay.method, sum(pay.amount) as total
  from public.payments pay
  join public.restaurants r on r.id = pay.restaurant_id
 where r.name = 'Bar La Ronda'
 group by pay.method
 order by pay.method;

select 'mesa 7' as check, pr.name as producto, oi.qty, oi.unit_price,
       oi.sent_to_kitchen, oi.created_at
  from public.order_items oi
  join public.orders o   on o.id = oi.order_id
  join public.tables t   on t.id = o.table_id
  join public.products pr on pr.id = oi.product_id
  join public.restaurants r on r.id = o.restaurant_id
 where r.name = 'Bar La Ronda' and t.name = 'Mesa 7'
 order by oi.created_at, pr.name;


-- ============================================================
-- 🔙 VOLVER AL LABORATORIO — devolver owner.test a Sede Lab Norte
--
-- La suite E2E espera que owner.test tenga "Sede Lab Norte" como sede activa.
-- Este bloque NO se ejecuta solo (está comentado): descomentalo y correlo
-- cuando termines las capturas, o cambiá de sede desde el selector del header.
-- El full_name vuelve a su valor en la próxima corrida de lab-seed.sql.
-- ============================================================
-- update public.profiles p
--    set restaurant_id = r.id
--   from public.restaurants r
--   join public.organizations o on o.id = r.organization_id
--  where p.email = 'owner.test@gvento.com'
--    and o.name = 'LAB'
--    and r.name = 'Sede Lab Norte'
--    and p.organization_id = o.id;
