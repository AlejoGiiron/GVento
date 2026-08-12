-- ============================================================
-- G-Vento — FASE 1: estado de suscripción escrito por G-Centro
--
-- ARQUITECTURA: G-Centro (panel de suscripciones, repo y BD aparte) ESCRIBE
-- una bandera en organizations; G-Vento solo LEE. Si G-Centro se cae, el POS
-- sigue vendiendo — por eso el default es 'active' y NO hay NOT NULL sin
-- default: la ausencia de información nunca puede degradar a un cliente.
--
-- ESTA MIGRACIÓN NO CAMBIA EL COMPORTAMIENTO DE G-VENTO. Agrega columnas que
-- nadie lee todavía. El gating (banner, bloqueo de módulos) es una fase
-- posterior. Riesgo para los clientes en producción: cero.
--
-- ── POR QUÉ HACE FALTA EL TRIGGER ───────────────────────────────────────────
-- La policy "organizations: editar con permiso" (multi-tenant-rbac.sql:272) es
-- FOR UPDATE para authenticated y valida QUIÉN, no QUÉ COLUMNAS:
--
--   using  (id = get_my_organization_id() and has_permission('sedes.gestionar'))
--   with check (id = get_my_organization_id());
--
-- Es la MISMA falla de categoría que cerramos en profiles (P1): sin acotar
-- columnas, agregar `subscription_status` la vuelve escribible por el cliente.
-- Un PATCH /organizations?id=eq.<la propia> con {"subscription_status":"active"}
-- pasa, y el WITH CHECK ni siquiera revalida el permiso.
--
-- RADIO DE IMPACTO: `sedes.gestionar` lo tiene SOLO el rol owner
-- (multi-tenant-rbac.sql:204; admin NO lo tiene) — más el rol custom al que el
-- owner decida otorgárselo desde la UI de Roles. Eso no lo hace menor: el owner
-- es exactamente quien tiene motivo económico para ponerse en 'active'. Acá el
-- adversario no es un cajero curioso, es el titular de la cuenta.
--
-- ── DIFERENCIA DE DISEÑO CON protect_profile_self_escalation ────────────────
-- Aquel trigger se acota a la fila PROPIA (new.id = auth.uid()) porque un admin
-- editando a un EMPLEADO es legítimo. Acá NO: ningún usuario authenticated debe
-- escribir estas columnas sobre NINGUNA fila, nunca. La guarda es solo
-- current_user = 'authenticated'.
--
-- Verificado antes de escribir esto: la app NO escribe en organizations en
-- ningún lado (`from('organizations')` sobre src/ = cero resultados; las únicas
-- lecturas son por join en AuthContext). Esa policy de UPDATE no la usa ningún
-- flujo, así que el trigger no puede romper nada existente.
--
-- ── DEFENSA EN PROFUNDIDAD: PRIVILEGIOS POR COLUMNA, EN ALLOWLIST ───────────
-- Además del trigger se reconstruye el privilegio de UPDATE como ALLOWLIST de
-- columnas, no como denylist. Es la misma lección del filtro de PII: una
-- denylist deja pasar lo que no previste — y acá lo no previsto es la PRÓXIMA
-- columna que agregue alguien. Con allowlist, una columna nueva nace NO
-- escribible por el cliente y hay que habilitarla a propósito.
--
-- OJO con la mecánica de Postgres: `revoke update (col)` NO tiene efecto si
-- existe el privilegio a NIVEL TABLA (que es lo que concede Supabase por
-- default). Hay que revocar el de tabla y volver a conceder por columna.
--
-- ── unique (name) ───────────────────────────────────────────────────────────
-- onboard-org.sql:94 resuelve la organización POR NOMBRE
-- (`select id ... where name = v_org_name limit 1`) y recién inserta si no
-- encuentra. Los ids existentes son estables —nada actualiza organizations.id—
-- pero `name` NO tenía UNIQUE, así que un renombre o un re-seed con el nombre
-- distinto creaba una organización NUEVA en silencio, y el `limit 1` sin
-- `order by` elegía arbitrariamente si llegaban a existir dos.
--
-- ⚠️ RESIDUO CONOCIDO: el unique es sensible a mayúsculas y espacios, así que
-- 'G-10' y 'g-10 ' siguen siendo dos filas válidas y distintas. NO se usa
-- unique sobre lower(name) para no rechazar nombres legítimos. La conclusión
-- operativa no cambia: **G-Centro debe guardar el UUID, nunca el nombre.**
--
-- Ejecutar en: Supabase Dashboard > SQL Editor. Migración NUEVA.
-- ============================================================


