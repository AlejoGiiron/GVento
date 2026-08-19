import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createHmac } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { loginAsOwner, ownerCreds } from './helpers/auth'
import { waitPosReady } from './helpers/pos'

// ============================================================================
// FASE 2 — el banner que LEE la bandera de suscripción.
//
// Complementa a suscripcion-estado.spec.ts (Fase 1: nadie puede ESCRIBIR estas
// columnas desde el cliente). Acá se prueba el otro lado: que G-Vento las lea
// y reaccione — y sobre todo, que NO reaccione cuando no debe.
//
// ── POR QUÉ SE ESCRIBE POR LA EDGE FUNCTION Y NO POR SERVICE ROLE ───────────
// El cliente authenticated NO puede escribir estas columnas: ese es justamente
// el punto de la Fase 1 (privilegios por columna en allowlist + trigger). Para
// montar cada escenario hay que escribirlas por alguno de los dos caminos que
// existen, y se eligió `aplicar-estado` firmada con HMAC porque es EL MISMO
// camino que usa G-Centro en producción. Beneficio lateral: cada corrida
// revalida que la función siga viva y que "Verify JWT" siga desactivado (si un
// redeploy lo reactiva, estos tests fallan con 401 y avisan).
//
// ⚠️ ESTE SPEC SÍ CAMBIA EL ESTADO DE SUSCRIPCIÓN DE LAB, a diferencia del de
// Fase 1, que a propósito solo probaba RECHAZOS. Consecuencias asumidas:
//   · Snapshot en beforeAll + restore en afterAll del estado y el mensaje.
//   · `subscription_updated_at` NO se puede restaurar por este camino (lo
//     escribe la función). Queda con la hora de la corrida — y es honesto: el
//     estado REALMENTE cambió varias veces. LAB es el laboratorio, no un
//     cliente que pague, así que ese timestamp no alimenta ningún cobro.
//   · LAB es el tenant con el que G-Centro prueba su panel: si esta suite corre
//     mientras ellos ensayan, se pisan. Es coordinación, no código; el restore
//     acota la ventana a la duración de la corrida.
//
// LO QUE NO SE PUEDE PROBAR ACÁ: un `subscription_status` fuera del enum. Lo
// rechaza la función Y el CHECK de la BD, así que el fail-open ante un valor
// desconocido vive en el test unitario de `resolveNotice`, que no pasa por red.
// ============================================================================

test.describe.configure({ mode: 'serial' })

function loadEnv(path: string) {
  try {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* ignore */ }
}
loadEnv('.env'); loadEnv('.env.test')

const SECRETO = process.env.E2E_GCENTRO_HMAC_SECRET
// Sin el secreto no hay forma de montar los escenarios: skip del archivo entero
// en vez de fallar (mismo criterio que el resto de la suite).
test.skip(!SECRETO, 'Requiere E2E_GCENTRO_HMAC_SECRET (mismo valor que el de la función)')

const CLAVE_DESCARTE = 'gvento:suscripcion:descartado'

const FN_URL = () =>
  `${process.env.VITE_GVENTO_SUPABASE_URL}/functions/v1/${
    process.env.E2E_APLICAR_ESTADO_FN ?? 'aplicar-estado'
  }`

let owner: SupabaseClient
let orgId = ''
let snap: { status: string; message: string | null }

/**
 * Escribe la bandera como lo hace G-Centro: HMAC sobre `${ts}.${crudo}` con el
 * cuerpo CRUDO (no re-serializado) y sin Authorization — la función tiene
 * "Verify JWT" desactivado y el HMAC es su única autenticación.
 */
async function setEstado(status: string, message: string | null) {
  const crudo = JSON.stringify({ organization_id: orgId, status, message })
  const ts = Math.floor(Date.now() / 1000).toString()
  const firma = createHmac('sha256', SECRETO!).update(`${ts}.${crudo}`).digest('hex')

  const res = await fetch(FN_URL(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-gcentro-timestamp': ts,
      'x-gcentro-signature': firma,
    },
    body: crudo,
  })
  if (!res.ok) {
    // Falla ruidosa: si el escenario no se montó, los `toHaveCount(0)` de abajo
    // darían VERDE por la razón equivocada (no hay banner porque no hay estado).
    throw new Error(`aplicar-estado devolvió ${res.status}: ${await res.text()}`)
  }
}

/**
 * Recarga el POS. El banner se resuelve al montar, así que cada caso necesita
 * una carga fresca DESPUÉS de haber escrito la bandera (no hay Realtime: es la
 * decisión de diseño, no una carencia — ver useSubscriptionStatus).
 */
async function recargarPos(page: Page) {
  await page.goto('/ventas')
  await waitPosReady(page)
}

