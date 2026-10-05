import { test, expect, type Page } from '@playwright/test'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ownerCreds, cashierCreds, waiterCreds, hasWaiterCreds, type Creds } from './helpers/auth'
import { cliente, psql } from './helpers/db-local'

// ============================================================================
// POS móvil (/m) — corre en los proyectos m-android (Chromium, Pixel 7) y
// m-iphone (WebKit, iPhone 13). Es la RED: Wake Lock real, el teclado, la barra
// de inicio y "Agregar a inicio" se prueban en equipos (docs/m1-verificacion-equipos.md).
//
// Escrituras de fixture: SOLO en la base local, por UUID de sede
// (restaurants.config de la sede LAB, restaurada al texto exacto en afterAll).
// ============================================================================

let owner: SupabaseClient
let OWNER_ID = ''
let CAJERO_ID = ''
let SEDE = ''
let CONFIG_ORIGINAL = ''
let COCTEL = ''

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  const o = await cliente(ownerCreds())
  const c = await cliente(cashierCreds())
  owner = o.c; OWNER_ID = o.uid; CAJERO_ID = c.uid; SEDE = o.sede
  expect(c.sede).toBe(SEDE)
  CONFIG_ORIGINAL = psql(`select coalesce(config, '{}'::jsonb)::text from public.restaurants where id = '${SEDE}';`)
  COCTEL = psql(`select id from public.products where restaurant_id = '${SEDE}' and name = 'Lab Coctel';`)
  expect(COCTEL).toMatch(/^[0-9a-f-]{36}$/)
})

test.afterAll(() => {
  psql(`update public.restaurants set config = '${CONFIG_ORIGINAL.replace(/'/g, "''")}'::jsonb where id = '${SEDE}';`)
  expect(psql(`select coalesce(config, '{}'::jsonb)::text from public.restaurants where id = '${SEDE}';`), 'config restaurada').toBe(CONFIG_ORIGINAL)
})

/** Cambia UNA clave de la config de la sede LAB (por UUID). */
function ponerConfig(clave: string, valor: unknown) {
  const n = psql(`with u as (update public.restaurants
                    set config = coalesce(config, '{}'::jsonb) || jsonb_build_object('${clave}', '${JSON.stringify(valor).replace(/'/g, "''")}'::jsonb)
                    where id = '${SEDE}' returning 1) select count(*) from u;`)
  expect(n, 'tocó exactamente la sede LAB').toBe('1')
}
function quitarConfig(clave: string) {
  psql(`update public.restaurants set config = coalesce(config, '{}'::jsonb) - '${clave}' where id = '${SEDE}';`)
}

async function turnoAbierto() {
  const abierto = (await owner.from('cash_shifts').select('id').eq('restaurant_id', SEDE).is('closed_at', null).maybeSingle()).data
  if (abierto) return
  const { error } = await owner.from('cash_shifts').insert({ restaurant_id: SEDE, opened_by: OWNER_ID, opening_amount: 0 })
  if (error) throw error
}
async function sinTurno() {
  const abierto = (await owner.from('cash_shifts').select('id').eq('restaurant_id', SEDE).is('closed_at', null).maybeSingle()).data
  if (!abierto) return
  const { error } = await owner.rpc('close_cash_shift', { p_shift_id: abierto.id, p_declarado: { cash: 0 } })
  if (error) throw error
}

async function entrar(page: Page, creds: Creds, destino: RegExp = /\/m$/, recargar = true) {
  // recargar=false: ya está en /login por navegación de la app (después de
  // "Cerrar sesión"). Un page.goto RECARGA la página y borra el estado en
  // memoria de la pestaña — justo lo que un test de cambio de usuario necesita conservar.
  if (recargar) await page.goto('/login')
  await page.locator('input[autocomplete="email"]').fill(creds.email)
  await page.locator('input[autocomplete="current-password"]').fill(creds.password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page).toHaveURL(destino, { timeout: 15_000 })
}

async function agregar(page: Page, nombre: string) {
  await page.getByTestId('m-buscar').fill(nombre)
  await page.getByTestId('m-productos').getByTestId('m-producto').filter({ hasText: nombre }).first().click()
  await page.getByTestId('m-buscar').fill('')
}