-- ============================================================
-- PRE-FLIGHT BLOQUEANTE — correr ESTO SOLO, primero.
-- Si devuelve UNA SOLA FILA, NO sigas: el `add constraint unique` de abajo
-- falla y aborta toda la transacción. Resolvé los duplicados antes
-- (renombrando o fusionando), y recién ahí corré la migración.
-- ============================================================
select name, count(*) as veces, array_agg(id) as ids
  from public.organizations
 group by name
having count(*) > 1;

-- Referencia para G-Centro: los UUID de cada organización. La cantidad de
-- sedes ayuda a desambiguar si dos nombres se parecen.
-- ⚠️ LAB NO es un cliente que pague: es el laboratorio. No debe entrar a un
-- cobro ni a un conteo de clientes activos (ver CLAUDE.md).
select o.id as organization_id,
       o.name,
       count(r.id) as sedes,
       o.created_at
  from public.organizations o
  left join public.restaurants r on r.organization_id = o.id
 group by o.id, o.name, o.created_at
 order by o.name;


-- ============================================================
-- PRE-FLIGHT 2 — el revoke de UPDATE no puede romper el trigger de updated_at.
--
-- Es el ÚNICO punto de esta migración que puede romper un flujo existente, así
-- que se verifica ejecutando, no leyendo (`tsc` no prueba el SQL).
--
-- Lo que se afirma: `handle_updated_at` es un BEFORE trigger que ASIGNA a NEW
-- (`new.updated_at = now()`), no una sentencia SQL contra la tabla. El
-- privilegio por columna se evalúa una sola vez, al arrancar el executor, sobre
-- las columnas del SET de la sentencia original — una asignación a NEW no entra
-- en ese conjunto. (Si fuera un AFTER trigger haciendo `update ... set
-- updated_at = now()`, SÍ pasaría por los privilegios del invocador, y además
-- recursaría.)
--
-- El bloque es autocontenido: no toca organizations, no depende de RLS ni de
-- claims JWT, y revierte entero.
--
-- ESPERADO: sin "permission denied", con name='despues' y updated_at movido a
-- hoy. Si diera `permission denied for column updated_at`, NO aplicar: hay que
-- sumar updated_at al grant de la sección 4.
-- ============================================================
begin;

create table public._t_priv (
  id int primary key,
  name text,
  updated_at timestamptz not null default now()
);
create trigger _t_priv_upd before update on public._t_priv
  for each row execute function public.handle_updated_at();

insert into public._t_priv (id, name) values (1, 'antes');
update public._t_priv set updated_at = '2000-01-01' where id = 1;  -- fecha vieja a propósito

grant select on public._t_priv to authenticated;
grant update (name) on public._t_priv to authenticated;   -- updated_at NO se concede

set local role authenticated;
-- Si el trigger necesitara el privilegio del llamante, esto falla acá.
update public._t_priv set name = 'despues' where id = 1;
reset role;

select id, name, updated_at from public._t_priv;

rollback;


-- ============================================================
-- MIGRACIÓN
-- ============================================================
begin;

-- ── 1. Columnas ────────────────────────────────────────────────────────────
-- text + CHECK, NO un enum de Postgres. Es la convención vigente del esquema
-- (payment_status, discount_type, discount_kind, products.kind son todos
-- text+check; los 5 enums son del esquema original). Y hay una razón extra
-- acá: es una bandera COMPARTIDA ENTRE DOS REPOS — ampliar un CHECK es un
-- drop/add constraint trivial, ampliar un enum es ALTER TYPE con sus
-- restricciones. Si G-Centro suma un estado, que salga barato.
alter table public.organizations
  add column if not exists subscription_status text not null default 'active'
    check (subscription_status in
      ('active', 'expiring', 'grace', 'restricted', 'suspended'));

