-- supabase/portal-config.sql — Pedidos en línea, P1: configuración del portal de cada sede
-- ============================================================================
-- QUÉ HACE (todo es nuevo; no cambia ni borra datos existentes):
--
--   1. portal_sedes: una fila por sede con el portal configurado. Link (slug, único entre
--      TODAS las organizaciones), publicado (activo), pausa, ubicación del local, zona (radio o
--      polígono), envío (fijo o por tramos de km), pedido mínimo, tiempo que se muestra, horario,
--      color y el WhatsApp del local (lo ve el cliente en el seguimiento y si su dirección queda
--      fuera de la zona; P2/P3). La forma de cada valor la validan CHECK con funciones inmutables.
--   2. portal_productos: qué productos de la sede salen en el portal y su precio a domicilio
--      (null = el del local). ALLOWLIST: un producto sin fila aquí NO está publicado. La FK
--      compuesta (product_id, restaurant_id) → products(id, restaurant_id) hace imposible
--      publicar un producto de otra sede. Para eso se agrega un índice único (id, restaurant_id)
--      en products (no cambia datos: id ya es único).
--   3. Las dos tablas tienen RLS sin políticas y SIN privilegios para anon ni authenticated:
--      todo pasa por las funciones de abajo (SECURITY DEFINER, sede = get_my_restaurant_id()).
--   4. portal_disponibilidad: la ÚNICA regla de "se puede vender en el portal" (producto activo, de una
--      categoría activa, con precio, publicado, y agotado según portal_consumo: su stock, los insumos
--      de la receta o, para un extra, el producto ligado). La usan la configuración (P1) y el portal
--      (P2, portal-publico.sql).
--   5. portal_estado: la ÚNICA fuente de "¿el portal recibe pedidos ahora?". La lee la pantalla
--      de configuración (P1) y la leerá el portal (P2); nadie lo recalcula en el navegador (R1).
--      Motivos, en este orden: sin_configurar, desactivado, incompleto, pausado,
--      fuera_de_horario, sin_turno. El horario se evalúa en America/Bogota (R7).
--
-- FUNCIONES PARA LA APP (authenticated; anon no):
--   portal_config()                         pedidos_online.gestionar
--   actualizar_portal(jsonb)                pedidos_online.gestionar  (allowlist de claves)
--   portal_slug_disponible(text)            pedidos_online.gestionar
--   portal_productos_lista()                pedidos_online.gestionar
--   guardar_portal_productos(jsonb)         pedidos_online.gestionar
--   pausar_pedidos_online(boolean)          pedidos_online.gestionar O delivery.gestionar
--   portal_estado(timestamptz)              pedidos_online.gestionar O delivery.gestionar
--
-- 🔴 CONTRATOS EN DOS LADOS (R1):
--   · Las claves de actualizar_portal (c_claves) y PortalCambios en src/lib/portal.ts. Lo
--     vigila tests/portal-config.spec.ts, que escribe cada clave de CLAVES_PORTAL por la RPC.
--   · El permiso pedidos_online.gestionar sale de src/lib/permissions.ts (pnpm gen:rbac); este
--     archivo solo lo NOMBRA. Con este SQL va el seed-system-roles.sql regenerado.
--
-- SIN PostGIS: distancia haversine en línea recta y punto en polígono por ray casting. A escala
-- de ciudad alcanza, y no se instala una extensión que crea spatial_ref_sys en public.
--
-- PRECONDICIONES: has_permission y get_my_restaurant_id (profiles-is-active-enforced.sql);
-- PostgreSQL con jsonb_populate_record (cualquiera soportado).
-- FRONTEND: todo es nuevo → este SQL va ANTES del frontend de P1 (el frontend anterior a P1 no lo usa).
-- RE-APLICAR: falla y hace rollback (la guarda del paso 0 aborta si portal_sedes ya existe).
--
-- NO DEDUZCAS EL ESTADO DE ESTE COMENTARIO — correlo:
--   select to_regclass('public.portal_sedes'), to_regprocedure('public.actualizar_portal(jsonb)'),
--          exists (select 1 from information_schema.columns where table_schema = 'public'
--                   and table_name = 'portal_sedes' and column_name = 'whatsapp'),
--          to_regprocedure('public.portal_disponibilidad(uuid,uuid,uuid)') is not null;
--   -- null, null, f, f = no está · con valor, con valor, t, t = está, con WhatsApp y con la regla
--   -- única · con valor pero alguna f = corrió una versión anterior de este archivo: avísame.
--   -- Para saber si es EXACTAMENTE esta versión: la consulta 6 del pre-flight (md5 de las 17 funciones).
-- ============================================================================

begin;

-- Crear el índice de products toma un lock SHARE que frena las ventas (que actualizan el stock)
-- mientras dura. Si hay una transacción larga delante, mejor fallar a los 3 s que colgar el POS
-- (la misma clase que order-number-unique.sql).
set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- ── 0. Guarda ──
do $$
begin
  if to_regclass('public.portal_sedes') is not null or to_regclass('public.portal_productos') is not null then
    raise exception 'portal-config.sql ya está aplicada (existe portal_sedes o portal_productos). No se cambió nada.';
  end if;
  -- Las versiones vigentes (profiles-is-active-enforced.sql, ver GANA en preparar-local.mjs):
  -- con unas viejas, un usuario desactivado podría configurar el portal.
  if (select count(*) from pg_proc p
       where (p.oid::regprocedure::text, md5(regexp_replace(regexp_replace(pg_get_functiondef(p.oid), E'\r','','g'), E'[ \t]+\n', E'\n','g'))) in (
               ('has_permission(text)',   '1a79ece7f371a2afd3a8e195d27ddb87'),
               ('get_my_restaurant_id()', '7ed39b96b4fa8da1101030aba03ee557'))) <> 2 then
    raise exception 'Precondición: has_permission(text) o get_my_restaurant_id() no son las de profiles-is-active-enforced.sql (md5). No se cambió nada.';
  end if;
end $$;

-- ── 1. Funciones inmutables (geometría y forma de los valores) ──

