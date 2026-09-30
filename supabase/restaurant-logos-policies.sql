-- supabase/restaurant-logos-policies.sql
-- ============================================================================
-- QUÉ HACE: define quién puede SUBIR, REEMPLAZAR y BORRAR en el bucket
-- restaurant-logos (logo del restaurante + QR de Nequi), con UN SOLO alcance
-- para las tres operaciones:
--     · la carpeta del objeto es la SEDE ACTIVA del usuario
--       ((storage.foldername(name))[1] = get_my_restaurant_id()), y
--     · el usuario tiene `config.acceder`, el permiso que gatea la pantalla
--       donde se suben (App.tsx: <ProtectedRoute permission="config.acceder" />
--       envuelve /config; SectionRestaurant sube el logo y SectionCaja el QR,
--       sin permiso propio en SECTIONS de ConfigPage).
-- La app sube a `<restaurant_id>/logo.<ext>` y `<restaurant_id>/nequi-qr.<ext>`
-- con upsert (uploadRestaurantLogo / uploadNequiQR en supabase-helpers), y
-- restaurant_id es la sede activa del perfil.
--
-- POR QUÉ, medido el 2026-09-30 en Docker con la base igual a prod (deriva 0):
--   1. REEMPLAZAR no funciona: sin policy de UPDATE, la 2ª subida del logo o
--      del QR da "new row violates row-level security policy".
--   2. 🔴 HUECO ENTRE CLIENTES: la policy de INSERT de prod ("admin sube") solo
--      pide bucket + get_my_role() = 'admin', SIN carpeta. Un admin de OTRA
--      organización (LAB-OTRA, local) subió `<sede LAB>/nequi-qr.png`, y
--      después el owner de LAB NO pudo subir su QR a esa ruta.
-- Por eso no alcanza con agregar UPDATE/DELETE "con el alcance del INSERT": el
-- INSERT no tenía alcance. Se reemplaza también.
--
-- QUÉ NO HACE: no toca ningún archivo existente (solo cambia quién escribe).
-- La lectura pública queda igual (el QR y el logo se muestran por URL pública).
-- Archivos que OTRA organización ya haya plantado en prod antes de esto: lo
-- responde supabase/diag/logos-plantados.sql (solo lectura).
--
-- PRECONDICIONES: public.has_permission(text) y public.get_my_restaurant_id()
-- (SECURITY DEFINER, EXECUTE para authenticated). Bucket restaurant-logos.
--
-- RE-APLICAR: idempotente (drop if exists + create, en una transacción).
-- CÓMO CORRERLO: SQL Editor de PROD, el archivo entero, una vez. Si falla,
-- rollback completo: no queda el bucket sin policies a mitad de camino.
--
-- NO DEDUZCAS EL ESTADO DE ESTE COMENTARIO — correlo:
--   select policyname, cmd from pg_policies
--    where schemaname = 'storage' and policyname like 'restaurant-logos%' order by 1;
--   aplicada ⇒ 4 filas: lectura pública (SELECT), subir / actualizar / borrar
--   con permiso (INSERT / UPDATE / DELETE), y NINGUNA "admin sube".
-- ============================================================================

begin;

drop policy if exists "restaurant-logos: admin sube"             on storage.objects;
drop policy if exists "restaurant-logos: subir con permiso"      on storage.objects;
drop policy if exists "restaurant-logos: actualizar con permiso" on storage.objects;
drop policy if exists "restaurant-logos: borrar con permiso"     on storage.objects;

create policy "restaurant-logos: subir con permiso"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'restaurant-logos'
    and (storage.foldername(name))[1] = public.get_my_restaurant_id()::text
    and public.has_permission('config.acceder')
  );

-- USING decide qué filas se pueden tocar; WITH CHECK, cómo pueden quedar: los
-- dos con el mismo alcance, para que un UPDATE no pueda MOVER un objeto a la
-- carpeta de otra sede.
create policy "restaurant-logos: actualizar con permiso"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'restaurant-logos'
    and (storage.foldername(name))[1] = public.get_my_restaurant_id()::text
    and public.has_permission('config.acceder')
  )
  with check (
    bucket_id = 'restaurant-logos'
    and (storage.foldername(name))[1] = public.get_my_restaurant_id()::text
    and public.has_permission('config.acceder')
  );

create policy "restaurant-logos: borrar con permiso"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'restaurant-logos'
    and (storage.foldername(name))[1] = public.get_my_restaurant_id()::text
    and public.has_permission('config.acceder')
  );

commit;
