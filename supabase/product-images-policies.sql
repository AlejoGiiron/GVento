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


-- ============================================================================
-- PASO 0 — PRE-FLIGHT (SOLO LECTURA). Seleccioná SOLO este bloque y ejecutalo
-- PRIMERO: el SQL Editor muestra únicamente el resultado de la última sentencia,
-- así que si corrés el archivo entero no lo vas a ver.
--
-- Qué mide, por organización:
--   objetos           → archivos en product-images.
--   carpeta_no_sede   → archivos cuyo primer segmento NO es el id de una sede
--                       existente. Con la migración NADIE podrá reemplazarlos ni
--                       borrarlos (ninguna sede activa coincide). Se agrupan por
--                       la organización de quien los subió.
--   foto_en_otra_sede → productos cuya image_url apunta a una carpeta que NO es
--                       su propia sede. Subir una foto nueva sigue funcionando
--                       (va a <sede>/<productId>), pero quitar la vieja fallaría
--                       en silencio (deleteProductImage se traga el error) y el
--                       archivo quedaría huérfano.
--
-- QUÉ ESPERAR: las dos últimas columnas en 0 para todos los clientes. La app
-- siempre sube a <profile.restaurant_id>/<productId>.<ext> y los productos son
-- de UNA sede (products.restaurant_id NOT NULL, RLS por sede activa), así que no
-- hay camino que produzca ninguna de las dos cosas.
--   · > 0 en carpeta_no_sede ⇒ sedes borradas, o subidas por fuera de la app. NO
--     bloquea a nadie para subir; solo esos archivos quedan congelados. Revisar.
--   · > 0 en foto_en_otra_sede ⇒ algo movió productos de sede o subió por fuera.
--     Revisar ANTES de aplicar: esas fotos no se podrán quitar desde la app.
-- ----------------------------------------------------------------------------
with objetos as (
  select o.name, o.owner, r.id as sede, r.organization_id as org_carpeta
    from storage.objects o
    left join public.restaurants r on r.id::text = (storage.foldername(o.name))[1]
   where o.bucket_id = 'product-images'
),
fotos as (
  select p.restaurant_id, r.organization_id,
         split_part(split_part(p.image_url, '/product-images/', 2), '/', 1) as carpeta
    from public.products p
    join public.restaurants r on r.id = p.restaurant_id
   where p.image_url like '%/product-images/%'
)
select org.name as organizacion,
       (select count(*) from objetos x where x.org_carpeta = org.id)                  as objetos,
       (select count(*) from objetos x join public.profiles pr on pr.id = x.owner
         where x.sede is null and pr.organization_id = org.id)                        as carpeta_no_sede,
       (select count(*) from fotos f
         where f.organization_id = org.id and f.carpeta <> f.restaurant_id::text)     as foto_en_otra_sede
  from public.organizations org
 order by org.created_at;
-- + objetos con carpeta que no es sede Y sin perfil de quien subió (no caen en
--   ninguna organización de arriba):
-- select count(*) from storage.objects o
--   left join public.restaurants r on r.id::text = (storage.foldername(o.name))[1]
--   left join public.profiles pr on pr.id = o.owner
--  where o.bucket_id = 'product-images' and r.id is null and pr.id is null;
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
