#!/usr/bin/env node
/**
 * Levanta y siembra el Supabase LOCAL de Docker para las capturas de la landing.
 *
 *   pnpm capturas:preparar     # esto
 *   pnpm capturas              # genera las 5 PNG
 *
 * ── POR QUÉ EXISTE ──────────────────────────────────────────────────────────
 * Las capturas no tienen por qué tocar la base compartida donde viven G-10,
 * Salchimelo y Café Aroma — ni siquiera para leer. Acá se reconstruye el
 * producto entero (esquema + laboratorio + escenario) en un contenedor
 * descartable, así que el riesgo de tocar datos de un cliente no es "bajo": es
 * inexistente, porque no hay ninguna credencial de la nube en juego.
 *
 * ── ESTE ARCHIVO ES, DE HECHO, EL LEDGER DE MIGRACIONES QUE NO HAY ──────────
 * El repo aplica las migraciones a mano desde el SQL Editor del Dashboard, así
 * que nada en el sistema sabe qué corrió ni en qué orden (ver CLAUDE.md → "El
 * estado de aplicación de una migración NO se declara"). El array ORDEN de
 * abajo es el primer orden del repo que está VERIFICADO por ejecución: se
 * aplica entero sobre una base vacía y tiene que terminar sin un solo error.
 * Si alguien agrega una migración y no la mete acá, esto sigue pasando pero la
 * base local queda vieja — el seed de vitrina falla después, ruidoso.
 *
 * ── DOS PARCHES DE APLICACIÓN (no se edita el repo: R5) ─────────────────────
 *  1. cash-movements.sql usa `create type if not exists`, que NINGUNA versión
 *     de Postgres acepta. Se reescribe al vuelo a un DO con
 *     `exception when duplicate_object`.
 *  2. organization-subscription.sql termina con una sección de verificación
 *     manual, sin comentar, con placeholders literales ('<uuid de la org…>').
 *     La migración real termina antes; se corta ahí.
 * Los dos archivos quedan intactos en el repo. Ver el README de capturas.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const SUPA = join(ROOT, 'supabase')
const DB = 'supabase_db_gvento'   // project_id "gvento" en supabase/config.toml

// Orden verificado por ejecución sobre una base vacía. Las dependencias que
// costaron un intento están anotadas.
const ORDEN = [
  'schema.sql',
  'multi-tenant-rbac.sql',
  'seed-system-roles.sql',
  'config-profile-active.sql',          // agrega profiles.is_active — va ANTES de quien lo lee
  'restaurants-sedes-rls.sql',
  'profiles-active-store-rls.sql',
  'profiles-is-active-enforced.sql',    // lee profiles.is_active
  'profiles-organization-invariant.sql',
  'fix-enforce-profile-organization-definer.sql',
  'fix-profiles-store-switch-rls.sql',
  'protect-owner-role.sql',
  'protect-profile-self-escalation.sql',
  'cash-movements.sql',
  'shift-reconciliation.sql',
  'shift-closed-at-server-time.sql',
  'caja-cierre-cuadre.sql',
  'inventory-recipes.sql',
  'inventory-min-stock.sql',
  'products-allow-negative-stock.sql',
  'order-items-stock-recipes.sql',
  'product-extras.sql',
  'order-extras-rpc.sql',
  'sent-to-kitchen.sql',
  'cocina-por-sede.sql',
  'tables-waiting-bill.sql',
  'orders-waiter-name.sql',
  'order-numbering.sql',
  'orders-discount-vale.sql',
  'register-sale-payment.sql',
  'sale-void.sql',
  'register-sale-void.sql',
  'fiado-clientes.sql',
  'delivery-couriers.sql',
  'compras-proveedores.sql',
  'compra-no-toca-caja.sql',
  'reports-views.sql',
  'organization-subscription.sql',
  'storage-product-images.sql',
  'security-definer-revoke.sql',
]

const RESET = `
drop schema if exists public cascade;
create schema public;
grant usage on schema public to postgres, anon, authenticated, service_role;
grant all on schema public to postgres, service_role;
alter default privileges in schema public grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;

-- storage-product-images.sql crea políticas sobre storage.objects, que NO vive
-- en public y por lo tanto sobrevive al drop de arriba. Sin esto, la segunda
-- corrida muere con 'policy … already exists'.
-- Acotado por partida doble: solo storage.objects, y solo los nombres del
-- prefijo que usa esa migración. No se enumera "lo que no hay que borrar".
do $reset$
declare p record;
begin
  for p in
    select policyname from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname like 'product-images%'
  loop
    execute format('drop policy %I on storage.objects', p.policyname);
  end loop;
end $reset$;
`

// Los UUID son los que supabase/lab-seed.sql tiene hardcodeados: si no
// coinciden, el seed no encuentra a quién darle profile. La Admin API de GoTrue
// no deja elegir el id, por eso se insertan directo. Base descartable.
//
// El trigger on_auth_user_created exige restaurant_id en user_metadata, y la
// sede todavía no existe (la crea lab-seed) → se desactiva alrededor del
// insert. Es fiel al estado real: en producción estas cuentas también
// existieron un rato "huérfanas", sin profile.
// ⚠️ CONTRATO COMPARTIDO (R1): este default es la MISMA contraseña que
// scripts/capturas/local.config pone en E2E_OWNER_PASSWORD / E2E_CASHIER_PASSWORD.
// Si cambia una, cambia la otra en la misma pasada: si no, la base se siembra
// con una y el login del globalSetup intenta con la otra.
const PASS = process.env.CAPTURAS_LOCAL_PASSWORD ?? 'lab-local-2026'
const AUTH = `
alter table auth.users disable trigger on_auth_user_created;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values
  ('00000000-0000-0000-0000-000000000000',
   '170af71e-a1fa-42e4-8565-5a9fa396bbb8', 'authenticated', 'authenticated',
   'owner.test@gvento.com', crypt('${PASS}', gen_salt('bf')),
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000',
   '0fc72dc6-5c73-49e4-9054-ac971c07a95c', 'authenticated', 'authenticated',
   'cajero.test@gvento.com', crypt('${PASS}', gen_salt('bf')),
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', '')
on conflict (id) do update
  set encrypted_password = excluded.encrypted_password,
      email_confirmed_at = excluded.email_confirmed_at;

-- identities.email es una columna GENERADA (sale de identity_data->>'email'):
-- no se puede insertar a mano.
insert into auth.identities (
  provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
) values
  ('170af71e-a1fa-42e4-8565-5a9fa396bbb8', '170af71e-a1fa-42e4-8565-5a9fa396bbb8',
   '{"sub":"170af71e-a1fa-42e4-8565-5a9fa396bbb8","email":"owner.test@gvento.com","email_verified":true,"phone_verified":false}',
   'email', now(), now(), now()),
  ('0fc72dc6-5c73-49e4-9054-ac971c07a95c', '0fc72dc6-5c73-49e4-9054-ac971c07a95c',
   '{"sub":"0fc72dc6-5c73-49e4-9054-ac971c07a95c","email":"cajero.test@gvento.com","email_verified":true,"phone_verified":false}',
   'email', now(), now(), now())
on conflict (provider, provider_id) do nothing;

alter table auth.users enable trigger on_auth_user_created;
`

/**
 * Corre SQL en la base local y devuelve stdout + stderr JUNTOS.
 * Lo segundo importa: psql manda los `raise notice` a stderr, y ahí es donde
 * viaja la verificación fail-closed de landing-seed.sql ("✅ Los 5 escenarios
 * cuadran"). Leer solo stdout sería tragarse justo la parte que prueba que el
 * escenario quedó bien.
 */
