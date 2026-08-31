#!/usr/bin/env node
// ============================================================
// Hook PreToolUse — checklist antes de escribir SQL en supabase/
//
// POR QUÉ EXISTE: en 20 días, 9 errores de este proyecto tenían su lección YA
// escrita en el repo (CLAUDE.md, un docblock o un spec). No fallamos en saber:
// fallamos en CONVOCAR lo que sabíamos, en el momento de decidir. Este hook
// trae las 4 preguntas al instante exacto en que se escribe el SQL, que es el
// único momento en que sirven.
//
// QUÉ HACE Y QUÉ NO: solo inyecta contexto (`additionalContext`). NO bloquea.
// PreToolUse PODRÍA denegar la escritura (`permissionDecision: "deny"`), y se
// decidió que no: un guard que salta en cada .sql bloquea trabajo legítimo casi
// siempre, y lo que se aprende es a esquivarlo. Es el mismo argumento que
// CLAUDE.md ya usa contra las alertas de mesas abiertas — un aviso sobre algo
// que se hace a propósito es ruido, y entrena a ignorar avisos.
//
// POR QUÉ node Y NO jq: jq NO está instalado en esta máquina (verificado). El
// patrón canónico de hooks lo usa, así que copiarlo habría dado un hook MUDO.
// node es la dependencia más segura acá: si falta, el proyecto no compila.
//
// POR QUÉ TAMBIÉN `Bash` Y NO SOLO `Write|Edit`: porque el flujo real escribe
// SQL por Bash. El 2026-08-25 se creó un seed con un heredoc (`cat > ... <<EOF`)
// y se editó con `python3 - <<PY`: dos escrituras que un hook limitado a
// Write|Edit no habría visto. Enumerar las herramientas que uno recuerda en vez
// de cubrir la CLASE ("escribir en supabase/*.sql") es exactamente el error del
// guard deny-list que este hook existe para prevenir.
//
// ── LOS CUATRO MODOS DE FALLO, Y CUÁL DA MIEDO ──────────────────────────────
//   1. El script revienta o no existe  → node sale != 0 y la UI lo muestra
//      ("Ran N hooks" aparece cuando un hook falla o tarda). RUIDOSO ✔
//      Es deliberado que NO haya `|| true`: preferimos ruidoso a mudo.
//   2. 🔴 `.claude/settings.json` queda MALFORMADO → SILENCIOSO, y no solo
//      apaga este hook: DESACTIVA TODAS LAS SETTINGS DE ESE ARCHIVO, permisos
//      incluidos. Es el peor de los cuatro y el único silencioso que depende
//      de nosotros — los otros tres dependen del entorno.
//      ⇒ REGLA: después de CUALQUIER edición de settings.json, validar el
//        esquema antes de darlo por puesto. `jq` NO está instalado acá; el
//        equivalente es:
//          node -e 'const s=JSON.parse(require("fs").readFileSync(".claude/settings.json","utf8"));
//                   if(!s?.hooks?.PreToolUse?.some(x=>x.matcher==="Write|Edit|Bash"))
//                     {console.error("FALLO");process.exit(4)}
//                   console.log("OK")'
//   3. El hook no está configurado (borrado, o repo clonado sin él) → SILENCIO.
//      Un hook no puede garantizar su propia existencia. Por eso las mismas 4
//      preguntas viven TAMBIÉN como regla de clase en CLAUDE.md: redundancia a
//      propósito, igual que conservar la denylist al invertir a allowlist.
//   4. El watcher no ve `.claude/` (no había settings al arrancar la sesión)
//      → el hook está bien escrito pero no carga. Se arregla abriendo `/hooks`
//      una vez, o reiniciando.
//
// VERIFICADO EN VIVO (2026-08-26): dispara en Write, Edit y Bash-heredoc sobre
// supabase/*.sql (767 bytes inyectados en los tres) y calla en un Bash sin SQL.
// ============================================================

