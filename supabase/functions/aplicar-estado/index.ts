// ============================================================
// G-Vento — Edge Function `aplicar-estado`
//
// G-Centro (panel de suscripciones, repo y BD aparte) llama a esta función para
// escribir el estado de suscripción en organizations. Es el ÚNICO camino de
// escritura: el cliente autenticado tiene esas columnas bloqueadas por
// trg_protect_organization_subscription y por privilegios de columna
// (ver supabase/organization-subscription.sql).
//
// ── AUTENTICACIÓN: HMAC, NO JWT ─────────────────────────────────────────────
// El llamante es un SERVIDOR, no un usuario. Las alternativas eran:
//   · Compartirle a G-Centro el service_role key de G-Vento — NO: esa llave
//     abre la base ENTERA, sin límite de alcance ni forma de rotarla sin
//     romper todo lo demás. Una integración no debe pedir la llave maestra.
//   · HMAC con secreto dedicado — SÍ: alcance limitado a este endpoint,
//     rotable por su cuenta, y no le da a G-Centro ninguna otra capacidad.
//
// ⚠️ Requiere DESACTIVAR "Verify JWT" en la configuración de la función
// (Dashboard > Edge Functions > aplicar-estado > Details). Sin eso, Supabase
// rechaza la petición antes de que este código corra. Consecuencia directa:
// el endpoint queda públicamente alcanzable y **el HMAC es la única
// autenticación** — de ahí la firma sobre timestamp+cuerpo, la ventana
// anti-replay y la verificación en tiempo constante.
//
// ── CONTRATO ────────────────────────────────────────────────────────────────
// POST, con headers:
//   x-gcentro-timestamp : unix EN SEGUNDOS
//   x-gcentro-signature : hex(HMAC_SHA256(secreto, `${timestamp}.${cuerpoCrudo}`))
// Cuerpo JSON:
//   { "organization_id": uuid, "status": <enum>, "message": string|null }
//
// La firma cubre el timestamp Y el cuerpo: firmar solo el cuerpo permitiría
// reusar una captura para siempre; firmar solo el timestamp dejaría alterar el
// payload. Van juntos o no sirve.
//
// ── IDEMPOTENCIA ────────────────────────────────────────────────────────────
// Re-aplicar el MISMO estado es un no-op: no se emite UPDATE y no se toca
// subscription_updated_at. Esa columna significa "cuándo CAMBIÓ el estado", no
// "cuándo llamaron a la función" — así sirve para contar desde cuándo corre un
// período de gracia. Además evita que el trigger trg_organizations_updated_at
// mueva `updated_at` en cada reintento de G-Centro.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-gcentro-timestamp, x-gcentro-signature',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

// Debe coincidir EXACTAMENTE con el CHECK de organization-subscription.sql.
// Si se agrega un estado, se cambian los dos lados en la misma pasada.
const ESTADOS = ['active', 'expiring', 'grace', 'restricted', 'suspended'] as const
type Estado = (typeof ESTADOS)[number]

// Ventana anti-replay. Se aplica en AMBAS direcciones para tolerar reloj
// adelantado del llamante: |ahora - ts| > VENTANA => rechazo.
const VENTANA_SEG = 300

function hexABytes(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0) return null
  if (!/^[0-9a-fA-F]+$/.test(hex)) return null
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

// crypto.subtle.verify compara en tiempo constante por construcción: no se
// compara la firma a mano para no abrir un oráculo de temporizado.
async function firmaValida(secreto: string, mensaje: string, firmaHex: string): Promise<boolean> {
  const firma = hexABytes(firmaHex)
  if (!firma) return false
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
  )
  return await crypto.subtle.verify('HMAC', key, firma, enc.encode(mensaje))
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Metodo no permitido' }, 405)

  try {
    const secreto = Deno.env.get('GCENTRO_HMAC_SECRET') ?? ''
    if (!secreto) {
      // Fail-closed: sin secreto configurado NO se acepta nada. Lo contrario
      // dejaría el endpoint abierto justo cuando falta la configuración.
      console.error('GCENTRO_HMAC_SECRET no configurado')
      return json({ error: 'Funcion no configurada' }, 503)
    }

    const ts = req.headers.get('x-gcentro-timestamp') ?? ''
    const sig = req.headers.get('x-gcentro-signature') ?? ''
    // El cuerpo se lee CRUDO: la firma se calcula sobre estos bytes exactos.
    // Firmar sobre un JSON re-serializado rompería con cualquier diferencia de
    // formato (orden de claves, espacios).
    const crudo = await req.text()

    const tsNum = Number(ts)
    if (!Number.isFinite(tsNum)) return json({ error: 'No autorizado' }, 401)
    if (Math.abs(Math.floor(Date.now() / 1000) - tsNum) > VENTANA_SEG)
      return json({ error: 'No autorizado' }, 401)

    if (!(await firmaValida(secreto, `${ts}.${crudo}`, sig)))
      return json({ error: 'No autorizado' }, 401)

    // ── A partir de acá el llamante está autenticado ──
    let body: { organization_id?: unknown; status?: unknown; message?: unknown }
    try {
      body = JSON.parse(crudo)
    } catch {
      return json({ error: 'Cuerpo JSON invalido' }, 400)
    }

    const orgId = typeof body.organization_id === 'string' ? body.organization_id : ''
    const status = typeof body.status === 'string' ? body.status : ''
    const message =
      body.message === null || body.message === undefined
        ? null
        : typeof body.message === 'string'
          ? body.message
          : undefined

    if (!orgId) return json({ error: 'organization_id requerido' }, 400)
    if (message === undefined) return json({ error: 'message debe ser string o null' }, 400)
    if (!ESTADOS.includes(status as Estado))
      return json({ error: `status invalido. Validos: ${ESTADOS.join(', ')}` }, 400)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // Existencia de la org + estado actual, en una sola lectura: el estado
    // actual es lo que decide si el UPDATE es necesario (idempotencia).
    const { data: org, error: leerErr } = await admin
      .from('organizations')
      .select('id, name, subscription_status, subscription_message, subscription_updated_at')
      .eq('id', orgId)
      .maybeSingle()

    if (leerErr) {
      console.error('Error leyendo organizations:', leerErr.message)
      return json({ error: 'Error de base de datos' }, 500)
    }
    if (!org) return json({ error: 'Organizacion inexistente' }, 404)

    // No-op si nada cambia. Ver la nota de idempotencia del encabezado.
    if (org.subscription_status === status && org.subscription_message === message) {
      return json({
        ok: true,
        changed: false,
        organization_id: org.id,
        status: org.subscription_status,
        subscription_updated_at: org.subscription_updated_at,
      })
    }

    const { data: actualizado, error: updErr } = await admin
      .from('organizations')
      .update({
        subscription_status: status,
        subscription_message: message,
        subscription_updated_at: new Date().toISOString(),
      })
      .eq('id', orgId)
      .select('id, subscription_status, subscription_message, subscription_updated_at')
      .single()

    if (updErr) {
      console.error('Error actualizando organizations:', updErr.message)
      return json({ error: 'Error de base de datos' }, 500)
    }

    return json({
      ok: true,
      changed: true,
      organization_id: actualizado.id,
      status: actualizado.subscription_status,
      subscription_updated_at: actualizado.subscription_updated_at,
    })
  } catch (e) {
    console.error('aplicar-estado:', e instanceof Error ? e.message : String(e))
    return json({ error: 'Error interno' }, 500)
  }
})
