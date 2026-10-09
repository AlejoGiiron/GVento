-- supabase/restaurant-config-rpc.sql
-- ============================================================================
-- restaurants.config se FUSIONA EN EL SERVIDOR, clave por clave.
--
-- Antes, el navegador guardaba el objeto ENTERO: { ...configQueTenía, ...cambio }
-- (useRestaurantConfig.updateConfig). Con una copia vieja —otra pestaña, otro
-- equipo, o dos guardados seguidos en la MISMA pantalla antes de que vuelva el
-- refetch— reescribía claves que no estaba cambiando con su valor viejo, o las
-- borraba. Falla callado: nadie se entera hasta que falta el QR o el PIN.
--
-- update_restaurant_config(p_cambios jsonb) → jsonb (la config resultante):
--   · Toca SOLO las claves que vienen en p_cambios; las demás quedan como están,
--     incluidas claves viejas que el frontend ya no conoce.
--   · Un valor null BORRA la clave.
--   · ALLOWLIST de claves (fail-closed): una clave que no está en la lista da
--     error y no se guarda nada. 🔴 CONTRATO DE DOS LADOS (R1): la lista vive
--     acá y en CLAVES_CONFIG de src/lib/restaurantConfig.ts (que el
--     compilador ata al tipo RestaurantConfig). Lo vigila
--     tests/config-merge.spec.ts, que escribe cada clave de CLAVES_CONFIG por
--     esta RPC. Agregar una clave = agregarla en los dos lados.
--   · Permiso: has_permission('config.acceder') (el mismo que abre la pantalla
--     de Configuración). La sede sale de get_my_restaurant_id(), no del cliente.
--   · Una sola sentencia UPDATE: dos guardados simultáneos se serializan por el
--     lock de la fila y ninguno pisa al otro.
--
-- QUIÉN PUEDE ESCRIBIR CAMBIA: antes lo decidía la RLS de restaurants (rol viejo
-- 'admin' o 'sedes.gestionar'); ahora, 'config.acceder'. En los roles del sistema
-- (src/lib/permissions.ts) config.acceder lo tienen owner y admin. Para ver a
-- quién le cambia en una base: la consulta del final.
--
-- NO cierra la escritura directa: la RLS sigue permitiendo
-- update restaurants set config = … desde el navegador (DEUDAS → "Tablas que solo
-- deberían escribirse por RPC").
--
-- PRECONDICIÓN: has_permission y get_my_restaurant_id (profiles-is-active-enforced.sql).
-- RE-APLICAR: idempotente (create or replace + revoke/grant).
-- FRONTEND: la RPC es NUEVA → este SQL va ANTES del frontend que la llama. El
-- frontend anterior sigue escribiendo el objeto entero (y sigue pudiendo pisar).
--
-- NO DEDUZCAS EL ESTADO DE ESTE COMENTARIO — correlo:
--   select to_regprocedure('public.update_restaurant_config(jsonb)');   -- null = no está
-- ============================================================================

begin;

create or replace function public.update_restaurant_config(p_cambios jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- 🔴 La misma lista que CLAVES_CONFIG (src/lib/restaurantConfig.ts).
  c_permitidas constant text[] := array[
    'slug', 'cash_out_reasons', 'payment_methods', 'nequi_qr_url',
    'kitchen_pin', 'kitchen_stations', 'kds_timers', 'default_delivery_time',
    'notifications', 'pos_movil'
  ];
  v_sede       uuid := get_my_restaurant_id();
  v_ajenas     text[];
  v_poner      jsonb;
  v_quitar     text[];
  v_resultado  jsonb;
begin
  if auth.uid() is null then raise exception 'No hay sesión'; end if;
  if v_sede is null then raise exception 'No tienes una sede activa'; end if;
  if not has_permission('config.acceder') then
    raise exception 'No tienes permiso para cambiar la configuración';
  end if;
  if jsonb_typeof(p_cambios) is distinct from 'object' or p_cambios = '{}'::jsonb then
    raise exception 'No hay cambios para guardar';
  end if;

  select array_agg(k order by k) into v_ajenas
    from jsonb_object_keys(p_cambios) k
   where k <> all (c_permitidas);
  if v_ajenas is not null then
    raise exception 'Clave de configuración no permitida: %. No se guardó nada.', array_to_string(v_ajenas, ', ');
  end if;

  select coalesce(jsonb_object_agg(key, value) filter (where jsonb_typeof(value) <> 'null'), '{}'::jsonb),
         coalesce(array_agg(key) filter (where jsonb_typeof(value) = 'null'), '{}')
    into v_poner, v_quitar
    from jsonb_each(p_cambios);

  update public.restaurants
     set config = (coalesce(config, '{}'::jsonb) - v_quitar) || v_poner
   where id = v_sede
  returning config into v_resultado;

  if not found then raise exception 'La sede % no existe', v_sede; end if;
  return v_resultado;
end;
$$;

revoke execute on function public.update_restaurant_config(jsonb) from public, anon;
grant  execute on function public.update_restaurant_config(jsonb) to authenticated;

commit;

-- A quién le cambia el poder de guardar la config (solo lectura; correr aparte):
--   select org.name as organizacion, p.full_name, p.role as rol_viejo, r.name as rol,
--          (p.role = 'admin' or r.permissions ? 'sedes.gestionar' or r.permissions ? '*') as podia_antes,
--          (r.permissions ? 'config.acceder' or r.permissions ? '*')                      as puede_ahora
--     from public.profiles p
--     join public.organizations org on org.id = p.organization_id
--     left join public.roles r on r.id = p.role_id
--    where p.is_active
--      and (p.role = 'admin' or r.permissions ? 'sedes.gestionar' or r.permissions ? '*')
--       is distinct from (r.permissions ? 'config.acceder' or r.permissions ? '*')
--    order by 1, 2;
--   -- 0 filas = no le cambia a nadie.
