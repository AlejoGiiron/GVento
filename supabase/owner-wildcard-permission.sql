-- ============================================================
-- G-Vento — Permiso comodín "*" para el rol owner
--
-- Problema:
--   Cada permiso nuevo (ej: compras.gestionar) hay que sembrarlo a mano en el
--   rol owner de CADA organización (G-10, LAB, futuras). Es frágil y se olvida.
--
-- Diseño aprobado:
--   • El rol owner usa el comodín "*" en permissions, en vez de enumerar todo.
--   • has_permission(perm) → true si el rol tiene 'perm' O tiene '*'.
--   • SOLO el owner usa "*". admin, cajero, mozo y roles custom siguen con
--     permisos explícitos (un rol custom nunca recibe el comodín desde la UI).
--
-- Efecto: el owner hereda automáticamente cualquier permiso futuro sin tocar BD.
--
-- Migración NUEVA, atómica. No edita migraciones aplicadas.
-- Ejecutar en: Supabase Dashboard > SQL Editor. NO aplicada todavía.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. has_permission(perm) — ahora reconoce el comodín "*".
--    Idéntico a multi-tenant-rbac.sql salvo el OR del comodín.
--    Se conservan SECURITY DEFINER, search_path y los grants.
-- ------------------------------------------------------------
create or replace function public.has_permission(perm text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    join public.roles r on r.id = p.role_id
    where p.id = auth.uid()
      and (r.permissions ? perm or r.permissions ? '*')
  )
$$;

revoke execute on function public.has_permission(text) from public;
revoke execute on function public.has_permission(text) from anon;
grant  execute on function public.has_permission(text) to authenticated;

-- ------------------------------------------------------------
-- 2. Colapsar los roles owner de TODAS las organizaciones a "*".
--    SOLO name='owner' AND is_system=true. No toca admin/cajero/mozo
--    ni roles custom (estos nunca son is_system con name owner).
-- ------------------------------------------------------------
update public.roles
   set permissions = '["*"]'::jsonb
 where name = 'owner'
   and is_system = true;

commit;

-- ============================================================
-- 3. VERIFICACIÓN (correr aparte tras el commit; no afecta la migración)
-- ============================================================

-- 3.1 Los owner deben quedar con ["*"]; el resto, intactos.
--     Esperado: 1 fila por organización con permissions = ["*"].
select organization_id, name, is_system, permissions
from public.roles
where name = 'owner' and is_system = true
order by organization_id;

-- 3.2 Nada más debería tener el comodín (admin/cajero/mozo/custom sin "*").
--     Esperado: 0 filas.
select organization_id, name, permissions
from public.roles
where permissions ? '*'
  and not (name = 'owner' and is_system = true);

-- 3.3 Prueba conceptual de has_permission (requiere sesión autenticada;
--     en el SQL Editor auth.uid() es null → no aplica). Lógica esperada:
--       • owner  (permissions ["*"])                 → has_permission('lo-que-sea') = true
--       • admin  (sin "*", sin 'compras.gestionar')  → has_permission('compras.gestionar') = false
--       • cajero (sin "*")                            → has_permission('config.acceder')   = false
