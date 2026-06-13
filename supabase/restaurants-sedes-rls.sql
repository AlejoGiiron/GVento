-- ============================================================
-- RLS — Gestión de sedes (restaurants) a nivel organización
--
-- Migración NUEVA. No edita migraciones aplicadas.
--
-- Necesaria para la sección "Sedes" del panel de configuración y para que
-- el StoreSelector pueda leer el nombre de las demás sedes:
--   - SELECT: hoy solo se ve la sede ACTIVA (id = get_my_restaurant_id()).
--     Se agrega ver todas las sedes de la propia organización.
--   - INSERT/UPDATE/DELETE: con has_permission('sedes.gestionar'),
--     acotado a la propia organización.
--
-- Las políticas viejas (ver la propia / admin actualiza por enum) se dejan
-- intactas; estas son aditivas (RLS permisivo = OR).
-- ============================================================

begin;

-- Ver todas las sedes de la propia organización.
create policy "restaurants: ver las de la org"
  on public.restaurants for select to authenticated
  using (organization_id = get_my_organization_id());

-- Crear una sede en la propia organización.
create policy "restaurants: crear sede con permiso"
  on public.restaurants for insert to authenticated
  with check (
    organization_id = get_my_organization_id()
    and has_permission('sedes.gestionar')
  );

-- Editar cualquier sede de la organización.
create policy "restaurants: editar sede con permiso"
  on public.restaurants for update to authenticated
  using  (organization_id = get_my_organization_id() and has_permission('sedes.gestionar'))
  with check (organization_id = get_my_organization_id());

-- Borrar una sede de la organización (la UI impide borrar la única).
create policy "restaurants: borrar sede con permiso"
  on public.restaurants for delete to authenticated
  using (organization_id = get_my_organization_id() and has_permission('sedes.gestionar'));

commit;
