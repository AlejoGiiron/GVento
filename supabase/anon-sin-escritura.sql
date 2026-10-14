-- ============================================================================
-- supabase/anon-sin-escritura.sql — Paso 11 / P0.2: el rol `anon` (cualquiera SIN sesión, con la
-- anon key que viaja en el bundle) no puede escribir en NINGUNA tabla ni vista de `public`.
--
-- POR QUÉ: Supabase concede por defecto a `anon` INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER
-- y MAINTAIN (Postgres 17: LOCK TABLE, VACUUM, REFRESH) en todo lo que `postgres` crea en `public`
-- (pg_default_acl: anon=arwdDxtm). MAINTAIN no escribe filas, pero un LOCK TABLE sin sesión puede
-- frenar la operación: se quita igual. Hoy lo contiene RLS
-- (todas las tablas lo tienen y ninguna política de escritura alcanza a anon salvo la de
-- cash_movements, que falla cerrada por ACCIDENTE: su condición usa get_my_restaurant_id(), que anon
-- no puede ejecutar). Una tabla nueva sin RLS, o una política `TO public` escrita sin pensar en
-- anon, quedaría escribible sin login. Medido el 2026-10-13 en la base local: 29 objetos (25 tablas
-- y las 4 vistas de reportes) con escritura para anon. Ver docs/DEUDAS.md.
--
-- QUÉ HACE (y nada más):
--   1. Anota en public.anon_escritura_revocada EXACTAMENTE lo que quita (lo usa la reversa).
--   2. Quita a anon la escritura en todas las tablas, vistas y secuencias de public. El SELECT se
--      QUEDA: qué ve anon lo sigue decidiendo RLS (y hoy no ve nada que no deba).
--   3. Quita a anon los privilegios POR DEFECTO de lo que `postgres` cree después en public
--      (tablas, secuencias y EXECUTE de funciones). Lo que cree `supabase_admin` no se puede tocar
--      desde `postgres` (no es miembro): eso lo vigila tests/anon-sin-escritura.spec.ts.
--   4. La política "cash_movements: acceso por restaurante" pasa de TO public a TO authenticated.
--   5. rls_auto_enable() (la función del event trigger ensure_rls, SECURITY DEFINER) deja de ser
--      ejecutable por public/anon. El event trigger la sigue disparando (no pide EXECUTE).
--   6. Comprueba, en la MISMA transacción, que no quedó nada; si queda, aborta (fail-closed).
--
-- QUÉ NO CAMBIA: nada de la app escribe sin sesión (barrido R3 del 2026-10-13): login no escribe;
-- Cocina escribe con la sesión de la tableta (el PIN es un candado de pantalla, y orders/order_items
-- son TO authenticated); marcar_version ya no es ejecutable por anon. No hay que pasar nada a RPC.
--
-- PRECONDICIONES: Postgres 17 o más (usa MAINTAIN; producción está en 17.6, supabase/.temp); existe
-- la política de cash_movements; la tabla de registro no existe.
-- RE-APLICAR: aborta sin cambiar nada (la tabla de registro ya existe).
-- REVERSA: anon-sin-escritura-revertir.sql (fuera de git): devuelve exactamente lo anotado.
--
-- NO DEDUZCAS EL ESTADO DE ESTE COMENTARIO — correlo:
--   select to_regclass('public.anon_escritura_revocada') is not null as aplicada;
-- ============================================================================
begin;

-- ── 0. Precondiciones ──
do $$
begin
  if current_setting('server_version_num')::int < 170000 then
    raise exception 'Esta migración asume Postgres 17 (privilegio MAINTAIN); la base es %. No se cambió nada.',
      current_setting('server_version');
  end if;
  if to_regclass('public.anon_escritura_revocada') is not null then
    raise exception 'anon-sin-escritura.sql ya se aplicó (existe public.anon_escritura_revocada). No se cambió nada.';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cash_movements'
                  and policyname = 'cash_movements: acceso por restaurante') then
    raise exception 'Precondición: no existe la política "cash_movements: acceso por restaurante". No se cambió nada.';
  end if;
end $$;

-- ── 1. Registro exacto de lo que se quita ──
create table public.anon_escritura_revocada (
  objeto   text primary key,   -- 'tabla public.x' | 'default tablas' | 'politica ...' | 'funcion ...'
  detalle  text not null,      -- privilegios (o roles) que tenía y se le quitan
  anotado  timestamptz not null default now()
);
alter table public.anon_escritura_revocada enable row level security;
revoke all on table public.anon_escritura_revocada from anon, authenticated;
comment on table public.anon_escritura_revocada is
  'Lo que anon-sin-escritura.sql le quitó a anon. La reversa (anon-sin-escritura-revertir.sql) lo devuelve.';