const banner = (page: Page) => page.getByTestId('subscription-banner')

test.beforeAll(async () => {
  owner = createClient(
    process.env.VITE_GVENTO_SUPABASE_URL!,
    process.env.VITE_GVENTO_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  )
  const { error } = await owner.auth.signInWithPassword(ownerCreds())
  if (error) throw error

  // La RLS "organizations: ver la propia" solo deja ver la del propio usuario,
  // así que esto ya es la org de LAB — sin hardcodear el UUID (los ids se leen
  // de la BD, regla del proyecto).
  const { data, error: e2 } = await owner
    .from('organizations')
    .select('id, subscription_status, subscription_message')
    .single()
  if (e2) throw e2
  orgId = data.id
  snap = { status: data.subscription_status, message: data.subscription_message }
})

test.afterAll(async () => {
  if (!orgId || !snap) return
  try {
    await setEstado(snap.status, snap.message)
  } catch {
    // El restore es best-effort: si falla no debe tumbar la corrida entera,
    // pero conviene que se vea.
    console.warn('[suscripcion-banner] No se pudo restaurar el estado de LAB')
  }
})

test.beforeEach(async ({ page }) => {
  await loginAsOwner(page)
  await page.evaluate(k => localStorage.removeItem(k), CLAVE_DESCARTE)
})

// ── Fail-open: los estados que NO deben mostrar nada ────────────────────────
//
// 📌 AUDITADOS POR MUTACIÓN (2026-08-18), en las DOS direcciones:
//   · con `resolveNotice` → siempre null, los 3 casos de este bloque SOBREVIVEN
//     y mueren los positivos. Es inherente a su forma: un test que verifica
//     AUSENCIA no puede fallar contra un mutante que no muestra nada.
//     NO son defectuosos y NO hay que "arreglarlos" en una auditoría futura.
//   · con `resolveNotice` → siempre un aviso, ESTOS mueren (murió el primero y
//     serial cortó el resto). Esa es la dirección que sí los discrimina, y es
//     la razón por la que no son vacuos.
// El contraste `cart-total` visible dentro de cada caso cubre lo tercero: que
// el 0 no venga de una pantalla que no cargó.

test('active no muestra banner', async ({ page }) => {
  await setEstado('active', 'Este texto no debe verse en ningún lado.')
  await recargarPos(page)
  await expect(banner(page)).toHaveCount(0)
  // Contraste dentro del mismo caso: la pantalla cargó de verdad, así que el 0
  // de arriba significa "no se muestra" y no "no cargó nada".
  await expect(page.getByTestId('cart-total')).toBeVisible()
})

for (const estado of ['restricted', 'suspended']) {
  test(`${estado} no muestra nada — no implementado en esta fase`, async ({ page }) => {
    // Cae en el default del switch, igual que un estado desconocido. Es la
    // decisión de alcance: hasta saber si el aviso suave alcanza, estos dos
    // niveles no cambian NADA en el POS.
    await setEstado(estado, `Mensaje de ${estado} que no debe verse.`)
    await recargarPos(page)
    await expect(banner(page)).toHaveCount(0)
    await expect(page.getByTestId('cart-total')).toBeVisible()
  })
}

// ── expiring: aviso descartable ─────────────────────────────────────────────

test('expiring muestra el mensaje de G-Centro y es descartable', async ({ page }) => {
  await setEstado('expiring', 'Tu plan vence el 25 de agosto.')
  await recargarPos(page)

  await expect(banner(page)).toBeVisible()
  await expect(banner(page)).toHaveAttribute('data-estado', 'expiring')
  await expect(page.getByTestId('subscription-banner-message'))
    .toHaveText('Tu plan vence el 25 de agosto.')
  await expect(page.getByTestId('subscription-banner-dismiss')).toBeVisible()
})

test('expiring sin mensaje usa el texto por defecto (no se calla)', async ({ page }) => {
  // Un NULL no puede silenciar el aviso: sería darle a G-Centro un interruptor
  // accidental para apagarlo.
  await setEstado('expiring', null)
  await recargarPos(page)

  await expect(banner(page)).toBeVisible()
  const texto = await page.getByTestId('subscription-banner-message').textContent()
  expect(texto!.trim().length).toBeGreaterThan(0)
  expect(texto).toMatch(/vencer/i)
})

