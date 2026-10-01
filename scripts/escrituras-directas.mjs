// Escrituras DIRECTAS a tablas desde el frontend, en un ref de git (default: origin/main,
// o sea lo desplegado). Uso: node scripts/escrituras-directas.mjs [ref]
// Busca cada `.from('<tabla>')` seguido de .insert/.update/.delete/.upsert, y lista las RPC.
// Control de completitud: avisa si hay `.from(<no literal>)`, que esta búsqueda no ve.
// Solo lectura (git show). Ver docs/DEUDAS.md → "Tablas que solo deberían escribirse por RPC".
import { execSync } from 'node:child_process'

const ref = process.argv[2] ?? 'origin/main'
const files = execSync(`git ls-tree -r --name-only ${ref} -- src`).toString().split('\n')
  .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.ts$/.test(f))
const escrituras = {}, rpcs = {}, noLiterales = []
for (const f of files) {
  const src = execSync(`git show ${ref}:${f}`, { maxBuffer: 1 << 26 }).toString()
  for (const m of src.matchAll(/\.from\(\s*['"](\w+)['"]\s*\)/g)) {
    const resto = src.slice(m.index + m[0].length, m.index + m[0].length + 400)
    const corte = resto.search(/\.from\(|\n\s*\n|;\s*\n/)
    const op = (corte >= 0 ? resto.slice(0, corte) : resto).match(/^\s*\.(insert|update|delete|upsert)\(/)
    if (op) (escrituras[m[1]] ??= []).push(`${op[1]} ${f}:${src.slice(0, m.index).split('\n').length}`)
  }
  for (const m of src.matchAll(/(?<!storage|Array)\.from\(\s*(?!['"])([^)\s]+)/g)) {
    if (!/^(new|\[|Array)/.test(m[1])) noLiterales.push(`${f}: .from(${m[1]}`)
  }
  for (const m of src.matchAll(/\.rpc\(\s*['"](\w+)['"]/g)) (rpcs[m[1]] ??= new Set()).add(f)
}
console.log(`ref ${ref} (${execSync(`git rev-parse --short ${ref}`).toString().trim()})\n`)
for (const [t, l] of Object.entries(escrituras).sort()) console.log(`${t}\n   ${l.join('\n   ')}`)
console.log(`\nRPC: ${Object.keys(rpcs).sort().join(', ')}`)
console.log(noLiterales.length ? `\n⚠️ from() NO literal (revisar a mano):\n   ${noLiterales.join('\n   ')}` : '\n✓ ningún from() con argumento no literal')