/** Cobra lo que hay en el carrito con el método dado; devuelve el número de venta. */
async function cobrar(page: Page, metodo: 'cash' | 'nequi' | 'card'): Promise<number> {
  await page.getByTestId('m-carrito-abrir').click()
  if (metodo === 'card') await page.getByTestId('m-pagar-mas').click()
  await page.getByTestId(`m-pagar-${metodo}`).click()
  await page.getByTestId('m-confirmar').click()
  await expect(page.getByTestId('m-exito')).toBeVisible({ timeout: 15_000 })
  const n = Number(((await page.getByTestId('m-exito-numero').textContent()) ?? '').replace(/\D/g, ''))
  await page.getByTestId('m-nueva-venta').click()
  return n
}

const turnoActual = () => psql(`select id || '|' || opened_at from public.cash_shifts where restaurant_id = '${SEDE}' and closed_at is null;`)

// ── Entrada ────────────────────────────────────────────────────────────────

test('en el celular, quien cobra entra directo a /m; "Versión completa" lo deja en escritorio', async ({ page }) => {
  await entrar(page, cashierCreds())
  await expect(page.getByTestId('m-shell')).toBeVisible()
  await page.getByTestId('m-nav-menu').click()
  await page.getByTestId('m-version-completa').click()
  await expect(page).toHaveURL(/\/ventas$/)
  // Contraste: navegar a otra pantalla NO lo devuelve a /m en esta pestaña.
  await page.goto('/mesas')
  await expect(page).toHaveURL(/\/mesas$/)
})

test('"Versión completa" se recuerda POR EQUIPO (otra pestaña) y se puede volver a /m', async ({ context }) => {
  const a = await context.newPage()
  await entrar(a, cashierCreds())
  await a.getByTestId('m-nav-menu').click()
  await a.getByTestId('m-version-completa').click()
  await expect(a).toHaveURL(/\/ventas$/)
  await a.close()

  // MISMO equipo (mismo contexto = mismo almacenamiento y la sesión sigue abierta, como
  // al volver a abrir la app en el celular): pestaña nueva, queda en escritorio.
  const b = await context.newPage()
  await b.goto('/ventas')
  await expect(b).toHaveURL(/\/ventas$/)
  await b.goto('/mesas')
  await expect(b).toHaveURL(/\/mesas$/)

  // Volver a elegir: desde el escritorio, "Usar la versión para celular".
  await b.getByTestId('app-usar-movil').click()
  await expect(b).toHaveURL(/\/m$/)
  await b.close()

  // Y queda elegido /m para el equipo: una pestaña nueva vuelve a caer en /m.
  const c = await context.newPage()
  await c.goto('/ventas')
  await expect(c).toHaveURL(/\/m$/)
  await expect(c.getByTestId('m-shell')).toBeVisible()
})

test('un mozo en el celular NO va a /m (no puede cobrar); si entra a /m, se le dice', async ({ page }) => {
  test.skip(!hasWaiterCreds(), 'sin credenciales de mozo en local.config')
  await entrar(page, waiterCreds(), /\/ventas$/)
  await page.goto('/m')
  await expect(page.getByTestId('m-sin-permiso')).toBeVisible()
})

test('/m usa SU manifest (íconos que cargan); el escritorio conserva el de Cocina', async ({ page, request }) => {
  await entrar(page, cashierCreds())
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/movil/manifest.webmanifest')
  const man = await (await request.get('/movil/manifest.webmanifest')).json() as { start_url: string; icons: { src: string; sizes: string; purpose: string }[] }
  expect(man.start_url).toBe('/m')
  expect(man.icons.map((i) => i.purpose).sort()).toEqual(['any', 'any', 'maskable'])
  for (const i of [...man.icons.map((x) => x.src), '/movil/apple-touch-icon-180.png']) {
    const r = await request.get(i)
    expect(r.status(), i).toBe(200)
    expect(r.headers()['content-type'], i).toContain('image/png')
  }
  await page.getByTestId('m-nav-menu').click()
  await page.getByTestId('m-version-completa').click()
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.json')
})

// ── Vender ─────────────────────────────────────────────────────────────────

