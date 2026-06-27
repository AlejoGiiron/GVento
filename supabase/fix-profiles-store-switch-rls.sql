-- ============================================================
-- Fix RLS — Cambio de sede activa bloqueado por la policy SELECT de profiles
--
-- Migración NUEVA. No edita migraciones aplicadas.
--
-- SÍNTOMA: un usuario con acceso a varias sedes (user_stores) no puede cambiar
-- su sede activa desde el StoreSelector. La operación
--     update profiles set restaurant_id = <otra sede> where id = auth.uid()
-- devuelve 403 "new row violates row-level security policy for table profiles".
-- Latente en producción (G-10 tiene 1 sola sede → el StoreSelector ni se
-- renderiza); aflora con multi-sede (p. ej. al abrir Salchimelo).
--
-- ── CAUSA RAÍZ (confirmada contra la BD, no asumida) ────────────────────────
-- El bloqueo NO está en las policies de UPDATE, sino en la de SELECT:
--
--   "profiles: ver del mismo restaurante"  (SELECT)
--      using (restaurant_id = get_my_restaurant_id())
--
-- Al actualizar el propio profile, la FILA NUEVA (restaurant_id = sede destino)
-- debe seguir siendo visible bajo las policies de SELECT. get_my_restaurant_id()
-- lee profiles.restaurant_id del usuario y, dentro del statement, devuelve la
-- sede ANTERIOR (snapshot previo al commit). Como sede_destino <> sede_anterior,
-- la fila nueva deja de ser visible y Postgres aborta con 42501.
--
-- Comprobado empíricamente (todo en transacciones con ROLLBACK):
--   · Con las policies tal cual → el switch del owner a otra sede da 42501.
--   · Las DOS clausulas WITH CHECK de UPDATE evalúan bien en el contexto del
--     owner: "admin edita cualquiera" = false, "editar el propio" = TRUE
--     (la subconsulta a user_stores devuelve las 3 sedes). El OR permisivo de
--     UPDATE NO es el problema → las policies de UPDATE NO se tocan.
--   · Dropeando "ver del mismo restaurante" → el switch pasa.
--   · Añadiendo una policy SELECT `id = auth.uid()` y dejando TODO lo demás
--     intacto → el switch pasa (after_update = sede destino). ← este es el fix.
--
-- ── FIX (aditivo y mínimo) ──────────────────────────────────────────────────
-- El usuario SIEMPRE puede ver su PROPIO perfil. Se añade una policy SELECT
-- permisiva extra `id = auth.uid()`, que se combina por OR con la existente.
-- NO amplía la visibilidad a perfiles ajenos (solo la fila propia, que el
-- usuario ya puede editar) y deja la fila nueva visible durante el cambio de
-- sede. Las policies de UPDATE y la de SELECT existente se preservan intactas.
--
-- Ejecutar en: Supabase Dashboard > SQL Editor. Migración NUEVA.
-- ============================================================

begin;

-- Idempotente: recrear la policy aditiva si ya existiera.
drop policy if exists "profiles: ver el propio" on public.profiles;

create policy "profiles: ver el propio"
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid());

commit;

-- ============================================================
-- VERIFICACIÓN (read-only) — todas las policies de profiles tras el fix.
-- Debe aparecer la nueva "profiles: ver el propio" (SELECT, permissive,
-- authenticated, using = id = auth.uid()) junto a las preexistentes intactas:
--   · "profiles: ver del mismo restaurante" (SELECT)
--   · "profiles: editar el propio" (UPDATE)
--   · "profiles: admin edita cualquiera" (UPDATE)
-- ============================================================
select policyname, cmd, permissive, roles, qual as using_expr, with_check
  from pg_policies
 where schemaname = 'public' and tablename = 'profiles'
 order by cmd, policyname;