-- Distancia en metros, en línea recta (haversine, radio medio de la Tierra).
create function public.geo_distancia_m(p_lat1 numeric, p_lng1 numeric, p_lat2 numeric, p_lng2 numeric)
returns numeric
language sql immutable strict
set search_path = public
as $$
  select (2 * 6371008.8 * asin(least(1::float8, sqrt(
            power(sin(radians((p_lat2 - p_lat1)::float8) / 2), 2)
          + cos(radians(p_lat1::float8)) * cos(radians(p_lat2::float8))
          * power(sin(radians((p_lng2 - p_lng1)::float8) / 2), 2)))))::numeric
$$;

-- ¿El punto está dentro del polígono [[lat,lng],…]? Ray casting (lng = x, lat = y).
create function public.geo_en_poligono(p_lat numeric, p_lng numeric, p_poligono jsonb)
returns boolean
language plpgsql immutable strict
set search_path = public
as $$
declare
  n integer := jsonb_array_length(p_poligono);
  y float8 := p_lat; x float8 := p_lng;
  yi float8; xi float8; yj float8; xj float8;
  j integer;
  dentro boolean := false;
begin
  if n < 3 then return false; end if;
  j := n - 1;
  for i in 0 .. n - 1 loop
    yi := (p_poligono->i->>0)::float8; xi := (p_poligono->i->>1)::float8;
    yj := (p_poligono->j->>0)::float8; xj := (p_poligono->j->>1)::float8;
    if (yi > y) <> (yj > y) then            -- el borde cruza la horizontal del punto (yi <> yj)
      if x < (xj - xi) * (y - yi) / (yj - yi) + xi then
        dentro := not dentro;
      end if;
    end if;
    j := i;
  end loop;
  return dentro;
end $$;

-- Polígono: arreglo de 3 a 200 vértices [lat, lng] en rango, sin bordes que se crucen.
create function public.portal_poligono_valido(p jsonb)
returns boolean
language plpgsql immutable strict
set search_path = public
as $$
declare
  n integer;
  v jsonb;
  ax float8; ay float8; bx float8; by_ float8; cx float8; cy float8; dx float8; dy float8;
  d1 float8; d2 float8; d3 float8; d4 float8;
