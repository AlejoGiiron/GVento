#!/usr/bin/env node
/**
 * Compara el esquema de PRODUCCIÓN contra el de la base LOCAL de Docker, a
 * partir de supabase/diag/deriva-esquema.sql corrida en las dos.
 *
 *   node scripts/deriva-comparar.mjs deriva-prod.csv              # local vía docker
 *   node scripts/deriva-comparar.mjs deriva-prod.csv deriva-local.csv
 *
 * Reporta SOLO las diferencias, agrupadas por tipo. Toda diferencia es una de
 * dos deudas: el .sql del repo no es lo que se aplicó en prod, o prod tiene algo
 * aplicado a mano que el repo no tiene.
 *
 * Salida (exit): 0 = sin deriva · 1 = hay deriva · 2 = la comparación NO es
 * válida (precondición rota) — y en ese caso NO se imprime ningún diff, porque
 * un diff sobre datos inválidos es peor que ninguno.
 *
 * Precondiciones, fail-closed:
 *   1. Cada CSV trae exactamente las filas que declara su 'meta total_filas'
 *      (el SQL Editor puede truncar al exportar: un CSV incompleto daría MENOS
 *      diferencias de las reales).
 *   2. Misma versión MAYOR de Postgres (pg_get_*def formatea distinto entre
 *      mayores: el diff se llenaría de falsos positivos).
 *   3. Se imprime el conteo por tipo de las DOS bases: un tipo que falte en un
 *      lado tiene que verse, no esconderse detrás de "0 diferencias".
 */
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const DB = 'supabase_db_gvento'

/** Parser CSV mínimo con comillas (nombres de funciones y grants llevan comas). */
function parseCsv(texto) {
  const filas = []
  let fila = [], campo = '', comillas = false
  const t = texto.replace(/\r\n/g, '\n')
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (comillas) {
      if (c === '"' && t[i + 1] === '"') { campo += '"'; i++ }
      else if (c === '"') comillas = false
      else campo += c
    } else if (c === '"') comillas = true
    else if (c === ',') { fila.push(campo); campo = '' }
    else if (c === '\n') { fila.push(campo); filas.push(fila); fila = []; campo = '' }
    else campo += c
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila) }
  return filas
}

function cargar(etiqueta, texto) {
  const filas = parseCsv(texto).filter((f) => f.length > 1 || f[0] !== '')
  const [cab, ...datos] = filas
  const idx = ['tipo', 'nombre', 'hash'].map((k) => cab.map((x) => x.trim().toLowerCase()).indexOf(k))
  if (idx.some((i) => i < 0)) {
    console.error(`🔴 ${etiqueta}: el CSV no tiene las columnas tipo,nombre,hash (tiene: ${cab.join(',')})`)
    process.exit(2)
  }
  const mapa = new Map()
  for (const f of datos) {
    const [tipo, nombre, hash] = idx.map((i) => f[i] ?? '')
    const clave = `${tipo}\u0000${nombre}`
    if (mapa.has(clave)) {
      console.error(`🔴 ${etiqueta}: fila duplicada ${tipo} ${nombre}. La query debería dar claves únicas.`)
      process.exit(2)
    }
    mapa.set(clave, { tipo, nombre, hash })
  }
  const total = Number(mapa.get('meta\u0000total_filas')?.hash)
  if (!Number.isInteger(total) || total !== datos.length) {
    console.error(`🔴 ${etiqueta}: el CSV trae ${datos.length} filas y la query declaró ${mapa.get('meta\u0000total_filas')?.hash ?? '(sin meta total_filas)'}.`)
    console.error('   ¿Se truncó al exportar? No se compara con datos incompletos.')
    process.exit(2)
  }
  return mapa
}

function localViaDocker() {
  const r = spawnSync('docker',
    ['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '--csv'],
    { input: readFileSync('supabase/diag/deriva-esquema.sql', 'utf-8'), encoding: 'utf-8' })
  if (r.status !== 0) {
    console.error(`🔴 No se pudo correr la query en ${DB}:\n${r.stderr}`)
    process.exit(2)
  }
  return r.stdout
}

const [archivoProd, archivoLocal] = process.argv.slice(2)
if (!archivoProd) {
  console.error('Uso: node scripts/deriva-comparar.mjs <deriva-prod.csv> [deriva-local.csv]')
  process.exit(2)
}
const prod = cargar('PROD', readFileSync(archivoProd, 'utf-8'))
const local = cargar('LOCAL', archivoLocal ? readFileSync(archivoLocal, 'utf-8') : localViaDocker())

// ── 2. versión mayor ────────────────────────────────────────────────────────
const mayor = (m) => Math.floor(Number(m.get('meta\u0000server_version_num')?.hash) / 10000)
const [mp, ml] = [mayor(prod), mayor(local)]
console.log(`Postgres: prod ${prod.get('meta\u0000server_version_num')?.hash} (mayor ${mp}) · local ${local.get('meta\u0000server_version_num')?.hash} (mayor ${ml})`)
if (!mp || mp !== ml) {
  console.error('🔴 Versión MAYOR distinta (o ausente). pg_get_*def formatea distinto: el diff no sería confiable.')
  console.error('   Alineá major_version en supabase/config.toml con prod y re-prepará la base local.')
  process.exit(2)
}

// ── 3. conteo por tipo, las dos bases ───────────────────────────────────────
const conteo = (m) => { const c = {}; for (const { tipo } of m.values()) if (tipo !== 'meta') c[tipo] = (c[tipo] ?? 0) + 1; return c }
const [cp, cl] = [conteo(prod), conteo(local)]
const tipos = [...new Set([...Object.keys(cp), ...Object.keys(cl)])].sort()
console.log('\nObjetos por tipo (prod / local):')
for (const t of tipos) console.log(`  ${t.padEnd(16)} ${String(cp[t] ?? 0).padStart(5)} / ${String(cl[t] ?? 0).padEnd(5)}${(cp[t] ?? 0) !== (cl[t] ?? 0) ? '  ←' : ''}`)

// ── marcadores: la pregunta más urgente, respondida explícita ───────────────
console.log('\nMarcadores:')
for (const [k, v] of prod) if (v.tipo === 'marcador') {
  console.log(`  ${v.nombre}: prod=${v.hash} · local=${local.get(k)?.hash ?? '(ausente)'}`)
}

// ── diferencias ─────────────────────────────────────────────────────────────
const dif = {}
const anotar = (tipo, linea) => (dif[tipo] ??= []).push(linea)
for (const [k, p] of prod) {
  if (p.tipo === 'meta') continue
  const l = local.get(k)
  if (!l) anotar(p.tipo, `  SOLO EN PROD   ${p.nombre}   [${p.hash}]`)
  else if (l.hash !== p.hash) anotar(p.tipo, `  DISTINTO       ${p.nombre}   prod=[${p.hash}] local=[${l.hash}]`)
}
for (const [k, l] of local) {
  if (l.tipo === 'meta') continue
  if (!prod.has(k)) anotar(l.tipo, `  SOLO EN LOCAL  ${l.nombre}   [${l.hash}]`)
}

const total = Object.values(dif).reduce((s, v) => s + v.length, 0)
if (!total) {
  console.log('\n✅ Deriva 0: la base local es igual a producción en todo lo que mide deriva-esquema.sql.')
  process.exit(0)
}
console.log(`\n🔴 Deriva: ${total} diferencia(s).`)
for (const t of Object.keys(dif).sort()) {
  console.log(`\n── ${t} (${dif[t].length}) ──`)
  for (const l of dif[t].sort()) console.log(l)
}
process.exit(1)
