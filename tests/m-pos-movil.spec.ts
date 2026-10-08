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
  await page.locator('input[type="email"]').fill(creds.email)
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

/** Manifests del DOCUMENTO cargado y la URL con la que se cargó (no navegación interna). */
async function documento(page: Page) {
  return page.evaluate(() => ({
    manifests: [...document.querySelectorAll('link[rel="manifest"]')].map((l) => l.getAttribute('href')),
    iconoApple: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href') ?? null,
    cargadoEn: new URL((performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming).name).pathname,
  }))
}

test('cada ruta trae SU documento: /m solo su manifest, /cocina solo el del KDS, el resto ninguno', async ({ request }) => {
  const html = async (ruta: string) => (await request.get(ruta, { headers: { accept: 'text/html' } })).text()
  const manifests = (h: string) => [...h.matchAll(/rel="manifest" href="([^"]+)"/g)].map((m) => m[1])
  for (const ruta of ['/m', '/m/ventas']) {
    const h = await html(ruta)
    expect(manifests(h), ruta).toEqual(['/movil/manifest.webmanifest'])
    expect(h, ruta).toContain('href="/movil/apple-touch-icon-180.png"')
  }
  expect(manifests(await html('/cocina'))).toEqual(['/manifest.json'])
  for (const ruta of ['/ventas', '/mesas', '/login', '/']) expect(manifests(await html(ruta)), ruta).toEqual([])

  const man = await (await request.get('/movil/manifest.webmanifest')).json() as { start_url: string; scope: string; icons: { src: string; purpose: string }[] }
  expect([man.start_url, man.scope]).toEqual(['/m', '/m'])
  expect(man.icons.map((i) => i.purpose).sort()).toEqual(['any', 'any', 'maskable'])
  for (const i of [...man.icons.map((x) => x.src), '/movil/apple-touch-icon-180.png']) {
    const r = await request.get(i)
    expect(r.status(), i).toBe(200)
    expect(r.headers()['content-type'], i).toContain('image/png')
  }
})

test('entrar a /m después del login es una CARGA del documento de /m (no navegación interna); salir también', async ({ page }) => {
  await entrar(page, cashierCreds())
  // El iPhone toma el manifest del DOCUMENTO: tiene que ser el de /m, cargado en /m.
  expect(await documento(page)).toEqual({ manifests: ['/movil/manifest.webmanifest'], iconoApple: '/movil/apple-touch-icon-180.png', cargadoEn: '/m' })
  await page.getByTestId('m-nav-menu').click()
  await page.getByTestId('m-version-completa').click()
  await expect(page).toHaveURL(/\/ventas$/)
  await expect.poll(async () => (await documento(page)).cargadoEn).toBe('/ventas')
  expect((await documento(page)).manifests).toEqual([])
  await page.getByTestId('app-usar-movil').click()
  await expect(page).toHaveURL(/\/m$/)
  await expect.poll(async () => (await documento(page)).cargadoEn).toBe('/m')
  expect((await documento(page)).manifests).toEqual(['/movil/manifest.webmanifest'])
})

