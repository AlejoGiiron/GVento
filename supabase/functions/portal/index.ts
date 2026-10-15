// ============================================================
// G-Vento — Edge Function `portal` (Pedidos en línea, P2)
//
// LA ÚNICA PUERTA PÚBLICA del portal del cliente. El navegador no llama a la base: anon no
// ejecuta ninguna función (tripwire de P0.2) y las funciones del portal (portal-publico.sql)
// solo las ejecuta service_role, desde aquí.
//
// ── CONTRATO ────────────────────────────────────────────────────────────────
// POST con JSON, una acción de la ALLOWLIST de reglas.ts (claves exactas por acción):
//   { "accion": "catalogo", "slug": "salchimelo" }
//   { "accion": "cotizar",  "slug": "salchimelo", "items": [...], "lat": 3.45, "lng": -76.53 }
// Respuestas: 200 con lo que devuelve la base · 400 cuerpo o ítems inválidos (mensaje para la
// pantalla) · 403 origen no permitido · 405 · 413 · 429 límite (Retry-After) · 500/503 sin detalle.
// El navegador la llama con fetch simple (solo content-type): supabase.functions.invoke manda
// authorization, apikey y x-client-info, que el preflight no permite.
//
// ── SIN JWT ─────────────────────────────────────────────────────────────────
// verify_jwt = false (supabase/config.toml y `--no-verify-jwt` al desplegar): el cliente del
// portal no tiene sesión, y la llave anon tampoco protegería nada (es pública). La protección es
// esta función: allowlist de acciones y claves, límite por IP y, en P3, Turnstile al crear.
//
// ── LÍMITE POR IP (decidido el 2026-10-15 con la medición en prod, ver reglas.ts) ──
// cf-connecting-ip; si viene vacío, el primer valor de x-forwarded-for; si faltan los dos, un
// balde GLOBAL (nunca sin límite). La base recibe solo un HMAC (reglas.ts › claveLimite). Si el
// contador falla, se rechaza (503).
// 🔴 Lo que NO cubre: este código no registra la IP, pero los logs de la plataforma (edge logs de
// Supabase) pueden traer los encabezados de la petición. No está medido (DEUDAS → "Portal público").
//
// ── SECRETOS / VARIABLES ────────────────────────────────────────────────────
//   PORTAL_SAL            obligatoria, ≥ 32 caracteres (sin ella responde 500: fail-closed).
//   PORTAL_ORIGENES       orígenes permitidos, separados por coma (por defecto el dominio del
//                         portal y g-vento.vercel.app).
//   PORTAL_PREVIEW_SUFIJO opcional: permite https://g-vento-<algo><sufijo> (vistas previas).
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: las pone Supabase.
// 🔴 NUNCA registrar la IP, el cuerpo ni los encabezados: solo la acción y el código de error.
// ============================================================

import {
  ACCIONES, ERROR_DE_FORMA, MAX_CUERPO_BYTES, SIN_IP_POR_MINUTO, claveLimite, ipDelCliente, leerOrigenes,
  origenPermitido, segundosParaReintentar, validarCuerpo,
} from './reglas.ts'

const URL_BASE = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICIO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const SAL = Deno.env.get('PORTAL_SAL') ?? ''
const ORIGENES = leerOrigenes(Deno.env.get('PORTAL_ORIGENES'))
const SUFIJO_PREVIEW = Deno.env.get('PORTAL_PREVIEW_SUFIJO')?.trim() || null

const MENSAJE_GENERICO = 'No pudimos atender tu consulta. Intenta de nuevo en un momento.'
const MUY_GRANDE = 'El pedido es demasiado grande.'

async function rpc(nombre: string, params: Record<string, unknown>) {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${nombre}`, {
    method: 'POST',
    headers: { apikey: SERVICIO, Authorization: `Bearer ${SERVICIO}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const cuerpo: unknown = await r.json().catch(() => null)
  return { ok: r.ok, cuerpo }
}

