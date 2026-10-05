#!/usr/bin/env node
/**
 * Levanta y siembra el Supabase LOCAL de Docker. Lo usan DOS cosas:
 *
 *   pnpm e2e:preparar          # esto, SIN la vitrina → luego pnpm test:e2e
 *   pnpm capturas:preparar     # esto, CON la vitrina → luego pnpm capturas
 *
 * La suite E2E corre SOLO contra este stack, nunca contra la nube (2026-09-30:
 * la nube cobra por ingesta de logs). Ver playwright.config.ts.
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
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const SUPA = join(ROOT, 'supabase')
const HERE_CAPTURAS = join(ROOT, 'scripts', 'capturas')
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
  'product-extras.sql',
  'order-extras-rpc.sql',               // versión VIEJA de add_order_items_with_extras…
  'order-items-stock-recipes.sql',      // …que ésta REEMPLAZA (descuento por receta). Va DESPUÉS.
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
  'fiado-abono-lote.sql',          // debt_payments.batch_id + RPC de lote — necesita fiado-clientes y cash-movements
  'delivery-couriers.sql',
  'delivery-delivered-at.sql',      // orders.delivered_at + trigger — necesita orders (schema.sql)
  'fix-delivered-at-comentario.sql',// solo corrige el comment de esa columna
  'compras-proveedores.sql',
  'compra-no-toca-caja.sql',
  'reports-views.sql',
  'organization-subscription.sql',
  'storage-product-images.sql',
  'security-definer-revoke.sql',
  'reconciliar-con-prod.sql',           // ÚLTIMA: lleva la base a lo que prod tiene de verdad (deriva 0)
  'restaurant-logos-policies.sql',      // aplicada en prod DESPUÉS de reconciliar: sube/reemplaza/borra en la carpeta propia
  'product-images-policies.sql',        // mismo alcance por carpeta para product-images (reemplaza las '… con permiso')
  'close-cash-shift.sql',               // FASE 1: cierre en el servidor + protocolo de locks (compatible con el frontend viejo)
  'close-cash-shift-revoke.sql',        // FASE 2: sin UPDATE directo sobre cash_shifts (después del deploy del frontend)
  'cobro-turno.sql',                    // cambio (1): turno obligatorio para cobrar y para abonos en efectivo + lock de la orden
  'app-version.sql',                    // cada equipo reporta su versión de la app (aviso de versión nueva)
  'pos-sale-lotes.sql',                 // paso 2: register_pos_sale + clave por tanda y total desde las líneas en add_order_items_with_extras
  'restaurant-config-rpc.sql',          // M1: restaurants.config se fusiona en el servidor, clave por clave (update_restaurant_config)
]

// ── QUIÉN GANA cuando una función está definida en más de un .sql ─────────────
// 🔴 El orden de ORDEN decide qué versión queda: gana la ÚLTIMA en aplicarse.
// Y un orden equivocado NO da error — plpgsql no valida las tablas al crear la
// función —, da un ESTADO FINAL equivocado. Medido el 2026-09-30: ORDEN tenía
// order-extras-rpc.sql (versión vieja de add_order_items_with_extras, sin
// descuento por receta) DESPUÉS de order-items-stock-recipes.sql, así que la
// base local vendía sin bajar stock. 12 specs rojos, y el script decía "orden
// verificado por ejecución": verificaba que no hubiera errores, no el resultado.
//
// Qué versión es la correcta no se puede deducir: lo decide una persona. Así
// que se DECLARA acá (allowlist) y el script lo hace cumplir antes de aplicar:
//   · todo objeto definido en >1 archivo de ORDEN tiene que figurar acá;
//   · el archivo declarado tiene que ser el ÚLTIMO de ORDEN que lo define.
// Un objeto redefinido que nadie declaró ABORTA, en vez de quedar con la
// versión que el azar del orden haya elegido.
//
// Cubre la CLASE, no solo la instancia que falló (R3): funciones, vistas,
// triggers y policies — todo lo que un .sql posterior puede reemplazar en
// silencio. Es una ALARMA TEMPRANA estática (corre en cada preparación, sin BD);
// la verificación real de que la base local es igual a producción es la deriva
// (supabase/diag/deriva-esquema.sql + scripts/deriva-comparar.mjs).
const GANA = {
  // pos-sale-lotes.sql la redefine con (p_order_id, p_items, p_lote) y BORRA la de 2 argumentos:
  'function add_order_items_with_extras': 'pos-sale-lotes.sql',
  'function register_purchase':           'compra-no-toca-caja.sql',
  'function enforce_profile_organization':'fix-enforce-profile-organization-definer.sql',
  'function get_my_organization_id':      'profiles-is-active-enforced.sql',
  'function get_my_restaurant_id':        'profiles-is-active-enforced.sql',
  'function get_my_role':                 'profiles-is-active-enforced.sql',
  'function has_permission':              'profiles-is-active-enforced.sql',
  'function handle_new_user':             'profiles-organization-invariant.sql',
  'policy "profiles: editar el propio" on profiles': 'profiles-active-store-rls.sql',
  // close-cash-shift.sql les agrega el protocolo de locks del turno (FOR SHARE):
  // cobro-turno.sql (cambio 1) les suma turno obligatorio en efectivo + lock de la orden:
  'function register_debt_payment':        'cobro-turno.sql',
  'function register_debt_payments_batch': 'cobro-turno.sql',
  'function register_sale_payment':        'cobro-turno.sql',
  'function register_sale_void':           'close-cash-shift.sql',
}

const DEFINICIONES = [
  ['function', /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?(\w+)"?\s*\(/gi, (m) => m[1]],
  ['view',     /create\s+(?:or\s+replace\s+)?view\s+(?:public\.)?"?(\w+)"?/gi,          (m) => m[1]],
  ['trigger',  /create\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+"?(\w+)"?[\s\S]*?\son\s+(?:public\.)?"?(\w+)"?/gi, (m) => `${m[1]} on ${m[2]}`],
  ['policy',   /create\s+policy\s+"([^"]+)"\s+on\s+(?:public\.)?"?(\w+)"?/gi,             (m) => `"${m[1]}" on ${m[2]}`],
]

function verificarQuienGana() {
  const defs = {}
  for (const f of ORDEN) {
    const sql = readFileSync(join(SUPA, f), 'utf-8').replace(/--.*$/gm, '')
    for (const [tipo, re, nombre] of DEFINICIONES) {
      for (const m of sql.matchAll(re)) {
        const clave = `${tipo} ${nombre(m).toLowerCase()}`
        ;(defs[clave] ??= []).push(f)
      }
    }
  }
  const declaradas = Object.fromEntries(Object.entries(GANA).map(([k, v]) => [k.toLowerCase(), v]))
  const errores = []
  for (const [obj, archivos] of Object.entries(defs)) {
    const unicos = [...new Set(archivos)]
    if (unicos.length < 2) continue
    const ultimo = unicos.sort((a, b) => ORDEN.indexOf(a) - ORDEN.indexOf(b)).at(-1)
    if (!declaradas[obj]) {
      errores.push(`${obj}: definido en ${unicos.join(', ')} y NO está declarado en GANA. Decidí qué versión es la correcta.`)
    } else if (declaradas[obj] !== ultimo) {
      errores.push(`${obj}: GANA dice ${declaradas[obj]}, pero con este ORDEN queda ${ultimo}. Mové ${declaradas[obj]} después.`)
    }
  }
  // Una entrada de GANA que ya no corresponde a nada redefinido es ruido que
  // envejece hacia la mentira: también aborta.
  for (const k of Object.keys(declaradas)) {
    if (!defs[k] || new Set(defs[k]).size < 2) errores.push(`GANA declara "${k}", pero ya no está definido en más de un archivo de ORDEN. Sacalo.`)
  }
  if (errores.length) {
    console.error('🔴 Orden de migraciones inconsistente:\n  ' + errores.join('\n  '))
    process.exit(1)
  }
}

const RESET = `
-- PRIMERO, antes de borrar nada de public: si este paso falla, la base queda
-- intacta. Los OBJETOS de Storage de la app no viven en public, sobreviven al
-- drop y quedaban con carpetas huérfanas (<sede vieja>/logo.png) de
-- preparaciones anteriores — residuo entre corridas (visto el 2026-09-30:
-- supabase/diag/logos-plantados.sql los marcaba a todos). Storage prohíbe el
-- DELETE directo (trigger storage.protect_delete) salvo con
-- storage.allow_delete_query; se habilita SOLO en esta transacción (set local)
-- y SOLO para los dos buckets de la app, por id. Base local descartable.
begin;
set local storage.allow_delete_query = 'true';
delete from storage.objects where bucket_id in ('product-images', 'restaurant-logos');
commit;

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
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', ''),
  -- mozo.test: lab-seed NO hardcodea su UID, lo descubre por email (bloque f).
  -- El UUID de acá es arbitrario pero fijo, para que re-preparar sea idempotente.
  ('00000000-0000-0000-0000-000000000000',
   '5a7e0c1d-2b3f-4c5d-8e9f-0a1b2c3d4e5f', 'authenticated', 'authenticated',
   'mozo.test@gvento.com', crypt('${PASS}', gen_salt('bf')),
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', ''),
  -- otra.test: admin de OTRA organización (LAB-OTRA, scripts/capturas/otra-org-local.sql).
  ('00000000-0000-0000-0000-000000000000',
   '0e7a0e7a-0e7a-4e7a-8e7a-0e7a0e7a0e7a', 'authenticated', 'authenticated',
   'otra.test@gvento.com', crypt('${PASS}', gen_salt('bf')),
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
   'email', now(), now(), now()),
  ('5a7e0c1d-2b3f-4c5d-8e9f-0a1b2c3d4e5f', '5a7e0c1d-2b3f-4c5d-8e9f-0a1b2c3d4e5f',
   '{"sub":"5a7e0c1d-2b3f-4c5d-8e9f-0a1b2c3d4e5f","email":"mozo.test@gvento.com","email_verified":true,"phone_verified":false}',
   'email', now(), now(), now()),
  ('0e7a0e7a-0e7a-4e7a-8e7a-0e7a0e7a0e7a', '0e7a0e7a-0e7a-4e7a-8e7a-0e7a0e7a0e7a',
   '{"sub":"0e7a0e7a-0e7a-4e7a-8e7a-0e7a0e7a0e7a","email":"otra.test@gvento.com","email_verified":true,"phone_verified":false}',
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

// Secreto HMAC de aplicar-estado, SOLO LOCAL. Vive en supabase/functions/.env
// (gitignored), que el edge runtime lee AL CREARSE el contenedor. Es aleatorio
// por máquina: no es el secreto de G-Centro de la nube. playwright.config.ts lo
// lee del MISMO archivo para firmar (una sola fuente, R1). Antes esos casos de
// suscripcion-estado.spec.ts hacían skip: el contrato con G-Centro sin custodia.
const FN_ENV = join(SUPA, 'functions', '.env')
let secretoNuevo = false
if (!existsSync(FN_ENV) || !/^GCENTRO_HMAC_SECRET=\S+/m.test(readFileSync(FN_ENV, 'utf-8'))) {
  writeFileSync(FN_ENV,
    '# SOLO LOCAL (gitignored). Lo crea/lee scripts/capturas/preparar-local.mjs.\n' +
    '# NO es el secreto de G-Centro de la nube: es aleatorio por máquina.\n' +
    `GCENTRO_HMAC_SECRET=local-${randomBytes(24).toString('hex')}\n`)
  secretoNuevo = true
  console.log('  secreto HMAC local creado en supabase/functions/.env')
}
try {
  execFileSync('docker', ['inspect', DB], { stdio: 'ignore' })
  console.log(`  ya está arriba (${DB})`)
} catch {
  console.log('  levantando… (la primera vez baja imágenes, puede tardar)')
  execFileSync('supabase', ['start'], { cwd: ROOT, stdio: 'inherit' })
}

// ── 0b. Edge Functions ──────────────────────────────────────────────────────
// Sin edge runtime, Kong responde 503 "name resolution failed" a
// /functions/v1/* — create-user.spec fallaba por eso, no por la función.
// Visto el 2026-09-30: con un contenedor de edge runtime VIEJO (creado semanas
// antes), `supabase start` lo reportaba en "Stopped services" y no lo
// levantaba; borrado ese contenedor, stop+start lo creó bien. Y el contenedor
// lee supabase/functions/.env solo al CREARSE: si el secreto es nuevo, hay que
// recrearlo. Se VERIFICA que sirva y tenga el secreto; si no, se aborta.
paso('Edge Functions')
const EDGE = 'supabase_edge_runtime_gvento'
const secretoEnContenedor = () => {
  try { return execFileSync('docker', ['exec', EDGE, 'printenv', 'GCENTRO_HMAC_SECRET'], { encoding: 'utf-8' }).trim() }
  catch { return '' }
}
const secretoArchivo = readFileSync(FN_ENV, 'utf-8').match(/^GCENTRO_HMAC_SECRET=(\S+)/m)[1]
if (secretoNuevo || secretoEnContenedor() !== secretoArchivo) {
  console.log('  recreando el stack para que el edge runtime lea el secreto…')
  try { execFileSync('docker', ['rm', '-f', EDGE], { stdio: 'ignore' }) } catch { /* no existía */ }
  execFileSync('supabase', ['stop'], { cwd: ROOT, stdio: 'inherit' })
  execFileSync('supabase', ['start'], { cwd: ROOT, stdio: 'inherit' })
}
if (secretoEnContenedor() !== secretoArchivo) {
  console.error(`  🔴 ${EDGE} no tiene el GCENTRO_HMAC_SECRET de supabase/functions/.env.`)
  process.exit(1)
}
let edgeOk = false
for (let i = 0; i < 20 && !edgeOk; i++) {
  try {
    const r = await fetch('http://127.0.0.1:54331/functions/v1/create-user', { method: 'OPTIONS' })
    edgeOk = r.status === 200
  } catch { /* todavía arrancando */ }
  if (!edgeOk) await new Promise((ok) => setTimeout(ok, 1000))
}
if (!edgeOk) {
  console.error(`  🔴 ${EDGE} no sirve /functions/v1/create-user. Revisá \`docker logs ${EDGE}\`.`)
  process.exit(1)
}
console.log('  ✅ sirviendo aplicar-estado y create-user')