-- Mensaje que G-Vento mostrará al usuario (español). El nombre de la columna va
-- en inglés como todo el esquema; el CONTENIDO en español es lo mismo que
-- `notes` o `cancel_reason`.
alter table public.organizations
  add column if not exists subscription_message text;

-- Cuándo CAMBIÓ el estado por última vez (no "cuándo se llamó a la función"):
-- re-aplicar el mismo estado es un no-op y no toca esta columna. Eso la vuelve
-- útil para contar desde cuándo corre un período de gracia.
alter table public.organizations
  add column if not exists subscription_updated_at timestamptz;

comment on column public.organizations.subscription_status is
  'Estado de suscripción. Lo escribe SOLO G-Centro vía Edge Function con service role; '
  'protegido de escritura por cliente con trg_protect_organization_subscription. '
  'Default active: si G-Centro no responde nunca, el cliente NO se degrada.';

-- ── 2. unique (name) ───────────────────────────────────────────────────────
-- Idempotente: si ya existiera la constraint, no falla.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.organizations'::regclass
       and conname  = 'organizations_name_key'
  ) then
    alter table public.organizations
      add constraint organizations_name_key unique (name);
  end if;
end $$;

-- ── 3. Trigger de protección ───────────────────────────────────────────────
create or replace function public.protect_organization_subscription()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Solo usuarios reales: PostgREST hace SET ROLE authenticated. El service_role
  -- de la Edge Function de G-Centro, los seeds y postgres pasan sin restricción.
  --
  -- A diferencia de protect_profile_self_escalation, NO se acota a la fila
  -- propia: no existe ningún caso legítimo en que un usuario de la app escriba
  -- el estado de suscripción de nadie.
  if current_user = 'authenticated' then

    -- IS DISTINCT FROM (no <>) es OBLIGATORIO: las columnas son nullables y
    -- PostgREST manda solo las del .update({...}), completando el resto de NEW
    -- desde OLD. Sin cambio real no hay diferencia => un update de {name} pasa.
    if new.subscription_status is distinct from old.subscription_status
       or new.subscription_message is distinct from old.subscription_message
       or new.subscription_updated_at is distinct from old.subscription_updated_at
    then
      raise exception 'El estado de suscripcion solo lo escribe G-Centro'
        using errcode = 'check_violation';
    end if;

  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_organization_subscription on public.organizations;

create trigger trg_protect_organization_subscription
  before update on public.organizations
  for each row execute function public.protect_organization_subscription();

-- ── 4. Privilegios por columna (allowlist) ─────────────────────────────────
-- Segunda capa, redundante A PROPÓSITO: un chequeo fail-closed extra no cuesta
-- nada, y este ataja incluso el caso en que alguien borre el trigger.
-- Primero se revoca el privilegio de TABLA (sin esto el revoke por columna no
-- hace nada) y después se concede columna por columna.
revoke update on public.organizations from authenticated;
grant  update (name, logo_url, config) on public.organizations to authenticated;

commit;


-- ============================================================
-- VERIFICACIÓN (read-only) — correr después del commit.
-- ============================================================

-- (1) Las 3 columnas existen, con el default correcto.
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name = 'organizations'
   and column_name like 'subscription%'
 order by column_name;

-- (2) Toda organización existente quedó en 'active'.
select subscription_status, count(*) as orgs
  from public.organizations
 group by subscription_status;

-- (3) El trigger quedó instalado.
select tgname, tgenabled, pg_get_triggerdef(oid) as definicion
  from pg_trigger
 where tgrelid = 'public.organizations'::regclass
   and not tgisinternal
 order by tgname;

