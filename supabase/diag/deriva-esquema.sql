-- supabase/diag/deriva-esquema.sql
-- ============================================================================
-- DIAGNÓSTICO de SOLO LECTURA (no es migración). Pregunta: ¿la base LOCAL de
-- Docker (la que arma scripts/capturas/preparar-local.mjs) es igual a PRODUCCIÓN
-- en todo lo que define el COMPORTAMIENTO del esquema?
--
-- Por qué existe: el orden de migraciones "verificado por ejecución" (140a0f2)
-- construía una base distinta de prod SIN UN SOLO ERROR (add_order_items_with_
-- extras quedaba en la versión vieja). "Corrió sin error" no es "quedó igual a
-- prod", y una suite verde en Docker vale lo que valga esa igualdad (R4).
--
-- QUÉ DEVUELVE: filas (tipo, nombre, hash), una por objeto. Se corre IGUAL en
-- las dos bases, se exporta a CSV y scripts/deriva-comparar.mjs reporta solo las
-- diferencias. Compara ESQUEMA, no datos: LAB, clientes y seeds no cuentan.
--
-- QUÉ ESCRIBE: nada. RE-EJECUTAR: inofensivo.
--
-- NORMALIZACIÓN (para no medir ruido):
--   · Cuerpos de funciones: se quita \r y el espacio al final de línea antes del
--     md5. Local se aplicó desde archivos con CRLF; prod, pegado en el SQL
--     Editor (LF). Sin esto TODAS las funciones "diferirían".
--   · Policies, triggers, constraints, índices, vistas y defaults los
--     RECONSTRUYE Postgres desde el catálogo (pg_get_*def): no dependen del
--     texto original, sí de la versión mayor → la fila 'meta' la reporta y el
--     comparador aborta si la versión mayor no coincide.
--   · Se excluyen objetos de EXTENSIONES (pg_depend deptype 'e') y agregados.
--
-- CÓMO CORRERLO EN PROD: SQL Editor → Run → "Export" → CSV. Guardalo como
--   deriva-prod.csv y pasámelo. (Local lo corre el comparador vía docker.)
-- ============================================================================

