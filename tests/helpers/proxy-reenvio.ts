import net from 'node:net'
import type { Page, Route } from '@playwright/test'

// ============================================================================
// Proxy TCP entre Chromium y el Supabase LOCAL que reproduce el REENVÍO
// automático del navegador (docs/DEUDAS.md → "El navegador ejecuta DOS VECES").
//
// Deja pasar todo, salvo el PRIMER POST a la ruta indicada: lo reenvía al
// servidor, espera a que el servidor empiece a responder (= la escritura ya
// corrió y confirmó) y entonces corta la conexión del navegador sin entregarle
// la respuesta. Medido el 2026-10-01/04 con Chromium:
//   'rst' / 'fin'   corte inmediato (RST / cierre ordenado) en una conexión
//                   REUTILIZADA → Chromium reenvía solo; el código ve éxito.
//   'colgada'       se retiene la respuesta `espera` s y después RST → idem,
//                   con el segundo envío `espera` s después (la #2945: 19,5 s).
//   'nueva'         el corte es en una conexión NUEVA → Chromium NO reenvía; el
//                   código ve "Failed to fetch" con la escritura YA hecha (el
//                   test reintenta a mano, como el cajero).
// ============================================================================

export type ModoCorte = 'rst' | 'fin' | 'colgada' | 'nueva'

export interface Proxy {
  origen: string
  postsQueLlegaron: () => number
  cerrarConexiones: () => void
  cerrar: () => Promise<void>
}

export async function abrirProxy(upstream: string, ruta: string, modo: ModoCorte, esperaS = 19, puerto = 54399): Promise<Proxy> {
  const up0 = new URL(upstream)
  let posts = 0
  let cortado = false
  const conexiones: net.Socket[] = []

  const server = net.createServer((cli) => {
    conexiones.push(cli)
    const up = net.connect(Number(up0.port), up0.hostname)
    let pedidos = 0
    let cortarAlResponder = false
    let retenida = false   // POR CONEXIÓN: solo se traga la respuesta de la conexión cortada
    cli.on('data', (buf) => {
      const inicio = /^(GET|POST|OPTIONS|HEAD|PATCH|DELETE|PUT) (\S+)/.exec(buf.toString('latin1'))
      if (inicio) {
        pedidos++
        if (inicio[1] === 'POST' && inicio[2].includes(ruta)) {
          posts++
          const toca = modo === 'nueva' ? pedidos === 1 : pedidos > 1
          if (!cortado && toca) { cortado = true; cortarAlResponder = true }
        }
      }
      up.write(buf)
    })
    up.on('data', (buf) => {
      if (cortarAlResponder) {
        cortarAlResponder = false
        retenida = true
        const espera = modo === 'colgada' ? esperaS * 1000 : 0
        setTimeout(() => {
          if (modo === 'fin') cli.end(); else cli.resetAndDestroy()
          up.destroy()
        }, espera)
        return
      }
      if (retenida) return
      if (!cli.destroyed) cli.write(buf)
    })
    up.on('error', () => cli.destroy())
    cli.on('error', () => up.destroy())
    up.on('end', () => cli.end())
    cli.on('end', () => up.end())
  })
  await new Promise<void>((ok) => server.listen(puerto, '127.0.0.1', ok))
  return {
    origen: `http://127.0.0.1:${puerto}`,
    postsQueLlegaron: () => posts,
    cerrarConexiones: () => { for (const s of conexiones) s.destroy() },
    cerrar: () => new Promise<void>((ok) => { for (const s of conexiones) s.destroy(); server.close(() => ok()) }),
  }
}

/**
 * Hace UN POST a una RPC desde el navegador, a través del proxy, con el JWT del
 * usuario. Para los modos de conexión reutilizada calienta antes la conexión con
 * dos pedidos; para 'nueva' la deja fría. Devuelve lo que vio el código.
 */
export async function postDesdeElNavegador(
  page: Page, proxy: Proxy, modo: ModoCorte, anon: string, token: string, rpc: string, cuerpo: unknown,
): Promise<string> {
  await page.goto(`${proxy.origen}/rest/v1/?apikey=${anon}`)
  if (modo === 'nueva') proxy.cerrarConexiones()
  return page.evaluate(async ({ anon, token, rpc, cuerpo, calentar }) => {
    const h = { apikey: anon, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
    if (calentar) await fetch('/rest/v1/orders?select=id&limit=1', { headers: h })
    try {
      const r = await fetch('/rest/v1/rpc/' + rpc, { method: 'POST', headers: h, body: JSON.stringify(cuerpo) })
      return `HTTP ${r.status}`
    } catch (e) {
      return `ERROR ${(e as Error).message}`
    }
  }, { anon, token, rpc, cuerpo, calentar: modo !== 'nueva' })
}

/**
 * La PRIMERA llamada de la APP a `rpc` pierde su respuesta POR EL PROXY: la URL de
 * la API de la app es fija (VITE_GVENTO_SUPABASE_URL), así que Playwright le pasa esa
 * llamada al proxy (route.fetch con su origen). El proxy, en modo 'nueva', deja que
 * el servidor la ejecute y corta la conexión en cuanto el servidor empieza a
 * responder (la venta ya confirmó); la app recibe un corte de conexión, como el
 * cajero en el local ("No se cobró"). Las llamadas siguientes van directo.
 * Devuelve los p_sale_id de cada llamada, en orden.
 */
export async function perderPrimeraRespuesta(page: Page, proxy: Proxy, rpc: string, urlApi: string): Promise<string[]> {
  const ids: string[] = []
  let primera = true
  await page.route(`**/rest/v1/rpc/${rpc}`, async (route: Route) => {
    ids.push((route.request().postDataJSON() as { p_sale_id: string }).p_sale_id)
    if (!primera) { await route.continue(); return }
    primera = false
    try {
      await route.fetch({ url: route.request().url().replace(urlApi.replace(/\/$/, ''), proxy.origen) })
    } catch {
      // Esperado: el proxy cortó la conexión después de que el servidor confirmó.
    }
    await route.abort('connectionreset')
  })
  return ids
}