function psql(sql, { user = 'postgres' } = {}) {
  const r = spawnSync(
    'docker',
    ['exec', '-i', DB, 'psql', '-U', user, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'],
    { input: sql, encoding: 'utf-8' },
  )
  const salida = `${r.stdout ?? ''}${r.stderr ?? ''}`
  if (r.status !== 0) {
    const e = new Error(`psql salió con ${r.status}`)
    e.stderr = salida
    throw e
  }
  return salida
}

/** Aplica un .sql del repo, con los dos parches de aplicación. */
function aplicar(nombre) {
  let sql = readFileSync(join(SUPA, nombre), 'utf-8')

  sql = sql.replace(
    /^create type if not exists (.+) as enum (.+);$/gm,
    'do $ct$ begin create type $1 as enum $2; exception when duplicate_object then null; end $ct$;',
  )

  if (nombre === 'organization-subscription.sql') {
    const corte = sql.indexOf('(A) VERIFICACIÓN DEL TRIGGER')
    if (corte === -1) {
      throw new Error(
        'organization-subscription.sql cambió: ya no está el marcador de la ' +
        'sección de verificación manual. Revisá hasta dónde llega la migración real.',
      )
    }
    sql = sql.slice(0, sql.lastIndexOf('\n', corte))
  }

  psql(sql)
}

function paso(txt) { process.stdout.write(`\n▸ ${txt}\n`) }

// ── 0. El stack local ───────────────────────────────────────────────────────
paso('Supabase local')
if (!existsSync(join(SUPA, 'config.toml'))) {
  throw new Error('Falta supabase/config.toml. Corré `supabase init` primero.')
}
try {
  execFileSync('docker', ['inspect', DB], { stdio: 'ignore' })
  console.log(`  ya está arriba (${DB})`)
} catch {
  console.log('  levantando… (la primera vez baja imágenes, puede tardar)')
  execFileSync('supabase', ['start'], { cwd: ROOT, stdio: 'inherit' })
}

// ── 1. Esquema desde cero ───────────────────────────────────────────────────
paso(`Esquema (${ORDEN.length} archivos, base en blanco)`)
psql(RESET)
for (const f of ORDEN) {
  try {
    aplicar(f)
    console.log(`  ✅ ${f}`)
  } catch (e) {
    console.error(`  🔴 ${f}`)
    console.error(String(e.stderr ?? e.message).split('\n').slice(0, 4).join('\n'))
    process.exit(1)
  }
}

// ── 2. Cuentas de Auth ──────────────────────────────────────────────────────
// supabase_admin y no postgres: desactivar un trigger de auth.users exige ser
// dueño de la tabla, y postgres no lo es.
paso('Cuentas de Auth del laboratorio')
psql(AUTH, { user: 'supabase_admin' })
console.log('  ✅ owner.test / cajero.test (con los UUID que espera lab-seed)')

// ── 3. Semillas ─────────────────────────────────────────────────────────────
for (const seed of ['lab-seed.sql', 'landing-seed.sql']) {
  paso(seed)
  const out = psql(readFileSync(join(SUPA, seed), 'utf-8'))
  for (const l of out.split('\n')) {
    if (/NOTICE|✅|🔴/.test(l)) console.log(`  ${l.replace(/^NOTICE:\s*/, '')}`)
  }
}

console.log(`
✅ Listo. El laboratorio local está sembrado y el escenario de vitrina cuadra.

   Siguiente:  pnpm capturas
   Studio:     http://127.0.0.1:54333
`)
