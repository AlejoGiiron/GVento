#!/usr/bin/env node
// ============================================================
// Generador del seed de roles de sistema.
//
//   src/lib/permissions.ts   →   supabase/seed-system-roles.sql
//
// POR QUÉ EXISTE. El catálogo de permisos vivía en 7 lados sin nada que los
// sincronizara, y las 4 copias del seed habían divergido: `admin` valía
// 16 / 20 / 18 / 23 según el archivo que abrieras. Eso ya causó daño real —
// organizaciones creadas con `onboard-org.sql` nacían sin Historial de ventas.
// Ver R1 en CLAUDE.md.
//
// POR QUÉ GENERA UNA FUNCIÓN Y NO BLOQUES PEGADOS EN CADA SEED. Generar cuatro
// bloques y pegarlos bajaría el drift pero dejaría cuatro copias generadas, y una
// copia generada se edita a mano igual de fácil que una escrita a mano. Generando
// UNA función que los seeds LLAMAN, no queda nada que editar: 7 lados → 2.
//
// CÓMO CORRE TYPESCRIPT SIN tsx NI esbuild. Verificado el 2026-08-31: `esbuild` NO
// es resolvible desde node en este repo (pnpm estricto; es dep transitiva de vite,
// no directa) y `tsx` no está instalado. `tsc` SÍ está, y `permissions.ts` no tiene
// un solo import — así que compilarlo suelto a un temporal funciona y no arrastra
// el árbol de React. Es R4: se verificaron las dependencias ANTES de copiar el
// patrón, en vez de asumir que "el estándar" está disponible acá.
// ============================================================

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const SRC = join(ROOT, 'src/lib/permissions.ts')
const OUT = join(ROOT, 'supabase/seed-system-roles.sql')
// Se invoca el ENTRYPOINT JS de typescript con el propio node, no el shim de
// node_modules/.bin. Medido acá el 2026-08-31, y las dos alternativas fallan:
//   · `.bin/tsc` (shim sh) necesita shell:true en Windows → DEP0190 en node 22+.
//   · `.bin/tsc.CMD` sin shell → node 24 lo rechaza con EINVAL (endurecimiento de
//     spawnSync contra .CMD/.BAT).
// El bin/tsc.js es un .js común: `process.execPath` lo corre igual en Windows,
// Linux y CI, sin shell y sin deprecaciones. Otra vez R4 — el patrón "canónico"
// no era el que funciona en esta máquina.
const TSC = join(ROOT, 'node_modules/typescript/bin/tsc')

const NL = String.fromCharCode(10)
const CRLF = String.fromCharCode(13) + NL
const check = process.argv.includes('--check')
const preflight = process.argv.includes('--preflight')

