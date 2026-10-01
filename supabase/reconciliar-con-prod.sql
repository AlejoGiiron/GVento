-- supabase/reconciliar-con-prod.sql
-- ============================================================================
-- QUÉ HACE: lleva el REPO a lo que PRODUCCIÓN tiene de verdad. No cambia prod:
-- describe cosas que se aplicaron a mano en prod y que ningún .sql tenía, y
-- deshace en la base local lo que el repo tenía y prod ya no.
-- Sale de la deriva medida el 2026-09-30 (supabase/diag/deriva-esquema.sql +
-- deriva-detalle.sql, corridas en prod; scripts/deriva-comparar.mjs).
--
-- DIRECCIÓN: el repo se ajusta a prod. En PROD esta migración es un NO-OP:
-- todo es "crear si falta", "revocar" (idempotente) o "borrar un nombre exacto
-- que prod no tiene". NO hace falta correrla en prod; existe para que la base
-- local (scripts/capturas/preparar-local.mjs → ORDEN) sea igual a prod.
--
-- RE-APLICAR: idempotente. Verificado el 2026-09-30 en Docker, sobre una base
-- recién preparada: la 1ª aplicación dio INSERT 0 1 (bucket), UPDATE 1
-- (límites de product-images) y creó 5 policies + rls_auto_enable() +
-- ensure_rls; la 2ª dio INSERT 0 0, UPDATE 0 y no creó nada. Después, con esta
-- migración en ORDEN y la base preparada desde cero, scripts/deriva-comparar.mjs
-- contra el export de prod del 2026-09-30 → "Deriva 0" (exit 0).
--
-- QUÉ NO HACE, a propósito:
--   · No "arregla" nada de prod. Lo que prod tiene raro se copia tal cual y se
--     anota en docs/DEUDAS.md (p. ej. restaurant-logos sin policy de UPDATE).
--   · No pisa la configuración de un bucket existente. El único UPDATE de
--     storage.buckets deshace EXACTAMENTE el valor que puso
--     storage-product-images.sql (2 MB + jpeg/png/webp) y nada más: si algún
--     día prod pone OTRO límite, esto no lo toca.
--
-- NO DEDUZCAS EL ESTADO DE ESTE COMENTARIO — correlo (1 fila por objeto = igual a prod):
--   select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' order by 1;
--   select id, public, file_size_limit, allowed_mime_types from storage.buckets;
--   select evtname, evtowner::regrole from pg_event_trigger where evtname = 'ensure_rls';
--   select proname, proacl from pg_proc where proname in ('get_my_role','get_my_restaurant_id','handle_new_user');
-- ============================================================================

begin;

-- ── 1. Grants: prod es MÁS estricto que el repo ─────────────────────────────
-- En prod, anon NO ejecuta get_my_role / get_my_restaurant_id, y ni anon ni
-- authenticated ejecutan handle_new_user (es un trigger: no necesita EXECUTE
-- del que inserta). security-definer-revoke.sql solo revocaba a PUBLIC, y los
-- privilegios por defecto del esquema dan EXECUTE a anon/authenticated en toda
-- función nueva ⇒ la base local quedaba MÁS permisiva que prod.
revoke execute on function public.get_my_role()          from anon;
revoke execute on function public.get_my_restaurant_id() from anon;
revoke execute on function public.handle_new_user()      from anon, authenticated;

-- ── 2. Storage: bucket restaurant-logos (lo usa la app: logo + QR de Nequi) ──
-- Propiedades REALES de prod (deriva-detalle.sql, 2026-09-30).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('restaurant-logos', 'restaurant-logos', true, null, null)
on conflict (id) do nothing;

-- ── 3. Storage: product-images SIN límite de tamaño ni de tipo, como prod ───
-- Solo si tiene EXACTAMENTE lo que puso storage-product-images.sql.
update storage.buckets
   set file_size_limit = null, allowed_mime_types = null
 where id = 'product-images'
   and file_size_limit = 2097152
   and allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- ── 4. Storage: policies ────────────────────────────────────────────────────
-- 4a. Las "… autenticado" de storage-product-images.sql: prod ya no las tiene
--     (las reemplazó por las "… con permiso"). Nombres EXACTOS; en prod, no-op.
drop policy if exists "product-images: upload autenticado" on storage.objects;
drop policy if exists "product-images: update autenticado" on storage.objects;
drop policy if exists "product-images: delete autenticado" on storage.objects;

-- 4b. Las de prod, creadas solo si faltan (create policy no tiene "if not exists").
do $$
declare
  p record;
begin
  for p in
    select * from (values
      ('product-images: subir con permiso', 'insert', null,
       $q$(bucket_id = 'product-images'::text) AND has_permission('productos.editar'::text)$q$),
      ('product-images: actualizar con permiso', 'update',
       $q$(bucket_id = 'product-images'::text) AND has_permission('productos.editar'::text)$q$, null),
      ('product-images: borrar con permiso', 'delete',
       $q$(bucket_id = 'product-images'::text) AND has_permission('productos.editar'::text)$q$, null),
      ('restaurant-logos: admin sube', 'insert', null,
       $q$(bucket_id = 'restaurant-logos'::text) AND (get_my_role() = 'admin'::user_role)$q$),
      ('restaurant-logos: lectura pública', 'select',
       $q$bucket_id = 'restaurant-logos'::text$q$, null)
    ) as t(nombre, cmd, usando, chequeo)
  loop
    if not exists (select 1 from pg_policies
                    where schemaname = 'storage' and tablename = 'objects' and policyname = p.nombre) then
      execute format('create policy %I on storage.objects for %s to %s %s %s',
        p.nombre, p.cmd,
        case when p.cmd = 'select' then 'public' else 'authenticated' end,
        case when p.usando  is not null then 'using (' || p.usando || ')' else '' end,
        case when p.chequeo is not null then 'with check (' || p.chequeo || ')' else '' end);
      raise notice 'creada: %', p.nombre;
    end if;
  end loop;
end $$;

-- ── 5. Auto-RLS: event trigger ensure_rls → rls_auto_enable() ───────────────
-- ORIGEN: no está en ningún .sql ni commit del repo, y un stack recién creado
-- por el CLI 2.90 no la trae. En prod el dueño de la función es postgres (el
-- grantor de su ACL), o sea que se creó como postgres (SQL Editor / Dashboard),
-- no la plataforma (supabase_admin). QUIÉN exactamente: sin verificar — la fila
-- 'event_trigger_dueno' de deriva-esquema.sql lo dice para el trigger.
-- QUÉ HACE: toda tabla nueva de public nace con RLS habilitado. Es una
-- protección fail-closed, y la base local tiene que tenerla para que un test no
-- pase sobre una tabla que en prod nacería con RLS.
-- Cuerpo IDÉNTICO al de prod (deriva-detalle.sql). Solo si falta.
do $body$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'rls_auto_enable') then
    execute $fn$
CREATE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
$fn$;
    raise notice 'creada: public.rls_auto_enable()';
  end if;

  if not exists (select 1 from pg_event_trigger where evtname = 'ensure_rls') then
    create event trigger ensure_rls on ddl_command_end
      when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      execute function public.rls_auto_enable();
    raise notice 'creado: event trigger ensure_rls';
  end if;
end $body$;

commit;
