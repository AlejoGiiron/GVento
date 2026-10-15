-- supabase/portal-publico.sql — Pedidos en línea, P2: lo que ve y cotiza el cliente del portal
-- ============================================================================
-- QUÉ HACE (todo es nuevo; no cambia ni borra datos existentes):
--
--   1. portal_catalogo(slug): lo que el portal muestra de un negocio. ALLOWLIST de campos, armada
--      campo por campo con jsonb_build_object (nunca to_jsonb(fila) menos claves): nombre, logo,
--      dirección, color, WhatsApp y ubicación del local; estado (recibe / motivo / abre_en);
--      tiempo, mínimo y "envío desde"; categorías con los productos PUBLICADOS, activos y con
--      precio, su precio efectivo (el de domicilio o el del local), si están agotados y sus extras
--      activos. NUNCA sale el costo, el stock exacto, la zona ni nada de otra sede. (Ojo: el stock
--      hasta 50 unidades SÍ se puede deducir cotizando cantidades crecientes hasta ver sin_stock;
--      es inherente a no dejar pedir de más. Ver DEUDAS → "Portal público (P2)".)
--      Un portal que no está publicado o quedó incompleto responde {"disponible": false} y nada más.
--   2. portal_calcular(sede, ítems, lat, lng, ahora): 🔴 EL ÚNICO CÁLCULO DE PRECIOS DEL PORTAL.
--      La usan portal_cotizar (P2) y crear el pedido (P3); las promociones (P6) entran aquí. El
--      navegador solo dice QUÉ quiere (producto, cantidad, extras); el precio de cada producto y
--      de cada extra lo pone el servidor. Valida, en este orden:
--        · la FORMA (allowlist de claves por línea y por extra, cantidades enteras, 1 a 30 líneas):
--          si no cumple, el error propio PT400 (ver ERRORES) — solo lo produce un cliente que no
--          es el portal;
--        · cada línea: lo que diga portal_disponibilidad (P1) del producto y de cada extra para ESE
--          producto. Si no se puede vender, la línea queda con problema y sin precio (un carrito
--          viejo es legítimo: no es un error, es "ya no está");
--        · el stock: lo que pide todo el carrito (simples, insumos de los compuestos por receta y
--          productos vinculados a extras) contra el stock de cada producto que lleva stock;
--        · el estado (portal_estado_de), la zona, el envío y el pedido mínimo.
--      Las cuentas son las de add_order_items_with_extras: la cantidad de un extra es POR UNIDAD
--      del producto (total = cantidad del extra × cantidad del producto).
--   3. portal_cotizar(slug, ítems, lat, lng): resuelve el slug y llama a portal_calcular. No escribe.
--   4. portal_limites + portal_contar(clave, máximo): el contador del límite por IP de la Edge
--      Function `portal`. La clave llega YA HASHEADA (HMAC-SHA256 con la sal secreta PORTAL_SAL y el
--      día de Bogotá dentro, en la función): el CHECK de forma (`acción:` + 64 hex, o `global:sin-ip`)
--      rechaza cualquier otra cosa, así que una IP en claro no se puede guardar ni por error. Cada
--      llamada a portal_contar purga las filas de hace más de un día (sin tráfico, esperan a la
--      siguiente llamada).
--
-- ERRORES: la forma inválida de los ítems o de la ubicación sale con el SQLSTATE PROPIO 'PT400'
-- (PostgREST lo devuelve como HTTP 400) y un mensaje para la pantalla. La Edge Function muestra SOLO
-- ese código (allowlist); cualquier otro error, de aquí o de Postgres, llega al cliente como genérico.
--
-- QUIÉN EJECUTA: SOLO service_role (la Edge Function `portal`, única puerta pública). Ni anon ni
-- authenticated: el tripwire de P0.2 ("anon no ejecuta ninguna función SECURITY DEFINER",
-- tests/anon-sin-escritura.spec.ts) sigue sin excepciones.
--
-- 🔴 CONTRATOS EN DOS LADOS (R1):
--   · La forma de los ítems (claves de línea y de extra) y la del resultado: este archivo, la
--     Edge Function `portal` (que pasa los ítems sin tocarlos) y los tipos del navegador en
--     src/portal/api.ts. Lo vigila tests/portal-publico.spec.ts (claves exactas); tsc no mira el SQL.
--   · La forma de la clave del límite: el CHECK portal_limites_clave y claveLimite() / ACCIONES en
--     supabase/functions/portal/reglas.ts.
--   · El precio y "se puede vender": los decide portal_disponibilidad (portal-config.sql, P1), la
--     ÚNICA regla (R1 #12 d), por su columna vendible; la usan el catálogo y portal_calcular (el spec
--     compara los dos, producto por producto). Qué stock consume cada unidad lo dice portal_consumo
--     (P1, R1 #12 e); aquí solo se SUMA el carrito (puede pedir varias veces el mismo insumo) y se
--     compara contra el stock: con cantidad 1 coincide con el "agotado" de la regla, para un producto
--     solo. Si un extra consume el mismo stock que su producto (el producto ligado es el mismo o un
--     insumo de su receta), el carrito suma los dos y puede dar sin_stock aunque el catálogo muestre
--     los dos disponibles: es la demanda real, la misma que descontaría el POS.
--   · Nunca sale al cliente cuántas unidades quedan: solo agotado / sin_stock ("no alcanza para esa
--     cantidad"). El spec fija las claves exactas de la respuesta.
--
-- PRECONDICIONES: portal-config.sql (P1), con las versiones de abajo (md5 en la guarda).
-- FRONTEND: nada del frontend actual lo usa. Va ANTES de desplegar la Edge Function `portal`.
-- RE-APLICAR: falla y hace rollback (la guarda del paso 0 aborta si portal_limites ya existe).
--
-- NO DEDUZCAS EL ESTADO DE ESTE COMENTARIO — correlo:
--   select to_regclass('public.portal_limites'),
--          to_regprocedure('public.portal_calcular(uuid,jsonb,numeric,numeric,timestamptz)');
--   -- null, null = no está · con valor, con valor = está. Para saber si es EXACTAMENTE esta versión:
--   -- la consulta 4 del pre-flight (md5 de las 9 funciones). · una con valor y la otra null = estado
--   -- parcial (no debería poder pasar: todo va en una transacción): no apliques ni reviertas, avísame.
-- ============================================================================

begin;

set local lock_timeout = '3s';
set local statement_timeout = '60s';

-- ── 0. Guarda ──
do $$
begin
  if to_regclass('public.portal_limites') is not null then
    raise exception 'portal-publico.sql ya está aplicada (existe portal_limites). No se cambió nada.';
  end if;
  -- Las funciones de P1 que este archivo usa, en la versión con la que se probó (md5 normalizado).
  if (select count(*) from pg_proc p
       where (p.oid::regprocedure::text, md5(regexp_replace(regexp_replace(pg_get_functiondef(p.oid), E'\r','','g'), E'[ \t]+\n', E'\n','g'))) in (
               ('portal_estado_de(uuid,timestamp with time zone)', '767360ed8650f2286688f6e22e1a6222'),
               ('portal_faltantes_de(uuid)',                       '61a6cbce7bf2d023f33155f210ad3711'),
               ('portal_disponibilidad(uuid,uuid,uuid)',           '74bd007f093a7be9d41131835e043090'),
               ('portal_consumo(uuid,uuid,uuid)',                  'e75f6b0bfb744c0219f024724e60cf3c'),
               ('geo_distancia_m(numeric,numeric,numeric,numeric)', 'a44665562016bdfdc22097466577f6b4'),
               ('geo_en_poligono(numeric,numeric,jsonb)',          'c462b6ef6ac36622da383d063f511a8c'))) <> 6 then
    raise exception 'Precondición: portal_estado_de, portal_faltantes_de, portal_disponibilidad, portal_consumo, geo_distancia_m o geo_en_poligono no son las de portal-config.sql (md5). No se cambió nada.';
  end if;
end $$;

-- ── 1. Contador del límite por IP ──
create table public.portal_limites (
  clave    text        not null,
  ventana  timestamptz not null,
  cuenta   integer     not null,
  primary key (clave, ventana),
  -- La IP NUNCA en claro: la función manda `<acción>:` + HMAC-SHA256 en hex, o `global:sin-ip`
  -- (un solo balde para todo lo que llega sin IP; un `<acción>:sin-ip` se rechaza).
  constraint portal_limites_clave check (clave ~ '^([a-z_]{1,20}:[0-9a-f]{64}|global:sin-ip)$')
);
create index portal_limites_ventana on public.portal_limites (ventana);
alter table public.portal_limites enable row level security;
revoke all on table public.portal_limites from public, anon, authenticated;

-- ── 2. Funciones internas ──

-- Un número JSON entero entre a y b (false para cualquier otra cosa, null incluido).
create function public.portal_entero_entre(j jsonb, a integer, b integer)
returns boolean
language sql immutable
set search_path = public
as $$
  -- case y no and: SQL no garantiza el orden de un and, y castear un string a numeric revienta.
  select case when jsonb_typeof(j) = 'number'
              then (j::text)::numeric = trunc((j::text)::numeric) and (j::text)::numeric between a and b
              else false end
$$;

-- Un string JSON con forma de uuid → uuid; cualquier otra cosa → null.
create function public.portal_uuid(j jsonb)
returns uuid
language sql immutable
set search_path = public
as $$
  select case when jsonb_typeof(j) = 'string'
                   and (j #>> '{}') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
              then (j #>> '{}')::uuid end
$$;

-- El portal de un slug, solo si está publicado y completo. null en cualquier otro caso.
create function public.portal_sede_de_slug(p_slug text)
returns uuid
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_sede uuid;
begin
  if p_slug is null or char_length(p_slug) > 40 then return null; end if;
  select restaurant_id into v_sede from public.portal_sedes
   where slug = lower(btrim(p_slug)) and activo;
  if v_sede is null or cardinality(portal_faltantes_de(v_sede)) > 0 then return null; end if;
  return v_sede;
end $$;

-- Próxima hora de apertura según el horario (America/Bogota, R7), dentro de 8 días. null = ninguna.
create function public.portal_proxima_apertura(p_sede uuid, p_ahora timestamptz)
returns timestamptz
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_horario jsonb;
  v_local   timestamp := p_ahora at time zone 'America/Bogota';
  v_fecha   date;
  v_inicio  timestamp;
  v_mejor   timestamp;
  f         jsonb;
begin
  select horario into v_horario from public.portal_sedes where restaurant_id = p_sede;
  if v_horario is null then return null; end if;
  for d in 0 .. 7 loop
    v_fecha := v_local::date + d;
    for f in select value from jsonb_array_elements(coalesce(v_horario->(extract(isodow from v_fecha)::int::text), '[]'::jsonb)) loop
      v_inicio := v_fecha + (f->>0)::time;
      if v_inicio > v_local and (v_mejor is null or v_inicio < v_mejor) then v_mejor := v_inicio; end if;
    end loop;
    exit when v_mejor is not null;
  end loop;
  return v_mejor at time zone 'America/Bogota';
end $$;

-- El estado que ve el cliente: {recibe, motivo, abre_en}. abre_en solo fuera de horario.
create function public.portal_estado_publico(p_sede uuid, p_ahora timestamptz)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v jsonb := portal_estado_de(p_sede, p_ahora);
begin
  return jsonb_build_object(
    'recibe', (v->>'recibe')::boolean,
    'motivo', v->>'motivo',
    'abre_en', case when v->>'motivo' = 'fuera_de_horario' then portal_proxima_apertura(p_sede, p_ahora) end);
end $$;

-- 🔴 EL cálculo. p_items: [{"product_id": uuid, "cantidad": 1..50,
--                          "extras": [{"extra_id": uuid, "cantidad": 1..5}] (opcional, hasta 10),
--                          "nota": texto hasta 140 (opcional)}], de 1 a 30 líneas.
-- Devuelve {lineas, subtotal, envio, total, distancia_m, en_zona, pedido_minimo,
--           falta_para_minimo, estado, motivos, puede_pedir}. motivos ⊆ cerrado, productos,
-- sin_ubicacion, fuera_de_zona, bajo_minimo. puede_pedir = sin motivos.
create function public.portal_calcular(p_sede uuid, p_items jsonb, p_lat numeric, p_lng numeric, p_ahora timestamptz)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  c_claves_linea constant text[] := array['product_id', 'cantidad', 'extras', 'nota'];
  c_claves_extra constant text[] := array['extra_id', 'cantidad'];
  s            public.portal_sedes%rowtype;
  v_item       jsonb;
  v_extra      jsonb;
  v_pid        uuid;
  v_eid        uuid;
  v_cant       integer;
  v_ecant      integer;
  v_vistos     uuid[];
  v_prod       record;
  v_ext        record;
  v_comp       record;
  v_problema   text;
  v_total_lin  numeric;
  v_extras_out jsonb;
  v_usa        jsonb;                 -- {producto con stock: unidades} que usa esta línea
  v_demanda    jsonb := '{}'::jsonb;  -- lo mismo, sumado en todo el carrito
  v_lineas     jsonb := '[]'::jsonb;
  v_usos       jsonb := '[]'::jsonb;
  v_cortos     text[];
  v_linea      jsonb;
  v_salida     jsonb := '[]'::jsonb;
  v_subtotal   numeric := 0;
  v_hay_prob   boolean := false;
  v_estado     jsonb;
  v_motivos    text[] := '{}';
  v_dist       numeric;
  v_en_zona    boolean;
  v_envio      numeric;
begin
  select * into s from public.portal_sedes where restaurant_id = p_sede;
  if not found then raise exception 'portal_calcular: la sede no tiene portal'; end if;

  -- 1. FORMA (todo el carrito antes de mirar un solo precio). Allowlist de claves.
  --    Error PROPIO 'PT400'. Un `or` de SQL no garantiza el orden de evaluación: si alguna parte
  --    revienta antes que la que la protegía (jsonb_object_keys sobre un escalar → 22023, un cast →
  --    22P02), el bloque lo convierte en el mensaje de forma, nunca en un texto interno de Postgres.
  --    Atrapa SOLO data_exception (clase 22, la de esos errores): un permiso, una función que falta o
  --    falta de memoria NO se disfrazan de culpa del cliente; salen como error (500 y al log).
  --    Es defensa en profundidad: ninguna de las entradas probadas llega a ese caso (el mutante que
  --    quita la conversión sobrevive).
  begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 30 then
    raise exception using errcode = 'PT400', message = 'El pedido tiene que tener de 1 a 30 productos.';
  end if;
  if (p_lat is null) <> (p_lng is null) or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception using errcode = 'PT400', message = 'La ubicación no es válida.';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object'
       or exists (select 1 from jsonb_object_keys(v_item) k where k <> all (c_claves_linea))
       or portal_uuid(v_item->'product_id') is null
       or not portal_entero_entre(v_item->'cantidad', 1, 50)
       or (v_item ? 'extras' and (jsonb_typeof(v_item->'extras') <> 'array' or jsonb_array_length(v_item->'extras') > 10))
       or (v_item ? 'nota' and jsonb_typeof(v_item->'nota') not in ('string', 'null'))
       or char_length(coalesce(v_item->>'nota', '')) > 140 then
      raise exception using errcode = 'PT400',
        message = 'Cada producto lleva product_id y cantidad (1 a 50); extras y nota son opcionales.';
    end if;
    v_vistos := '{}';
    for v_extra in select value from jsonb_array_elements(coalesce(v_item->'extras', '[]'::jsonb)) loop
      if jsonb_typeof(v_extra) <> 'object'
         or exists (select 1 from jsonb_object_keys(v_extra) k where k <> all (c_claves_extra))
         or portal_uuid(v_extra->'extra_id') is null
         or not portal_entero_entre(v_extra->'cantidad', 1, 5)
         or portal_uuid(v_extra->'extra_id') = any (v_vistos) then
        raise exception using errcode = 'PT400',
          message = 'Cada extra lleva extra_id y cantidad (1 a 5), sin repetirse en el mismo producto.';
      end if;
      v_vistos := v_vistos || portal_uuid(v_extra->'extra_id');
    end loop;
  end loop;
  exception
    when sqlstate 'PT400' then raise;
    when data_exception then
      raise exception using errcode = 'PT400', message = 'El pedido no tiene la forma esperada.';
  end;

  -- 2. CADA LÍNEA, con los precios de la base.
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_pid := portal_uuid(v_item->'product_id');
    v_cant := (v_item->>'cantidad')::numeric::integer;   -- "1.0" pasa la forma; ::integer directo revienta
    v_problema := null;
    v_extras_out := '[]'::jsonb;
    v_usa := '{}'::jsonb;
    v_total_lin := null;

    -- Por id y contra la sede; precio y "se puede vender" por la regla única de P1. "agotado" no es
    -- problema aquí: lo decide abajo la demanda de TODO el carrito contra el stock.
    select p.id, p.name, d.precio, d.vendible
      into v_prod
      from public.products p
      cross join lateral portal_disponibilidad(p_sede, p.id) d
     where p.id = v_pid and p.restaurant_id = p_sede;
    if not found or not v_prod.vendible then
      v_problema := 'no_disponible';
    else
      v_total_lin := v_prod.precio * v_cant;
      -- Lo que consume: portal_consumo (P1), la misma regla con la que descuenta el POS.
      for v_comp in select c.product_id, c.cantidad from portal_consumo(p_sede, v_pid) c loop
        v_usa := v_usa || jsonb_build_object(v_comp.product_id::text,
                   coalesce((v_usa->>v_comp.product_id::text)::integer, 0) + v_comp.cantidad * v_cant);
      end loop;

      -- Extras: de la sede, activos y asignados a ESTE producto. El precio, de la base.
      for v_extra in select value from jsonb_array_elements(coalesce(v_item->'extras', '[]'::jsonb)) loop
        v_eid := portal_uuid(v_extra->'extra_id');
        v_ecant := (v_extra->>'cantidad')::numeric::integer;
        select e.name, d.precio as price, d.vendible
          into v_ext
          from public.extras e
          cross join lateral portal_disponibilidad(p_sede, v_pid, e.id) d
         where e.id = v_eid and e.restaurant_id = p_sede;
        if not found or not v_ext.vendible then
          v_problema := 'extra_no_disponible';
          exit;
        end if;
        v_total_lin := v_total_lin + v_ext.price * v_ecant * v_cant;
        v_extras_out := v_extras_out || jsonb_build_object(
          'extra_id', v_eid, 'nombre', v_ext.name, 'cantidad', v_ecant, 'precio_unitario', v_ext.price);
        for v_comp in select c.product_id, c.cantidad from portal_consumo(p_sede, v_pid, v_eid) c loop
          v_usa := v_usa || jsonb_build_object(v_comp.product_id::text,
                     coalesce((v_usa->>v_comp.product_id::text)::integer, 0) + v_comp.cantidad * v_ecant * v_cant);
        end loop;
      end loop;
    end if;

    if v_problema is null then
      select coalesce(jsonb_object_agg(k, coalesce((v_demanda->>k)::integer, 0) + coalesce((v_usa->>k)::integer, 0)), '{}'::jsonb)
        into v_demanda
        from (select jsonb_object_keys(v_demanda) as k union select jsonb_object_keys(v_usa)) t;
    end if;
    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object(
      'product_id', v_pid,
      'cantidad', v_cant,
      'nombre', case when v_problema is distinct from 'no_disponible' then v_prod.name end,
      'precio_unitario', case when v_problema is null then v_prod.precio end,
      'extras', case when v_problema is null then v_extras_out else '[]'::jsonb end,
      'total', case when v_problema is null then v_total_lin end,
      'problema', v_problema));
    v_usos := v_usos || jsonb_build_array(v_usa);
  end loop;

  -- 3. STOCK de todo el carrito: los productos con stock a los que no les alcanza.
  select array_agg(d.key) into v_cortos
    from jsonb_each_text(v_demanda) d
    join public.products p on p.id = d.key::uuid and p.restaurant_id = p_sede
   where p.stock_tracking and d.value::integer > greatest(coalesce(p.stock_qty, 0), 0);

  for i in 0 .. jsonb_array_length(v_lineas) - 1 loop
    v_linea := v_lineas->i;
    if v_linea->>'problema' is null and v_cortos is not null
       and exists (select 1 from jsonb_object_keys(v_usos->i) k where k = any (v_cortos)) then
      v_linea := v_linea || jsonb_build_object('problema', 'sin_stock', 'precio_unitario', null,
                                               'extras', '[]'::jsonb, 'total', null);
    end if;
    if v_linea->>'problema' is null then
      v_subtotal := v_subtotal + (v_linea->>'total')::numeric;
    else
      v_hay_prob := true;
    end if;
    v_salida := v_salida || jsonb_build_array(v_linea);
  end loop;

  -- 4. Estado, zona, envío y mínimo.
  v_estado := portal_estado_publico(p_sede, p_ahora);
  if not (v_estado->>'recibe')::boolean then v_motivos := v_motivos || 'cerrado'::text; end if;
  if v_hay_prob then v_motivos := v_motivos || 'productos'::text; end if;

  if p_lat is null then
    v_motivos := v_motivos || 'sin_ubicacion'::text;
  else
    v_dist := geo_distancia_m(s.lat, s.lng, p_lat, p_lng);
    v_en_zona := case s.zona_tipo
                   when 'radio'    then v_dist <= s.zona_radio_m
                   when 'poligono' then geo_en_poligono(p_lat, p_lng, s.zona_poligono)
                   else false
                 end;
    if not v_en_zona then
      v_motivos := v_motivos || 'fuera_de_zona'::text;
    elsif s.envio_tipo = 'fijo' then
      v_envio := s.envio_fijo;
    elsif s.envio_tipo = 'distancia' then
      select (t->>'valor')::numeric into v_envio
        from jsonb_array_elements(s.envio_tramos) with ordinality a(t, n)
       where jsonb_typeof(t->'hasta_km') = 'null' or v_dist / 1000.0 <= (t->>'hasta_km')::numeric
       order by n
       limit 1;
    end if;
    -- En zona y sin tarifa = configuración rota: no se deja pedir (fail-closed).
    if v_en_zona and v_envio is null then v_motivos := v_motivos || 'fuera_de_zona'::text; end if;
  end if;

  if v_subtotal < s.pedido_minimo then v_motivos := v_motivos || 'bajo_minimo'::text; end if;

  return jsonb_build_object(
    'lineas', v_salida,
    'subtotal', v_subtotal,
    'envio', v_envio,
    'total', case when v_envio is not null then v_subtotal + v_envio end,
    'distancia_m', round(v_dist),
    'en_zona', v_en_zona,
    'pedido_minimo', s.pedido_minimo,
    'falta_para_minimo', greatest(s.pedido_minimo - v_subtotal, 0),
    'estado', v_estado,
    'motivos', to_jsonb(v_motivos),
    'puede_pedir', cardinality(v_motivos) = 0);
end $$;

-- ── 3. Funciones de la Edge Function `portal` (solo service_role) ──

create function public.portal_catalogo(p_slug text, p_ahora timestamptz default now())
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_sede uuid := portal_sede_de_slug(p_slug);
  s      public.portal_sedes%rowtype;
  r      public.restaurants%rowtype;
begin
  if v_sede is null then return jsonb_build_object('disponible', false); end if;
  select * into s from public.portal_sedes where restaurant_id = v_sede;
  select * into r from public.restaurants where id = v_sede;
  return jsonb_build_object(
    'disponible', true,
    'negocio', jsonb_build_object(
      'nombre', r.name, 'logo_url', r.logo_url, 'direccion', r.address,
      'color', s.color, 'whatsapp', s.whatsapp, 'lat', s.lat, 'lng', s.lng),
    'estado', portal_estado_publico(v_sede, p_ahora),
    'entrega', jsonb_build_object(
      'tiempo_min', s.tiempo_min, 'tiempo_max', s.tiempo_max, 'pedido_minimo', s.pedido_minimo,
      'envio_tipo', s.envio_tipo,
      'envio_desde', case s.envio_tipo
                       when 'fijo' then s.envio_fijo
                       when 'distancia' then (select min((t->>'valor')::numeric) from jsonb_array_elements(s.envio_tramos) t)
                     end),
    'categorias', coalesce((
      select jsonb_agg(cat.j order by cat.orden, cat.nombre)
        from (
          select c.sort_order as orden, c.name as nombre,
                 jsonb_build_object('id', c.id, 'nombre', c.name, 'productos', jsonb_agg(jsonb_build_object(
                   'id', p.id,
                   'nombre', p.name,
                   'descripcion', p.description,
                   'imagen_url', p.image_url,
                   'precio', d.precio,
                   'agotado', d.agotado,
                   'extras', (
                     select coalesce(jsonb_agg(jsonb_build_object(
                              'id', e.id, 'nombre', e.name, 'precio', de.precio, 'agotado', de.agotado)
                              order by e.name), '[]'::jsonb)
                       from public.product_extras pe
                       join public.extras e on e.id = pe.extra_id
                       cross join lateral portal_disponibilidad(v_sede, p.id, e.id) de
                      where pe.product_id = p.id and de.vendible)
                 ) order by p.name)) as j
            from public.portal_productos pp
            join public.products p on p.id = pp.product_id and p.restaurant_id = v_sede
            join public.categories c on c.id = p.category_id
            cross join lateral portal_disponibilidad(v_sede, p.id) d
           where pp.restaurant_id = v_sede and d.vendible
           group by c.id, c.sort_order, c.name
        ) cat), '[]'::jsonb));
end $$;

create function public.portal_cotizar(p_slug text, p_items jsonb, p_lat numeric default null,
                                      p_lng numeric default null, p_ahora timestamptz default now())
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_sede uuid := portal_sede_de_slug(p_slug);
begin
  if v_sede is null then return jsonb_build_object('disponible', false); end if;
  return jsonb_build_object('disponible', true) || portal_calcular(v_sede, p_items, p_lat, p_lng, p_ahora);
end $$;

-- Cuenta una consulta en la ventana del minuto actual y dice si está dentro del máximo.
-- Purga lo de hace más de un día (el día va dentro del hash: al día siguiente ya no coincide).
create function public.portal_contar(p_clave text, p_max integer)
returns boolean
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_cuenta integer;
begin
  if p_max is null or p_max < 1 then raise exception 'portal_contar: máximo inválido'; end if;
  insert into public.portal_limites as l (clave, ventana, cuenta)
  values (p_clave, date_trunc('minute', now()), 1)
  on conflict (clave, ventana) do update set cuenta = l.cuenta + 1
  returning cuenta into v_cuenta;
  delete from public.portal_limites where ventana < now() - interval '1 day';
  return v_cuenta <= p_max;
end $$;

-- ── 4. Permisos de ejecución: solo service_role ──
do $$
declare
  f text;
begin
  foreach f in array array[
    'portal_entero_entre(jsonb,integer,integer)', 'portal_uuid(jsonb)',
    'portal_sede_de_slug(text)',
    'portal_proxima_apertura(uuid,timestamptz)', 'portal_estado_publico(uuid,timestamptz)',
    'portal_calcular(uuid,jsonb,numeric,numeric,timestamptz)',
    'portal_catalogo(text,timestamptz)', 'portal_cotizar(text,jsonb,numeric,numeric,timestamptz)',
    'portal_contar(text,integer)']
  loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- ── 5. Comprobación, en esta misma transacción (fail-closed) ──
do $$
declare
  v_mal text;
begin
  select string_agg(format('%s→%s', g.grantee, g.privilege_type), ', ') into v_mal
    from information_schema.role_table_grants g
   where g.table_schema = 'public' and g.table_name = 'portal_limites'
     and g.grantee in ('anon', 'authenticated', 'PUBLIC');
  if v_mal is not null then raise exception 'Quedaron privilegios en portal_limites: %. No se cambió nada.', v_mal; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.portal_limites'::regclass) then
    raise exception 'RLS apagada en portal_limites. No se cambió nada.';
  end if;

  -- Por la CLASE, no por la lista de arriba (R2): TODA función portal_* o geo_* de public.
  --   · anon: ninguna.
  --   · authenticated: solo las 4 de la app de P1 que tienen el prefijo portal_ (allowlist); las otras
  --     3 de la app de P1 (actualizar_portal, guardar_portal_productos, pausar_pedidos_online) no
  --     entran en el filtro por nombre. Ninguna de este archivo.
  --   · service_role: las de este archivo (las que llama la Edge Function o usan esas).
  select string_agg(p.oid::regprocedure::text, ', ') into v_mal
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and (p.proname like 'portal\_%' or p.proname like 'geo\_%')
     and (has_function_privilege('anon', p.oid, 'EXECUTE')
          or (has_function_privilege('authenticated', p.oid, 'EXECUTE')
              and p.proname not in ('portal_estado', 'portal_config', 'portal_slug_disponible', 'portal_productos_lista')));
  if v_mal is not null then raise exception 'Funciones del portal ejecutables por anon o authenticated sin estar en la lista: %. No se cambió nada.', v_mal; end if;
  select string_agg(f, ', ') into v_mal
    from unnest(array[
      'portal_entero_entre(jsonb,integer,integer)', 'portal_uuid(jsonb)',
      'portal_sede_de_slug(text)',
      'portal_proxima_apertura(uuid,timestamptz)', 'portal_estado_publico(uuid,timestamptz)',
      'portal_calcular(uuid,jsonb,numeric,numeric,timestamptz)',
      'portal_catalogo(text,timestamptz)', 'portal_cotizar(text,jsonb,numeric,numeric,timestamptz)',
      'portal_contar(text,integer)']) f
   where not has_function_privilege('service_role', f::regprocedure, 'EXECUTE');
  if v_mal is not null then raise exception 'service_role no ejecuta: %. No se cambió nada.', v_mal; end if;

  -- El tripwire de P0.2, en la misma transacción: anon no ejecuta NINGUNA función DEFINER.
  select string_agg(p.oid::regprocedure::text, ', ') into v_mal
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_mal is not null then raise exception 'anon ejecuta funciones SECURITY DEFINER: %. No se cambió nada.', v_mal; end if;
  raise notice 'portal-publico: listo — 9 funciones solo para service_role, contador sin acceso directo';
end $$;

commit;
