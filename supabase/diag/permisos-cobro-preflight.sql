-- supabase/diag/permisos-cobro-preflight.sql — SOLO LECTURA (no escribe nada).
-- ============================================================================
-- PRE-FLIGHT de A (supabase/permisos-cobro.sql), en TODAS las organizaciones.
-- Por usuario ACTIVO, qué puede hacer HOY en cada camino y qué podrá DESPUÉS de A:
--   camino      HOY (decide…)                                DESPUÉS (decide…)
--   pos         get_my_role() in (admin, cashier)            pos.vender
--   m (/m)      rol viejo in (admin, cashier) — puedeCobrar  pos.vender (con el frontend de A)
--   mesa        get_my_role() in (admin, cashier)            mesas.cobrar
--   fiado (POS) rol viejo in (admin, cashier) + fiado.gest.  pos.vender + fiado.gestionar
--   anular      ventas.anular                                ventas.anular (A no lo toca)
-- "Después" = los permisos de HOY ∪ lo que agrega la migración (la lista AGREGAR, la
-- misma del archivo de la migración). Se parte de PROFILES (el sujeto), no de roles: un
-- usuario sin rol, o con un rol de otra organización, también sale (lección #12).
--
-- Consulta 1 — las tres listas. 'PIERDE' tiene que salir VACÍA para aplicar A.
-- Consulta 2 — cobertura: TODAS las organizaciones (desde organizations), con cuántos
--              usuarios activos tiene cada una y cuántos caen en cada lista.
-- ============================================================================

-- ── Consulta 1 ──
with agregar(rol, clave) as (
  -- AGREGAR:inicio (la MISMA lista en permisos-cobro.sql y en el pre-flight; la compara un test)
  values ('admin',  'mesas.cobrar'), ('admin',  'pos.vender'),
         ('cajero', 'mesas.cobrar'), ('cajero', 'pos.vender'),
         ('mozo',   'mesas.cobrar')
  -- AGREGAR:fin
),
usuarios as (
  select o.id as org_id, o.name as organizacion, p.email, p.role::text as rol_viejo,
         r.id as rol_id, coalesce(r.name, '(sin rol)') as rol, coalesce(r.is_system, false) as de_sistema,
         r.organization_id is not distinct from s.organization_id as rol_de_su_org,
         coalesce(r.permissions, '[]'::jsonb) as hoy,
         coalesce(r.permissions, '[]'::jsonb)
           || coalesce((select jsonb_agg(a.clave) from agregar a
                         where r.is_system and a.rol = r.name and not (r.permissions ? a.clave)), '[]'::jsonb) as despues
    from public.profiles p
    join public.restaurants s on s.id = p.restaurant_id
    left join public.organizations o on o.id = s.organization_id
    left join public.roles r on r.id = p.role_id
   where p.is_active
),
caminos as (
  select u.*,
         u.rol_viejo in ('admin', 'cashier')                                    as pos_hoy,
         u.rol_viejo in ('admin', 'cashier')                                    as m_hoy,
         u.rol_viejo in ('admin', 'cashier')                                    as mesa_hoy,
         u.rol_viejo in ('admin', 'cashier') and (u.hoy ? 'fiado.gestionar' or u.hoy ? '*') as fiado_hoy,
         (u.hoy ? 'ventas.anular' or u.hoy ? '*')                               as anular_hoy,
         (u.despues ? 'pos.vender' or u.despues ? '*')                          as pos_despues,
         (u.despues ? 'pos.vender' or u.despues ? '*')                          as m_despues,
         (u.despues ? 'mesas.cobrar' or u.despues ? '*')                        as mesa_despues,
         (u.despues ? 'pos.vender' or u.despues ? '*')
           and (u.despues ? 'fiado.gestionar' or u.despues ? '*')               as fiado_despues,
         (u.despues ? 'ventas.anular' or u.despues ? '*')                       as anular_despues
    from usuarios u
)
select case
         when (pos_hoy and not pos_despues) or (m_hoy and not m_despues) or (mesa_hoy and not mesa_despues)
           or (fiado_hoy and not fiado_despues) or (anular_hoy and not anular_despues) then '1 PIERDE'
         when (pos_despues and not pos_hoy) or (m_despues and not m_hoy) or (mesa_despues and not mesa_hoy)
           or (fiado_despues and not fiado_hoy) or (anular_despues and not anular_hoy) then '2 GANA'
         else '3 IGUAL'
       end as lista,
       organizacion, org_id, email, rol_viejo, rol, de_sistema, rol_de_su_org,
       concat_ws(', ', case when pos_hoy and not pos_despues then 'POS' end,
                       case when m_hoy and not m_despues then '/m' end,
                       case when mesa_hoy and not mesa_despues then 'cobro de mesa' end,
                       case when fiado_hoy and not fiado_despues then 'fiado' end,
                       case when anular_hoy and not anular_despues then 'anular' end) as pierde,
       concat_ws(', ', case when pos_despues and not pos_hoy then 'POS' end,
                       case when m_despues and not m_hoy then '/m' end,
                       case when mesa_despues and not mesa_hoy then 'cobro de mesa' end,
                       case when fiado_despues and not fiado_hoy then 'fiado' end,
                       case when anular_despues and not anular_hoy then 'anular' end) as gana,
       concat_ws(' ', case when pos_hoy then 'POS' end, case when m_hoy then '/m' end,
                      case when mesa_hoy then 'mesa' end, case when fiado_hoy then 'fiado' end,
                      case when anular_hoy then 'anular' end) as puede_hoy,
       concat_ws(' ', case when pos_despues then 'POS' end, case when m_despues then '/m' end,
                      case when mesa_despues then 'mesa' end, case when fiado_despues then 'fiado' end,
                      case when anular_despues then 'anular' end) as podra
  from caminos
 order by lista, organizacion, email;

-- ── Consulta 2: cobertura (desde organizations: ninguna se pierde por no tener roles) ──
select o.id as org_id, o.name as organizacion,
       count(p.id) filter (where p.is_active)     as usuarios_activos,
       count(p.id) filter (where not p.is_active) as usuarios_inactivos,
       (select count(*) from public.roles r where r.organization_id = o.id and r.is_system) as roles_de_sistema
  from public.organizations o
  left join public.restaurants s on s.organization_id = o.id
  left join public.profiles p on p.restaurant_id = s.id
 group by o.id, o.name
 order by o.name;
