-- supabase/product-images-policies.sql
-- ============================================================================
-- QUÉ HACE: las policies de ESCRITURA del bucket product-images (fotos de
-- productos) pasan a tener alcance por carpeta, igual que restaurant-logos:
--     · la carpeta del objeto es la SEDE ACTIVA del usuario
--       ((storage.foldername(name))[1] = get_my_restaurant_id()), y
--     · el usuario tiene `productos.editar`, el permiso que gatea la pantalla
--       donde se suben (App.tsx: <ProtectedRoute permission="productos.editar" />
--       envuelve /productos).
-- La app sube a `<restaurant_id>/<productId>.<ext>` con upsert
-- (uploadProductImage, llamado desde useProductMutations con
-- profile.restaurant_id = sede activa) y borra con deleteProductImage.
--
-- POR QUÉ, medido el 2026-09-30 en Docker con la base igual a prod: las
-- policies de prod ("product-images: subir / actualizar / borrar con permiso")
-- piden bucket + has_permission('productos.editar') SIN carpeta. Un usuario de
-- OTRA organización (LAB-OTRA, local) SUBIÓ a la carpeta de LAB, REEMPLAZÓ la
-- foto de un producto ajeno y la BORRÓ. La foto se muestra desde la URL guardada
-- en products.image_url: reemplazar el archivo cambia la foto que el otro
-- negocio ve en SU POS. Mismo defecto de clase que restaurant-logos (R3).
--
-- NOMBRES NUEVOS a propósito ("… en su sede"): la query de estado distingue sin
-- ambigüedad la versión vieja (sin carpeta) de la nueva.
--
-- QUÉ NO HACE: no toca ningún archivo existente. La lectura pública
-- ("product-images: lectura pública") queda igual. No cambia QUIÉN puede
-- escribir en su propia sede (ya era productos.editar): solo DÓNDE.
--
-- ANTES DE APLICAR: supabase/diag/storage-escrituras-cruzadas.sql (¿alguien ya
-- escribió en la carpeta de otra organización?).
-- PRECONDICIONES: public.has_permission(text), public.get_my_restaurant_id().
-- RE-APLICAR: idempotente (drop if exists + create, en una transacción).
-- CÓMO CORRERLO: SQL Editor de PROD, el archivo entero, una vez. Si falla,
-- rollback completo.
--
-- NO DEDUZCAS EL ESTADO DE ESTE COMENTARIO — correlo:
--   select policyname, cmd from pg_policies
--    where schemaname = 'storage' and policyname like 'product-images%' order by 1;
--   aplicada ⇒ 4 filas: lectura pública (SELECT) y subir / actualizar / borrar
--   "en su sede" (INSERT / UPDATE / DELETE); NINGUNA "con permiso".
-- ============================================================================

begin;

drop policy if exists "product-images: subir con permiso"       on storage.objects;
drop policy if exists "product-images: actualizar con permiso"  on storage.objects;
drop policy if exists "product-images: borrar con permiso"      on storage.objects;
drop policy if exists "product-images: subir en su sede"        on storage.objects;
drop policy if exists "product-images: actualizar en su sede"   on storage.objects;
drop policy if exists "product-images: borrar en su sede"       on storage.objects;

create policy "product-images: subir en su sede"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = public.get_my_restaurant_id()::text
    and public.has_permission('productos.editar')
  );

-- USING y WITH CHECK con el mismo alcance: un UPDATE no puede MOVER un objeto a
-- la carpeta de otra sede.
create policy "product-images: actualizar en su sede"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = public.get_my_restaurant_id()::text
    and public.has_permission('productos.editar')
  )
  with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = public.get_my_restaurant_id()::text
    and public.has_permission('productos.editar')
  );

create policy "product-images: borrar en su sede"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = public.get_my_restaurant_id()::text
    and public.has_permission('productos.editar')
  );

commit;