test('venta en EFECTIVO: con vuelto, número, y queda a nombre del cajero', async ({ page }) => {
  await turnoAbierto()
  await entrar(page, cashierCreds())
  await agregar(page, 'Lab Cerveza')
  await agregar(page, 'Lab Cerveza')
  await expect(page.getByTestId('m-carrito-total')).toContainText('16.000')
  await page.getByTestId('m-carrito-abrir').click()
  await page.getByTestId('m-pagar-cash').click()
  await expect(page.getByTestId('m-recibido')).toHaveAttribute('inputmode', 'decimal')
  await page.getByTestId('m-recibido').fill('20000')
  await expect(page.getByTestId('m-vuelto')).toContainText('4.000')
  await page.getByTestId('m-confirmar').click()
  await expect(page.getByTestId('m-exito-vuelto')).toContainText('4.000')
  const numero = Number(((await page.getByTestId('m-exito-numero').textContent()) ?? '').replace(/\D/g, ''))
  const fila = psql(`select o.created_by || '|' || o.type || '|' || o.total || '|' || p.method || '|' || p.amount
                       from public.orders o join public.payments p on p.order_id = o.id
                      where o.restaurant_id = '${SEDE}' and o.order_number = ${numero};`)
  expect(fila).toBe(`${CAJERO_ID}|takeaway|16000.00|cash|16000.00`)
})

test('faltan pesos: con menos de lo que vale, NO deja cobrar', async ({ page }) => {
  await turnoAbierto()
  await entrar(page, cashierCreds())
  await agregar(page, 'Lab Cerveza')
  await page.getByTestId('m-carrito-abrir').click()
  await page.getByTestId('m-pagar-cash').click()
  await page.getByTestId('m-recibido').fill('5000')
  await expect(page.getByTestId('m-vuelto')).toContainText('Faltan')
  await expect(page.getByTestId('m-confirmar')).toBeDisabled()
  await page.getByTestId('m-recibido').fill('')
  await expect(page.getByTestId('m-confirmar')).toBeEnabled()        // vacío = exacto
  await page.getByTestId('m-hoja-volver').click()
  await page.getByTestId('m-hoja-volver').click()
})

test('NEQUI con QR configurado: el QR se ve; sin QR, el botón funciona igual', async ({ page }) => {
  await turnoAbierto()
  ponerConfig('nequi_qr_url', 'http://localhost:5180/movil/icon-512.png')
  await entrar(page, cashierCreds())
  await agregar(page, 'Lab Cerveza')
  await page.getByTestId('m-carrito-abrir').click()
  await page.getByTestId('m-pagar-nequi').click()
  await expect(page.getByTestId('m-nequi-qr')).toBeVisible()
  await expect(page.getByTestId('m-nequi-qr')).toHaveAttribute('src', 'http://localhost:5180/movil/icon-512.png')
  await page.getByTestId('m-confirmar').click()
  await expect(page.getByTestId('m-exito')).toContainText('Nequi')
  await page.getByTestId('m-nueva-venta').click()

  quitarConfig('nequi_qr_url')
  await page.reload()
  await agregar(page, 'Lab Cerveza')
  await page.getByTestId('m-carrito-abrir').click()
  await page.getByTestId('m-pagar-nequi').click()
  await expect(page.getByTestId('m-nequi-sin-qr')).toBeVisible()
  await expect(page.getByTestId('m-nequi-qr')).toHaveCount(0)
  await page.getByTestId('m-confirmar').click()
  await expect(page.getByTestId('m-exito')).toBeVisible()
  await page.getByTestId('m-nueva-venta').click()
})

test('sin turno: se puede armar el carrito pero NO cobrar, y se dice por qué', async ({ page }) => {
  await sinTurno()
  await entrar(page, cashierCreds())
  await expect(page.getByTestId('m-turno')).toHaveAttribute('data-abierto', 'no')
  await agregar(page, 'Lab Cerveza')
  await page.getByTestId('m-carrito-abrir').click()
  await expect(page.getByTestId('m-sin-turno')).toBeVisible()
  await expect(page.getByTestId('m-pagar-cash')).toBeDisabled()
  await expect(page.getByTestId('m-pagar-nequi')).toBeDisabled()
  await page.getByTestId('m-hoja-volver').click()
})