test('el descarte sobrevive a la recarga y guarda estado + día', async ({ page }) => {
  await setEstado('expiring', 'Vence pronto.')
  await recargarPos(page)

  await page.getByTestId('subscription-banner-dismiss').click()
  await expect(banner(page)).toHaveCount(0)

  const guardado = await page.evaluate(k => localStorage.getItem(k), CLAVE_DESCARTE)
  const parsed = JSON.parse(guardado!)
  expect(parsed.estado).toBe('expiring')
  expect(parsed.dia).toMatch(/^\d{4}-\d{2}-\d{2}$/)

  await recargarPos(page)
  await expect(banner(page)).toHaveCount(0)
})

test('el descarte caduca: con un día viejo el aviso vuelve', async ({ page }) => {
  await setEstado('expiring', 'Vence pronto.')
  await recargarPos(page)
  await expect(banner(page)).toBeVisible()

  // Se simula "ayer" escribiendo la clave a mano: es lo que hace que el aviso
  // sea un recordatorio diario y no un silencio permanente.
  await page.evaluate(
    ([k, v]) => localStorage.setItem(k, v),
    [CLAVE_DESCARTE, JSON.stringify({ estado: 'expiring', dia: '2020-01-01' })],
  )
  await recargarPos(page)
  await expect(banner(page)).toBeVisible()
})

test('descartar expiring no tapa un grace posterior', async ({ page }) => {
  // El caso que justifica guardar el ESTADO junto al día: son avisos distintos
  // y el segundo es más serio.
  await setEstado('expiring', 'Vence pronto.')
  await recargarPos(page)
  await page.getByTestId('subscription-banner-dismiss').click()
  await expect(banner(page)).toHaveCount(0)

  await setEstado('grace', 'Tu suscripción venció.')
  await recargarPos(page)
  await expect(banner(page)).toBeVisible()
  await expect(banner(page)).toHaveAttribute('data-estado', 'grace')
})

// ── grace: aviso persistente ────────────────────────────────────────────────

test('grace se muestra y NO se puede descartar', async ({ page }) => {
  await setEstado('grace', 'Tu suscripción venció. Regularizá con soporte.')
  await recargarPos(page)

  await expect(banner(page)).toBeVisible()
  await expect(banner(page)).toHaveAttribute('data-estado', 'grace')
  await expect(page.getByTestId('subscription-banner-dismiss')).toHaveCount(0)
})

test('grace no bloquea nada: el POS sigue operable', async ({ page }) => {
  // El alcance de esta fase es UI y solo UI. Si algún día alguien "endurece"
  // esto deshabilitando botones o bloqueando módulos, este test se pone rojo.
  await setEstado('grace', 'Tu suscripción venció.')
  await recargarPos(page)
  await expect(banner(page)).toBeVisible()

  await page.getByTestId('product-card').first().click()
  await expect(page.getByText('Carrito vacío')).toHaveCount(0)
  const total = Number((await page.getByTestId('cart-total').innerText()).replace(/[^\d]/g, ''))
  expect(total).toBeGreaterThan(0)
})

// ── Layout: dónde vive y qué desplaza ───────────────────────────────────────

test('el banner va ARRIBA del de turno y comprime el contenido sin romperlo', async ({ page }) => {
  await setEstado('grace', 'Tu suscripción venció.')
  await recargarPos(page)
  await expect(banner(page)).toBeVisible()

  const caja = (await banner(page).boundingBox())!
  const main = (await page.locator('main').boundingBox())!

  // No se superpone con el contenido: termina donde arranca <main>.
  expect(caja.y + caja.height).toBeLessThanOrEqual(main.y + 1)
  // Y <main> conserva alto real (no quedó aplastado ni desbordado).
  expect(main.height).toBeGreaterThan(300)

  // Si además no hay turno abierto, el de suscripción va PRIMERO.
  const turno = page.getByText('No hay turno de caja abierto.')
  if (await turno.count()) {
    const cajaTurno = (await turno.boundingBox())!
    expect(caja.y).toBeLessThan(cajaTurno.y)
  }
})

test('un mensaje largo sin espacios no se recorta en silencio', async ({ page }) => {
  // Una corrida sin oportunidad de corte (un token, un id) desbordaba un flex
  // item bajo un ancestro overflow-hidden y quedaba INVISIBLE sin ninguna
  // señal. Con min-width:0 + overflow-wrap:anywhere envuelve y se lee entero.
  const token = 'A'.repeat(140)
  await setEstado('grace', token)
  await recargarPos(page)

  const msg = page.getByTestId('subscription-banner-message')
  await expect(msg).toBeVisible()
  const caja = (await msg.boundingBox())!
  const mainCaja = (await page.locator('main').boundingBox())!

  // Envolvió en varias líneas en vez de quedar en una sola recortada...
  expect(caja.height).toBeGreaterThan(20)
  // ...y no se salió del ancho disponible.
  expect(caja.width).toBeLessThanOrEqual(mainCaja.width + 1)
})
