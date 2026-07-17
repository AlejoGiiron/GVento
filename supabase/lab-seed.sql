-- ============================================================
-- G-Vento — Semilla del LABORATORIO de pruebas E2E
--
-- Crea un ecosistema de pruebas AISLADO de los datos reales (org "G-10")
-- reutilizando la arquitectura multi-tenant existente: una organización
-- "LAB" con sus propias sedes, roles, usuarios y datos mínimos. Los tests
-- E2E corren contra esta org, NUNCA contra G-10.
--
-- IDEMPOTENTE: se puede ejecutar más de una vez sin duplicar. Identidad por
-- NOMBRE (no hay unique en organizations/restaurants/categories/products/
-- extras/tables) → patrón "buscar por nombre; si no existe, insertar". Donde
-- sí hay unique/PK se usa ON CONFLICT.
--
-- CONTEXTO: las cuentas auth ya existen en auth.users SIN profile (huérfanas):
--   owner.test@gvento.com   170af71e-a1fa-42e4-8565-5a9fa396bbb8
--   cajero.test@gvento.com  0fc72dc6-5c73-49e4-9054-ac971c07a95c
--   mozo.test@gvento.com    (OPCIONAL — UID auto-descubierto por email; rol
--                            restringido para probar gating negativo. Si no
--                            existe la cuenta, su bloque se omite. Ver bloque f.)
-- Este script les crea profile dentro de la organización LAB. NO crea cuentas
-- auth (eso se hace por el panel/Admin API de Supabase).
--
-- profiles.role (enum legacy user_role: admin|cashier|waiter) sigue siendo
-- NOT NULL → se setea junto a role_id (RBAC). owner.test → admin / owner;
-- cajero.test → cashier / cajero.
--
-- Ejecutar en: Supabase Dashboard > SQL Editor. Migración NUEVA, no edita
-- migraciones aplicadas. Requiere que multi-tenant-rbac.sql y las migraciones
-- de inventario/extras/numeración YA estén aplicadas (lo están en la BD viva).
-- ============================================================

-- Atómico: si algo falla, ROLLBACK completo (no deja LAB a medias).
begin;

do $$
declare
  -- UUIDs reales de las cuentas auth (huérfanas) — ver cabecera.
  c_owner_uid  constant uuid := '170af71e-a1fa-42e4-8565-5a9fa396bbb8';
  c_cajero_uid constant uuid := '0fc72dc6-5c73-49e4-9054-ac971c07a95c';
  -- mozo.test: su UID NO se hardcodea; se auto-descubre por email desde
  -- auth.users (ver bloque f). Si la cuenta auth aún no existe, se OMITE sin
  -- romper el seed. Rol restringido (mozo) para probar gating NEGATIVO.
  c_mozo_uid   uuid;

  v_org         uuid;
  v_norte       uuid;
  v_sur         uuid;
  v_nokitchen   uuid;  -- sede dedicada con uses_kitchen=false (test de cocina OFF)

  v_role_owner  uuid;
  v_role_admin  uuid;
  v_role_cajero uuid;
  v_role_mozo   uuid;

  v_cat_cocteles uuid;
  v_cat_insumos  uuid;

  v_p_cerveza uuid;
  v_p_agua    uuid;
  v_p_vaso    uuid;
  v_p_coctel  uuid;

  v_extra_doble uuid;

  i integer;