test('los botones de cobro quedan DENTRO de la pantalla (no bajo la barra de inicio)', async ({ page }) => {
  await turnoAbierto()
  await entrar(page, cashierCreds())
  await agregar(page, 'Lab Cerveza')
  const alto = page.viewportSize()!.height
  const abrir = await page.getByTestId('m-carrito-abrir').boundingBox()
  expect(abrir!.y + abrir!.height).toBeLessThanOrEqual(alto)
  await page.getByTestId('m-carrito-abrir').click()
  for (const id of ['m-pagar-cash', 'm-pagar-nequi']) {
    const b = await page.getByTestId(id).boundingBox()
    expect(b!.y + b!.height, id).toBeLessThanOrEqual(alto)
    expect(b!.height, `${id}: blanco para el pulgar`).toBeGreaterThanOrEqual(56)
  }
  await page.getByTestId('m-pagar-cash').click()
  const c = await page.getByTestId('m-confirmar').boundingBox()
  expect(c!.y + c!.height).toBeLessThanOrEqual(alto)
})

test('producto con EXTRAS: hoja propia dentro de la pantalla, subtotal, y el extra llega a la venta', async ({ page }) => {
  await turnoAbierto()
  await entrar(page, cashierCreds())
  await page.getByTestId('m-buscar').fill('Lab Coctel')
  await page.getByTestId('m-productos').getByTestId('m-producto').filter({ hasText: 'Lab Coctel' }).first().click()
  await expect(page.getByTestId('m-extras')).toBeVisible()
  await expect(page.getByTestId('item-config-modal')).toHaveCount(0)        // no el modal del escritorio
  await expect(page.getByTestId('m-extras-subtotal')).toContainText('18.000')
  await page.getByTestId('m-extra-mas').first().click()
  await expect(page.getByTestId('m-extra-qty').first()).toHaveText('1')
  await expect(page.getByTestId('m-extras-subtotal')).toContainText('24.000')
  const alto = page.viewportSize()!.height
  const b = await page.getByTestId('m-extras-confirmar').boundingBox()
  expect(b!.y + b!.height, 'el botón de agregar queda dentro de la pantalla').toBeLessThanOrEqual(alto)
  await page.getByTestId('m-extras-confirmar').click()
  await expect(page.getByTestId('m-extras')).toHaveCount(0)
  await expect(page.getByTestId('m-carrito-total')).toContainText('24.000')
  const numero = await cobrar(page, 'cash')
  expect(psql(`select string_agg(e.name || ' x' || ie.qty || ' @' || ie.unit_price, ', ')
                 from public.orders o join public.order_items i on i.order_id = o.id
                 join public.order_item_extras ie on ie.order_item_id = i.id join public.extras e on e.id = ie.extra_id
                where o.restaurant_id = '${SEDE}' and o.order_number = ${numero};`)).toBe('Lab Doble x1 @6000.00')
})

// ── Más vendidos y fijados ─────────────────────────────────────────────────

test('FIJADOS arriba de todo, con estrella; un id inválido se ignora sin romper', async ({ page }) => {
  ponerConfig('pos_movil', { fijados: ['no-es-un-uuid', COCTEL], mas_vendidos: { cantidad: 4, dias: 30 } })
  await entrar(page, cashierCreds())
  const primero = page.getByTestId('m-destacados').getByTestId('m-producto').first()
  await expect(primero).toHaveAttribute('data-producto-id', COCTEL)
  await expect(primero.getByLabel('Fijado')).toBeVisible()
  // Contraste: sin fijados, el primero ya no es necesariamente el coctel ni lleva estrella.
  quitarConfig('pos_movil')
  await page.reload()
  await expect(page.getByTestId('m-destacados').getByLabel('Fijado')).toHaveCount(0)
})

// ── Mis ventas ─────────────────────────────────────────────────────────────

