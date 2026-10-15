-- supabase/diag/portal-publico-preflight.sql — SOLO LECTURA. Antes y después de
-- supabase/portal-publico.sql (Pedidos en línea, P2). Cada consulta por separado.

-- ── Consulta 1: ¿ya está? ──
select to_regclass('public.portal_limites')                                              as portal_limites,
       to_regprocedure('public.portal_calcular(uuid,jsonb,numeric,numeric,timestamptz)') as portal_calcular,
       to_regprocedure('public.portal_catalogo(text,timestamptz)')                       as portal_catalogo;
-- ANTES:   null · null · null
-- DESPUÉS: portal_limites · portal_calcular(…) · portal_catalogo(…)

-- ── Consulta 2 (ANTES): la precondición — las funciones de P1 que usa, en la versión probada ──
select f.firma,
       md5(regexp_replace(regexp_replace(pg_get_functiondef(to_regprocedure('public.' || f.firma)), E'\r','','g'), E'[ \t]+\n', E'\n','g')) as md5,
       md5(regexp_replace(regexp_replace(pg_get_functiondef(to_regprocedure('public.' || f.firma)), E'\r','','g'), E'[ \t]+\n', E'\n','g')) = f.esperado as como_se_espera
  from (values ('portal_estado_de(uuid,timestamptz)',                 '767360ed8650f2286688f6e22e1a6222'),
               ('portal_faltantes_de(uuid)',                          'a1103ee7eebbbfa0e79705fe2f9de1ad'),
               ('portal_disponibilidad(uuid,uuid,uuid)',              '062b1a81cd955da4a022e0fbf6a0e574'),
               ('geo_distancia_m(numeric,numeric,numeric,numeric)',   'a44665562016bdfdc22097466577f6b4'),
               ('geo_en_poligono(numeric,numeric,jsonb)',             'c462b6ef6ac36622da383d063f511a8c')) f(firma, esperado);
-- Esperado: 5 filas con como_se_espera = t. Una f o vacía (la función no existe): P1 no
-- está, o está otra versión. No apliques; avísame con la fila.

-- ── Consulta 3 (DESPUÉS): quién ejecuta qué ──
select (select count(*) from pg_proc p
         where p.pronamespace = 'public'::regnamespace
           and (p.proname like 'portal\_%' or p.proname like 'geo\_%')
           and has_function_privilege('anon', p.oid, 'EXECUTE'))                       as portal_para_anon,
       (select count(*) from pg_proc p
         where p.pronamespace = 'public'::regnamespace
           and (p.proname like 'portal\_%' or p.proname like 'geo\_%')
           and has_function_privilege('authenticated', p.oid, 'EXECUTE')
           -- las 4 de la app de P1 con prefijo portal_ (las otras 3 de P1 no entran en el filtro)
           and p.proname not in ('portal_estado', 'portal_config', 'portal_slug_disponible',
                                 'portal_productos_lista'))                             as portal_para_authenticated_de_mas,
       (select count(*) from pg_proc p
         where p.pronamespace = 'public'::regnamespace
           and p.proname in ('portal_catalogo', 'portal_cotizar', 'portal_contar')
           and has_function_privilege('service_role', p.oid, 'EXECUTE'))               as para_la_edge_function,
       (select count(*) from pg_proc p
         where p.pronamespace = 'public'::regnamespace and p.prosecdef
           and has_function_privilege('anon', p.oid, 'EXECUTE'))                       as definer_para_anon,
       (select count(*) from information_schema.role_table_grants
         where table_schema = 'public' and table_name = 'portal_limites'
           and grantee in ('anon', 'authenticated', 'PUBLIC'))                         as privilegios_contador;
-- DESPUÉS: 0 · 0 · 3 · 0 · 0

-- ── Consulta 4 (DESPUÉS): las 9 funciones con el md5 que espera la reversa, y la RLS del contador ──
select f.firma,
       md5(regexp_replace(regexp_replace(pg_get_functiondef(to_regprocedure('public.' || f.firma)), E'\r','','g'), E'[ \t]+\n', E'\n','g')) = f.esperado as como_la_reversa,
       (select relrowsecurity from pg_class where oid = 'public.portal_limites'::regclass) as rls_contador
  from (values
    ('portal_entero_entre(jsonb,integer,integer)',              '873a49c6a8155a3dad14d8bf9b513132'),
    ('portal_uuid(jsonb)',                                      '2f04226324a92b3ca53ae52129b3ba6e'),
    ('portal_sede_de_slug(text)',                               'eb901b623062769e3461edec8a1aa55f'),
    ('portal_proxima_apertura(uuid,timestamptz)',               '8139ac42233e9122b7e5e19d362b84ee'),
    ('portal_estado_publico(uuid,timestamptz)',                 'eba92cbd2cb296d0626b94ef935ab11a'),
    ('portal_calcular(uuid,jsonb,numeric,numeric,timestamptz)', '505fb553c0ab4aab0b7e5c3ac589a81c'),
    ('portal_catalogo(text,timestamptz)',                       'd49a9270c442db8f98ed10b93d0d210a'),
    ('portal_cotizar(text,jsonb,numeric,numeric,timestamptz)',  'eb2724105e78bcd6efd0250d6b7ebd32'),
    ('portal_contar(text,integer)',                             'a9be6cef366b66ac009e06cf1d12c6c1')) f(firma, esperado);
-- DESPUÉS: 9 filas con como_la_reversa = t y rls_contador = t. Una f: lo aplicado no es este archivo
-- (o pg_get_functiondef formatea distinto en prod); la reversa abortaría. Avísame con la fila.