// ── 1. permissions.ts → JS temporal → import ───────────────────────────────
const tmp = mkdtempSync(join(tmpdir(), 'gvento-rbac-'))
let mod
try {
  execFileSync(process.execPath,
               [TSC, SRC, '--outDir', tmp, '--module', 'esnext',
                '--target', 'es2022', '--moduleResolution', 'bundler'],
               { stdio: 'pipe' })
  mod = await import(pathToFileURL(join(tmp, 'permissions.js')).href)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

const { PERMISSION_GROUPS, ALL_PERMISSION_KEYS, SYSTEM_ROLES } = mod

// ── 2. Chequeos fail-closed ANTES de emitir ────────────────────────────────
// Un generador que emite basura en silencio es peor que no tenerlo: el archivo se
// ve generado y nadie lo mira. Todo lo raro aborta con exit != 0 y SIN escribir.
const errores = []

if (!ALL_PERMISSION_KEYS.length) errores.push('El catálogo quedó vacío.')

const dup = ALL_PERMISSION_KEYS.filter((k, i) => ALL_PERMISSION_KEYS.indexOf(k) !== i)
if (dup.length) errores.push('Claves duplicadas en el catálogo: ' + dup.join(', '))

const malFormadas = ALL_PERMISSION_KEYS.filter((k) => !/^[a-z]+\.[a-z]+$/.test(k))
if (malFormadas.length) errores.push('Claves con formato inválido: ' + malFormadas.join(', '))

// Un rol no puede pedir un permiso que no existe: sería un permiso muerto sembrado
// en la BD de cada cliente. El comodín '*' es la única excepción legítima.
for (const [rol, perms] of Object.entries(SYSTEM_ROLES)) {
  const huerfanos = perms.filter((p) => p !== '*' && !ALL_PERMISSION_KEYS.includes(p))
  if (huerfanos.length) {
    errores.push('Rol "' + rol + '" pide permisos inexistentes: ' + huerfanos.join(', '))
  }
}

if (!SYSTEM_ROLES.owner || !SYSTEM_ROLES.owner.includes('*')) {
  errores.push('El rol owner perdió el comodín "*" — lo espera has_permission() '
              + 'en supabase/profiles-is-active-enforced.sql.')
}

// Solo owner lleva comodín. Si otro rol lo recibe se vuelve superusuario silencioso
// — el peor fail-open posible en RBAC, y no lo detectaría ningún test de UI.
for (const [rol, perms] of Object.entries(SYSTEM_ROLES)) {
  if (rol !== 'owner' && perms.includes('*')) {
    errores.push('El rol "' + rol + '" tiene el comodín "*" y no debería: solo owner.')
  }
}

if (errores.length) {
  console.error('\n✗ gen:rbac abortó sin escribir nada:\n')
  for (const e of errores) console.error('  · ' + e)
  console.error('')
  process.exit(1)
}

// ── 3. Emitir el SQL ───────────────────────────────────────────────────────
function chunk(perms) {
  const out = []
  let line = ''
  for (const p of perms) {
    const t = '"' + p + '",'
    if ((line + t).length > 74) { out.push(line); line = '' }
    line += t
  }
  if (line) out.push(line)
  return out.map((l, i) => (i === out.length - 1 ? l.replace(/,$/, '') : l))
}

function arr(perms) {
  const flat = [...perms].map((p) => '"' + p + '"').join(',')
  if (flat.length <= 66) return "'[" + flat + "]'::jsonb"
  return "'[\n" + chunk([...perms]).map((l) => '      ' + l).join('\n') + "\n    ]'::jsonb"
}

const ROLES = Object.entries(SYSTEM_ROLES)

const valores = ROLES.map(([rol, perms], i) =>
  "    (p_org, '" + rol + "', true, " + arr(perms) + ')' + (i === ROLES.length - 1 ? '' : ','),
).join('\n')

const resumen = ROLES.map(([rol, perms]) =>
  '--   ' + rol.padEnd(7) + ' ' + String(perms.length).padStart(2) + ' ' +
  (perms.includes('*') ? 'comodín "*" — hereda todo, presente y futuro' : 'permisos'),
).join('\n')

const modulos = PERMISSION_GROUPS.map((g) =>
  '--   ' + g.module.padEnd(15) + ' ' + g.perms.map((p) => p.key).join(', '),
).join('\n')

const esperado = ROLES.map(([r, p]) => '--   ' + r.padEnd(7) + ' → ' + p.length).join('\n')

const sql = `-- ============================================================
-- 🤖 ARCHIVO GENERADO — NO EDITAR A MANO.
--
--   Fuente:  src/lib/permissions.ts  (PERMISSION_GROUPS + SYSTEM_ROLES)
--   Generar: pnpm gen:rbac
--   CI:      pnpm gen:rbac:check   (regenera y falla si hay diff)
--
-- Cualquier edición hecha acá se pierde en la próxima corrida, y el check de CI la
-- marca en rojo antes de que llegue a develop. Para cambiar un permiso o la
-- política de un rol: editá permissions.ts y regenerá.
-- ============================================================
--
-- QUÉ HACE: siembra (o actualiza) los ${ROLES.length} roles de sistema de UNA organización.
-- Idempotente por diseño (\`on conflict … do update\`): re-correrla sobre una org que
-- ya existe reafirma la política canónica sin duplicar filas.
--
-- POR QUÉ ES UNA FUNCIÓN Y NO UN BLOQUE COPIADO EN CADA SEED: porque una copia
-- generada se edita a mano igual de fácil que una escrita a mano. Los seeds
-- (lab-seed, onboard-org, onboard-org-paso1) LLAMAN a esta función. Ver R1.
--
-- CATÁLOGO VIVO (${ALL_PERMISSION_KEYS.length} permisos):
${modulos}
--
-- POLÍTICA DE ROLES:
${resumen}
--
-- ⚠️ ESTA FUNCIÓN NO CORRIGE ORGANIZACIONES YA EXISTENTES. Nadie vuelve a correr un
--    onboarding sobre una org que ya está vendiendo. Reconciliar las que nacieron
--    con catálogos viejos es una migración APARTE, y tiene que ser UNIÓN (agregar
--    lo que falta), nunca \`set permissions = <canónica>\`: eso pisaría en silencio
--    los ajustes que el cliente haya hecho a sus roles. Ver R6 y docs/DEUDAS.md.
--
-- NO DEDUZCAS EL ESTADO DE ESTE COMENTARIO — correlo (1 fila = aplicada):
--   select 1 from pg_proc where proname = 'seed_system_roles';
--
-- RE-APLICAR ES SEGURO (idempotente): solo \`create or replace function\`.
--
-- Ejecutar en: Supabase Dashboard > SQL Editor.
-- ============================================================

begin;

create or replace function public.seed_system_roles(p_org uuid)
returns void
language plpgsql
set search_path = public
as $fn$
begin
  if p_org is null then
    raise exception 'seed_system_roles: p_org no puede ser null';
  end if;

  if not exists (select 1 from public.organizations where id = p_org) then
    raise exception 'seed_system_roles: la organización % no existe', p_org;
  end if;

  insert into public.roles (organization_id, name, is_system, permissions)
  values
${valores}
  on conflict (organization_id, name)
    do update set permissions = excluded.permissions, is_system = true;
end $fn$;

-- Postgres concede EXECUTE a PUBLIC por defecto en toda función nueva. Esto solo lo
-- corre un humano desde el SQL Editor durante un onboarding: nadie autenticado
-- necesita poder reescribir los roles de su propia organización.
revoke execute on function public.seed_system_roles(uuid) from public;
revoke execute on function public.seed_system_roles(uuid) from anon;
revoke execute on function public.seed_system_roles(uuid) from authenticated;

commit;

-- ============================================================
-- VERIFICACIÓN (correr aparte tras el commit)
-- ============================================================
-- Esperado: ${ROLES.length} filas por organización, con estos tamaños:
${esperado}
--
-- select o.name as org, r.name as rol,
--        jsonb_array_length(r.permissions) as n,
--        (r.permissions ? '*')             as comodin
--   from public.roles r
--   join public.organizations o on o.id = r.organization_id
--  where r.is_system
--  order by o.name, r.name;
`

// ── 3bis. Pre-flight: QUÉ SE VA A PISAR, antes de pisarlo ──────────────────
// El `on conflict do update` del seed FUERZA la política canónica. Sobre una org
// recién creada eso es correcto (no hay nada que perder), pero sobre una org viva
// puede borrar permisos que alguien ajustó desde la UI de Roles. Esta query
// muestra el diff ANTES de aplicar; se genera desde la MISMA fuente que el seed,
// así que las listas canónicas no pueden divergir de lo que se va a escribir.
if (preflight) {
  const filas = ROLES.map(([rol, perms], i) =>
    "    ('" + rol + "'::text, " + arr(perms) + ')' + (i === ROLES.length - 1 ? '' : ','),
  ).join(NL)

  const nombres = ROLES.map(([r]) => "'" + r + "'").join(', ')

  process.stdout.write(`-- ============================================================
-- PRE-FLIGHT de seed_system_roles() — SOLO LECTURA, no modifica nada.
-- Generado por: pnpm gen:rbac -- --preflight   (catálogo de ${ALL_PERMISSION_KEYS.length} permisos)
--
-- Contesta dos cosas: sobre QUÉ organizaciones actúa el seed, y qué permisos
-- pierde cada una. Correr en el SQL Editor ANTES de aplicar seed-system-roles.sql.
--
-- 🔴 CORREGIDO EL 2026-08-31. La primera versión arrancaba \`from public.roles\` y
--    hacía join a organizations, así que una organización SIN roles era invisible.
--    Mostró 4 organizaciones cuando había 5: LabCentro se crea con
--    labcentro-org.sql, que inserta SOLO la fila de \`organizations\` y ningún rol.
--    Falló ABIERTO — resultado limpio, cobertura incompleta. La causa es de clase:
--    enumeraba LO QUE EXISTE (roles) en vez de LO QUE LA OPERACIÓN TOCA (orgs).
--    Ahora arranca de \`organizations\` y hace LEFT JOIN, así que toda organización
--    aparece aunque no tenga todavía un solo rol.
-- ============================================================

with canonico(rol, permisos) as (
  values
${filas}
)

-- ── 0) CUÁNTAS ORGANIZACIONES TOCA. Mirá este número primero. ──────────────
-- Si no coincide con las que esperás, pará: el resto del pre-flight está
-- describiendo un universo distinto al de la operación.
select count(*) as organizaciones_totales,
       count(*) * ${ROLES.length} as filas_esperadas_en_bloque_1
  from public.organizations;


-- ── 1) EL DIFF, una fila por ORGANIZACIÓN × ROL canónico. ──────────────────
-- accion     = 'SE CREA' si el rol todavía no existe en esa org.
-- se_pierde  = está hoy en la BD y NO en el canónico  → el seed lo BORRA 🔴
-- se_agrega  = está en el canónico y NO en la BD      → el seed lo agrega
-- es_system  = false 🔴 significa que es un rol CUSTOM del cliente con nombre
--              colisionante: el seed lo pisa Y lo promueve a is_system (ver 2).
-- Aplicar es seguro si se_pierde viene '[]' en TODAS las filas.
select o.name                                as org,
       c.rol,
       case when r.id is null then 'SE CREA' else 'se reescribe' end as accion,
       r.is_system                           as es_system,
       jsonb_array_length(r.permissions)     as tiene_hoy,
       jsonb_array_length(c.permisos)        as quedara_con,
       (select coalesce(jsonb_agg(x), '[]'::jsonb)
          from jsonb_array_elements_text(coalesce(r.permissions, '[]'::jsonb)) x
         where not c.permisos ? x)           as se_pierde,
       (select coalesce(jsonb_agg(x), '[]'::jsonb)
          from jsonb_array_elements_text(c.permisos) x
         where not coalesce(r.permissions, '[]'::jsonb) ? x) as se_agrega
  from public.organizations o
  cross join canonico c
  left join public.roles r
         on r.organization_id = o.id
        and r.name = c.rol          -- SIN filtrar is_system: la unique es
                                    -- (organization_id, name) y tampoco lo mira.
 order by o.name, c.rol;


-- ── 2) 🔴 ROLES CUSTOM QUE EL SEED SE VA A TRAGAR SIN QUE PAREZCA ─────────
-- La unique es (organization_id, name) y NO mira is_system. Si un cliente creó
-- desde la UI un rol llamado exactamente ${nombres},
-- el on conflict lo pisa Y ADEMÁS lo marca is_system = true: deja de ser suyo y
-- pasa a ser reescribible por cada seed futuro.
-- Esperado: 0 filas. Si aparece alguna, decidir ANTES de aplicar.
select o.name as org, r.name as rol, r.is_system, r.permissions,
       (select count(*) from public.profiles p where p.role_id = r.id) as usuarios_afectados
  from public.roles r
  join public.organizations o on o.id = r.organization_id
 where r.name in (${nombres})
   and r.is_system is not true
 order by o.name, r.name;


-- ── 3) Roles de sistema que el canónico NO contempla ──────────────────────
-- El seed no los toca (quedan como están). Informativo: si aparece algo acá, el
-- SYSTEM_ROLES de permissions.ts podría estar incompleto.
select o.name as org, r.name as rol, jsonb_array_length(r.permissions) as n
  from public.roles r
  join public.organizations o on o.id = r.organization_id
 where r.is_system
   and r.name not in (${nombres})
 order by o.name, r.name;
`)
  process.exit(0)

}

// ── 4. Escribir, o comparar si es el check de CI ───────────────────────────
let previo = null
try { previo = readFileSync(OUT, 'utf8') } catch { /* no existe todavía */ }

// Comparar NORMALIZANDO los fines de línea. Este repo tiene core.autocrlf=true y
// no tiene .gitattributes, así que git materializa el archivo con CRLF al hacer
// checkout mientras el generador emite LF. Sin esto, gen:rbac:check falla en
// CUALQUIER checkout limpio en Windows —el CI nacería en rojo— y gen:rbac
// reescribiría el archivo entero por un cambio que no existe.
//
// Medido el 2026-08-31 al mergear a develop: el check pasaba en la rama donde el
// archivo se había GENERADO y fallaba tras el checkout, CON EL MISMO ÁRBOL. Es R4:
// comparar byte a byte contra el archivo que uno acaba de escribir es un PROXY del
// archivo que git entrega, no el archivo real. La verificación tiene que correr
// sobre lo que sale del checkout.
const eolNorm = (s) => (s === null ? null : s.split(CRLF).join(NL))
const igual = eolNorm(previo) === eolNorm(sql)

if (check) {
  if (igual) {
    console.log('✓ seed-system-roles.sql está al día con permissions.ts')
    process.exit(0)
  }
  console.error('\n✗ supabase/seed-system-roles.sql NO coincide con src/lib/permissions.ts.')
  console.error('  Alguien editó el generado a mano, o cambió la fuente sin regenerar.')
  console.error('  Corré:  pnpm gen:rbac   y commiteá el resultado.\n')
  process.exit(1)
}

writeFileSync(OUT, sql)
console.log('✓ supabase/seed-system-roles.sql ' + (igual ? '(sin cambios)' : 'regenerado'))
console.log('  ' + ALL_PERMISSION_KEYS.length + ' permisos · ' +
            ROLES.map(([r, p]) => r + '=' + p.length).join(' · '))