test('MIS VENTAS: solo lo que cobró ESTE usuario en ESTE turno, por método — contra la base', async ({ page }) => {
  // Turno nuevo: la venta del dueño en el mismo turno y las del turno anterior NO cuentan.
  await turnoAbierto()
  await sinTurno()
  await turnoAbierto()
  // Venta del DUEÑO en el mismo turno (no es del cajero).
  const ajena = await owner.rpc('register_pos_sale', {
    p_sale_id: crypto.randomUUID(), p_order: { type: 'takeaway', total: 8000 },
    p_items: [{ product_id: psql(`select id from public.products where restaurant_id = '${SEDE}' and name = 'Lab Cerveza';`), qty: 1, unit_price: 8000, extras: [] }],
    p_payments: [{ method: 'cash', amount: 8000 }],
  })
  expect(ajena.error, ajena.error?.message).toBeNull()

  await entrar(page, cashierCreds())
  await page.getByTestId('m-nav-ventas').click()
  await expect(page.getByTestId('m-mis-cantidad')).toHaveText('0')
  await expect(page.getByTestId('m-mis-efectivo')).toContainText('0')

  await page.getByTestId('m-nav-vender').click()
  await agregar(page, 'Lab Cerveza')
  await cobrar(page, 'cash')
  await agregar(page, 'Lab Cerveza')
  await agregar(page, 'Lab Cerveza')
  await cobrar(page, 'nequi')
  await agregar(page, 'Lab Cerveza')
  await cobrar(page, 'card')

  await page.getByTestId('m-nav-ventas').click()
  await expect(page.getByTestId('m-mis-cantidad')).toHaveText('3')
  await expect(page.getByTestId('m-mis-efectivo')).toContainText('8.000')
  await expect(page.getByTestId('m-mis-nequi')).toContainText('16.000')
  await expect(page.getByTestId('m-mi-venta')).toHaveCount(3)

  // R4: lo que muestra la pantalla contra una consulta independiente a la base.
  const [, abierto] = turnoActual().split('|')
  const base = psql(`select count(distinct o.id) || '|' || coalesce(sum(p.amount) filter (where p.method = 'cash'), 0) || '|' || coalesce(sum(p.amount) filter (where p.method = 'nequi'), 0)
                       from public.payments p join public.orders o on o.id = p.order_id
                      where p.restaurant_id = '${SEDE}' and p.created_at >= '${abierto}' and o.created_by = '${CAJERO_ID}';`)
  expect(base).toBe('3|8000.00|16000.00')
})

// ── Equipo ─────────────────────────────────────────────────────────────────

test('sin Wake Lock (iOS viejo / app instalada): avisa que la pantalla se puede apagar y vende igual', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'wakeLock', { get: () => undefined, configurable: true }); delete (Navigator.prototype as { wakeLock?: unknown }).wakeLock })
  await turnoAbierto()
  await entrar(page, cashierCreds())
  await expect(page.getByTestId('m-pantalla-aviso')).toBeVisible()
  await agregar(page, 'Lab Cerveza')
  await cobrar(page, 'cash')
})

test('CON Wake Lock concedido: no hay aviso (contraste)', async ({ page }) => {
  await page.addInitScript(() => {
    const sentinel = { released: false, type: 'screen', release: async () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined }
    Object.defineProperty(Navigator.prototype, 'wakeLock', { get: () => ({ request: async () => sentinel }), configurable: true })
  })
  await entrar(page, cashierCreds())
  await expect(page.getByTestId('m-shell')).toBeVisible()
  await expect(page.getByTestId('m-pantalla-aviso')).toHaveCount(0)
})

test('Wake Lock RECHAZADO por el equipo: avisa, no rompe', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'wakeLock', { get: () => ({ request: async () => { throw new Error('NotAllowedError') } }), configurable: true })
  })
  await entrar(page, cashierCreds())
  await expect(page.getByTestId('m-pantalla-aviso')).toHaveAttribute('data-estado', 'rechazada')
})

test('instrucción de "Agregar a inicio": en Safari de iPhone UNA vez; en Android no', async ({ page }, info) => {
  await entrar(page, cashierCreds())
  if (info.project.name === 'm-iphone') {
    await expect(page.getByTestId('m-ayuda-ios')).toBeVisible()
    await page.getByTestId('m-ayuda-ios-cerrar').click()
    await page.reload()
    await expect(page.getByTestId('m-shell')).toBeVisible()
    await expect(page.getByTestId('m-ayuda-ios')).toHaveCount(0)
  } else {
    await expect(page.getByTestId('m-shell')).toBeVisible()
    await expect(page.getByTestId('m-ayuda-ios')).toHaveCount(0)
  }
})