/**
 * El cuerpo como texto, cortando apenas pasa el tope (también si no viene content-length).
 * En local el Kong junta el cuerpo y pone content-length (medido el 2026-10-15), así que la lectura
 * en partes solo la ejercita un gateway que no lo haga; el de producción no se pudo medir.
 */
async function leerCuerpo(req: Request): Promise<string | null> {
  if (Number(req.headers.get('content-length') ?? 0) > MAX_CUERPO_BYTES) return null
  if (!req.body) return ''
  const lector = req.body.getReader()
  const partes: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await lector.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_CUERPO_BYTES) { await lector.cancel(); return null }
    partes.push(value)
  }
  const junto = new Uint8Array(total)
  let i = 0
  for (const p of partes) { junto.set(p, i); i += p.byteLength }
  return new TextDecoder().decode(junto)
}

Deno.serve(async (req) => {
  const origen = req.headers.get('origin')
  const cors: Record<string, string> = { Vary: 'Origin' }
  if (origen !== null) {
    if (!origenPermitido(origen, ORIGENES, SUFIJO_PREVIEW)) {
      return new Response(JSON.stringify({ error: 'Origen no permitido.' }), {
        status: 403, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
      })
    }
    cors['Access-Control-Allow-Origin'] = origen
    cors['Access-Control-Expose-Headers'] = 'Retry-After'
  }
  const responder = (cuerpo: unknown, status = 200, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(cuerpo), {
      status,
      headers: {
        ...cors, ...extra,
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })

  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { ...cors, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Max-Age': '86400' },
    })
  }
  if (req.method !== 'POST') return responder({ error: 'Método no permitido.' }, 405, { Allow: 'POST, OPTIONS' })
  if (SAL.length < 32 || !URL_BASE || !SERVICIO) {
    console.error('portal: falta configuración (PORTAL_SAL de al menos 32 caracteres, o las variables de Supabase)')
    return responder({ error: MENSAJE_GENERICO }, 500)
  }

  const texto = await leerCuerpo(req)
  if (texto === null) return responder({ error: MUY_GRANDE }, 413)
  const cuerpo = validarCuerpo(texto)
  if (!cuerpo.ok) return responder({ error: cuerpo.error }, 400)

  // Límite: se cuenta ANTES de consultar. Si el contador no responde, no se deja pasar.
  const ahora = new Date()
  const ip = ipDelCliente(req.headers)
  const maximo = ip === null ? SIN_IP_POR_MINUTO : ACCIONES[cuerpo.accion].porMinuto
  const conteo = await rpc('portal_contar', { p_clave: await claveLimite(cuerpo.accion, ip, SAL, ahora), p_max: maximo })
  if (!conteo.ok || typeof conteo.cuerpo !== 'boolean') {
    console.error(`portal ${cuerpo.accion}: el contador del límite no respondió`)
    return responder({ error: MENSAJE_GENERICO }, 503)
  }
  if (!conteo.cuerpo) {
    return responder({ error: 'Demasiadas consultas seguidas. Espera un momento y vuelve a intentarlo.' }, 429,
      { 'Retry-After': String(segundosParaReintentar(ahora)) })
  }

  const r = await rpc(ACCIONES[cuerpo.accion].rpc, cuerpo.params)
  if (r.ok) return responder(r.cuerpo)
  // ALLOWLIST del error: solo el SQLSTATE propio de portal_calcular (forma de los ítems o de la
  // ubicación) trae un mensaje para la pantalla. Cualquier otro, también un 22023 de Postgres,
  // sale genérico: un texto interno nunca llega al cliente.
  const err = (r.cuerpo ?? {}) as { code?: string; message?: string }
  if (err.code === ERROR_DE_FORMA && typeof err.message === 'string') return responder({ error: err.message }, 400)
  console.error(`portal ${cuerpo.accion}: error ${err.code ?? 'desconocido'}`)
  return responder({ error: MENSAJE_GENERICO }, 500)
})
