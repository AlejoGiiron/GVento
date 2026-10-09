// Lista CANDIDATOS a voseo en textos de la app, para revisar a mano.
//
//   node scripts/buscar-voseo.mjs src/pages/movil src/pages/LoginPage.tsx …
//
// Busca por FORMA, no por una lista de verbos (R2, caso #15: un grep por los nombres
// que uno espera es una deny-list de lo que uno se acordó de imaginar):
//   1. palabras terminadas en á/é/í (con o sin pronombre: "Instalá", "Tocá", "Abrí")
//      y en ás/és/ís ("podés", "tenés");
//   2. el imperativo con UN pronombre, que pierde la tilde ("Pedile", "Avisale", "Decime").
// Con regex Unicode: `grep` en Windows no trata la letra con tilde como parte de la
// palabra (\b se corta en "á") y devuelve vacío, que se lee como "no hay".
// Salta líneas de comentario. Da falsos positivos (futuros como "desactivará",
// identificadores en inglés en la pasada 2): por eso es una lista para REVISAR.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const NUNCA = new Set(('está más así aquí ahí allí allá acá sí ya después también estás qué cómo cuál cuáles quién ' +
  'quiénes menú además jamás atrás detrás quizás inglés francés bogotá través interés demás país mamá papá café ' +
  'sofá vale sale dale cable posible imposible visible detalle calle simple nombre sobre entre siempre total final ' +
  'mesa sola tabla pila fila una alguna ninguna cada nada toda todas todos esa esas esos ella ellas ellos esta ' +
  'estas estos pantalla para hola sala billete paquete').split(' '))
const TILDE = /[\p{L}]*(?:[áéí](?:le|les|lo|la|los|las|me|te|nos|se)?|[áéí]s)(?![\p{L}])/gu
const ENCLITICO = /(?<![\p{L}])[\p{Ll}\p{Lu}][\p{Ll}]+[aei](?:le|les|lo|la|los|las|me|nos)(?![\p{L}])/gu

const archivos = []
const recorrer = (p) => {
  if (statSync(p).isDirectory()) for (const f of readdirSync(p)) recorrer(join(p, f))
  else if (/\.(tsx?|sql)$/.test(p) && !/\.test\./.test(p)) archivos.push(p)
}
for (const o of process.argv.slice(2)) recorrer(o)
if (!archivos.length) { console.error('uso: node scripts/buscar-voseo.mjs <carpeta|archivo>…'); process.exit(2) }

let n = 0
for (const f of archivos) {
  readFileSync(f, 'utf8').split(/\r?\n/).forEach((l, i) => {
    const t = l.trim()
    if (/^(\/\/|\*|\/\*|\{\/\*|--)/.test(t)) return
    // Pasada 2 sin tildes: "Pídele" (tú) lleva tilde; "Pedile" (vos) no.
    const ws = [...[...l.matchAll(TILDE)].map((m) => m[0]), ...[...l.matchAll(ENCLITICO)].map((m) => m[0]).filter((w) => !/[áéíóú]/.test(w))]
      .filter((w) => w.length > 2 && !NUNCA.has(w.toLowerCase()) && !/[A-Z].*[A-Z]|[a-z][A-Z]/.test(w))
    if (ws.length) { n++; console.log(`${relative('.', f)}:${i + 1}: [${[...new Set(ws)].join(', ')}]  ${t.slice(0, 140)}`) }
  })
}
console.log(`— ${n} línea(s) para revisar`)
