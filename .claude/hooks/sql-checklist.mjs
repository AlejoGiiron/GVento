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
const candidatos = [
  entrada.file_path,   // Write, Edit
  entrada.command,     // Bash
  entrada.notebook_path,
]
  .filter(v => typeof v === 'string')
  .join('\n')
  .replace(/\\/g, '/')

if (!OBJETIVO.test(candidatos)) process.exit(0)

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    additionalContext: CHECKLIST,
  },
}))
