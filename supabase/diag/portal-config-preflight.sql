-- supabase/diag/portal-config-preflight.sql — SOLO LECTURA. Antes y después de
-- supabase/portal-config.sql (Pedidos en línea, P1) y del seed-system-roles.sql regenerado.
-- Cada consulta por separado.

-- ── Consulta 1: ¿ya está? (antes: todo null / f; después: todo con valor / t) ──
select to_regclass('public.portal_sedes')                         as portal_sedes,
       to_regclass('public.portal_productos')                     as portal_productos,
       to_regclass('public.products_id_restaurant_uniq')          as indice_products,
       to_regprocedure('public.actualizar_portal(jsonb)')         as actualizar_portal,
       position('pedidos_online.gestionar' in pg_get_functiondef('public.seed_system_roles(uuid)'::regprocedure)) > 0
                                                                   as seed_con_permiso_nuevo,
       exists (select 1 from information_schema.columns where table_schema = 'public'
                and table_name = 'portal_sedes' and column_name = 'whatsapp')
                                                                   as con_whatsapp,
       to_regprocedure('public.portal_disponibilidad(uuid,uuid,uuid)') is not null
                                                                   as con_regla_unica;
-- ANTES:   null · null · null · null · f · f · f
-- DESPUÉS: portal_sedes · portal_productos · products_id_restaurant_uniq · actualizar_portal(jsonb) · t · t · t
-- (portal_sedes con valor pero con_whatsapp o con_regla_unica = f: corrió una versión anterior de este
-- archivo; avísame)