insert into public.anon_escritura_revocada (objeto, detalle)
select case c.relkind when 'S' then 'secuencia ' else 'tabla ' end || c.oid::regclass::text,
       concat_ws(',',
         case when c.relkind <> 'S' and has_table_privilege('anon', c.oid, 'INSERT')     then 'insert' end,
         case when c.relkind <> 'S' and has_table_privilege('anon', c.oid, 'UPDATE')     then 'update' end,
         case when c.relkind <> 'S' and has_table_privilege('anon', c.oid, 'DELETE')     then 'delete' end,
         case when c.relkind <> 'S' and has_table_privilege('anon', c.oid, 'TRUNCATE')   then 'truncate' end,
         case when c.relkind <> 'S' and has_table_privilege('anon', c.oid, 'REFERENCES') then 'references' end,
         case when c.relkind <> 'S' and has_table_privilege('anon', c.oid, 'TRIGGER')    then 'trigger' end,
         case when c.relkind <> 'S' and has_table_privilege('anon', c.oid, 'MAINTAIN')   then 'maintain' end,
         case when c.relkind =  'S' and has_sequence_privilege('anon', c.oid, 'USAGE')   then 'usage' end,
         case when c.relkind =  'S' and has_sequence_privilege('anon', c.oid, 'UPDATE')  then 'update' end)
  from pg_class c
 where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
   and c.relname <> 'anon_escritura_revocada'
   and (    (c.relkind <> 'S' and has_table_privilege('anon', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'))
         or (c.relkind =  'S' and has_sequence_privilege('anon', c.oid, 'USAGE,UPDATE')));

insert into public.anon_escritura_revocada (objeto, detalle)
select 'default ' || case d.defaclobjtype when 'r' then 'tablas' when 'S' then 'secuencias' else 'funciones' end,
       string_agg(lower(a.privilege_type), ',' order by a.privilege_type)
  from pg_default_acl d
  cross join lateral aclexplode(d.defaclacl) a
 where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace
   and a.grantee = 'anon'::regrole
   and (   (d.defaclobjtype = 'r' and a.privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'))
        or (d.defaclobjtype = 'S' and a.privilege_type in ('USAGE','UPDATE'))
        or (d.defaclobjtype = 'f' and a.privilege_type = 'EXECUTE'))
 group by d.defaclobjtype;

insert into public.anon_escritura_revocada (objeto, detalle)
values ('politica cash_movements: acceso por restaurante',
        (select array_to_string(roles, ',') from pg_policies
          where schemaname = 'public' and tablename = 'cash_movements' and policyname = 'cash_movements: acceso por restaurante'));

insert into public.anon_escritura_revocada (objeto, detalle)
select 'funcion public.rls_auto_enable()',
       concat_ws(',', case when has_function_privilege('public', 'public.rls_auto_enable()', 'EXECUTE') then 'public' end,
                      case when has_function_privilege('anon',   'public.rls_auto_enable()', 'EXECUTE') then 'anon' end)
 where to_regprocedure('public.rls_auto_enable()') is not null
   and has_function_privilege('anon', 'public.rls_auto_enable()', 'EXECUTE');

-- ── 2. Lo que existe: anon sin escritura (el SELECT se queda; lo decide RLS) ──
revoke insert, update, delete, truncate, references, trigger, maintain on all tables in schema public from anon;
revoke usage, update on all sequences in schema public from anon;

-- ── 3. Lo que `postgres` cree después ──
alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate, references, trigger, maintain on tables from anon;
alter default privileges for role postgres in schema public
  revoke usage, update on sequences from anon;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon;

-- ── 4. La única política que alcanzaba a anon ──
alter policy "cash_movements: acceso por restaurante" on public.cash_movements to authenticated;

-- ── 5. La función SECURITY DEFINER del event trigger ──
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon;
  end if;
end $$;

-- ── 6. Comprobación, en esta misma transacción (fail-closed) ──
do $$
declare
  v_n integer;
  v_lista text;
begin
  select count(*), string_agg(c.oid::regclass::text, ', ') into v_n, v_lista
    from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and has_table_privilege('anon', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN');
  if v_n > 0 then
    raise exception 'anon todavía escribe en % objeto(s): %. No se cambió nada.', v_n, v_lista;
  end if;

  select count(*), string_agg(tablename || ' / ' || policyname, '; ') into v_n, v_lista
    from pg_policies
   where schemaname = 'public' and cmd <> 'SELECT' and ('anon' = any(roles) or 'public' = any(roles));
  if v_n > 0 then
    raise exception 'Quedan % política(s) de escritura que alcanzan a anon: %. No se cambió nada.', v_n, v_lista;
  end if;

  select count(*), string_agg(p.oid::regprocedure::text, ', ') into v_n, v_lista
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_n > 0 then
    raise exception 'anon todavía ejecuta % función(es) SECURITY DEFINER: %. No se cambió nada.', v_n, v_lista;
  end if;

  -- Lo que nazca después: una tabla de prueba (se borra acá mismo) tiene que nacer sin escritura.
  create table public.__anon_sin_escritura_prueba (id int);
  if has_table_privilege('anon', 'public.__anon_sin_escritura_prueba', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') then
    raise exception 'Una tabla nueva todavía nace con escritura para anon. No se cambió nada.';
  end if;
  drop table public.__anon_sin_escritura_prueba;

  raise notice 'anon-sin-escritura: % objeto(s) anotados en public.anon_escritura_revocada',
    (select count(*) from public.anon_escritura_revocada);
end $$;

commit;
