-- supabase/diag/storage-escrituras-cruzadas.sql
-- ============================================================================
-- DIAGNÓSTICO de SOLO LECTURA, para correr en PROD ANTES de aplicar
-- supabase/product-images-policies.sql. Generaliza logos-plantados.sql a los
-- DOS buckets de la app.
--
-- Pregunta: ¿algún objeto de Storage fue escrito por última vez por un usuario
-- de OTRA organización que la dueña de la carpeta? Detecta archivos PLANTADOS
-- y fotos REEMPLAZADAS: medido el 2026-09-30 en Docker, un upsert de otro
-- usuario deja `storage.objects.owner` = el último que escribió. Límite: si
-- después el negocio volvió a subir su foto, el rastro se pierde (owner vuelve
-- a ser del negocio) — y en ese caso el daño ya se corrigió solo.
--
-- QUÉ ESCRIBE: nada. RE-EJECUTAR: inofensivo. Muestra emails de usuarios del
-- sistema (no datos de clientes finales).
-- ============================================================================
select o.bucket_id                                   as bucket,
       o.name                                        as objeto,
       o.updated_at at time zone 'America/Bogota'    as ultima_escritura_bogota,
       org_carpeta.name                              as org_de_la_carpeta,
       org_escritor.name                             as org_del_ultimo_que_escribio,
       p.email                                       as ultimo_que_escribio,
       case when r.id is null then 'carpeta que no es una sede'
            when p.id is null then 'escritor sin perfil'
            else 'OTRA organización' end             as motivo
  from storage.objects o
  left join public.restaurants r       on r.id::text = (storage.foldername(o.name))[1]
  left join public.organizations org_carpeta  on org_carpeta.id = r.organization_id
  left join public.profiles p          on p.id = o.owner
  left join public.organizations org_escritor on org_escritor.id = p.organization_id
 where o.bucket_id in ('product-images', 'restaurant-logos')
   and (r.id is null or p.id is null or p.organization_id is distinct from r.organization_id)
 order by 1, 3;

-- CÓMO LEERLO:
--   · 0 filas ⇒ nadie escribió en la carpeta de otra organización (o se
--     corrigió después). Se puede aplicar la migración.
--   · 'OTRA organización' ⇒ un archivo de un negocio fue escrito por otro. NO
--     se borra desde acá: se revisa con el cliente (la foto que ve en su POS
--     puede no ser la suya).
--   · 'carpeta que no es una sede' / 'escritor sin perfil' ⇒ residuo (sede o
--     usuario borrados); revisar, pero no es necesariamente un ataque.