-- ── Consulta 2: quién podrá configurar el portal en cada organización ──
-- Arranca de organizations (caso #12): una organización sin roles sale igual.
-- P1 NO le agrega el permiso a ningún rol existente: lo tiene quien tiene el comodín '*'.
-- Un admin de una organización ya creada lo recibe solo si se lo dan en Roles y permisos.
select o.name as organizacion, o.id as organizacion_id,
       coalesce(string_agg(distinct r.name, ', ') filter (where r.permissions ? '*' or r.permissions ? 'pedidos_online.gestionar'), '(nadie)')
         as roles_que_configuran,
       count(distinct p.id) filter (where p.is_active and (r.permissions ? '*' or r.permissions ? 'pedidos_online.gestionar'))
         as usuarios_activos_que_configuran
  from public.organizations o
  left join public.roles r on r.organization_id = o.id
  left join public.profiles p on p.role_id = r.id
 group by o.name, o.id, o.created_at
 order by o.created_at;
-- Esperado (decisión del 2026-10-13): Salchimelo → owner (7f697c91…), 1 usuario activo.

-- ── Consulta 3: el link sugerido de cada sede (el "Slug público" viejo, config.slug) ──
select o.name as organizacion, s.name as sede, s.id as sede_id,
       nullif(s.config->>'slug', '') as slug_viejo
  from public.organizations o
  join public.restaurants s on s.organization_id = o.id
 order by o.created_at, s.name;
-- Informativa: la pantalla de P1 lo propone como link al crear el portal. Dos sedes con el mismo
-- slug viejo no chocan hasta que las dos crean su portal; la segunda tendría que elegir otro.

-- ── Consulta 4 (DESPUÉS): nadie toca las tablas directo y las funciones están donde van ──
select (select count(*) from information_schema.role_table_grants
         where table_schema = 'public' and table_name in ('portal_sedes', 'portal_productos')
           and grantee in ('anon', 'authenticated', 'PUBLIC'))                       as privilegios_de_tabla,
       (select count(*) from pg_proc
         where pronamespace = 'public'::regnamespace
           and proname in ('portal_estado', 'portal_config', 'portal_slug_disponible', 'actualizar_portal',
                           'pausar_pedidos_online', 'portal_productos_lista', 'guardar_portal_productos')
           and has_function_privilege('authenticated', oid, 'EXECUTE')
           and not has_function_privilege('anon', oid, 'EXECUTE'))                   as funciones_app_ok,
       (select count(*) from pg_proc
         where pronamespace = 'public'::regnamespace
           and proname in ('geo_distancia_m', 'geo_en_poligono', 'portal_poligono_valido', 'portal_tramos_validos',
                           'portal_horario_valido', 'portal_faltantes_de', 'portal_estado_de', 'portal_mensaje_restriccion',
                           'portal_disponibilidad', 'portal_consumo')
           and not has_function_privilege('authenticated', oid, 'EXECUTE')
           and not has_function_privilege('anon', oid, 'EXECUTE'))                   as funciones_internas_ok,
       (select count(*) from public.portal_sedes)                                     as portales;
-- DESPUÉS: 0 · 7 · 10 · 0 (portales = 0 hasta que alguien cree el suyo en la pantalla).

-- ── Consulta 5 (ANTES): la precondición de la guarda — las funciones de permisos vigentes ──
select p.oid::regprocedure as funcion,
       md5(regexp_replace(regexp_replace(pg_get_functiondef(p.oid), E'\r','','g'), E'[ \t]+\n', E'\n','g')) as md5
  from pg_proc p
 where p.oid in ('public.has_permission(text)'::regprocedure, 'public.get_my_restaurant_id()'::regprocedure)
 order by 1;
-- Esperado: get_my_restaurant_id() 7ed39b96b4fa8da1101030aba03ee557 · has_permission(text)
-- 1a79ece7f371a2afd3a8e195d27ddb87 (las de profiles-is-active-enforced.sql). Si no, portal-config.sql
-- aborta en su guarda: no la corras y avísame.

-- ── Consulta 6 (DESPUÉS): ¿es ESTA versión? Las 17 funciones con su md5 (normalizado) ──
-- La consulta 1 solo dice si están las piezas; esta distingue una versión anterior del archivo.
select f.firma, md5(regexp_replace(regexp_replace(pg_get_functiondef(to_regprocedure('public.' || f.firma)), E'\r','','g'), E'[ \t]+\n', E'\n','g')) = f.esperado as como_este_archivo
  from (values
    ('actualizar_portal(jsonb)',                           '9d79a6ae85394e501d067a1902397fd9'),
    ('geo_distancia_m(numeric,numeric,numeric,numeric)',   'a44665562016bdfdc22097466577f6b4'),
    ('geo_en_poligono(numeric,numeric,jsonb)',             'c462b6ef6ac36622da383d063f511a8c'),
    ('guardar_portal_productos(jsonb)',                    'c079497b067391ba8c3dbb03f5568616'),
    ('pausar_pedidos_online(boolean)',                     'b49854e3158ff8010df07d580da7fe5a'),
    ('portal_config()',                                    'd29aa45ad9694123397dcd569ef83dae'),
    ('portal_consumo(uuid,uuid,uuid)',                     'e75f6b0bfb744c0219f024724e60cf3c'),
    ('portal_disponibilidad(uuid,uuid,uuid)',              '902763cecae24bbd5ae877c46bf34f74'),
    ('portal_estado_de(uuid,timestamptz)',                 '767360ed8650f2286688f6e22e1a6222'),
    ('portal_estado(timestamptz)',                         '1d2e115ad4004022ca826db9e453ed8a'),
    ('portal_faltantes_de(uuid)',                          '61a6cbce7bf2d023f33155f210ad3711'),
    ('portal_horario_valido(jsonb)',                       '68fe9c08c32513707c0c567eaf45cbf7'),
    ('portal_mensaje_restriccion(text)',                   '342339e61f82bb48eea139fe1e22a470'),
    ('portal_poligono_valido(jsonb)',                      'd1cc825e1025523aea23099b788e4994'),
    ('portal_productos_lista()',                           '9099bcb614ebfcbcf738ac5cd45f4fee'),
    ('portal_slug_disponible(text)',                       '6ac364a79a218e05b0d3ca8bffd6fc6b'),
    ('portal_tramos_validos(jsonb)',                       '31285d61c13186d008ae6906390810ba')) f(firma, esperado);
-- DESPUÉS: 17 filas con como_este_archivo = t. Una f o vacía: lo aplicado no es este archivo (o
-- pg_get_functiondef formatea distinto en prod). Avísame con la fila; la reversa también abortaría.
