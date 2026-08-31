-- ============================================================
-- 🤖 ARCHIVO GENERADO — NO EDITAR A MANO.
--
--   Fuente:  src/lib/permissions.ts  (PERMISSION_GROUPS + SYSTEM_ROLES)
--   Generar: pnpm gen:rbac
--   CI:      pnpm gen:rbac:check   (regenera y falla si hay diff)
--
-- Cualquier edición hecha acá se pierde en la próxima corrida, y el check de CI la
-- marca en rojo antes de que llegue a develop. Para cambiar un permiso o la
-- política de un rol: editá permissions.ts y regenerá.
-- ============================================================
--
-- QUÉ HACE: siembra (o actualiza) los 4 roles de sistema de UNA organización.
-- Idempotente por diseño (`on conflict … do update`): re-correrla sobre una org que
-- ya existe reafirma la política canónica sin duplicar filas.
--
-- POR QUÉ ES UNA FUNCIÓN Y NO UN BLOQUE COPIADO EN CADA SEED: porque una copia
-- generada se edita a mano igual de fácil que una escrita a mano. Los seeds
-- (lab-seed, onboard-org, onboard-org-paso1) LLAMAN a esta función. Ver R1.
--
-- CATÁLOGO VIVO (23 permisos):
--   POS             pos.vender, pos.descuento, pos.anular
--   Caja            caja.abrir, caja.cerrar, caja.movimientos
--   Mesas           mesas.gestionar, mesas.cobrar
--   Cocina          cocina.acceder
--   Delivery        delivery.gestionar
--   Productos       productos.ver, productos.editar
--   Compras         compras.gestionar
--   Fiado           fiado.gestionar
--   Ventas          ventas.historial, ventas.anular
--   Reportes        reportes.financiero, reportes.stock, reportes.consolidado
--   Configuración   config.acceder, usuarios.gestionar, sedes.gestionar, roles.gestionar
--
-- POLÍTICA DE ROLES:
--   owner    1 comodín "*" — hereda todo, presente y futuro
--   admin   23 permisos
--   cajero  10 permisos
--   mozo     3 permisos
--
-- ⚠️ ESTA FUNCIÓN NO CORRIGE ORGANIZACIONES YA EXISTENTES. Nadie vuelve a correr un
--    onboarding sobre una org que ya está vendiendo. Reconciliar las que nacieron
--    con catálogos viejos es una migración APARTE, y tiene que ser UNIÓN (agregar
--    lo que falta), nunca `set permissions = <canónica>`: eso pisaría en silencio
--    los ajustes que el cliente haya hecho a sus roles. Ver R6 y docs/DEUDAS.md.
--
-- NO DEDUZCAS EL ESTADO DE ESTE COMENTARIO — correlo (1 fila = aplicada):
--   select 1 from pg_proc where proname = 'seed_system_roles';
--
-- RE-APLICAR ES SEGURO (idempotente): solo `create or replace function`.
--
-- Ejecutar en: Supabase Dashboard > SQL Editor.
-- ============================================================

begin;

create or replace function public.seed_system_roles(p_org uuid)
returns void
language plpgsql
set search_path = public
as $fn$
begin
  if p_org is null then
    raise exception 'seed_system_roles: p_org no puede ser null';
  end if;

  if not exists (select 1 from public.organizations where id = p_org) then
    raise exception 'seed_system_roles: la organización % no existe', p_org;
  end if;

  insert into public.roles (organization_id, name, is_system, permissions)
  values
    (p_org, 'owner', true, '["*"]'::jsonb),
    (p_org, 'admin', true, '[
      "pos.vender","pos.descuento","pos.anular","caja.abrir","caja.cerrar",
      "caja.movimientos","mesas.gestionar","mesas.cobrar","cocina.acceder",
      "delivery.gestionar","productos.ver","productos.editar",
      "compras.gestionar","fiado.gestionar","ventas.historial","ventas.anular",
      "reportes.financiero","reportes.stock","reportes.consolidado",
      "config.acceder","usuarios.gestionar","sedes.gestionar","roles.gestionar"
    ]'::jsonb),
    (p_org, 'cajero', true, '[
      "pos.vender","pos.descuento","pos.anular","caja.abrir","caja.cerrar",
      "caja.movimientos","mesas.cobrar","delivery.gestionar","fiado.gestionar",
      "ventas.historial"
    ]'::jsonb),
    (p_org, 'mozo', true, '["pos.vender","mesas.gestionar","cocina.acceder"]'::jsonb)
  on conflict (organization_id, name)
    do update set permissions = excluded.permissions, is_system = true;
end $fn$;

-- Postgres concede EXECUTE a PUBLIC por defecto en toda función nueva. Esto solo lo
-- corre un humano desde el SQL Editor durante un onboarding: nadie autenticado
-- necesita poder reescribir los roles de su propia organización.
revoke execute on function public.seed_system_roles(uuid) from public;
revoke execute on function public.seed_system_roles(uuid) from anon;
revoke execute on function public.seed_system_roles(uuid) from authenticated;

commit;

-- ============================================================
-- VERIFICACIÓN (correr aparte tras el commit)
-- ============================================================
-- Esperado: 4 filas por organización, con estos tamaños:
--   owner   → 1
--   admin   → 23
--   cajero  → 10
--   mozo    → 3
--
-- select o.name as org, r.name as rol,
--        jsonb_array_length(r.permissions) as n,
--        (r.permissions ? '*')             as comodin
--   from public.roles r
--   join public.organizations o on o.id = r.organization_id
--  where r.is_system
--  order by o.name, r.name;
