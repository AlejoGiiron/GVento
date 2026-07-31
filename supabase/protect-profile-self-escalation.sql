-- ============================================================
-- G-Vento — PRIORIDAD 1: cerrar la escalada por auto-edición de profiles
--
-- Del diagnóstico: la policy "profiles: editar el propio" (UPDATE) no acota
-- COLUMNAS. Su WITH CHECK solo valida que restaurant_id pertenezca a
-- user_stores del propio usuario:
--
--   with check (
--     id = auth.uid()
--     and restaurant_id in (select restaurant_id from user_stores where user_id = auth.uid())
--   )
--
-- Eso deja al usuario escribir libremente sobre SU PROPIA fila:
--
--   (1) role_id       -> auto-promocion. La policy "roles: ver los de la org"
--                        le deja LEER el id del rol owner de su org, asi que se
--                        auto-asigna el comodin '*' y has_permission() pasa a
--                        true para todo. protect_owner_role NO lo frena: blinda
--                        la tabla roles, no la ASIGNACION de role_id.
--   (2) role (enum)   -> gates legacy get_my_role() in ('admin','cashier'),
--                        todavia vigentes (register_sale_payment, create-user).
--   (3) is_active     -> un usuario desactivado se REACTIVA solo. Sin esto, la
--                        Prioridad 2 (is_active efectivo) seria trivial de
--                        revertir por el propio sancionado.
--   (4) organization_id -> get_my_organization_id() lee esta columna. Apuntarla
--                        a otra org (manteniendo restaurant_id, que satisface el
--                        WITH CHECK) rompe el aislamiento multi-tenant: se ven
--                        las sedes y roles ajenos y, con usuarios.gestionar, se
--                        auto-inserta un user_stores hacia una sede de la
--                        victima y luego se activa esa sede.
--
-- Encadenados, (1)+(4) llevan de "cualquier credencial valida" a "datos de
-- cualquier organizacion de la BD compartida".
--
-- ── FIX ─────────────────────────────────────────────────────────────────────
-- Trigger BEFORE UPDATE en profiles, mismo patron que protect_owner_role:
-- acotado a usuarios reales (current_user = 'authenticated') para no romper
-- seeds, el trigger handle_new_user ni el service_role de la Edge Function.
-- Rechaza el cambio de las 4 columnas SOLO cuando la fila editada es la del
-- propio llamante (new.id = auth.uid()).
--
-- NO se tocan las policies. La escritura ajena sigue gobernada por
-- "profiles: admin edita cualquiera" (new.id <> auth.uid() => el trigger no
-- aplica), asi que asignar rol/desactivar a un EMPLEADO sigue funcionando.
--
-- La comparacion usa IS DISTINCT FROM (no <>) por dos razones:
--   · role_id y organization_id son NULLABLE; <> daria NULL y no dispararia.
--   · PostgREST envia solo las columnas del .update({...}); Postgres completa
--     el resto de NEW desde OLD. Sin cambio real no hay diferencia => pasa.
--     Por eso el cambio de sede activa (update {restaurant_id}) NO se ve
--     afectado: role_id/role/is_active/organization_id llegan identicos.
--
-- Ejecutar en: Supabase Dashboard > SQL Editor. Migracion NUEVA.
-- ============================================================

begin;

create or replace function public.protect_profile_self_escalation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Solo usuarios reales (PostgREST hace SET ROLE authenticated) y solo sobre
  -- la fila PROPIA. Seeds/servicio (postgres, service_role) y la edicion de
  -- perfiles ajenos por un admin pasan sin restriccion.
  if current_user = 'authenticated' and new.id = auth.uid() then

    if new.role_id is distinct from old.role_id then
      raise exception 'No podes cambiar tu propio rol'
        using errcode = 'check_violation';
    end if;

    if new.role is distinct from old.role then
      raise exception 'No podes cambiar tu propio rol de sistema'
        using errcode = 'check_violation';
    end if;

    if new.is_active is distinct from old.is_active then
      raise exception 'No podes activar ni desactivar tu propio usuario'
        using errcode = 'check_violation';
    end if;

    if new.organization_id is distinct from old.organization_id then
      raise exception 'No podes cambiar tu propia organizacion'
        using errcode = 'check_violation';
    end if;

  end if;

  return new;
end;
$$;

-- Idempotente: recrear si ya existiera.
drop trigger if exists trg_protect_profile_self_escalation on public.profiles;

create trigger trg_protect_profile_self_escalation
  before update on public.profiles
  for each row execute function public.protect_profile_self_escalation();

commit;

-- ============================================================
-- VERIFICACION (read-only) — el trigger quedo instalado.
-- ============================================================
select tgname,
       tgenabled,
       pg_get_triggerdef(oid) as definicion
  from pg_trigger
 where tgrelid = 'public.profiles'::regclass
   and not tgisinternal
 order by tgname;

-- ============================================================
-- PRUEBAS EMPIRICAS — correr COMO EL USUARIO afectado (no como postgres:
-- con postgres current_user no es 'authenticated' y el trigger se saltea).
-- Desde la app, con la consola del navegador y la sesion iniciada.
--
--   // (A) DEBE FALLAR — auto-promocion
--   await supabase.from('profiles')
--     .update({ role_id: '<uuid del rol owner>' })
--     .eq('id', (await supabase.auth.getUser()).data.user.id)
--   // esperado: error 'No podes cambiar tu propio rol'
--
--   // (B) DEBE FALLAR — salto de organizacion
--   await supabase.from('profiles')
--     .update({ organization_id: '<uuid de otra org>' })
--     .eq('id', (await supabase.auth.getUser()).data.user.id)
--
--   // (C) DEBE FALLAR — auto-reactivacion
--   await supabase.from('profiles')
--     .update({ is_active: true })
--     .eq('id', (await supabase.auth.getUser()).data.user.id)
--
--   // (D) DEBE PASAR — cambio de sede activa (StoreSelector, flujo real)
--   await supabase.from('profiles')
--     .update({ restaurant_id: '<otra sede propia de user_stores>' })
--     .eq('id', (await supabase.auth.getUser()).data.user.id)
--
--   // (E) DEBE PASAR — editar el propio nombre
--   await supabase.from('profiles')
--     .update({ full_name: 'Nombre Nuevo' })
--     .eq('id', (await supabase.auth.getUser()).data.user.id)
--
--   // (F) DEBE PASAR — admin asigna rol a un EMPLEADO (fila ajena)
--   await supabase.from('profiles')
--     .update({ role_id: '<uuid rol cajero>' })
--     .eq('id', '<uuid de OTRO usuario de la sede>')
-- ============================================================
