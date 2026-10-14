-- supabase/diag/anon-sin-escritura-preflight.sql — SOLO LECTURA. Antes y después de
-- supabase/anon-sin-escritura.sql, cada consulta por separado.

-- ── Consulta 1: tablas y vistas de public donde anon (sin sesión) puede escribir ──
select c.oid::regclass::text as objeto, c.relkind::text as tipo,
       concat_ws(',', case when has_table_privilege('anon', c.oid, 'INSERT')     then 'insert' end,
                      case when has_table_privilege('anon', c.oid, 'UPDATE')     then 'update' end,
                      case when has_table_privilege('anon', c.oid, 'DELETE')     then 'delete' end,
                      case when has_table_privilege('anon', c.oid, 'TRUNCATE')   then 'truncate' end,
                      case when has_table_privilege('anon', c.oid, 'REFERENCES') then 'references' end,
                      case when has_table_privilege('anon', c.oid, 'TRIGGER')    then 'trigger' end,
                      case when has_table_privilege('anon', c.oid, 'MAINTAIN')   then 'maintain' end) as escritura,
       has_table_privilege('anon', c.oid, 'SELECT') as lee,
       c.relrowsecurity as rls
  from pg_class c
 where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
   and has_table_privilege('anon', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
 order by 2, 1;
-- ANTES (medido en la base local el 2026-10-13): 29 filas, 25 tablas ('r') y 4 vistas ('v');
-- cash_shifts sin 'update' (la fase 1 de D ya se lo quitó). DESPUÉS: 0 filas.

-- ── Consulta 2: políticas de ESCRITURA que alcanzan a anon (TO anon o TO public) ──
select tablename, policyname, cmd, array_to_string(roles, ',') as roles
  from pg_policies
 where schemaname = 'public' and cmd <> 'SELECT' and ('anon' = any(roles) or 'public' = any(roles))
 order by 1, 2;
-- ANTES: 1 fila, "cash_movements | cash_movements: acceso por restaurante | ALL | public".
-- DESPUÉS: 0 filas.

-- ── Consulta 3: funciones SECURITY DEFINER de public que anon puede ejecutar ──
select p.oid::regprocedure::text as funcion
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace and p.prosecdef
   and has_function_privilege('anon', p.oid, 'EXECUTE')
 order by 1;
-- ANTES: 1 fila, rls_auto_enable() (la del event trigger ensure_rls). DESPUÉS: 0 filas.

-- ── Consulta 4: privilegios POR DEFECTO de anon en lo que `postgres` crea en public ──
select case d.defaclobjtype when 'r' then 'tablas' when 'S' then 'secuencias' when 'f' then 'funciones'
       else d.defaclobjtype::text end as para,
       string_agg(lower(a.privilege_type), ',' order by a.privilege_type) as anon_recibe
  from pg_default_acl d
  cross join lateral aclexplode(d.defaclacl) a
 where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace
   and a.grantee = 'anon'::regrole
 group by d.defaclobjtype
 order by 1;
-- ANTES: tablas = delete,insert,maintain,references,select,trigger,truncate,update · secuencias =
-- select,update,usage · funciones = execute. DESPUÉS: tablas = select · secuencias = select
-- (funciones ya no aparece).

-- ── Consulta 5: ¿está aplicada? y qué anotó ──
select to_regclass('public.anon_escritura_revocada') is not null as aplicada,
       (select count(*) from pg_class where oid = to_regclass('public.anon_escritura_revocada')) as tabla_de_registro;
-- Si aplicada = t, el detalle (solo con privilegios de dueño, p. ej. desde el SQL Editor):
--   select objeto, detalle from public.anon_escritura_revocada order by 1;