// ── Login en el celular (iPhone 16 Pro Max, 2026-10-07: no estaba pensado para
// el celular). El escritorio no cambia: se comparó píxel a píxel contra capturas
// de antes. Anchos del pedido: 360 a 430 px.
test.describe('login en el celular', () => {
  for (const ancho of [360, 390, 430]) {
    test(`${ancho} px: sin desborde, campos de 16 px, autocompletado, ver la clave y "Ingresar" usable`, async ({ page }) => {
      await page.setViewportSize({ width: ancho, height: 800 })
      await page.goto('/login')
      const correo = page.locator('#login-correo')
      const clave = page.locator('#login-clave')
      await expect(correo).toBeVisible()

      // Sin desborde horizontal y cada campo entero dentro del ancho.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      for (const campo of [correo, clave, page.getByTestId('login-entrar')]) {
        const c = (await campo.boundingBox())!
        expect(c.x >= 0 && c.x + c.width <= ancho, 'un campo se sale del ancho').toBe(true)
      }
      // Letra de 16 px o más: con menos, Safari del iPhone hace zoom al tocar.
      for (const campo of [correo, clave]) {
        expect(parseFloat(await campo.evaluate((e) => getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16)
      }
      // Teclado y contraseñas guardadas del iPhone y de Android.
      await expect(correo).toHaveAttribute('type', 'email')
      await expect(correo).toHaveAttribute('inputmode', 'email')
      await expect(correo).toHaveAttribute('autocomplete', 'username')
      await expect(correo).toHaveAttribute('autocapitalize', 'none')
      await expect(clave).toHaveAttribute('autocomplete', 'current-password')
      // Mostrar / ocultar la contraseña (con contraste: vuelve a ocultarse).
      const ojo = page.getByTestId('login-ver-clave')
      await expect(clave).toHaveAttribute('type', 'password')
      await ojo.click()
      await expect(clave).toHaveAttribute('type', 'text')
      await expect(ojo).toHaveAttribute('aria-pressed', 'true')
      await ojo.click()
      await expect(clave).toHaveAttribute('type', 'password')
      expect((await ojo.boundingBox())!.height, 'el ojo es chico para el pulgar').toBeGreaterThanOrEqual(44)

      // "Ingresar": al menos 44 px, entero en pantalla, arriba de todo y tocable sin forzar.
      await correo.fill(cashierCreds().email)
      await clave.fill(cashierCreds().password)
      const entrar = page.getByTestId('login-entrar')
      expect((await entrar.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      await usable(page, 'login-entrar', true)
      await entrar.click()
      await expect(page).toHaveURL(/\/m$/, { timeout: 15_000 })
      await expect(page.getByTestId('m-shell')).toBeVisible()
    })
  }

  test('con el teclado abierto, "Ingresar" queda a la vista (se desplaza solo)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 })
    await page.goto('/login')
    await page.locator('#login-correo').fill('alguien@ejemplo.com')
    await page.locator('#login-clave').fill('x')
    await page.locator('#login-clave').focus()
    // El teclado achica el viewport visible. Acá se simula achicando la ventana: es un
    // proxy (en el equipo real lo que cambia es visualViewport); lo real va en la lista
    // de verificación de equipos.
    await page.setViewportSize({ width: 390, height: 330 })
    await expect.poll(async () => {
      const b = (await page.getByTestId('login-entrar').boundingBox())!
      const vv = await page.evaluate(() => ({ top: window.visualViewport!.offsetTop, h: window.visualViewport!.height }))
      return b.y >= -0.5 && b.y + b.height <= vv.h + 0.5
    }, { timeout: 3000 }).toBe(true)
  })

  test('el mensaje de error se ve completo', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 })
    await page.goto('/login')
    await page.locator('#login-correo').fill('nadie@ejemplo.com')
    await page.locator('#login-clave').fill('clave-incorrecta')
    await page.getByTestId('login-entrar').click()
    const error = page.getByRole('alert')
    await expect(error).toContainText('Credenciales incorrectas')
    await expect(error).toContainText('Verifica tu correo y contraseña e intenta de nuevo.')
    const c = (await error.boundingBox())!
    expect(c.x >= 0 && c.x + c.width <= 360, 'el error se sale del ancho').toBe(true)
    // Ningún texto del error queda cortado (su contenido no es más ancho que su caja).
    expect(await error.evaluate((e) => [...e.querySelectorAll('div')].every((d) => d.scrollWidth <= d.clientWidth + 1))).toBe(true)
  })
})

// ── Vender ───────────────────────────────────────────────────────────────

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

// ── Nada nuestro tapa la acción principal (medido en un iPhone 16 Pro Max el ─
// 2026-10-05: la barra inferior tapaba Cobrar, Confirmar y Agregar; el aviso de
// instalación tapaba el primer ítem, el monto y el ícono de venta exitosa). Los
// tests anteriores medían la barra de inicio del iPhone y el teclado: un proxy.
type Caja = { x: number; y: number; width: number; height: number }
const seCruzan = (a: Caja, b: Caja) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
// Lo nuestro que puede tapar algo: barra inferior, avisos y aviso de versión.
const NUESTRO = ['m-nav', 'm-ayuda-ios', 'm-aviso-instalar', 'm-pantalla-aviso', 'version-nueva']

/**
 * (a) entero dentro del viewport VISIBLE; (b) su caja no se cruza con nada de
 * NUESTRO que esté visible; (c) arriba de todo en su centro (lo que se tocaría);
 * (d) solo botones de acción: sin un ancestro con scroll (un fixed adentro de un
 * contenedor con scroll es lo que el iPhone apila y recorta distinto).
 * El click real lo hace el test después, sin force.
 */
async function usable(page: Page, testid: string, accion: boolean) {
  const el = page.getByTestId(testid).first()
  await expect(el, testid).toBeVisible()
  const c = (await el.boundingBox())!
  const vv = await page.evaluate(() => {
    const v = window.visualViewport!
    return { x: v.offsetLeft, y: v.offsetTop, w: v.width, h: v.height }
  })
  expect(c.x >= vv.x - 0.5 && c.y >= vv.y - 0.5 && c.x + c.width <= vv.x + vv.w + 0.5 && c.y + c.height <= vv.y + vv.h + 0.5,
    `(a) ${testid} no está entero dentro del viewport visible`).toBe(true)
  for (const otro of NUESTRO) {
    const o = page.getByTestId(otro)
    if (await o.count() && await o.first().isVisible()) {
      expect(seCruzan(c, (await o.first().boundingBox())!), `(b) ${testid} se cruza con ${otro}`).toBe(false)
    }
  }
  expect(await el.evaluate((e) => {
    const r = e.getBoundingClientRect()
    const arriba = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return !!arriba && (arriba === e || e.contains(arriba))
  }), `(c) algo tapa el centro de ${testid}`).toBe(true)
  if (accion) {
    expect(await el.evaluate((e) => {
      for (let a = e.parentElement; a; a = a.parentElement) {
        const o = getComputedStyle(a).overflowY
        if (o === 'auto' || o === 'scroll') return `${a.tagName}${a.dataset.testid ? '#' + a.dataset.testid : ''}`
      }
      return null
    }), `(d) ${testid} está adentro de un contenedor con scroll`).toBeNull()
  }
}

