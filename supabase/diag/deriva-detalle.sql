-- supabase/diag/deriva-detalle.sql
-- ============================================================================
-- DIAGNÓSTICO de SOLO LECTURA. Trae las DEFINICIONES completas de los objetos
-- que la deriva (deriva-esquema.sql + scripts/deriva-comparar.mjs) marcó como
-- distintos entre prod y la base local el 2026-09-30. Con esto se escribe la
-- migración que hace que el repo describa lo que prod tiene de verdad.
--
-- QUÉ ESCRIBE: nada. RE-EJECUTAR: inofensivo.
-- No trae datos de clientes: solo definiciones de esquema, grants y la
-- configuración de los buckets de Storage.
--
-- CÓMO CORRERLO: SQL Editor → Run → Export CSV → guardalo como
-- deriva-detalle.csv (queda cubierto por .gitignore: deriva-*.csv).
-- ============================================================================

-- 1. Policies de storage.objects: prod tiene "product-images: … con permiso"
--    y "restaurant-logos: …"; el repo solo tiene las "… autenticado".
select 'policy' as tipo, policyname as nombre,
       concat_ws(E'\n', 'cmd=' || cmd, 'permissive=' || permissive,
                 'roles=' || array_to_string(roles, ','),
                 'using=' || coalesce(qual, '(null)'),
                 'with_check=' || coalesce(with_check, '(null)')) as definicion
  from pg_policies
 where schemaname = 'storage' and tablename = 'objects'

union all
-- 2. Buckets: restaurant-logos no existe en ningún .sql del repo.
select 'bucket', id,
       concat_ws(' | ', 'public=' || public::text, 'file_size_limit=' || coalesce(file_size_limit::text, 'null'),
                 'allowed_mime_types=' || coalesce(array_to_string(allowed_mime_types, ','), 'null'))
  from storage.buckets

union all
-- 3. rls_auto_enable(): solo en prod, sin rastro en el repo.
select 'funcion', p.oid::regprocedure::text,
       'prosecdef=' || p.prosecdef::text || E'\nreturns=' || p.prorettype::regtype || E'\nacl=' ||
       coalesce(p.proacl::text, '(default)') || E'\n' || pg_get_functiondef(p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'rls_auto_enable'

union all
-- 3b. ¿Quién la dispara? (si es una función de event trigger, la usa uno de estos)
select 'event_trigger', evtname,
       'evento=' || evtevent || ' | habilitado=' || evtenabled::text || ' | funcion=' || evtfoid::regprocedure ||
       ' | tags=' || coalesce(array_to_string(evttags, ','), '(todos)')
  from pg_event_trigger

union all
-- 4. ACL de las 3 funciones cuyos grants difieren (prod: anon SIN execute).
select 'acl_funcion', p.oid::regprocedure::text, coalesce(p.proacl::text, '(default)')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('get_my_role', 'get_my_restaurant_id', 'handle_new_user')

union all
-- 5. Privilegios por defecto del esquema public: explican de dónde sale el
--    grant a anon que la base local SÍ tiene y prod NO.
select 'default_acl', defaclrole::regrole::text || ' / ' || defaclobjtype::text, defaclacl::text
  from pg_default_acl d
  left join pg_namespace n on n.oid = d.defaclnamespace
 where n.nspname = 'public' or d.defaclnamespace = 0

order by 1, 2;