const CHECKLIST = `⚠️ SQL en supabase/ — respondé estas 4 EN TU RESPUESTA, no mentalmente:

1. CLASE — ¿qué tipo de decisión es? (allowlist/denylist · fail-open/closed ·
   validar/forzar · por-id/por-nombre). Nombrala en una frase.
2. PRECEDENTE — grep de esa clase en CLAUDE.md y en supabase/. En 20 días,
   9 errores de este proyecto tenían su lección YA escrita.
3. MODO DE FALLO — si me equivoco, ¿qué pasa? Si es "borra datos ajenos" o
   "falla callado" ⇒ el diseño tiene que ser fail-closed.
4. OBJETIVO — ¿fijado por UUID, no resuelto por nombre? ¿Allowlist, no denylist?

Si hay DELETE/UPDATE/DROP: además begin/commit, y contar filas ANTES de tocarlas.`

// El objetivo es la CLASE "escribir en supabase/*.sql", venga por donde venga:
//   · Write/Edit  → tool_input.file_path
//   · Bash        → tool_input.command  (heredoc, sed -i, python -c, tee…)
// Se normalizan las barras invertidas porque en Windows el file_path llega como
// c:\...\supabase\x.sql y sin normalizar el patrón no matchea NUNCA — un hook
// mudo, que es justo el modo de fallo que no queremos.
const OBJETIVO = /supabase\/[^\s"'`;|&)]*\.sql/i

// 🔴 `import`, NO `require`. Este archivo es .mjs = módulo ES, donde `require`
//    NO EXISTE. La primera versión lo usaba dentro de un try/catch que devolvía
//    '' al fallar, así que el hook salía con código 0 SIN INYECTAR NADA: mudo,
//    exitoso y completamente invisible. Lo cazó el pipe-test (10 de 10 casos
//    callados, incluidos los 6 que debían disparar) — leyendo el código se veía
//    perfecto. Es el modo de fallo que este hook existe para evitar, dentro del
//    propio hook, y por la misma causa: un catch que convierte un error en
//    silencio.

// ============================================================
// REGLA 2 — catalogo de permisos RBAC (desde 2026-08-31: 1 fuente + 1 generado)
//
// POR QUE NO MATCHEA POR RUTA: enumerar los archivos conocidos
// (permissions.ts + los seeds que hoy existen) seria enumerar INSTANCIAS, que
// es el defecto de clase que este hook existe para prevenir. Un `.sql` nuevo
// con cualquier nombre que haga `update roles set permissions` no matchearia,
// y ese es justamente el caso que ya nos mordio: `ventas.historial` se sembro
// con un update de una pasada y `onboard-org.sql` quedo congelado.
//
// SE MATCHEA POR CONTENIDO, contra los tres anclajes del contrato — que no
// dependen de donde viva el archivo:
//   · PERMISSION_GROUPS / ALL_PERMISSION_KEYS  -> la fuente en TS
//   · has_permission                            -> el enforcement en SQL
//   · `roles` Y `permissions` juntos            -> cualquier SQL sobre la columna
//
// Se exigen las DOS palabras juntas a proposito: .claude/settings.json contiene
// "permissions" pero no "roles", asi que no dispara sobre la config del harness.
//
// ⚠️ AGUJEROS QUE ESTO **NO** CIERRA, dichos explicitamente en vez de fingir
//    cobertura total:
//   1. Cambiar permisos desde la UI de Roles no escribe ningun archivo. Ningun
//      hook lo ve. Lo cubre la RLS y protect_owner_role, no esto.
//   2. Agregar un `can('nuevo.permiso')` en un componente SIN tocar el catalogo
//      no dispara. Matchear `can(` haria ruido en cada componente. Ese caso es
//      otro bug (consumir un permiso inexistente) y lo caza R1 al leerse.
// ============================================================
const PERMISOS_TS  = /PERMISSION_GROUPS|ALL_PERMISSION_KEYS/
const PERMISOS_SQL = /has_permission/
// Las dos palabras se exigen JUNTAS (no una alternancia): `permissions` sola
// aparece en .claude/settings.json y en cualquier texto sobre permisos del
// harness; `roles` sola aparece en prosa. Juntas senalan la tabla real.
const PERMISOS_TABLA = /\broles\b/i
const PERMISOS_COLUM = /\bpermissions\b/i

/** Toca el catalogo de permisos, viva donde viva el archivo? */
function tocaCatalogoDePermisos(texto) {
  return PERMISOS_TS.test(texto)
      || PERMISOS_SQL.test(texto)
      || (PERMISOS_TABLA.test(texto) && PERMISOS_COLUM.test(texto))
}

const CHECKLIST_PERMISOS = `⚠️ Estás tocando el CATÁLOGO DE PERMISOS RBAC — y ESTO SE GENERA.

Desde el 2026-08-31 el catálogo tiene UNA fuente y UN artefacto (antes eran 7 lados
y las 4 copias del seed habían divergido: admin valía 16/20/18/23 según el archivo):

  FUENTE     src/lib/permissions.ts   (PERMISSION_GROUPS + SYSTEM_ROLES)
  GENERADO   supabase/seed-system-roles.sql   ← NO EDITAR A MANO
  REGENERAR  pnpm gen:rbac      · CI: pnpm gen:rbac:check (falla si hay diff)

Los seeds (lab-seed, onboard-org, onboard-org-paso1) ya NO llevan listas: llaman a
seed_system_roles(v_org). Si estás por escribir un array de permisos dentro de un
.sql, casi seguro estás en el archivo equivocado — editá permissions.ts y regenerá.

TRIPWIRE: tests/roles.spec.ts clava el tamaño del catálogo con toBe(23). Si se pone
rojo, mirá QUÉ permiso cambió ANTES de tocar el número.

LO QUE ESTO **NO** ARREGLA, dicho explícitamente:
 · Las organizaciones YA creadas siguen con el catálogo con el que nacieron. La
   reconciliación es una migración APARTE y tiene que ser UNIÓN (agregar lo que
   falta), nunca un "set permissions = <canónica>": eso pisa los ajustes del cliente.
 · multi-tenant-rbac.sql está APLICADA ⇒ es registro histórico, no fuente. Su
   comentario-catálogo tiene 19 claves y está desactualizado a propósito. No editar.
 · 6 permisos del catálogo no gatean nada y fallan ABIERTO (pos.vender, caja.abrir,
   mesas.cobrar, productos.ver, reportes.stock, reportes.consolidado). Ver
   docs/DEUDAS.md → "concedible pero inerte". Que una clave esté en el catálogo NO
   es evidencia de que algo esté protegido.`

import fs from 'node:fs'

let crudo
try {
  crudo = fs.readFileSync(0, 'utf8')
} catch (e) {
  // Ruidoso a propósito: no poder leer el payload significa que el hook no
  // cubrió nada. Devolver '' acá fue exactamente el bug de arriba.
  process.stderr.write(`sql-checklist: no pude leer stdin: ${e.message}\n`)
  process.exit(1)
}

if (!crudo.trim()) process.exit(0)   // sin payload no hay nada que decidir

let payload
try {
  payload = JSON.parse(crudo)
} catch (e) {
  // Contrato roto: ruidoso a propósito. Si el harness cambia la forma del
  // payload, queremos enterarnos, no seguir en silencio sin cubrir nada.
  process.stderr.write(`sql-checklist: no pude parsear el payload del hook: ${e.message}\n`)
  process.exit(1)
}

const entrada = payload?.tool_input ?? {}

// REGLA 1 mira DONDE se escribe (ruta o comando).
const rutas = [entrada.file_path, entrada.command, entrada.notebook_path]
  .filter(v => typeof v === 'string')
  .join('\n')
  .split('\\').join('/')

// REGLA 2 mira QUE se escribe: el contenido, no la ruta. Por eso suma
// `content` (Write) y `new_string` (Edit) — sin ellos, un archivo nuevo con
// nombre cualquiera que siembre permisos pasaria invisible, que es justo la
// enumeracion de instancias que esta regla evita.
const contenido = [
  entrada.file_path, entrada.command,
  entrada.content,      // Write
  entrada.new_string,   // Edit
].filter(v => typeof v === 'string').join('\n')

const avisos = []
if (OBJETIVO.test(rutas)) avisos.push(CHECKLIST)
if (tocaCatalogoDePermisos(contenido)) avisos.push(CHECKLIST_PERMISOS)

if (avisos.length === 0) process.exit(0)

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    additionalContext: avisos.join('\n\n' + '─'.repeat(70) + '\n\n'),
  },
}))