/** Muestra TODOS los avisos nuestros a la vez: versión nueva y, en Android, "Instalar". */
async function conAvisos(page: Page, info: { project: { name: string } }) {
  await page.route('**/version.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"version":"otra"}' }))
  await entrar(page, cashierCreds())
  await expect(page.getByTestId('version-nueva')).toBeVisible()
  if (info.project.name === 'm-android') {
    await page.evaluate(() => {
      const e = Object.assign(new Event('beforeinstallprompt'), { prompt: async () => undefined, userChoice: Promise.resolve({ outcome: 'dismissed' }) })
      window.dispatchEvent(e)
    })
    await expect(page.getByTestId('m-aviso-instalar')).toBeVisible()
  } else {
    await expect(page.getByTestId('m-ayuda-ios')).toBeVisible()
  }
}

test.describe('nada nuestro tapa la acción principal', () => {
  // serviceWorkers 'block': conAvisos fuerza el aviso de versión con page.route sobre
  // /version.json, y en WebKit page.route no ve los pedidos de una página controlada por
  // el service worker (medido 2026-10-04, ver "reintento"). Lo que se mide acá es la
  // disposición de la pantalla, que no depende del service worker.
  test.use({ serviceWorkers: 'block' })
  test('Vender → carrito → EFECTIVO → venta exitosa', async ({ page }, info) => {
    await turnoAbierto()
    await conAvisos(page, info)
    await usable(page, 'm-producto', false)                     // contenido bajo los avisos
    await agregar(page, 'Lab Cerveza')
    await usable(page, 'm-carrito-abrir', true)
    await page.getByTestId('m-carrito-abrir').click()
    await usable(page, 'm-item', false)                         // primer ítem del carrito
    await usable(page, 'm-pagar-cash', true)
    await usable(page, 'm-pagar-nequi', true)
    await page.getByTestId('m-pagar-cash').click()
    await usable(page, 'm-recibido', false)                     // el campo del monto
    await usable(page, 'm-confirmar', true)
    await page.getByTestId('m-confirmar').click()
    await expect(page.getByTestId('m-exito')).toBeVisible({ timeout: 15_000 })
    await usable(page, 'm-exito-icono', false)
    await usable(page, 'm-nueva-venta', true)
    await page.getByTestId('m-nueva-venta').click()
    // Al cerrar la capa, la barra y los avisos vuelven.
    await expect(page.getByTestId('m-nav')).toBeVisible()
    await expect(page.getByTestId('version-nueva')).toBeVisible()
  })

  test('cobro en NEQUI', async ({ page }, info) => {
    await turnoAbierto()
    await conAvisos(page, info)
    await agregar(page, 'Lab Cerveza')
    await page.getByTestId('m-carrito-abrir').click()
    await page.getByTestId('m-pagar-nequi').click()
    await usable(page, 'm-confirmar', true)
    await page.getByTestId('m-confirmar').click()
    await expect(page.getByTestId('m-exito')).toBeVisible({ timeout: 15_000 })
    await usable(page, 'm-nueva-venta', true)
    await page.getByTestId('m-nueva-venta').click()
  })

  test('hoja de EXTRAS', async ({ page }, info) => {
    await turnoAbierto()
    await conAvisos(page, info)
    await page.getByTestId('m-buscar').fill('Lab Coctel')
    await page.getByTestId('m-productos').getByTestId('m-producto').filter({ hasText: 'Lab Coctel' }).first().click()
    await usable(page, 'm-extra', false)
    await usable(page, 'm-extras-confirmar', true)
    await page.getByTestId('m-extras-confirmar').click()
    await expect(page.getByTestId('m-extras')).toHaveCount(0)
    await usable(page, 'm-carrito-abrir', true)
  })
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
  // ⚠️ R10 — ESTE TEST YA NO DISTINGUE ESE MUTANTE (medido 2026-10-05): desde que
  // entrar a /m recarga la página (manifest por documento), el login de B pasa por
  // una carga completa que vacía el id pendiente. Queda como prueba del resultado; la
  // que distingue el mutante es la del POS de escritorio, donde cerrar sesión y
  // volver a entrar NO recarga (tests/pos-sale-lotes.spec.ts › "POS escritorio: A
  // pierde la respuesta…").
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