// ── 1. Esquema desde cero ───────────────────────────────────────────────────
paso(`Esquema (${ORDEN.length} archivos, base en blanco)`)
verificarQuienGana()   // antes de tocar la base: si el orden está mal, no se aplica nada
psql(RESET)
// Privilegios por defecto de supabase_admin en public: prod los tiene (los crea
// la plataforma al hacer el proyecto) y el RESET, al recrear el esquema, los
// pierde. Solo supabase_admin puede fijarlos para sí mismo. Sin esto, la deriva
// (categoría default_acl) no da 0. Valores = los de prod (deriva-detalle.sql).
psql(`
alter default privileges for role supabase_admin in schema public grant all on tables    to postgres, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public grant all on sequences to postgres, anon, authenticated, service_role;
`, { user: 'supabase_admin' })
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
console.log('  ✅ owner.test / cajero.test / mozo.test (con los UUID que espera lab-seed)')

// ── 3. Semillas ─────────────────────────────────────────────────────────────
// --sin-vitrina: para la suite E2E (`pnpm e2e:preparar`). landing-seed arma el
// escenario de las capturas (ventas, turnos, fiados de vitrina) dentro de LAB;
// los specs miden deltas y no lo necesitan, y cada dato extra es estado que un
// spec puede heredar sin haberlo pedido.
const SIN_VITRINA = process.argv.includes('--sin-vitrina')
const SEMILLAS = SIN_VITRINA ? ['lab-seed.sql'] : ['lab-seed.sql', 'landing-seed.sql']
for (const seed of SEMILLAS) {
  paso(seed)
  const out = psql(readFileSync(join(SUPA, seed), 'utf-8'))
  for (const l of out.split('\n')) {
    if (/NOTICE|✅|🔴/.test(l)) console.log(`  ${l.replace(/^NOTICE:\s*/, '')}`)
  }
}

// Segunda organización, SOLO local: sin ella no se puede probar el aislamiento
// entre clientes (ver el encabezado del archivo). Va después de lab-seed.
paso('otra-org-local.sql (LAB-OTRA)')
for (const l of psql(readFileSync(join(HERE_CAPTURAS, 'otra-org-local.sql'), 'utf-8')).split('\n')) {
  if (/NOTICE/.test(l)) console.log(`  ${l.replace(/^NOTICE:\s*/, '')}`)
}

console.log(SIN_VITRINA ? `
✅ Listo. El laboratorio local está sembrado (sin vitrina).

   Siguiente:  pnpm test:e2e
   Studio:     http://127.0.0.1:54333
` : `
✅ Listo. El laboratorio local está sembrado y el escenario de vitrina cuadra.

   Siguiente:  pnpm capturas
   Studio:     http://127.0.0.1:54333
`)