with
fn as (
  select p.oid, n.nspname,
         p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as ident
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prokind in ('f', 'p')                         -- sin agregados ni window
     and not exists (select 1 from pg_depend d
                      where d.objid = p.oid and d.deptype = 'e')   -- sin extensiones
),
filas as (
  -- ── meta: versión del servidor (el comparador exige misma versión MAYOR) ──
  select 'meta' as tipo, 'server_version_num' as nombre,
         current_setting('server_version_num') as hash
  union all
  select 'meta', 'version', version()

  -- ── funciones: definición completa (incluye SECURITY DEFINER, search_path) ──
  union all
  select 'funcion', f.ident,
         md5(regexp_replace(regexp_replace(pg_get_functiondef(f.oid), E'\r', '', 'g'),
                            E'[ \t]+\n', E'\n', 'g'))
    from fn f

  -- ── marcador explícito: ¿add_order_items_with_extras descuenta por receta? ──
  --    Versión NUEVA (order-items-stock-recipes.sql): lee product_components y
  --    escribe stock_movements. VIEJA (order-extras-rpc.sql): ninguna de las dos.
  union all
  select 'marcador', 'add_order_items_with_extras.usa_receta',
         (pg_get_functiondef(f.oid) ilike '%product_components%')::text
    from fn f where f.ident like 'add_order_items_with_extras(%'
  union all
  select 'marcador', 'add_order_items_with_extras.crea_stock_movements',
         (pg_get_functiondef(f.oid) ilike '%stock_movements%')::text
    from fn f where f.ident like 'add_order_items_with_extras(%'

  -- ── EXECUTE de funciones para anon / authenticated (incluye el grant a PUBLIC,
  --    que Postgres da por defecto: es lo que "revoke from public" debe quitar) ──
  union all
  select 'grant_exec', r.rol || ' → ' || f.ident,
         has_function_privilege(r.rol, f.oid, 'EXECUTE')::text
    from fn f cross join (values ('anon'), ('authenticated')) r(rol)

  -- ── vistas (reportes) ──
  union all
  select 'vista', c.relname, md5(pg_get_viewdef(c.oid, true))
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('v', 'm')

  -- ── opciones de vista (security_invoker, etc.) ──
  union all
  select 'vista_opciones', c.relname, coalesce(array_to_string(c.reloptions, ','), '')
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('v', 'm')

  -- ── RLS activado por tabla ──
  union all
  select 'rls', c.relname, c.relrowsecurity::text || '/' || c.relforcerowsecurity::text
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p')

  -- ── policies (public + storage: storage-product-images.sql define ahí) ──
  union all
  select 'policy', schemaname || '.' || tablename || ' :: ' || policyname,
         md5(concat_ws(' | ', permissive, cmd, array_to_string(roles, ','),
                       coalesce(qual, ''), coalesce(with_check, '')))
    from pg_policies
   where schemaname in ('public', 'storage')

  -- ── triggers: los de tablas de public, TODOS los de tablas de auth (ahí vive
  --    el alta de usuarios: on_auth_user_created → handle_new_user; un trigger
  --    de auth que llamara a una función de OTRO esquema quedaba invisible), y
  --    los que llaman funciones de public desde cualquier esquema ──
  union all
  select 'trigger', t.tgrelid::regclass::text || ' :: ' || t.tgname,
         md5(pg_get_triggerdef(t.oid, true) || ' enabled=' || t.tgenabled::text)
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace pn on pn.oid = p.pronamespace
   where not t.tgisinternal
     and (n.nspname in ('public', 'auth') or pn.nspname = 'public')

  -- ── EVENT triggers (DDL): categoría entera que antes no se medía. Prod tiene
  --    ensure_rls → rls_auto_enable() (auto-habilita RLS en tablas nuevas de
  --    public). El DUEÑO va en fila aparte: distingue lo que crea la plataforma
  --    (supabase_admin) de lo que alguien creó como postgres ──
  union all
  select 'event_trigger', e.evtname,
         md5(concat_ws(' | ', e.evtevent, e.evtenabled::text, e.evtfoid::regprocedure::text,
                       coalesce(array_to_string(e.evttags, ','), '(todos)')))
    from pg_event_trigger e
  union all
  select 'event_trigger_dueno', e.evtname, e.evtowner::regrole::text
    from pg_event_trigger e

  -- ── buckets de Storage: son DATOS, no esquema, pero definen qué acepta la
  --    subida (público, tamaño máximo, tipos). Legibles, no hasheados ──
  union all
  select 'bucket', b.id,
         concat_ws(' | ', 'public=' || b.public::text,
                   'file_size_limit=' || coalesce(b.file_size_limit::text, 'null'),
                   'allowed_mime_types=' || coalesce(array_to_string(b.allowed_mime_types, ','), 'null'))
    from storage.buckets b

  -- ── privilegios por DEFECTO en public: deciden los grants de todo objeto
  --    nuevo (de acá venía que la base local diera EXECUTE a anon) ──
  union all
  select 'default_acl', d.defaclrole::regrole::text || ' / ' || d.defaclobjtype::text,
         d.defaclacl::text
    from pg_default_acl d
    join pg_namespace n on n.oid = d.defaclnamespace
   where n.nspname = 'public'

  -- ── constraints (check, fk, unique, pk, exclusion) ──
  union all
  select 'constraint', con.conrelid::regclass::text || ' :: ' || con.conname,
         md5(pg_get_constraintdef(con.oid, true))
    from pg_constraint con
    join pg_namespace n on n.oid = con.connamespace
   where n.nspname = 'public' and con.conrelid <> 0

  -- ── índices ──
  union all
  select 'indice', schemaname || '.' || indexname, md5(indexdef)
    from pg_indexes
   where schemaname = 'public'

  -- ── columnas: tipo, default, nullable ──
  union all
  select 'columna', c.relname || '.' || a.attname,
         format_type(a.atttypid, a.atttypmod)
           || ' | null=' || (not a.attnotnull)::text
           || ' | default=' || coalesce(pg_get_expr(d.adbin, d.adrelid), '')
           || case when a.attgenerated <> '' then ' | generated' else '' end
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
     and a.attnum > 0 and not a.attisdropped

  -- ── enums (valores y orden) ──
  union all
  select 'enum', t.typname, string_agg(e.enumlabel, ',' order by e.enumsortorder)
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'public'
   group by t.typname

  -- ── grants de TABLA para anon / authenticated ──
  union all
  select 'grant_tabla', grantee || ' → ' || table_name,
         string_agg(privilege_type, ',' order by privilege_type)
    from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'authenticated')
   group by grantee, table_name

  -- ── grants POR COLUMNA para anon / authenticated. Incluye el de
  --    organizations: la capa activa de la protección de suscripción ──
  union all
  select 'grant_columna', grantee || ' → ' || table_name || '.' || column_name,
         string_agg(privilege_type, ',' order by privilege_type)
    from information_schema.column_privileges
   where table_schema = 'public' and grantee in ('anon', 'authenticated')
   group by grantee, table_name, column_name
)
-- 'meta total_filas' = cuántas filas DEBE traer el CSV (esta incluida). El
-- comparador lo exige: si el SQL Editor truncó el resultado al exportar, el
-- diff saldría con MENOS diferencias de las reales — el peor tipo de error.
select tipo, nombre, hash from (
  select tipo, nombre, hash from filas
  union all
  select 'meta', 'total_filas', ((select count(*) from filas) + 1)::text
) t
 order by tipo, nombre;