// ── Reintento ──────────────────────────────────────────────────────────────
// serviceWorkers 'block': en WebKit, page.route NO ve los pedidos de una página
// controlada por el service worker (public/sw.js), aunque el SW los deje pasar
// sin tocarlos (la API es de otro origen). Medido 2026-10-04: en m-iphone el
// POST salió directo, 200, sin pasar por la ruta. Es una limitación de la
// herramienta, no de la app; en Chromium la ruta lo ve con o sin SW.
test.describe('reintento', () => {
test.use({ serviceWorkers: 'block' })

test('se pierde la respuesta del cobro y el vendedor reintenta: UNA venta, y se le avisa', async ({ page }) => {
  await turnoAbierto()
  const ids: string[] = []
  let primera = true
  await page.route('**/rest/v1/rpc/register_pos_sale', async (route) => {
    ids.push((route.request().postDataJSON() as { p_sale_id: string }).p_sale_id)
    if (primera) { primera = false; await route.fetch(); await route.abort('connectionreset'); return }
    await route.continue()
  })
  await entrar(page, cashierCreds())
  await agregar(page, 'Lab Cerveza')
  await page.getByTestId('m-carrito-abrir').click()
  await page.getByTestId('m-pagar-cash').click()
  await page.getByTestId('m-confirmar').click()
  await expect(page.getByText(/No se cobró/)).toBeVisible({ timeout: 15_000 })
  expect(psql(`select count(*) from public.orders where id = '${ids[0]}';`), 'el primer intento llegó a la base').toBe('1')
  await page.getByTestId('m-confirmar').click()
  await expect(page.getByTestId('m-ya-existia')).toBeVisible({ timeout: 15_000 })
  expect(ids).toHaveLength(2)
  expect(ids[1]).toBe(ids[0])
  expect(psql(`select count(*) from public.payments where order_id = '${ids[0]}';`)).toBe('1')
  await page.getByTestId('m-nueva-venta').click()
})

test('A pierde la respuesta y cierra sesión; B entra en la MISMA pestaña con el mismo carrito: B hace SU venta', async ({ page }) => {
  // El id pendiente vive en la pestaña. Sin el usuario en la huella, B
  // reenviaría el id de A y recibiría la venta de A (ya_existia) a nombre de A.
  await turnoAbierto()
  const ids: string[] = []
  let primera = true
  await page.route('**/rest/v1/rpc/register_pos_sale', async (route) => {
    ids.push((route.request().postDataJSON() as { p_sale_id: string }).p_sale_id)
    if (primera) { primera = false; await route.fetch(); await route.abort('connectionreset'); return }
    await route.continue()
  })
  await entrar(page, cashierCreds())
  await agregar(page, 'Lab Cerveza')
  await page.getByTestId('m-carrito-abrir').click()
  await page.getByTestId('m-pagar-cash').click()
  await page.getByTestId('m-confirmar').click()
  await expect(page.getByText(/No se cobró/)).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('m-hoja-volver').click()
  await page.getByTestId('m-hoja-volver').click()
  await page.getByTestId('m-nav-menu').click()
  await page.getByTestId('m-salir').click()
  await expect(page).toHaveURL(/\/login$/)

  // SIN recargar: la misma pestaña, con el id pendiente de A todavía en memoria.
  // (Con page.goto el test pasaba aun sin el usuario en la huella: el mutante
  // sobrevivió el 2026-10-04 porque la recarga borraba el pendiente.)
  await entrar(page, ownerCreds(), /\/m$/, false)
  await agregar(page, 'Lab Cerveza')
  await page.getByTestId('m-carrito-abrir').click()
  await page.getByTestId('m-pagar-cash').click()
  await page.getByTestId('m-confirmar').click()
  await expect(page.getByTestId('m-exito')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('m-ya-existia')).toHaveCount(0)
  expect(ids).toHaveLength(2)
  expect(ids[1], 'B reenvió el id pendiente de A').not.toBe(ids[0])
  expect(psql(`select created_by from public.orders where id = '${ids[0]}';`)).toBe(CAJERO_ID)
  expect(psql(`select created_by from public.orders where id = '${ids[1]}';`)).toBe(OWNER_ID)
  await page.getByTestId('m-nueva-venta').click()
})
})