begin
  -- ========================================================
  -- a) Organización "LAB"
  -- ========================================================
  select id into v_org from public.organizations where name = 'LAB' limit 1;
  if v_org is null then
    insert into public.organizations (name) values ('LAB') returning id into v_org;
  end if;

  -- ========================================================
  -- b) 2 sedes (restaurants) en LAB
  -- ========================================================
  select id into v_norte
    from public.restaurants
   where organization_id = v_org and name = 'Sede Lab Norte' limit 1;
  if v_norte is null then
    insert into public.restaurants (organization_id, name, address, phone)
    values (v_org, 'Sede Lab Norte', 'Calle Lab Norte 1', '0000000001')
    returning id into v_norte;
  end if;

  select id into v_sur
    from public.restaurants
   where organization_id = v_org and name = 'Sede Lab Sur' limit 1;
  if v_sur is null then
    insert into public.restaurants (organization_id, name, address, phone)
    values (v_org, 'Sede Lab Sur', 'Calle Lab Sur 2', '0000000002')
    returning id into v_sur;
  end if;

  -- Sede dedicada SIN cocina (uses_kitchen=false) — aísla el test de cocina OFF
  -- sin tocar Norte/Sur (las sedes de trabajo del resto de specs).
  select id into v_nokitchen
    from public.restaurants
   where organization_id = v_org and name = 'Sede Lab Sin Cocina' limit 1;
  if v_nokitchen is null then
    insert into public.restaurants (organization_id, name, address, phone)
    values (v_org, 'Sede Lab Sin Cocina', 'Calle Lab Sin Cocina 3', '0000000003')
    returning id into v_nokitchen;
  end if;

  -- Baseline defensivo de uses_kitchen: Norte/Sur CON cocina, la dedicada SIN.
  -- Se reescribe en cada corrida → un re-seed resetea cualquier deriva de tests.
  update public.restaurants set uses_kitchen = true  where id in (v_norte, v_sur);
  update public.restaurants set uses_kitchen = false where id = v_nokitchen;

  -- Motivos de egreso configurables (config.cash_out_reasons). Sin ellos, el
  -- único motivo es "Otro" (exige texto libre) y el test de "egreso con motivo
  -- de la lista" no puede elegir de una lista. Se MERGE en config (|| preserva
  -- el resto de claves) y se reescribe en cada corrida → idempotente.
  update public.restaurants
     set config = coalesce(config, '{}'::jsonb)
                  || jsonb_build_object('cash_out_reasons', jsonb_build_array(
                       'Compra de insumos', 'Pago a proveedor', 'Retiro de caja',
                       'Servicios', 'Otro'))
   where id = v_norte;

  -- ========================================================
  -- b.2) Purga de RESIDUO E2E — higiene del lab entre corridas
  --   Specs previos (extras/compras/historial/inventario) crean categorías y
  --   productos con prefijo "E2E <timestamp>" y no siempre los limpian. Se van
  --   acumulando y, como quedan con sort_order=0, una categoría E2E puede
  --   terminar como categories[0] y contaminar el default del ProductPicker.
  --
  --   Se DESACTIVAN (is_active=false), NO se borran: el hard-delete chocaría con
  --   las FK de order_items/… de corridas pasadas y, al ser este seed atómico,
  --   abortaría TODO el reset. La UI filtra is_active=true (getCategories/
  --   getProducts), así que desactivar los saca del picker igual. Idempotente.
  -- ========================================================
  update public.categories
     set is_active = false
   where is_active = true
     and name like 'E2E %'
     and restaurant_id in (select id from public.restaurants where organization_id = v_org);

  update public.products
     set is_active = false
   where is_active = true
     and name like 'E2E %'
     and restaurant_id in (select id from public.restaurants where organization_id = v_org);

  -- ========================================================
  -- c) 4 roles de sistema para LAB — fiel al estado de G-10 tras las migraciones
  --    aplicadas. Upsert: si el rol ya existe, se reescriben permisos (mantiene
  --    LAB al día). ⚠️ MANTENER SINCRONIZADO con las migraciones de permisos:
  --      - owner usa el comodín "*" (owner-wildcard-permission.sql): hereda TODO
  --        permiso, presente y futuro, sin reseed. NO volver a enumerarlo aquí.
  --      - admin/cajero/mozo son explícitos: al agregar un permiso nuevo a un rol
  --        en una migración (p. ej. compras.gestionar en admin), reflejarlo aquí
  --        o el reseed lo borra de LAB.
  -- ========================================================
  insert into public.roles (organization_id, name, is_system, permissions) values
    (v_org, 'owner', true, '["*"]'::jsonb)
  on conflict (organization_id, name)
    do update set permissions = excluded.permissions, is_system = true
  returning id into v_role_owner;

  insert into public.roles (organization_id, name, is_system, permissions) values
    (v_org, 'admin', true, '[
      "pos.vender","pos.descuento","pos.anular",
      "caja.abrir","caja.cerrar","caja.movimientos",
      "mesas.gestionar","mesas.cobrar","cocina.acceder","delivery.gestionar",
      "productos.ver","productos.editar",
      "reportes.financiero","reportes.stock",
      "ventas.historial","ventas.anular",
      "config.acceder","usuarios.gestionar","compras.gestionar","fiado.gestionar"
    ]'::jsonb)
  on conflict (organization_id, name)
    do update set permissions = excluded.permissions, is_system = true
  returning id into v_role_admin;

  insert into public.roles (organization_id, name, is_system, permissions) values
    (v_org, 'cajero', true, '[
      "pos.vender","pos.descuento","pos.anular",
      "caja.abrir","caja.cerrar","caja.movimientos",
      "mesas.cobrar","delivery.gestionar","fiado.gestionar",
      "ventas.historial"
    ]'::jsonb)
  on conflict (organization_id, name)
    do update set permissions = excluded.permissions, is_system = true
  returning id into v_role_cajero;

  insert into public.roles (organization_id, name, is_system, permissions) values
    (v_org, 'mozo', true, '[
      "pos.vender","mesas.gestionar","cocina.acceder"
    ]'::jsonb)
  on conflict (organization_id, name)
    do update set permissions = excluded.permissions, is_system = true
  returning id into v_role_mozo;

  -- ========================================================
  -- d) Profiles de los 2 usuarios huérfanos, ligados a LAB.
  --    Sede activa (restaurant_id) = Norte para ambos.
  --    role (enum legacy) + role_id (RBAC):
  --      owner.test  → admin / owner
  --      cajero.test → cashier / cajero
  --    ON CONFLICT (id) DO UPDATE: si ya tienen profile, se reasigna a LAB.
  -- ========================================================
  insert into public.profiles
    (id, email, full_name, role, role_id, organization_id, restaurant_id, is_active)
  values
    (c_owner_uid, 'owner.test@gvento.com', 'Owner Lab',
     'admin'::public.user_role, v_role_owner, v_org, v_norte, true)
  on conflict (id) do update set
    email           = excluded.email,
    full_name       = excluded.full_name,
    role            = excluded.role,
    role_id         = excluded.role_id,
    organization_id = excluded.organization_id,
    restaurant_id   = excluded.restaurant_id,
    is_active       = true;

  insert into public.profiles
    (id, email, full_name, role, role_id, organization_id, restaurant_id, is_active)
  values
    (c_cajero_uid, 'cajero.test@gvento.com', 'Cajero Lab',
     'cashier'::public.user_role, v_role_cajero, v_org, v_norte, true)
  on conflict (id) do update set
    email           = excluded.email,
    full_name       = excluded.full_name,
    role            = excluded.role,
    role_id         = excluded.role_id,
    organization_id = excluded.organization_id,
    restaurant_id   = excluded.restaurant_id,
    is_active       = true;

  -- ========================================================
  -- e) user_stores (acceso N:M a sedes)
  --    owner.test  → Norte + Sur + Sin Cocina (para el test de cocina OFF)
  --    cajero.test → solo Norte
  -- ========================================================
  insert into public.user_stores (user_id, restaurant_id) values
    (c_owner_uid,  v_norte),
    (c_owner_uid,  v_sur),
    (c_owner_uid,  v_nokitchen),
    (c_cajero_uid, v_norte)
  on conflict (user_id, restaurant_id) do nothing;

  -- ========================================================
  -- f) mozo.test — usuario de rol RESTRINGIDO (mozo) para probar gating
  --    NEGATIVO (no ve caja.*, fiado, historiales, etc.). Resuelve una
  --    carencia estructural del lab: no había rol limitado con el que
  --    verificar que las rutas/nav gateadas SÍ se ocultan.
  --
  --    El seed NO crea cuentas auth. El UID se AUTO-DESCUBRE por email desde
  --    auth.users (este script corre como postgres en el SQL Editor). Si la
  --    cuenta mozo.test@gvento.com aún no existe, se OMITE el bloque sin
  --    romper el seed (idempotente). Para habilitarla:
  --      1) crear el usuario mozo.test@gvento.com en Auth (panel Supabase),
  --      2) re-correr este seed (descubrirá el UID y creará profile+user_stores),
  --      3) poner E2E_WAITER_EMAIL/PASSWORD en .env.test.
  -- ========================================================
  select id into c_mozo_uid from auth.users where email = 'mozo.test@gvento.com' limit 1;
  if c_mozo_uid is not null then
    insert into public.profiles
      (id, email, full_name, role, role_id, organization_id, restaurant_id, is_active)
    values
      (c_mozo_uid, 'mozo.test@gvento.com', 'Mozo Lab',
       'waiter'::public.user_role, v_role_mozo, v_org, v_norte, true)
    on conflict (id) do update set
      email           = excluded.email,
      full_name       = excluded.full_name,
      role            = excluded.role,
      role_id         = excluded.role_id,
      organization_id = excluded.organization_id,
      restaurant_id   = excluded.restaurant_id,
      is_active       = true;

    insert into public.user_stores (user_id, restaurant_id) values
      (c_mozo_uid, v_norte)
    on conflict (user_id, restaurant_id) do nothing;

    raise notice 'mozo.test sembrado (UID %): rol mozo, sede Norte.', c_mozo_uid;
  else
    raise notice 'mozo.test@gvento.com no existe en auth.users → se omite (crea la cuenta y re-corre el seed).';
  end if;

  -- ========================================================
  -- f) Datos mínimos de prueba en Sede Lab Norte
  -- ========================================================

  -- Categorías ---------------------------------------------
  select id into v_cat_cocteles
    from public.categories where restaurant_id = v_norte and name = 'Lab Cocteles' limit 1;
  if v_cat_cocteles is null then
    insert into public.categories (restaurant_id, name)
    values (v_norte, 'Lab Cocteles') returning id into v_cat_cocteles;
  end if;

  select id into v_cat_insumos
    from public.categories where restaurant_id = v_norte and name = 'Lab Insumos' limit 1;
  if v_cat_insumos is null then
    insert into public.categories (restaurant_id, name)
    values (v_norte, 'Lab Insumos') returning id into v_cat_insumos;
  end if;

  -- Producto simple "Lab Cerveza" (sin tracking) -----------
  select id into v_p_cerveza
    from public.products where restaurant_id = v_norte and name = 'Lab Cerveza' limit 1;
  if v_p_cerveza is null then
    insert into public.products
      (restaurant_id, category_id, name, price, kind, stock_tracking)
    values
      (v_norte, v_cat_cocteles, 'Lab Cerveza', 8000, 'simple', false)
    returning id into v_p_cerveza;
  end if;

  -- Producto simple "Lab Agua" (sin tracking) --------------
  select id into v_p_agua
    from public.products where restaurant_id = v_norte and name = 'Lab Agua' limit 1;
  if v_p_agua is null then
    insert into public.products
      (restaurant_id, category_id, name, price, kind, stock_tracking)
    values
      (v_norte, v_cat_cocteles, 'Lab Agua', 4000, 'simple', false)
    returning id into v_p_agua;
  end if;

  -- Insumo "Lab Vaso" (simple, con tracking) ---------------
  select id into v_p_vaso
    from public.products where restaurant_id = v_norte and name = 'Lab Vaso' limit 1;
  if v_p_vaso is null then
    insert into public.products
      (restaurant_id, category_id, name, price, kind, stock_tracking, stock_qty, min_stock)
    values
      (v_norte, v_cat_insumos, 'Lab Vaso', 0, 'simple', true, 100, 10)
    returning id into v_p_vaso;
  end if;

  -- Estado conocido en cada corrida: stock de Lab Vaso fijo a 100 (min 10).
  -- Tras una corrida de tests el stock pudo bajar (ventas de Lab Coctel
  -- descuentan su insumo); el seed lo devuelve al baseline para que los tests
  -- sean deterministas y LAB no acumule deriva.
  update public.products set stock_qty = 100, min_stock = 10 where id = v_p_vaso;

  -- Producto compuesto "Lab Coctel" (kind=composite) -------
  select id into v_p_coctel
    from public.products where restaurant_id = v_norte and name = 'Lab Coctel' limit 1;
  if v_p_coctel is null then
    insert into public.products
      (restaurant_id, category_id, name, price, kind, stock_tracking)
    values
      (v_norte, v_cat_cocteles, 'Lab Coctel', 18000, 'composite', false)
    returning id into v_p_coctel;
  end if;

  -- Receta de "Lab Coctel": 1 × "Lab Vaso" -----------------
  insert into public.product_components (restaurant_id, parent_id, component_id, qty)
  values (v_norte, v_p_coctel, v_p_vaso, 1)
  on conflict (parent_id, component_id) do update set qty = excluded.qty;

  -- Baseline de routes_to_kitchen (cocina por producto): "Lab Agua" NO va a
  -- cocina (bebida), el resto SÍ. Se reescribe en cada corrida → determinista
  -- para el test que verifica que el contador "Cocina (N)" cuenta solo lo que
  -- enruta y que el agua no se envía.
  update public.products set routes_to_kitchen = false where id = v_p_agua;
  update public.products set routes_to_kitchen = true  where id in (v_p_cerveza, v_p_coctel);

  -- Extra "Lab Doble" (sin linked_product) -----------------
  select id into v_extra_doble
    from public.extras where restaurant_id = v_norte and name = 'Lab Doble' limit 1;
  if v_extra_doble is null then
    insert into public.extras (restaurant_id, name, price, linked_product_id, is_active)
    values (v_norte, 'Lab Doble', 6000, null, true)
    returning id into v_extra_doble;
  end if;

  -- Asignar "Lab Doble" a "Lab Coctel" (sin unique → check de existencia)
  if not exists (
    select 1 from public.product_extras
     where product_id = v_p_coctel and extra_id = v_extra_doble
  ) then
    insert into public.product_extras (product_id, extra_id)
    values (v_p_coctel, v_extra_doble);
  end if;

  -- store_sequences RESETEADO a 0 para ambas sedes (si la tabla existe) ----
  -- Estado conocido en cada corrida: la numeración de ventas vuelve a arrancar
  -- en 1, así los tests que verifican secuencia (#N → #N+1) son deterministas.
  if to_regclass('public.store_sequences') is not null then
    insert into public.store_sequences (restaurant_id, last_order_number) values
      (v_norte, 0),
      (v_sur,   0)
    on conflict (restaurant_id) do update set last_order_number = 0;
  end if;

  -- Mesas: 3 en Norte, 2 en Sur (check por nombre+sede) ----
  for i in 1..3 loop
    if not exists (
      select 1 from public.tables where restaurant_id = v_norte and name = 'Mesa ' || i
    ) then
      insert into public.tables (restaurant_id, name, capacity)
      values (v_norte, 'Mesa ' || i, 4);
    end if;
  end loop;

  for i in 1..2 loop
    if not exists (
      select 1 from public.tables where restaurant_id = v_sur and name = 'Mesa ' || i
    ) then
      insert into public.tables (restaurant_id, name, capacity)
      values (v_sur, 'Mesa ' || i, 4);
    end if;
  end loop;

  -- 1 mesa en la sede sin cocina (para abrir el panel y comprobar que el botón
  -- "Cocina" NO aparece cuando uses_kitchen=false).
  if not exists (
    select 1 from public.tables where restaurant_id = v_nokitchen and name = 'Mesa 1'
  ) then
    insert into public.tables (restaurant_id, name, capacity)
    values (v_nokitchen, 'Mesa 1', 4);
  end if;
end $$;


-- ============================================================
-- LIMPIEZA DE DATOS TRANSACCIONALES — SOLO de la organización LAB.
--
-- ⚠️  SECCIÓN DELICADA: un DELETE mal acotado tocaría G-10. Por eso TODO
--     borrado se restringe estrictamente a las sedes de LAB. El conjunto de
--     sedes de LAB se define UNA vez como subconsulta y se reutiliza:
--
--       restaurant_id in (
--         select r.id from restaurants r
--         join organizations o on o.id = r.organization_id
--         where o.name = 'LAB'
--       )
--
--     Para las tablas SIN restaurant_id (order_items, order_item_extras) el
--     acotado sube por la cadena order_id → orders (que sí tiene restaurant_id
--     de LAB). Si la org LAB no existiera, la subconsulta sería vacía y no se
--     borraría nada (fail-safe). El seed crea LAB arriba, así que sí existe.
--
--     NO toca catálogo (products/categories/extras/recipes/tables salvo el
--     status), ni profiles/roles/user_stores: solo lo que generan las corridas.
-- ============================================================

-- 1. Extras de líneas de orden (hijo de order_items; sin restaurant_id).
delete from public.order_item_extras
 where order_item_id in (
   select oi.id
     from public.order_items oi
     join public.orders ord        on ord.id = oi.order_id
     join public.restaurants r     on r.id = ord.restaurant_id
     join public.organizations o   on o.id = r.organization_id
    where o.name = 'LAB'
 );

-- 2. Pagos (tiene restaurant_id propio → acotado directo a sedes de LAB).
delete from public.payments
 where restaurant_id in (
   select r.id from public.restaurants r
   join public.organizations o on o.id = r.organization_id
   where o.name = 'LAB'
 );

-- 3. Líneas de orden (hijo de orders; sin restaurant_id).
delete from public.order_items
 where order_id in (
   select ord.id
     from public.orders ord
     join public.restaurants r   on r.id = ord.restaurant_id
     join public.organizations o on o.id = r.organization_id
    where o.name = 'LAB'
 );

-- 4. Órdenes (restaurant_id propio).
delete from public.orders
 where restaurant_id in (
   select r.id from public.restaurants r
   join public.organizations o on o.id = r.organization_id
   where o.name = 'LAB'
 );

-- 5. Movimientos de caja (hijo de cash_shifts; tiene restaurant_id propio).
delete from public.cash_movements
 where restaurant_id in (
   select r.id from public.restaurants r
   join public.organizations o on o.id = r.organization_id
   where o.name = 'LAB'
 );

-- 6. Turnos de caja (restaurant_id propio).
delete from public.cash_shifts
 where restaurant_id in (
   select r.id from public.restaurants r
   join public.organizations o on o.id = r.organization_id
   where o.name = 'LAB'
 );

-- 7. Movimientos de stock (restaurant_id propio). El stock de Lab Vaso ya quedó
--    fijado a 100 arriba; aquí solo se purga la auditoría de movimientos de LAB.
delete from public.stock_movements
 where restaurant_id in (
   select r.id from public.restaurants r
   join public.organizations o on o.id = r.organization_id
   where o.name = 'LAB'
 );

-- 8. Mesas de LAB de vuelta a 'free' (los tests las dejan ocupadas/pide cuenta).
update public.tables set status = 'free'
 where restaurant_id in (
   select r.id from public.restaurants r
   join public.organizations o on o.id = r.organization_id
   where o.name = 'LAB'
 );


-- ============================================================
-- VERIFICACIÓN (read-only) — corre dentro de la misma transacción.
-- ============================================================

-- Organización LAB y sus sedes (con flag de cocina)
select 'org + sedes' as check, o.name as org, r.name as sede,
       r.uses_kitchen, r.id as restaurant_id
  from public.organizations o
  join public.restaurants r on r.organization_id = o.id
 where o.name = 'LAB'
 order by r.name;

-- 4 roles de LAB con conteo de permisos
select 'roles' as check, r.name as rol, r.is_system,
       jsonb_array_length(r.permissions) as num_permisos
  from public.roles r
  join public.organizations o on o.id = r.organization_id
 where o.name = 'LAB'
 order by num_permisos desc;

-- Profiles de prueba con su rol RBAC y sede activa
select 'profiles' as check, p.email, p.full_name, p.role as enum_legacy,
       rl.name as rol_rbac, r.name as sede_activa, p.is_active
  from public.profiles p
  join public.organizations o on o.id = p.organization_id
  left join public.roles rl on rl.id = p.role_id
  left join public.restaurants r on r.id = p.restaurant_id
 where o.name = 'LAB'
 order by p.email;

-- user_stores por usuario (sedes a las que tiene acceso)
select 'user_stores' as check, p.email, r.name as sede_con_acceso
  from public.user_stores us
  join public.profiles p    on p.id = us.user_id
  join public.restaurants r on r.id = us.restaurant_id
  join public.organizations o on o.id = p.organization_id
 where o.name = 'LAB'
 order by p.email, r.name;

-- Datos mínimos en Sede Lab Norte: productos, receta y extra
select 'productos norte' as check, pr.name, pr.kind, pr.price,
       pr.stock_tracking, pr.stock_qty, pr.min_stock, pr.routes_to_kitchen, c.name as categoria
  from public.products pr
  join public.restaurants r on r.id = pr.restaurant_id
  join public.organizations o on o.id = r.organization_id
  join public.categories c on c.id = pr.category_id
 where o.name = 'LAB' and r.name = 'Sede Lab Norte'
 order by pr.name;

-- Limpieza: filas transaccionales residuales en LAB (deben ser todas 0)
select 'limpieza LAB' as check,
  (select count(*) from public.orders ord
     join public.restaurants r on r.id = ord.restaurant_id
     join public.organizations o on o.id = r.organization_id where o.name = 'LAB') as orders,
  (select count(*) from public.payments p
     join public.restaurants r on r.id = p.restaurant_id
     join public.organizations o on o.id = r.organization_id where o.name = 'LAB') as payments,
  (select count(*) from public.cash_shifts cs
     join public.restaurants r on r.id = cs.restaurant_id
     join public.organizations o on o.id = r.organization_id where o.name = 'LAB') as cash_shifts,
  (select count(*) from public.stock_movements sm
     join public.restaurants r on r.id = sm.restaurant_id
     join public.organizations o on o.id = r.organization_id where o.name = 'LAB') as stock_movements,
  (select count(*) from public.tables t
     join public.restaurants r on r.id = t.restaurant_id
     join public.organizations o on o.id = r.organization_id
    where o.name = 'LAB' and t.status <> 'free') as mesas_no_libres;

commit;
