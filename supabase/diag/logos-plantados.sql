-- supabase/diag/logos-plantados.sql
-- ============================================================================
-- DIAGNÓSTICO de SOLO LECTURA, para correr en PROD ANTES de aplicar
-- supabase/restaurant-logos-policies.sql. Responde dos preguntas:
--
--   1. ¿Alguien ya usó el hueco? La policy de INSERT de prod no mira la
--      carpeta, así que un admin de una organización pudo subir archivos a la
--      carpeta de la sede de OTRA. Se listan los objetos cuyo SUBIDOR no es de
--      la organización dueña de la carpeta (o cuya carpeta no es una sede).
--   2. ¿A quién le cambia el permiso de subir? Hoy sube quien tiene el enum
--      profiles.role = 'admin'; después, quien tiene config.acceder (o '*') en
--      su rol. Se listan los usuarios ACTIVOS para los que la respuesta cambia.
--      Aproximación: lee roles.permissions directo (has_permission además exige
--      perfil activo; acá ya se filtra is_active).
--
-- QUÉ ESCRIBE: nada. RE-EJECUTAR: inofensivo. Muestra emails de usuarios del
-- sistema (no datos de clientes finales).
-- ============================================================================

-- 1. Objetos en restaurant-logos subidos por alguien de OTRA organización.
select 'plantado' as hallazgo,
       o.name                         as objeto,
       o.created_at at time zone 'America/Bogota' as subido_bogota,
       org_carpeta.name               as org_de_la_carpeta,
       org_subidor.name               as org_del_que_subio,
       p.email                        as subido_por
  from storage.objects o
  left join public.restaurants r      on r.id::text = (storage.foldername(o.name))[1]
  left join public.organizations org_carpeta on org_carpeta.id = r.organization_id
  left join public.profiles p         on p.id = o.owner
  left join public.organizations org_subidor on org_subidor.id = p.organization_id
 where o.bucket_id = 'restaurant-logos'
   and (r.id is null or p.id is null or p.organization_id is distinct from r.organization_id)

union all

-- 2. Usuarios activos cuyo permiso de subir CAMBIA con la migración.
select case when puede_hoy then 'PIERDE subir' else 'GANA subir' end,
       email, null, org, null, rol
  from (
    select p.email, o.name as org, ro.name as rol,
           (p.role = 'admin')                                              as puede_hoy,
           coalesce(ro.permissions ? 'config.acceder' or ro.permissions ? '*', false) as puede_despues
      from public.profiles p
      join public.organizations o on o.id = p.organization_id
      left join public.roles ro   on ro.id = p.role_id
     where p.is_active
  ) u
 where puede_hoy is distinct from puede_despues
 order by 1, 2;

-- CÓMO LEERLO:
--   · Ninguna fila 'plantado' ⇒ el hueco no se usó. Si hay: NO se borran desde
--     acá; se decide con el cliente (la migración no toca archivos existentes).
--   · 'PIERDE subir' ⇒ alguien que hoy puede cambiar el logo dejaría de poder.
--     Si es un dueño o admin real de un cliente, NO aplicar hasta resolverlo
--     (darle config.acceder a su rol, o decidir que es correcto).
--   · 'GANA subir' ⇒ un rol con config.acceder que hoy no podía (el enum no era
--     admin): consistente con la UI, que ya le muestra la pantalla.