begin
  if jsonb_typeof(p) <> 'array' then return false; end if;
  n := jsonb_array_length(p);
  if n < 3 or n > 200 then return false; end if;
  for v in select value from jsonb_array_elements(p) loop
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) <> 2
       or jsonb_typeof(v->0) <> 'number' or jsonb_typeof(v->1) <> 'number'
       or (v->>0)::numeric not between -90 and 90
       or (v->>1)::numeric not between -180 and 180 then
      return false;
    end if;
  end loop;
  -- Bordes i→i+1 contra k→k+1, no vecinos: un cruce propio lo invalida.
  for i in 0 .. n - 1 loop
    ay := (p->i->>0)::float8; ax := (p->i->>1)::float8;
    by_ := (p->((i + 1) % n)->>0)::float8; bx := (p->((i + 1) % n)->>1)::float8;
    for k in i + 2 .. n - 1 loop
      continue when i = 0 and k = n - 1;   -- el último borde es vecino del primero
      cy := (p->k->>0)::float8; cx := (p->k->>1)::float8;
      dy := (p->((k + 1) % n)->>0)::float8; dx := (p->((k + 1) % n)->>1)::float8;
      d1 := (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
      d2 := (dx - cx) * (by_ - cy) - (dy - cy) * (bx - cx);
      d3 := (bx - ax) * (cy - ay) - (by_ - ay) * (cx - ax);
      d4 := (bx - ax) * (dy - ay) - (by_ - ay) * (dx - ax);
      if ((d1 > 0 and d2 < 0) or (d1 < 0 and d2 > 0)) and ((d3 > 0 and d4 < 0) or (d3 < 0 and d4 > 0)) then
        return false;
      end if;
    end loop;
  end loop;
  return true;
end $$;

-- Tramos de envío: [{"hasta_km": 2, "valor": 3000}, …, {"hasta_km": null, "valor": 6000}].
-- 1 a 10 tramos, solo esas dos claves, hasta_km creciente (> 0 y ≤ 100), valor 0 a 1.000.000, y
-- SOLO el último con hasta_km null ("más de X km, dentro de la zona").
create function public.portal_tramos_validos(p jsonb)
returns boolean
language plpgsql immutable strict
set search_path = public
as $$
declare
  n integer;
  t jsonb;
  previo numeric := 0;
begin
  if jsonb_typeof(p) <> 'array' then return false; end if;
  n := jsonb_array_length(p);
  if n < 1 or n > 10 then return false; end if;
  for i in 0 .. n - 1 loop
    t := p->i;
    if jsonb_typeof(t) <> 'object'
       or (select count(*) from jsonb_object_keys(t)) <> 2
       or not (t ? 'hasta_km' and t ? 'valor')
       or jsonb_typeof(t->'valor') <> 'number'
       or (t->>'valor')::numeric not between 0 and 1000000 then
      return false;
    end if;
    if i < n - 1 then
      if jsonb_typeof(t->'hasta_km') <> 'number' then return false; end if;
      if (t->>'hasta_km')::numeric <= previo or (t->>'hasta_km')::numeric > 100 then return false; end if;
      previo := (t->>'hasta_km')::numeric;
    elsif jsonb_typeof(t->'hasta_km') <> 'null' then
      return false;
    end if;
  end loop;
  return true;
end $$;

-- Horario: {"1": [["17:00","23:30"]], …, "7": [...]} — 1 = lunes … 7 = domingo (ISO). Un día
-- que falta o con [] = cerrado. Hasta 3 franjas por día, "HH:MM" de 00:00 a 23:59, abre ≠ cierra.
-- Si cierra < abre, la franja pasa la medianoche y pertenece al día en que abre.
create function public.portal_horario_valido(p jsonb)
returns boolean
language plpgsql immutable strict
set search_path = public
as $$
declare
  dia text;
  franjas jsonb;
  f jsonb;
begin
  if jsonb_typeof(p) <> 'object' then return false; end if;
  for dia, franjas in select key, value from jsonb_each(p) loop
    if dia not in ('1', '2', '3', '4', '5', '6', '7') then return false; end if;
    if jsonb_typeof(franjas) <> 'array' or jsonb_array_length(franjas) > 3 then return false; end if;
    for f in select value from jsonb_array_elements(franjas) loop
      if jsonb_typeof(f) <> 'array' or jsonb_array_length(f) <> 2
         or jsonb_typeof(f->0) <> 'string' or jsonb_typeof(f->1) <> 'string'
         or (f->>0) !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         or (f->>1) !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         or (f->>0) = (f->>1) then
        return false;
      end if;
    end loop;
  end loop;
  return true;
end $$;

-- ── 2. Tablas ──

-- (id, restaurant_id) único en products, para la FK compuesta de portal_productos.
create unique index products_id_restaurant_uniq on public.products (id, restaurant_id);

create table public.portal_sedes (
  restaurant_id  uuid primary key references public.restaurants (id) on delete cascade,
  slug           text not null,
  activo         boolean not null default false,
  pausado        boolean not null default false,
  pausado_en     timestamptz,
  pausado_por    uuid references public.profiles (id) on delete set null,
  lat            numeric(9,6),
  lng            numeric(9,6),
  zona_tipo      text,
  zona_radio_m   integer,
  zona_poligono  jsonb,
  envio_tipo     text,
  envio_fijo     numeric(12,2),
  envio_tramos   jsonb,
  pedido_minimo  numeric(12,2) not null default 0,
  tiempo_min     smallint,
  tiempo_max     smallint,
  horario        jsonb not null default '{}'::jsonb,
  color          text,
  whatsapp       text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.profiles (id) on delete set null,
  constraint portal_sedes_slug_unico     unique (slug),
  constraint portal_sedes_slug_formato   check (slug ~ '^[a-z0-9]([a-z0-9-]{1,38})[a-z0-9]$'),
  constraint portal_sedes_ubicacion      check ((lat is null) = (lng is null)
                                                and (lat is null or lat between -90 and 90)
                                                and (lng is null or lng between -180 and 180)),
  constraint portal_sedes_zona_tipo      check (zona_tipo in ('radio', 'poligono')),
  constraint portal_sedes_zona_radio     check (zona_radio_m between 200 and 30000),
  constraint portal_sedes_zona_poligono  check (portal_poligono_valido(zona_poligono)),
  constraint portal_sedes_envio_tipo     check (envio_tipo in ('fijo', 'distancia')),
  constraint portal_sedes_envio_fijo     check (envio_fijo between 0 and 1000000),
  constraint portal_sedes_envio_tramos   check (portal_tramos_validos(envio_tramos)),
  constraint portal_sedes_pedido_minimo  check (pedido_minimo between 0 and 10000000),
  constraint portal_sedes_tiempo         check (tiempo_min between 5 and 240 and tiempo_max between 5 and 240
                                                and tiempo_min <= tiempo_max),
  constraint portal_sedes_horario        check (portal_horario_valido(horario)),
  constraint portal_sedes_color          check (color ~ '^#[0-9a-f]{6}$'),
  -- Número de Colombia con el indicativo y sin signos: 57 + celular (3 + 9 dígitos) o fijo
  -- (60 + indicativo de 1 a 8 + 7 dígitos). El mismo formato que RE_WHATSAPP (src/lib/portal.ts).
  constraint portal_sedes_whatsapp       check (whatsapp ~ '^57(3[0-9]{9}|60[1-8][0-9]{7})$')
);

comment on table public.portal_sedes is
  'Pedidos en línea (P1): configuración del portal de cada sede. Solo se escribe por actualizar_portal y pausar_pedidos_online.';

create table public.portal_productos (
  product_id        uuid primary key,
  restaurant_id     uuid not null,
  publicado         boolean not null default false,
  precio_domicilio  numeric(12,2),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references public.profiles (id) on delete set null,
  constraint portal_productos_producto_de_la_sede foreign key (product_id, restaurant_id)
    references public.products (id, restaurant_id) on update cascade on delete cascade,
  constraint portal_productos_precio check (precio_domicilio > 0 and precio_domicilio <= 10000000)
);

create index portal_productos_restaurant on public.portal_productos (restaurant_id);

comment on table public.portal_productos is
  'Pedidos en línea (P1): productos publicados en el portal y precio a domicilio (null = el del local). Sin fila = no publicado.';

alter table public.portal_sedes     enable row level security;
alter table public.portal_productos enable row level security;
revoke all on table public.portal_sedes     from public, anon, authenticated;
revoke all on table public.portal_productos from public, anon, authenticated;

-- ── 3. Funciones internas (no ejecutables desde la app) ──

-- 🔴 QUÉ STOCK CONSUME UNA UNIDAD: del producto (p_extra null) o de ese extra puesto en ese producto.
-- Devuelve (product_id, cantidad) de cada producto CON stock que se descuenta: el propio si es simple
-- y lleva stock; los insumos con stock de la receta si es compuesto (cantidad = la de la receta); el
-- producto ligado al extra si lleva stock. Es la misma regla con la que descuenta el POS
-- (add_order_items_with_extras, R1 #12 e). Sin filas = no consume stock (sin límite).
-- La usan portal_disponibilidad (cuántas unidades quedan) y portal_calcular (la demanda del carrito, P2).
create function public.portal_consumo(p_sede uuid, p_producto uuid, p_extra uuid default null)
returns table (product_id uuid, cantidad integer)
language sql stable security definer
set search_path = public
as $$
  select pr.id, 1
    from public.products pr
   where p_extra is null and pr.id = p_producto and pr.restaurant_id = p_sede
     and pr.kind = 'simple' and pr.stock_tracking
  union all
  select pc.component_id, pc.qty
    from public.product_components pc
    join public.products pr on pr.id = pc.parent_id and pr.restaurant_id = p_sede and pr.kind = 'composite'
    join public.products ins on ins.id = pc.component_id and ins.restaurant_id = p_sede and ins.stock_tracking
   where p_extra is null and pc.parent_id = p_producto and pc.restaurant_id = p_sede
  union all
  select lp.id, 1
    from public.extras ex
    join public.products lp on lp.id = ex.linked_product_id and lp.restaurant_id = p_sede and lp.stock_tracking
   where p_extra is not null and ex.id = p_extra and ex.restaurant_id = p_sede
$$;

-- 🔴 LA REGLA ÚNICA de "se puede vender en el portal" (R1 #12 d). La usan portal_faltantes_de,
-- portal_productos_lista y guardar_portal_productos (P1), y el catálogo y el cálculo del portal (P2).
--   · p_extra null → el PRODUCTO: precio = el de domicilio o el del local. motivo, en este orden:
--     no_existe (no es de la sede), inactivo, categoria_inactiva, sin_precio, sin_publicar, agotado.
--   · p_extra con valor → ese EXTRA para ese producto: precio = el del extra. motivo: no_existe,
--     inactivo, no_asignado (no está en product_extras de ese producto), agotado. No mira el estado
--     del producto: eso es la llamada sin p_extra.
--   · unidades = cuántas se pueden vender con el stock de hoy, según portal_consumo (null = sin
--     límite); agotado = unidades ≤ 0. Va de último: un producto agotado está bien configurado.
--   · vendible = motivo null o 'agotado': está a la venta y lo que decide es el stock de hoy. Es la
--     columna que leen los llamadores (no repiten la lista de motivos).
-- Quien la llama NO expone `unidades` al cliente (regla para los llamadores, no algo que esta función
-- pueda impedir): el portal solo dice agotado / no alcanza.
create function public.portal_disponibilidad(p_sede uuid, p_producto uuid, p_extra uuid default null)
returns table (precio numeric, unidades integer, agotado boolean, vendible boolean, motivo text)
language plpgsql stable security definer
set search_path = public
as $$
declare
  p record;
  e record;
begin
  select pr.price, pr.kind, pr.is_active,
         coalesce(c.is_active, false) as categoria_activa,
         coalesce(pp.publicado, false) as publicado, pp.precio_domicilio
    into p
    from public.products pr
    left join public.categories c on c.id = pr.category_id
    left join public.portal_productos pp on pp.product_id = pr.id and pp.restaurant_id = pr.restaurant_id
   where pr.id = p_producto and pr.restaurant_id = p_sede;
  if not found then
    return query select null::numeric, null::integer, false, false, 'no_existe'::text;
    return;
  end if;

  -- Lo que queda: el mínimo, entre los productos con stock que consume, de stock / cantidad.
  select min(greatest(coalesce(s.stock_qty, 0), 0) / c.cantidad)
    into unidades
    from portal_consumo(p_sede, p_producto, p_extra) c
    join public.products s on s.id = c.product_id;
  agotado := coalesce(unidades <= 0, false);

  if p_extra is null then
    precio := coalesce(p.precio_domicilio, p.price);
    motivo := case
      when not p.is_active or p.kind not in ('simple', 'composite') then 'inactivo'
      when not p.categoria_activa then 'categoria_inactiva'
      when coalesce(precio, 0) <= 0 then 'sin_precio'
      when not p.publicado then 'sin_publicar'
      when agotado then 'agotado'
    end;
  else
    select ex.price, ex.is_active,
           exists (select 1 from public.product_extras pe where pe.extra_id = ex.id and pe.product_id = p_producto) as asignado
      into e
      from public.extras ex
     where ex.id = p_extra and ex.restaurant_id = p_sede;
    if not found then
      return query select null::numeric, null::integer, false, false, 'no_existe'::text;
      return;
    end if;
    precio := e.price;
    motivo := case
      when not e.is_active or e.price is null or e.price < 0 then 'inactivo'
      when not e.asignado then 'no_asignado'
      when agotado then 'agotado'
    end;
  end if;
  vendible := motivo is null or motivo = 'agotado';
  return next;
end $$;

-- Qué le falta a la sede para publicar el portal. [] = completo.
create function public.portal_faltantes_de(p_sede uuid)
returns text[]
language plpgsql stable security definer
set search_path = public
as $$
declare
  s public.portal_sedes%rowtype;
  v text[] := '{}';
begin
  select * into s from public.portal_sedes where restaurant_id = p_sede;
  if not found then return array['la configuración del portal']; end if;

  if s.lat is null then v := array_append(v, 'la ubicación del local'::text); end if;
  if s.zona_tipo is null
     or (s.zona_tipo = 'radio' and s.zona_radio_m is null)
     or (s.zona_tipo = 'poligono' and s.zona_poligono is null) then
    v := array_append(v, 'la zona de cobertura'::text);
  elsif s.zona_tipo = 'poligono' and s.lat is not null
        and not geo_en_poligono(s.lat, s.lng, s.zona_poligono) then
    v := array_append(v, 'que el local quede dentro de la zona de cobertura'::text);
  end if;
  if s.envio_tipo is null
     or (s.envio_tipo = 'fijo' and s.envio_fijo is null)
     or (s.envio_tipo = 'distancia' and s.envio_tramos is null) then
    v := array_append(v, 'el valor del envío'::text);
  end if;
  if s.tiempo_min is null or s.tiempo_max is null then v := array_append(v, 'el tiempo de entrega'::text); end if;
  if not exists (select 1 from jsonb_each(s.horario) d where jsonb_array_length(d.value) > 0) then
    v := array_append(v, 'el horario'::text);
  end if;
  -- Por la regla única: agotado cuenta como configurado (el stock es de hoy, no de la configuración).
  if not exists (
    select 1
      from public.portal_productos pp
      cross join lateral portal_disponibilidad(p_sede, pp.product_id) d
     where pp.restaurant_id = p_sede and d.vendible) then
    v := array_append(v, 'al menos un producto publicado que se pueda vender (activo, de una categoría activa y con precio)'::text);
  end if;
  return v;
end $$;

-- ¿Recibe pedidos ahora? {recibe, motivo, faltantes}. Horario en America/Bogota.
create function public.portal_estado_de(p_sede uuid, p_ahora timestamptz)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  s public.portal_sedes%rowtype;
  v_faltantes text[];
  v_local timestamp := p_ahora at time zone 'America/Bogota';
  v_dia text := extract(isodow from v_local)::int::text;
  v_ayer text := (case when extract(isodow from v_local)::int = 1 then 7 else extract(isodow from v_local)::int - 1 end)::text;
  v_hora time := v_local::time;
  v_abierto boolean := false;
  f jsonb;
  a time; c time;
begin
  select * into s from public.portal_sedes where restaurant_id = p_sede;
  if not found then
    return jsonb_build_object('recibe', false, 'motivo', 'sin_configurar', 'faltantes', to_jsonb(array['la configuración del portal']));
  end if;
  v_faltantes := portal_faltantes_de(p_sede);
  if not s.activo then
    return jsonb_build_object('recibe', false, 'motivo', 'desactivado', 'faltantes', to_jsonb(v_faltantes));
  end if;
  if cardinality(v_faltantes) > 0 then
    return jsonb_build_object('recibe', false, 'motivo', 'incompleto', 'faltantes', to_jsonb(v_faltantes));
  end if;
  if s.pausado then
    return jsonb_build_object('recibe', false, 'motivo', 'pausado', 'faltantes', '[]'::jsonb);
  end if;

  -- Franjas de hoy: [abre, cierra) o, si pasa la medianoche, desde abre hasta el fin del día.
  for f in select value from jsonb_array_elements(coalesce(s.horario->v_dia, '[]'::jsonb)) loop
    a := (f->>0)::time; c := (f->>1)::time;
    if (c > a and v_hora >= a and v_hora < c) or (c < a and v_hora >= a) then v_abierto := true; end if;
  end loop;
  -- Franjas de ayer que pasan la medianoche: desde las 00:00 hasta cierra.
  for f in select value from jsonb_array_elements(coalesce(s.horario->v_ayer, '[]'::jsonb)) loop
    a := (f->>0)::time; c := (f->>1)::time;
    if c < a and v_hora < c then v_abierto := true; end if;
  end loop;
  if not v_abierto then
    return jsonb_build_object('recibe', false, 'motivo', 'fuera_de_horario', 'faltantes', '[]'::jsonb);
  end if;

  if not exists (select 1 from public.cash_shifts where restaurant_id = p_sede and closed_at is null) then
    return jsonb_build_object('recibe', false, 'motivo', 'sin_turno', 'faltantes', '[]'::jsonb);
  end if;
  return jsonb_build_object('recibe', true, 'motivo', null, 'faltantes', '[]'::jsonb);
end $$;

-- ── 4. Funciones de la app ──

create function public.portal_estado(p_ahora timestamptz default now())
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_sede uuid := get_my_restaurant_id();
begin
  if auth.uid() is null then raise exception 'No hay sesión'; end if;
  if v_sede is null then raise exception 'No tienes una sede activa'; end if;
  if not (has_permission('pedidos_online.gestionar') or has_permission('delivery.gestionar')) then
    raise exception 'No tienes permiso para ver el estado de los pedidos en línea';
  end if;
  return portal_estado_de(v_sede, p_ahora);
end $$;

create function public.portal_config()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_sede uuid := get_my_restaurant_id();
  v_fila jsonb;
begin
  if auth.uid() is null then raise exception 'No hay sesión'; end if;
  if v_sede is null then raise exception 'No tienes una sede activa'; end if;
  if not has_permission('pedidos_online.gestionar') then
    raise exception 'No tienes permiso para configurar los pedidos en línea';
  end if;
  select to_jsonb(s) - 'restaurant_id' - 'updated_by' - 'pausado_por' into v_fila
    from public.portal_sedes s where s.restaurant_id = v_sede;
  return jsonb_build_object('portal', v_fila, 'estado', portal_estado_de(v_sede, now()));
end $$;

create function public.portal_slug_disponible(p_slug text)
returns boolean
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_sede uuid := get_my_restaurant_id();
  v_slug text := lower(btrim(coalesce(p_slug, '')));
begin
  if auth.uid() is null then raise exception 'No hay sesión'; end if;
  if v_sede is null then raise exception 'No tienes una sede activa'; end if;
  if not has_permission('pedidos_online.gestionar') then
    raise exception 'No tienes permiso para configurar los pedidos en línea';
  end if;
  if v_slug !~ '^[a-z0-9]([a-z0-9-]{1,38})[a-z0-9]$' then return false; end if;
  return not exists (select 1 from public.portal_sedes where slug = v_slug and restaurant_id <> v_sede);
end $$;

-- Mensaje para cada CHECK de portal_sedes (lo que ve el usuario si el navegador dejó pasar algo).
create function public.portal_mensaje_restriccion(p_restriccion text)
returns text
language sql immutable
set search_path = public
as $$
  select case p_restriccion
    when 'portal_sedes_slug_formato'  then 'El link solo puede tener letras minúsculas sin tildes, números y guiones (de 3 a 40), sin guion al principio ni al final.'
    when 'portal_sedes_ubicacion'     then 'La ubicación del local no es válida.'
    when 'portal_sedes_zona_tipo'     then 'La zona tiene que ser un radio o un polígono dibujado.'
    when 'portal_sedes_zona_radio'    then 'El radio de la zona tiene que estar entre 200 m y 30 km.'
    when 'portal_sedes_zona_poligono' then 'La zona dibujada no es válida: necesita de 3 a 200 puntos y sus bordes no se pueden cruzar.'
    when 'portal_sedes_envio_tipo'    then 'El envío tiene que ser una tarifa fija o por distancia.'
    when 'portal_sedes_envio_fijo'    then 'La tarifa fija de envío no es válida.'
    when 'portal_sedes_envio_tramos'  then 'Los tramos de envío no son válidos: los km tienen que ir de menor a mayor y el último tramo es "más de X km".'
    when 'portal_sedes_pedido_minimo' then 'El pedido mínimo no es válido.'
    when 'portal_sedes_tiempo'        then 'El tiempo de entrega tiene que estar entre 5 y 240 minutos, y el mínimo no puede ser mayor que el máximo.'
    when 'portal_sedes_horario'       then 'El horario no es válido: cada franja necesita hora de abrir y de cerrar distintas, y hasta 3 franjas por día.'
    when 'portal_sedes_color'         then 'El color tiene que tener la forma #rrggbb.'
    when 'portal_sedes_whatsapp'      then 'El WhatsApp del local tiene que ser un celular (3xx) o un fijo (60x) de Colombia, de 10 dígitos.'
    else 'Un valor de la configuración no es válido (' || coalesce(p_restriccion, 'sin nombre') || ').'
  end
$$;

create function public.actualizar_portal(p_cambios jsonb)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  -- 🔴 La misma lista que CLAVES_PORTAL (src/lib/portal.ts). Lo demás (sede, pausa, fechas) no
  -- se escribe por aquí.
  c_claves constant text[] := array[
    'slug', 'activo', 'lat', 'lng', 'zona_tipo', 'zona_radio_m', 'zona_poligono',
    'envio_tipo', 'envio_fijo', 'envio_tramos', 'pedido_minimo', 'tiempo_min', 'tiempo_max',
    'horario', 'color', 'whatsapp'
  ];
  c_obligatorias constant text[] := array['slug', 'activo', 'pedido_minimo', 'horario'];
  v_sede      uuid := get_my_restaurant_id();
  v_ajenas    text[];
  v_borrar    text[];
  v_cambios   jsonb := p_cambios;
  v_vieja     public.portal_sedes%rowtype;
  v_nueva     public.portal_sedes%rowtype;
  v_faltantes text[];
  v_restr     text;
begin
  if auth.uid() is null then raise exception 'No hay sesión'; end if;
  if v_sede is null then raise exception 'No tienes una sede activa'; end if;
  if not has_permission('pedidos_online.gestionar') then
    raise exception 'No tienes permiso para configurar los pedidos en línea';
  end if;
  if jsonb_typeof(p_cambios) is distinct from 'object' or p_cambios = '{}'::jsonb then
    raise exception 'No hay cambios para guardar';
  end if;

  select array_agg(k order by k) into v_ajenas
    from jsonb_object_keys(p_cambios) k where k <> all (c_claves);
  if v_ajenas is not null then
    raise exception 'Clave de configuración del portal no permitida: %. No se guardó nada.', array_to_string(v_ajenas, ', ');
  end if;
  select array_agg(k order by k) into v_borrar
    from jsonb_each(p_cambios) e(k, val) where k = any (c_obligatorias) and jsonb_typeof(val) = 'null';
  if v_borrar is not null then
    raise exception 'No se puede dejar vacío: %. No se guardó nada.', array_to_string(v_borrar, ', ');
  end if;
  if v_cambios ? 'slug' then
    if jsonb_typeof(v_cambios->'slug') <> 'string' then raise exception 'El link tiene que ser un texto'; end if;
    v_cambios := jsonb_set(v_cambios, '{slug}', to_jsonb(lower(btrim(v_cambios->>'slug'))));
  end if;

  select * into v_vieja from public.portal_sedes where restaurant_id = v_sede for update;
  if not found then
    if not (v_cambios ? 'slug') then
      raise exception 'Para empezar, elige el link de tu portal';
    end if;
    v_vieja.restaurant_id := v_sede;
    v_vieja.activo := false;
    v_vieja.pausado := false;
    v_vieja.pedido_minimo := 0;
    v_vieja.horario := '{}'::jsonb;
    v_vieja.created_at := now();
  end if;

  begin
    v_nueva := jsonb_populate_record(v_vieja, v_cambios);
  exception when invalid_text_representation or invalid_parameter_value or numeric_value_out_of_range
                 or datatype_mismatch or invalid_datetime_format then
    raise exception 'Hay un valor con el tipo equivocado en la configuración del portal. No se guardó nada.';
  end;
  v_nueva.restaurant_id := v_sede;      -- nunca del cliente
  v_nueva.updated_at := now();
  v_nueva.updated_by := auth.uid();

  begin
    insert into public.portal_sedes values (v_nueva.*)
    on conflict (restaurant_id) do update set
      slug = excluded.slug, activo = excluded.activo,
      lat = excluded.lat, lng = excluded.lng,
      zona_tipo = excluded.zona_tipo, zona_radio_m = excluded.zona_radio_m, zona_poligono = excluded.zona_poligono,
      envio_tipo = excluded.envio_tipo, envio_fijo = excluded.envio_fijo, envio_tramos = excluded.envio_tramos,
      pedido_minimo = excluded.pedido_minimo, tiempo_min = excluded.tiempo_min, tiempo_max = excluded.tiempo_max,
      horario = excluded.horario, color = excluded.color, whatsapp = excluded.whatsapp,
      updated_at = excluded.updated_at, updated_by = excluded.updated_by;
  exception
    when unique_violation then
      get stacked diagnostics v_restr = constraint_name;
      if v_restr = 'portal_sedes_slug_unico' then
        raise exception 'Ese link ya lo usa otro negocio. Elige otro. No se guardó nada.';
      end if;
      raise exception 'Alguien más está guardando la configuración de esta sede en este momento. Vuelve a intentarlo. No se guardó nada.';
    when check_violation then
      get stacked diagnostics v_restr = constraint_name;
      raise exception '% No se guardó nada.', portal_mensaje_restriccion(v_restr);
  end;

  -- Publicado = completo. Vale para prenderlo y para no dejar incompleto uno ya publicado.
  if v_nueva.activo then
    v_faltantes := portal_faltantes_de(v_sede);
    if cardinality(v_faltantes) > 0 then
      raise exception 'Para publicar el portal falta: %. No se guardó nada.', array_to_string(v_faltantes, '; ');
    end if;
  end if;

  return portal_config();
end $$;

create function public.pausar_pedidos_online(p_pausar boolean)
returns jsonb
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_sede uuid := get_my_restaurant_id();
begin
  if auth.uid() is null then raise exception 'No hay sesión'; end if;
  if v_sede is null then raise exception 'No tienes una sede activa'; end if;
  if not (has_permission('pedidos_online.gestionar') or has_permission('delivery.gestionar')) then
    raise exception 'No tienes permiso para pausar los pedidos en línea';
  end if;
  if p_pausar is null then raise exception 'Indica si pausar o reanudar'; end if;
  update public.portal_sedes
     set pausado = p_pausar,
         pausado_en = case when p_pausar then now() end,
         pausado_por = case when p_pausar then auth.uid() end,
         updated_at = now(), updated_by = auth.uid()
   where restaurant_id = v_sede;
  if not found then raise exception 'Los pedidos en línea de esta sede no están configurados'; end if;
  return portal_estado_de(v_sede, now());
end $$;

create function public.portal_productos_lista()
returns table (product_id uuid, nombre text, categoria text, precio_local numeric,
               precio_domicilio numeric, publicado boolean, agotado boolean, motivo text)
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_sede uuid := get_my_restaurant_id();
begin
  if auth.uid() is null then raise exception 'No hay sesión'; end if;
  if v_sede is null then raise exception 'No tienes una sede activa'; end if;
  if not has_permission('pedidos_online.gestionar') then
    raise exception 'No tienes permiso para configurar los pedidos en línea';
  end if;
  return query
    -- agotado y motivo, de la regla única: la pantalla no decide nada por su cuenta (salvo el precio
    -- que se está escribiendo, ver SeccionProductosPortal.tsx).
    select p.id, p.name, c.name, p.price, pp.precio_domicilio, coalesce(pp.publicado, false),
           d.agotado, d.motivo
      from public.products p
      left join public.categories c on c.id = p.category_id
      left join public.portal_productos pp on pp.product_id = p.id
      cross join lateral portal_disponibilidad(v_sede, p.id) d
     where p.restaurant_id = v_sede and p.is_active
     order by c.name nulls last, p.name;
end $$;

-- p_cambios: [{"product_id": "…", "publicado": true, "precio_domicilio": 10000 | null}, …]
create function public.guardar_portal_productos(p_cambios jsonb)
returns integer
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_sede      uuid := get_my_restaurant_id();
  v_item      jsonb;
  v_id        uuid;
  v_publicado boolean;
  v_precio    numeric;
  v_prod      public.products%rowtype;
  v_vistos    uuid[] := '{}';
  v_activo    boolean;
  v_faltantes text[];
  v_motivo    text;
begin
  if auth.uid() is null then raise exception 'No hay sesión'; end if;
  if v_sede is null then raise exception 'No tienes una sede activa'; end if;
  if not has_permission('pedidos_online.gestionar') then
    raise exception 'No tienes permiso para configurar los pedidos en línea';
  end if;
  if jsonb_typeof(p_cambios) is distinct from 'array' or jsonb_array_length(p_cambios) = 0 then
    raise exception 'No hay cambios para guardar';
  end if;
  if jsonb_array_length(p_cambios) > 1000 then raise exception 'Demasiados productos en un solo guardado'; end if;
  -- Se bloquea el portal de la sede antes de tocar los productos: así nadie lo publica mientras
  -- se despublican (actualizar_portal toma la misma fila con for update).
  perform 1 from public.portal_sedes where restaurant_id = v_sede for update;

  for v_item in select value from jsonb_array_elements(p_cambios) loop
    if jsonb_typeof(v_item) <> 'object'
       or exists (select 1 from jsonb_object_keys(v_item) k where k not in ('product_id', 'publicado', 'precio_domicilio'))
       or not (v_item ? 'product_id' and v_item ? 'publicado' and v_item ? 'precio_domicilio')
       or jsonb_typeof(v_item->'publicado') <> 'boolean'
       or jsonb_typeof(v_item->'precio_domicilio') not in ('number', 'null') then
      raise exception 'Cada producto lleva product_id, publicado y precio_domicilio (número o null). No se guardó nada.';
    end if;
    begin
      v_id := (v_item->>'product_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'Un product_id no es válido. No se guardó nada.';
    end;
    if v_id = any (v_vistos) then raise exception 'Un producto viene repetido. No se guardó nada.'; end if;
    v_vistos := v_vistos || v_id;
    v_publicado := (v_item->>'publicado')::boolean;
    v_precio := (v_item->>'precio_domicilio')::numeric;

    -- Por id y contra la sede de la sesión: un producto de otra sede (o que no existe) aborta todo.
    select * into v_prod from public.products where id = v_id and restaurant_id = v_sede;
    if not found then
      raise exception 'Hay un producto que no es de esta sede. No se guardó nada.';
    end if;
    if v_precio is not null and (v_precio <= 0 or v_precio > 10000000) then
      raise exception 'El precio a domicilio de "%" no es válido (vacío = el del local). No se guardó nada.', v_prod.name;
    end if;

    insert into public.portal_productos (product_id, restaurant_id, publicado, precio_domicilio, updated_at, updated_by)
    values (v_id, v_sede, v_publicado, v_precio, now(), auth.uid())
    on conflict (product_id) do update set
      publicado = excluded.publicado, precio_domicilio = excluded.precio_domicilio,
      updated_at = excluded.updated_at, updated_by = excluded.updated_by;

    -- Publicar exige que la regla única lo deje vender, salvo por el stock de hoy (ya con el precio a
    -- domicilio guardado). Cualquier otro motivo, también uno que no esté aquí, rechaza (fail-closed).
    if v_publicado then
      select d.motivo into v_motivo from portal_disponibilidad(v_sede, v_id) d;
      if not found then
        raise exception '"%" no se puede publicar en el portal. No se guardó nada.', v_prod.name;
      elsif v_motivo = 'inactivo' then
        raise exception '"%" está inactivo en el POS: no se puede publicar. No se guardó nada.', v_prod.name;
      elsif v_motivo = 'categoria_inactiva' then
        raise exception '"%" es de una categoría desactivada en el POS: no se puede publicar. No se guardó nada.', v_prod.name;
      elsif v_motivo = 'sin_precio' then
        raise exception '"%" no tiene precio: no se puede publicar. No se guardó nada.', v_prod.name;
      elsif v_motivo is not null and v_motivo <> 'agotado' then
        raise exception '"%" no se puede publicar en el portal. No se guardó nada.', v_prod.name;
      end if;
    end if;
  end loop;

  select activo into v_activo from public.portal_sedes where restaurant_id = v_sede;
  if coalesce(v_activo, false) then
    v_faltantes := portal_faltantes_de(v_sede);
    if cardinality(v_faltantes) > 0 then
      raise exception 'El portal está publicado y quedaría sin: %. Despublícalo primero. No se guardó nada.', array_to_string(v_faltantes, '; ');
    end if;
  end if;
  return jsonb_array_length(p_cambios);
end $$;

-- ── 5. Permisos de ejecución ──
-- Internas: solo las usan las funciones de arriba y los CHECK. Ojo: un CHECK revisa el EXECUTE con
-- el USUARIO ACTUAL, no con el dueño de la tabla; aquí siempre es el dueño porque solo escriben
-- las funciones SECURITY DEFINER. Un escritor nuevo que no lo sea necesitaría EXECUTE.
revoke execute on function public.geo_distancia_m(numeric, numeric, numeric, numeric) from public, anon, authenticated;
revoke execute on function public.geo_en_poligono(numeric, numeric, jsonb)            from public, anon, authenticated;
revoke execute on function public.portal_poligono_valido(jsonb)                       from public, anon, authenticated;
revoke execute on function public.portal_tramos_validos(jsonb)                        from public, anon, authenticated;
revoke execute on function public.portal_horario_valido(jsonb)                        from public, anon, authenticated;
revoke execute on function public.portal_disponibilidad(uuid, uuid, uuid)            from public, anon, authenticated;
revoke execute on function public.portal_consumo(uuid, uuid, uuid)                   from public, anon, authenticated;
revoke execute on function public.portal_faltantes_de(uuid)                           from public, anon, authenticated;
revoke execute on function public.portal_estado_de(uuid, timestamptz)                 from public, anon, authenticated;
revoke execute on function public.portal_mensaje_restriccion(text)                    from public, anon, authenticated;
-- De la app: authenticated (cada una revisa su permiso adentro); anon no.
revoke execute on function public.portal_estado(timestamptz)          from public, anon;
revoke execute on function public.portal_config()                     from public, anon;
revoke execute on function public.portal_slug_disponible(text)        from public, anon;
revoke execute on function public.actualizar_portal(jsonb)            from public, anon;
revoke execute on function public.pausar_pedidos_online(boolean)      from public, anon;
revoke execute on function public.portal_productos_lista()            from public, anon;
revoke execute on function public.guardar_portal_productos(jsonb)     from public, anon;
grant  execute on function public.portal_estado(timestamptz)          to authenticated;
grant  execute on function public.portal_config()                     to authenticated;
grant  execute on function public.portal_slug_disponible(text)        to authenticated;
grant  execute on function public.actualizar_portal(jsonb)            to authenticated;
grant  execute on function public.pausar_pedidos_online(boolean)      to authenticated;
grant  execute on function public.portal_productos_lista()            to authenticated;
grant  execute on function public.guardar_portal_productos(jsonb)     to authenticated;

-- ── 6. Comprobación, en esta misma transacción (fail-closed) ──
do $$
declare
  v_mal text;
begin
  -- Ningún privilegio de tabla para anon ni authenticated.
  select string_agg(format('%s→%s', g.grantee, g.table_name), ', ') into v_mal
    from information_schema.role_table_grants g
   where g.table_schema = 'public' and g.table_name in ('portal_sedes', 'portal_productos')
     and g.grantee in ('anon', 'authenticated', 'PUBLIC');
  if v_mal is not null then raise exception 'Quedaron privilegios de tabla: %. No se cambió nada.', v_mal; end if;

  -- Las 7 de la app: authenticated sí, anon no. Las 10 internas: ninguno de los dos.
  select string_agg(p.oid::regprocedure::text, ', ') into v_mal
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('portal_estado', 'portal_config', 'portal_slug_disponible', 'actualizar_portal',
                       'pausar_pedidos_online', 'portal_productos_lista', 'guardar_portal_productos')
     and (has_function_privilege('anon', p.oid, 'EXECUTE') or not has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if v_mal is not null then raise exception 'Permisos de ejecución mal en: %. No se cambió nada.', v_mal; end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_mal
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('geo_distancia_m', 'geo_en_poligono', 'portal_poligono_valido', 'portal_tramos_validos',
                       'portal_horario_valido', 'portal_faltantes_de', 'portal_estado_de', 'portal_mensaje_restriccion',
                       'portal_disponibilidad', 'portal_consumo')
     and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if v_mal is not null then raise exception 'Funciones internas ejecutables desde la app: %. No se cambió nada.', v_mal; end if;

  if not (select relrowsecurity from pg_class where oid = 'public.portal_sedes'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.portal_productos'::regclass) then
    raise exception 'RLS apagada en portal_sedes o portal_productos. No se cambió nada.';
  end if;
  -- Cada CHECK de portal_sedes tiene su mensaje propio (si no, el usuario vería el genérico).
  select string_agg(conname::text, ', ' order by conname) into v_mal
    from pg_constraint
   where conrelid = 'public.portal_sedes'::regclass and contype = 'c'
     and portal_mensaje_restriccion(conname::text) like 'Un valor de la configuración no es válido%';
  if v_mal is not null then raise exception 'CHECK sin mensaje propio en portal_mensaje_restriccion: %. No se cambió nada.', v_mal; end if;
  raise notice 'portal-config: listo — 2 tablas sin acceso directo, 7 funciones para la app';
end $$;

commit;