-- (4) authenticated puede escribir SOLO las 3 columnas permitidas.
--     Debe listar exactamente: config, logo_url, name.
select column_name
  from information_schema.column_privileges
 where table_schema = 'public' and table_name = 'organizations'
   and grantee = 'authenticated' and privilege_type = 'UPDATE'
 order by column_name;

-- (5) El unique quedó.
select conname, pg_get_constraintdef(oid)
  from pg_constraint
 where conrelid = 'public.organizations'::regclass and contype = 'u';


-- ============================================================
-- QUÉ CAPA CONTESTA — MEDIDO CONTRA LA BD, no deducido.
--
-- De las dos defensas, contesta SIEMPRE la de privilegios: Postgres verifica
-- los privilegios de columna al ARRANCAR el executor, antes de escanear filas y
-- por lo tanto antes de cualquier BEFORE ROW trigger. Medido contra LAB con
-- sesión de owner:
--
--   update {subscription_status}        -> 42501 permission denied for table organizations
--   update {subscription_message}       -> 42501 (idem)
--   update {name, subscription_status}  -> 42501 (idem)  [no hay escritura parcial]
--   update {name}                       -> pasa
--
-- El mensaje es a nivel TABLA aunque la falla sea por columna: cuando el chequeo
-- por columna no pasa, Postgres reporta el error de la relación. Por eso el spec
-- assertea el CÓDIGO 42501 y no una subcadena del texto.
--
-- 🔴 EL TRIGGER NO ES CÓDIGO MUERTO. Es la red para el día en que alguien
-- restaure el privilegio a nivel tabla — y el modo de fallo más probable es una
-- línea rutinaria de Supabase del estilo
-- `grant all on all tables in schema public to authenticated`, que borraría la
-- allowlist EN SILENCIO y sin que nadie lo note. Ahí el trigger es lo único que
-- queda. NO se puede ejercitar desde la app ni desde el spec (requiere que
-- authenticated TENGA el privilegio de columna, que es justo lo que revocamos),
-- así que se verifica acá, a mano.
-- ============================================================

-- ── (A) VERIFICACIÓN DEL TRIGGER (segunda capa) ────────────────────────────
-- Simula el re-grant accidental y comprueba que el trigger ataja. Revierte
-- entero. Reemplazar los dos UUID.
--
-- ESPERADO: ERROR 'El estado de suscripcion solo lo escribe G-Centro'.
-- Si en cambio el UPDATE PASA, el trigger no está haciendo su trabajo.
begin;
  grant update on public.organizations to authenticated;   -- el accidente a simular
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"<uuid del usuario owner>","role":"authenticated"}';

  update public.organizations
     set subscription_status = 'suspended'
   where id = '<uuid de la org de ese usuario>';
rollback;

-- ── (B) PRUEBAS DESDE LA APP — consola del navegador, sesión de owner ──────
-- Con postgres, current_user no es 'authenticated': ni el trigger ni los
-- privilegios de authenticated aplican, y daría un falso negativo.
--
--   // (B1) DEBE FALLAR con 42501 — el owner se auto-activa la suscripción
--   await supabase.from('organizations')
--     .update({ subscription_status: 'active' })
--     .eq('id', '<uuid de la propia org>')
--
--   // (B2) DEBE FALLAR con 42501 — el mensaje es lo que ve el usuario: si
--   //      fuera escribible, podría borrar el aviso de mora sin tocar el estado
--   await supabase.from('organizations')
--     .update({ subscription_message: 'todo bien' })
--     .eq('id', '<uuid de la propia org>')
--
--   // (B3) DEBE PASAR — columna permitida. Es el CONTRASTE que prueba que el
--   //      rechazo de (B1) es específico y no un "no podés escribir nada".
--   //      Imprescindible: el mensaje de Postgres es a nivel tabla y NO nombra
--   //      la columna culpable, así que sin este caso no se distingue una
--   //      protección puntual de una RLS rota.
--   await supabase.from('organizations')
--     .update({ name: '<mismo nombre de siempre>' })
--     .eq('id', '<uuid de la propia org>')
-- ============================================================
