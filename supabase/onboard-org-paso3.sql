-- ============================================================
-- G-Vento — Onboarding de ORGANIZACIÓN NUEVA · PASO 3 de 3
--            (completar el profile del owner: role_id + user_stores)
--
-- 🔴 ESTO NO ES UNA MIGRACIÓN. Correr DESPUÉS de onboard-org-paso1.sql y de
--    haber creado la cuenta de Auth (paso 2, abajo).
--
-- ============================================================
-- PASO 2 — CREAR LA CUENTA DE AUTH (esto NO es SQL; va antes de este archivo)
--
-- La cuenta DEBE nacer con user_metadata. handle_new_user
-- (profiles-organization-invariant.sql) lee de ahí `restaurant_id`, `role` y
-- `full_name`, y ABORTA la creación si falta `restaurant_id`:
--
--   'No se puede crear el perfil: falta restaurant_id en user_metadata'
--
-- La metadata exacta, con el restaurant_id que imprimió el PASO 1:
--
--   {
--     "restaurant_id": "<<UUID DE LA SEDE, salida del PASO 1>>",
--     "role": "admin",
--     "full_name": "Nombre del dueño"
--   }
--
-- `role` es el ENUM LEGACY (admin | cashier | waiter), no el RBAC. Va 'admin'
-- porque las policies viejas que todavía gatean por get_my_role() lo esperan.
-- El rol RBAC de verdad (owner, con "*") lo asigna este archivo.
--
-- ── VÍA A: Dashboard ────────────────────────────────────────────────────────
-- Authentication → Users → Add user → Create new user. Si el formulario tiene
-- un campo "User Metadata" (JSON), pegá el objeto de arriba y listo.
--
-- ⚠️ NO DOY POR SENTADO QUE ESE CAMPO EXISTE en la versión del Dashboard que
--    tenés: cambió entre versiones y no lo puedo verificar desde acá. Miralo
--    ANTES (son 10 segundos). Si el modal solo pide Email / Password / Auto
--    Confirm User, no sirve: la cuenta se crearía sin metadata, el trigger
--    abortaría y no queda nada creado (falla limpio, no deja huérfanos).
--
-- ── VÍA B: API admin de Auth — funciona SIEMPRE, es la que yo usaría ────────
-- Necesitás el `service_role` key (Dashboard → Project Settings → API).
-- ⚠️ Esa key es de TODO el proyecto (LAB, G-10, Salchimelo), no "del lab".
--
-- 🔴 PEGAR UN curl MULTILÍNEA EN GIT BASH ROMPE LAS CONTINUACIONES `\` y la
--    petición sale SIN HEADERS → 401 idéntico al de una key equivocada, y se
--    pierde el tiempo revisando la credencial (trampa ya documentada en
--    CLAUDE.md). Por eso va como FUNCIÓN de shell: se pega como bloque y se
--    invoca en una línea.
--
--   crear_owner() {
--     curl -s -X POST "$SB_URL/auth/v1/admin/users" \
--       -H "apikey: $SB_SERVICE_KEY" \
--       -H "Authorization: Bearer $SB_SERVICE_KEY" \
--       -H "Content-Type: application/json" \
--       -d "{\"email\":\"$1\",\"password\":\"$2\",\"email_confirm\":true,
--            \"user_metadata\":{\"restaurant_id\":\"$3\",\"role\":\"admin\",
--                               \"full_name\":\"$4\"}}"
--   }
--
--   export SB_URL="https://<project-ref>.supabase.co"
--   export SB_SERVICE_KEY="<service_role key>"
--   crear_owner "dueno@cafeteria.com" "unaClaveLarga123" "<uuid-sede>" "Nombre del Dueño"
--
-- Respuesta OK: un JSON con "id". Si el trigger rechazó, viene
-- {"code":500,...,"msg":"Database error creating new user"} y NO se creó nada
-- (el AFTER INSERT aborta la transacción entera) — revisá el restaurant_id.
--
-- ── VÍA C: la Edge Function `create-user` NO SIRVE ACÁ ──────────────────────
-- Exige `restaurant_id === callerProfile.restaurant_id` (index.ts:75), o sea
-- que solo crea usuarios DENTRO de la sede del llamante. Para el PRIMER owner
-- de una organización nueva no hay llamante todavía. No insistas por ahí.
--
-- ── LO QUE NO HAY QUE HACER ─────────────────────────────────────────────────
-- Insertar a mano en `auth.users` desde el SQL Editor. Se puede, pero hay que
-- hashear la contraseña y crear la fila de `auth.identities` con la forma que
-- espera la versión de GoTrue en uso; si queda mal, el síntoma es un login que
-- falla sin decir por qué. Usá la API admin.
-- ============================================================


-- ============================================================
-- PASO 3 — completar el profile.
--
-- handle_new_user ya creó la fila de `profiles` con id, email, full_name,
-- role (enum), restaurant_id y organization_id DERIVADO de la sede. Lo que NO
-- setea —a propósito, porque `raw_user_meta_data` es un canal que el usuario
-- controlaría en un signUp abierto— es `role_id`. Sin role_id el usuario entra
-- pero queda con permissions = [] : sidebar vacío y toda ruta rebotando.
--
-- Este bloque hace exactamente dos cosas: role_id → owner, y user_stores.
--
-- El owner se resuelve por EMAIL, no por UUID pegado a mano: un UUID mal
-- copiado apuntaría a un usuario de otra organización, y este script escribe
-- sobre la fila que encuentre. El email es verificable de un vistazo.
--
-- Corre como `postgres` desde el SQL Editor, así que
-- trg_protect_profile_self_escalation (acotado a 'authenticated') no dispara.
-- trg_profiles_org_consistency SÍ dispara —es invariante de datos, no de
-- autorización— y pasa: la organización ya coincide con la de la sede.
--
-- IDEMPOTENTE: re-correrlo reafirma los mismos valores.
-- ============================================================

begin;

create temporary table _params on commit drop as
select
  'Café Aroma'::text    as v_org_name,     -- el mismo del PASO 1
  'demo@demo.com'::text as v_owner_email;  -- el del PASO 2


do $$
declare
  v_org_name text;  v_owner_email text;
  v_org uuid;  v_sede uuid;  v_uid uuid;  v_role_owner uuid;
  v_prof_org uuid;  v_n_sedes integer;
begin
  select p.v_org_name, p.v_owner_email into v_org_name, v_owner_email from _params p;

  if v_org_name like 'CAMBIAR:%' or v_owner_email like 'CAMBIAR:%' then
    raise exception 'Editá el bloque de PARÁMETROS antes de ejecutar.';
  end if;

  select id into v_org from public.organizations where name = v_org_name limit 1;
  if v_org is null then
    raise exception 'No existe la organización "%". Corré onboard-org-paso1.sql primero.', v_org_name;
  end if;

  -- Una sola sede por diseño de este onboarding. Si hubiera más de una, el
  -- script no adivina cuál es la del owner: aborta y lo decide un humano.
  select count(*), min(id) into v_n_sedes, v_sede
    from public.restaurants where organization_id = v_org;
  if v_n_sedes <> 1 then
    raise exception 'La organización "%" tiene % sedes; este script asume 1. Asigná la sede a mano.',
      v_org_name, v_n_sedes;
  end if;

  -- La cuenta de Auth tiene que existir: es el PASO 2.
  select id into v_uid from auth.users where email = v_owner_email limit 1;
  if v_uid is null then
    raise exception
      'No existe la cuenta Auth "%". Hacé el PASO 2 (crear el usuario CON user_metadata) antes de correr esto. Ver el encabezado de este archivo.',
      v_owner_email;
  end if;

  -- El profile lo tiene que haber creado handle_new_user. Si no está, la
  -- cuenta se creó por un camino que salteó el trigger y hay que mirarlo: NO
  -- lo insertamos acá a mano, porque eso taparía el problema en silencio.
  if not exists (select 1 from public.profiles where id = v_uid) then
    raise exception
      'La cuenta Auth "%" existe pero NO tiene profile. Se creó salteando handle_new_user. Borrá la cuenta y volvé a crearla con user_metadata (PASO 2).',
      v_owner_email;
  end if;

  -- Guard de organización cruzada: si el profile quedó apuntando a OTRA org,
  -- es que la metadata llevaba el restaurant_id equivocado. Abortar antes de
  -- escribirle un role_id de esta organización encima.
  select organization_id into v_prof_org from public.profiles where id = v_uid;
  if v_prof_org is distinct from v_org then
    raise exception
      'El profile de "%" pertenece a la organización % y no a "%" (%). El restaurant_id de la metadata estaba equivocado.',
      v_owner_email, v_prof_org, v_org_name, v_org;
  end if;

  select id into v_role_owner
    from public.roles where organization_id = v_org and name = 'owner' limit 1;
  if v_role_owner is null then
    raise exception 'La organización "%" no tiene rol owner. Re-corré onboard-org-paso1.sql.', v_org_name;
  end if;

  -- Lo único que falta del profile.
  update public.profiles
     set role_id       = v_role_owner,
         restaurant_id = v_sede,
         is_active     = true
   where id = v_uid;

  -- Acceso a la sede (sin esto no puede operar ni cambiar de sede).
  insert into public.user_stores (user_id, restaurant_id)
  values (v_uid, v_sede)
  on conflict (user_id, restaurant_id) do nothing;

  raise notice 'PASO 3 OK — % es owner de "%" en la sede %.', v_owner_email, v_org_name, v_sede;
end $$;


-- ============================================================
-- VERIFICACIÓN — las 3 grillas tienen que cuadrar antes del commit.
-- ============================================================

-- rol_rbac debe decir 'owner'; org y sede, las del PASO 1; is_active true.
select 'profile owner' as check, pr.email, pr.full_name,
       pr.role as enum_legacy, rl.name as rol_rbac, rl.permissions,
       o.name as org, r.name as sede_activa, r.uses_kitchen, pr.is_active
  from _params p
  join public.profiles pr        on pr.email = p.v_owner_email
  left join public.organizations o on o.id = pr.organization_id
  left join public.roles rl        on rl.id = pr.role_id
  left join public.restaurants r   on r.id = pr.restaurant_id;

-- Debe haber exactamente 1 fila.
select 'user_stores' as check, pr.email, r.name as sede_con_acceso
  from _params p
  join public.profiles pr    on pr.email = p.v_owner_email
  join public.user_stores us on us.user_id = pr.id
  join public.restaurants r  on r.id = us.restaurant_id;

-- Sin banner de suscripción: 'active' + mensaje null.
select 'suscripción (debe ser active)' as check,
       o.name, o.subscription_status, o.subscription_message, o.subscription_updated_at
  from _params p
  join public.organizations o on o.name = p.v_org_name;

commit;


-- ============================================================
-- ❌ DESCARTADO POR DECISIÓN (2026-08-25) — ocultar DELIVERY del sidebar.
--
-- 🔴 NO APLICAR. Se evaluó y se decidió que NO. Queda escrito con su porqué
--    para que una sesión futura no lo "descubra" y lo aplique creyendo que es
--    una mejora pendiente. Si alguna vez se retoma, que sea con este trade-off
--    a la vista, no por encontrarlo acá.
--
-- LA DECISIÓN: el owner de la demo CONSERVA el comodín "*".
-- EL PORQUÉ (del dueño de la demo, que es quien la da en vivo): en una
-- demostración presencial, un permiso faltante que revienta delante del
-- cliente cuesta muchísimo más que un ítem de menú que nunca se toca.
-- Delivery visible y no visitado tiene costo CERO; un botón que no responde
-- porque al rol le faltaba un permiso te deja mudo y sin salida. Si el dueño
-- pregunta por Delivery o Mesas, se convierte en venta: "está si algún día lo
-- necesitás, hoy no te estorba".
--
-- Lo de abajo es el camino que se descartó, conservado solo como referencia.
--
-- El item Delivery se gatea con `delivery.gestionar`; el owner lo hereda por
-- el comodín "*", así que con el rol owner SIEMPRE se ve. Para un negocio de
-- mostrador es ruido. (Cocina ya desaparece por uses_kitchen=false.
-- ⚠️ VENTAS y MESAS no tienen permiso en NAV_GROUPS: se ven siempre, no hay
--    forma de ocultar Mesas sin tocar código. Con 0 mesas sembradas la
--    pantalla muestra un vacío limpio: "Sin mesas. Usa Configurar para agregar".)
--
-- El precio de esto: el usuario deja de tener el comodín, así que si falta un
-- permiso en la lista, ESE flujo se cae en vivo. Por eso la vuelta atrás está
-- escrita justo abajo — un solo UPDATE, 5 segundos.
--
-- Descomentar para APLICAR:
--
-- begin;
-- Deriva los permisos del rol 'admin' ya sembrado por seed_system_roles(), en vez
-- de repetir la lista acá. Antes esto era una SÉPTIMA copia del catálogo, y con la
-- divergencia que tenían las otras seis lo más probable era que naciera desfasada.
-- insert into public.roles (organization_id, name, is_system, permissions)
-- select o.id, 'Administrador', false, r.permissions
--   from public.organizations o
--   join public.roles r
--     on r.organization_id = o.id and r.name = 'admin' and r.is_system
--  where o.name = 'CAMBIAR: nombre del negocio'
-- on conflict (organization_id, name) do update set permissions = excluded.permissions;
--
-- update public.profiles p
--    set role_id = rl.id
--   from public.roles rl
--   join public.organizations o on o.id = rl.organization_id
--  where o.name = 'CAMBIAR: nombre del negocio'
--    and rl.name = 'Administrador'
--    and p.email = 'CAMBIAR: correo del owner';
-- commit;
--
-- VUELTA ATRÁS (volver al owner con "*") si algo falta en plena demo:
--
-- update public.profiles p
--    set role_id = rl.id
--   from public.roles rl
--   join public.organizations o on o.id = rl.organization_id
--  where o.name = 'CAMBIAR: nombre del negocio'
--    and rl.name = 'owner'
--    and p.email = 'CAMBIAR: correo del owner';
--
-- Los permisos se cachean 30 min en React Query (usePermissions, staleTime),
-- así que después del swap hay que RECARGAR la pestaña (F5) para verlo.
-- ============================================================
