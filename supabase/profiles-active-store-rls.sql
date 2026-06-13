-- ============================================================
-- Fix RLS — Cambio de sede activa (profiles.restaurant_id)
--
-- Migración NUEVA. No edita migraciones aplicadas.
--
-- Problema: la política "profiles: editar el propio" tenía
--   with check (... restaurant_id = get_my_restaurant_id())
-- lo que rechaza cambiar la sede activa (el nuevo restaurant_id ≠ el
-- actual, que es lo que devuelve get_my_restaurant_id()).
--
-- Fix: permitir que el usuario fije su restaurant_id a CUALQUIER sede a la
-- que tenga acceso en user_stores (que incluye la sede actual, así que
-- también cubre editar el resto del perfil sin cambiar de sede).
-- ============================================================

begin;

drop policy if exists "profiles: editar el propio" on public.profiles;

create policy "profiles: editar el propio"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and restaurant_id in (
      select restaurant_id from public.user_stores where user_id = auth.uid()
    )
  );

commit;
