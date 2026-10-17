import { test, expect, type Page, type Request } from '@playwright/test'
import { ownerCreds } from './helpers/auth'
import { cliente, psql } from './helpers/db-local'

// ============================================================================
// Pedidos en línea, P2 parte 4: las pantallas del cliente (pedido.html).
//   · Pantalla 1: el menú, la hoja de adiciones y el botón "Ver mi pedido" con el subtotal del SERVIDOR.
//   · Pantalla 2: el pedido, el punto (mi ubicación / mapa), quién recibe y los totales del servidor.
//   · Pantalla 2b: fuera de zona → "Todavía no llegamos", cambiar la dirección y WhatsApp del local.
//   · 🔴 El navegador cotiza SOLO al cambiar el carrito o el punto (decisión del 2026-10-17): se cuentan
//     las consultas `cotizar`, con contraste (escribir datos no cotiza; cambiar una cantidad sí).
//   · Los datos de quien recibe no salen del navegador; "Recordar mis datos" los deja solo ahí.
// Los precios y la zona los prueba portal-publico.spec.ts contra el servidor; aquí, lo que se VE.
// ============================================================================

const SLUG = 'e2e-p4-lab'
const CENTRO = { lat: 3.45, lng: -76.53 }
const A_1500 = { latitude: 3.4635, longitude: -76.53 }   // en zona, tramo 2 (envío 4.000)
const A_3000 = { latitude: 3.477, longitude: -76.53 }    // fuera del radio de 2 km
const HORARIO_TODO_EL_DIA = Object.fromEntries(['1', '2', '3', '4', '5', '6', '7'].map((d) => [d, [['00:00', '12:00'], ['12:00', '00:00']]]))
const CLAVE_DATOS = 'gvento-portal-datos'

let SEDE = ''
let OWNER = ''
let TURNO_PROPIO = ''
const id: Record<string, string> = {}
const insertarId = (sql: string) => psql(sql).split(/\r?\n/)[0].trim()

function restablecer() {
  psql(`
    delete from public.portal_limites;
    update public.portal_sedes set lat = ${CENTRO.lat}, lng = ${CENTRO.lng}, zona_tipo = 'radio', zona_radio_m = 2000,
           envio_tipo = 'distancia', envio_fijo = null,
           envio_tramos = '[{"hasta_km": 1, "valor": 2000}, {"hasta_km": null, "valor": 4000}]',
           pedido_minimo = 15000, tiempo_min = 25, tiempo_max = 45, color = '#aa3300', whatsapp = '573155550101', pausado = false
     where restaurant_id = '${SEDE}';
    update public.products set stock_qty = 5 where id = '${id.gaseosa}';`)
}

test.beforeAll(async () => {
  const o = await cliente(ownerCreds()); SEDE = o.sede; OWNER = o.uid
  psql(`delete from public.portal_productos where restaurant_id = '${SEDE}';
        delete from public.portal_sedes where restaurant_id = '${SEDE}' or slug = '${SLUG}';`)
  id.cat = insertarId(`insert into public.categories (name, restaurant_id, sort_order) values ('E2E P4 Comidas', '${SEDE}', 1) returning id;`)
  id.perro = insertarId(`insert into public.products (name, price, restaurant_id, category_id) values ('E2E P4 Perro', 10000, '${SEDE}', '${id.cat}') returning id;`)
  id.gaseosa = insertarId(`insert into public.products (name, price, restaurant_id, category_id, stock_tracking, stock_qty)
     values ('E2E P4 Gaseosa', 3000, '${SEDE}', '${id.cat}', true, 5) returning id;`)
  id.queso = insertarId(`insert into public.extras (name, price, restaurant_id) values ('E2E P4 Queso', 2000, '${SEDE}') returning id;`)
  psql(`insert into public.product_extras (product_id, extra_id) values ('${id.perro}', '${id.queso}');
        insert into public.portal_sedes (restaurant_id, slug, horario) values ('${SEDE}', '${SLUG}', '${JSON.stringify(HORARIO_TODO_EL_DIA)}');
        insert into public.portal_productos (product_id, restaurant_id, publicado, precio_domicilio) values
          ('${id.perro}', '${SEDE}', true, 12000), ('${id.gaseosa}', '${SEDE}', true, null);`)
  restablecer()
  psql(`update public.portal_sedes set activo = true where restaurant_id = '${SEDE}';`)
  if (psql(`select count(*) from public.cash_shifts where restaurant_id = '${SEDE}' and closed_at is null;`) === '0') {
    TURNO_PROPIO = insertarId(`insert into public.cash_shifts (restaurant_id, opened_by, opening_amount) values ('${SEDE}', '${OWNER}', 0) returning id;`)
  }
})

test.afterAll(() => {
  if (!SEDE) return
  psql(`delete from public.portal_productos where restaurant_id = '${SEDE}';
        delete from public.portal_sedes where restaurant_id = '${SEDE}';
        delete from public.portal_limites;
        delete from public.extras where name like 'E2E P4 %';
        delete from public.products where name like 'E2E P4 %';
        delete from public.categories where name like 'E2E P4 %';
        ${TURNO_PROPIO ? `delete from public.cash_shifts where id = '${TURNO_PROPIO}';` : ''}`)
})

test.beforeEach(() => restablecer())

type Cuerpo = { accion: string; items?: unknown[]; lat?: number | null; lng?: number | null }
/** Todo lo que el navegador le manda a la función `portal` (sin los preflight). */
function escuchar(page: Page): Cuerpo[] {
  const cuerpos: Cuerpo[] = []
  page.on('request', (r: Request) => {
    if (r.method() === 'POST' && r.url().includes('/functions/v1/portal')) cuerpos.push(r.postDataJSON() as Cuerpo)
  })
  return cuerpos
}
const cotizaciones = (c: Cuerpo[]) => c.filter((x) => x.accion === 'cotizar')

async function agregarPerroConQueso(page: Page) {
  await page.getByTestId(`pedido-agregar-${id.perro}`).click()
  await page.getByTestId(`pedido-extra-${id.queso}`).check()
  await page.getByTestId('pedido-hoja-agregar').click()
}

async function llenarDatos(page: Page) {
  await page.getByTestId('pedido-direccion').fill('Cra. 24 # 9-35, San Fernando')
  await page.getByTestId('pedido-indicaciones').fill('Portón negro')
  await page.getByTestId('pedido-nombre').fill('Laura Prueba')
  await page.getByTestId('pedido-celular').fill('300 123 4567')
}

test.describe('Pedidos en línea · pantallas del cliente', () => {
  test('menú y carrito: el subtotal lo pone el servidor y solo se cotiza al cambiar el carrito', async ({ page }) => {
    const cuerpos = escuchar(page)
    const pedidas: string[] = []
    const todo: string[] = []   // TODAS las peticiones del navegador: URL y cuerpo
    page.on('request', (r: Request) => { pedidas.push(r.url()); todo.push(`${r.url()} ${r.postData() ?? ''}`) })
    await page.goto(`/pedir/${SLUG}`)
    await expect(page.getByTestId(`pedido-item-${id.perro}`)).toContainText('12.000')

    // La hoja de adiciones: el foco entra al abrir, Escape la cierra y el foco vuelve al botón.
    await page.getByTestId(`pedido-agregar-${id.perro}`).click()
    await expect(page.getByTestId('pedido-hoja').getByRole('button', { name: 'Cerrar' }), 'el foco entra a la hoja').toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('pedido-hoja')).toHaveCount(0)
    await expect(page.getByTestId(`pedido-agregar-${id.perro}`)).toBeFocused()
    expect(cotizaciones(cuerpos), 'abrir el menú no cotiza').toHaveLength(0)
    const esMapa = (u: string) => /maplibre|\/src\/portal\/Mapa\.tsx/.test(u)
    expect(pedidas.filter(esMapa), 'abrir el menú no descarga el mapa').toEqual([])
    await expect(page.getByTestId('pedido-ver'), 'sin productos no hay botón').toHaveCount(0)

    await page.getByTestId(`pedido-agregar-${id.gaseosa}`).click()
    await expect(page.getByTestId('pedido-subtotal')).toHaveText(/3\.000/)
    expect(pedidas.some(esMapa), 'contraste: con el primer producto se precarga').toBe(true)
    await agregarPerroConQueso(page)
    await expect(page.getByTestId('pedido-unidades')).toHaveText('2')
    await expect(page.getByTestId('pedido-subtotal'), '3.000 + 12.000 + 2.000 de queso').toHaveText(/17\.000/)
    expect(cotizaciones(cuerpos)).toHaveLength(2)
    // Lo que se manda: QUÉ se quiere, nunca un precio (allowlist de portal_calcular).
    expect(cotizaciones(cuerpos)[1].items).toEqual([
      { product_id: id.gaseosa, cantidad: 1 },
      { product_id: id.perro, cantidad: 1, extras: [{ extra_id: id.queso, cantidad: 1 }] }])

    await page.getByTestId('pedido-ver').click()
    await expect(page.getByTestId('pedido-linea-total-1')).toHaveText(/14\.000/)
    await llenarDatos(page)
    await page.getByTestId('pedido-acepta').check()
    await page.waitForTimeout(1500)   // más que la espera de 500 ms antes de cotizar
    expect(cotizaciones(cuerpos), 'abrir el pedido y escribir los datos NO cotiza').toHaveLength(2)
    // Contraste: cambiar una cantidad SÍ cotiza, y el total de la línea es el nuevo del servidor. Mientras
    // la respuesta no llega (se retrasa a propósito), la línea no muestra el precio de la cotización vieja.
    await page.route('**/functions/v1/portal', async (r) => {
      if (r.request().method() === 'POST') await new Promise((listo) => setTimeout(listo, 1500))
      await r.continue()
    })
    await page.getByTestId('pedido-linea-mas-0').click()
    await expect(page.getByTestId('pedido-linea-total-0')).toHaveText('…')
    await expect(page.getByTestId('pedido-linea-total-0')).toHaveText(/6\.000/)
    expect(cotizaciones(cuerpos)).toHaveLength(3)
    // Tres toques seguidos (antes de la espera de 500 ms) son UNA sola consulta, con la cantidad final.
    await page.getByTestId('pedido-linea-mas-1').click()
    await page.getByTestId('pedido-linea-mas-1').click()
    await page.getByTestId('pedido-linea-mas-1').click()
    await expect(page.getByTestId('pedido-linea-total-1'), '4 × 14.000').toHaveText(/56\.000/)
    expect(cotizaciones(cuerpos)).toHaveLength(4)
    expect(cotizaciones(cuerpos)[3].items?.[1]).toMatchObject({ product_id: id.perro, cantidad: 4 })
    // Prueba de AUSENCIA (marcada, R10: no puede fallar contra un no-op): los datos de quien recibe no
    // salen del navegador en NINGUNA petición, ni en la URL ni en el cuerpo (el pedido es P3).
    expect(todo.filter((x) => /Laura|300 123|3001234567|San Fernando|Port%C3%B3n|Portón/.test(x))).toEqual([])

    // El Atrás del navegador vuelve al menú con el pedido armado.
    await page.goBack()
    await expect(page.getByTestId('pedido-unidades')).toHaveText('6')   // 2 gaseosas + 4 perros
  })

  test('mi ubicación: pone el punto y el envío; fuera de zona muestra la pantalla 2b con WhatsApp', async ({ page, context }) => {
    await context.grantPermissions(['geolocation'])
    await context.setGeolocation(A_1500)
    const cuerpos = escuchar(page)
    await page.goto(`/pedir/${SLUG}`)
    await agregarPerroConQueso(page)
    await page.getByTestId(`pedido-agregar-${id.gaseosa}`).click()
    await expect(page.getByTestId('pedido-subtotal')).toHaveText(/17\.000/)
    await page.getByTestId('pedido-ver').click()
    await expect(page.getByTestId('pedido-total-envio')).toHaveText('Marca el punto')
    await llenarDatos(page)
    await page.getByTestId('pedido-acepta').check()
    await expect(page.getByTestId('pedido-razones')).toHaveText('Para pagar falta el punto de entrega en el mapa.')
    await expect(page.getByTestId('pedido-pagar')).toBeDisabled()
    const antes = cotizaciones(cuerpos).length

    await page.getByTestId('pedido-mi-ubicacion').click()
    await expect(page.getByTestId('pedido-total-envio'), '1,5 km: segundo tramo').toHaveText(/4\.000/)
    await expect(page.getByTestId('pedido-total')).toHaveText(/21\.000/)
    expect(cotizaciones(cuerpos).length, 'el punto nuevo cotiza una vez').toBe(antes + 1)
    expect(cotizaciones(cuerpos).at(-1)).toMatchObject({ lat: A_1500.latitude, lng: A_1500.longitude })
    await expect(page.getByTestId('pedido-pagar')).toBeEnabled()
    await expect(page.getByTestId('pedido-pagar')).toHaveText(/Pagar .*21\.000/)
    await page.getByTestId('pedido-pagar').click()
    await expect(page.getByTestId('pedido-pago-pronto')).toContainText('No se te ha cobrado nada')
    await expect(page.getByTestId('pedido-fuera-de-zona'), 'contraste: en zona no hay 2b').toHaveCount(0)

    // 2b: fuera del radio.
    await context.setGeolocation(A_3000)
    await page.getByTestId('pedido-mi-ubicacion').click()
    await expect(page.getByTestId('pedido-fuera-de-zona')).toContainText('Todavía no llegamos a esta dirección')
    await expect(page.getByTestId('pedido-pagar')).toBeDisabled()
    await expect(page.getByTestId('pedido-total-envio')).toHaveText('—')
    const href = await page.getByTestId('pedido-whatsapp').getAttribute('href')
    expect(href).toMatch(/^https:\/\/wa\.me\/573155550101\?text=/)
    expect(decodeURIComponent(href!.split('text=')[1])).toContain('Cra. 24 # 9-35, San Fernando')
    await page.getByTestId('pedido-cambiar-direccion').click()
    await expect(page.getByTestId('pedido-direccion')).toBeFocused()

    // Sin WhatsApp del local, 2b no ofrece el botón (contraste con el de arriba).
    psql(`update public.portal_sedes set whatsapp = null where restaurant_id = '${SEDE}';`)
    await page.reload()
    await agregarPerroConQueso(page)
    await page.getByTestId('pedido-ver').click()
    await page.getByTestId('pedido-mi-ubicacion').click()
    await expect(page.getByTestId('pedido-fuera-de-zona')).toBeVisible()
    await expect(page.getByTestId('pedido-whatsapp')).toHaveCount(0)
  })

  test('mi ubicación sin permiso: lo dice y deja mover el mapa', async ({ page, context }) => {
    await context.clearPermissions()
    await page.goto(`/pedir/${SLUG}`)
    await page.getByTestId(`pedido-agregar-${id.gaseosa}`).click()
    await page.getByTestId('pedido-ver').click()
    await page.getByTestId('pedido-mi-ubicacion').click()
    await expect(page.getByTestId('pedido-aviso-ubicacion')).toHaveText('No tenemos permiso para ver tu ubicación. Mueve el mapa hasta el punto de entrega.')
    await expect(page.getByTestId('pedido-total-envio')).toHaveText('Marca el punto')
  })

  test('el mapa: moverlo cambia el punto y cotiza el envío desde ahí', async ({ page }) => {
    const cuerpos = escuchar(page)
    await page.goto(`/pedir/${SLUG}`)
    await page.getByTestId(`pedido-agregar-${id.gaseosa}`).click()
    await expect(page.getByTestId('pedido-subtotal')).toHaveText(/3\.000/)   // la cotización del carrito ya salió
    await page.getByTestId('pedido-ver').click()
    const mapa = page.getByTestId('pedido-mapa')
    await expect(mapa.locator('canvas')).toBeVisible()
    const caja = (await mapa.boundingBox())!
    const antes = cotizaciones(cuerpos).length
    await page.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2)
    await page.mouse.down()
    await page.mouse.move(caja.x + caja.width / 2 + 60, caja.y + caja.height / 2 + 40, { steps: 8 })
    await page.mouse.up()
    // A unos cientos de metros del local: primer tramo.
    await expect(page.getByTestId('pedido-total-envio')).toHaveText(/2\.000/)
    expect(cotizaciones(cuerpos).length).toBe(antes + 1)
    const { lat, lng } = cotizaciones(cuerpos).at(-1)!
    expect([lat !== CENTRO.lat, lng !== CENTRO.lng], 'el punto se movió desde el local').toEqual([true, true])

    // Acercar con la rueda, con el cursor lejos del centro: el zoom es alrededor del CENTRO, así que el
    // pin sigue sobre el mismo punto (el que se cotizó). Se mide con el marcador del local: su distancia
    // al centro crece, pero en la MISMA dirección. Con zoom alrededor del cursor, la dirección gira y el
    // pin queda sobre otro lugar (medido: la rueda no trae originalEvent, así que el punto no cambiaba
    // y el pin dejaba de coincidir con él).
    const marcador = page.getByTestId('pedido-mapa').locator('.maplibregl-marker')
    const centro = { x: caja.x + caja.width / 2, y: caja.y + caja.height / 2 }
    const desdeCentro = async () => { const b = (await marcador.boundingBox())!; return { x: b.x + b.width / 2 - centro.x, y: b.y + b.height - centro.y } }
    const a1 = await desdeCentro()
    await page.mouse.move(caja.x + caja.width - 70, caja.y + 30)
    await page.mouse.wheel(0, -400)
    await page.waitForTimeout(1500)   // la animación del zoom + la espera de 500 ms antes de cotizar
    const a2 = await desdeCentro()
    const largo = (v: { x: number; y: number }) => Math.hypot(v.x, v.y)
    expect(largo(a2), 'contraste: la rueda SÍ hizo zoom').toBeGreaterThan(largo(a1) * 1.2)
    expect(Math.abs(a1.x * a2.y - a1.y * a2.x) / (largo(a1) * largo(a2)), 'misma dirección: zoom alrededor del centro').toBeLessThan(0.05)
    expect(cotizaciones(cuerpos).length, 'el zoom no cotiza').toBe(antes + 1)
  })

  test('el paquete del mapa no carga: aviso, el carrito sigue y "Usar mi ubicación" funciona', async ({ page, context }) => {
    await context.grantPermissions(['geolocation'])
    await context.setGeolocation(A_1500)
    await page.route(/\/src\/portal\/Mapa\.tsx/, (r) => r.abort())
    await page.goto(`/pedir/${SLUG}`)
    await page.getByTestId(`pedido-agregar-${id.gaseosa}`).click()
    await page.getByTestId('pedido-ver').click()
    await expect(page.getByTestId('pedido-mapa-fallo')).toContainText('No pudimos cargar el mapa')
    await expect(page.getByTestId('pedido-linea-cantidad-0'), 'el pedido sigue ahí').toHaveText('1')
    await page.getByTestId('pedido-mi-ubicacion').click()
    await expect(page.getByTestId('pedido-total-envio')).toHaveText(/4\.000/)
  })

  test('cotizar falla: lo dice y "Reintentar" vuelve a pedir; líneas en otro orden: ni precios ni pago', async ({ page }) => {
    const cuerpos = escuchar(page)
    let fallar = true
    let invertir = false
    await page.route('**/functions/v1/portal', async (r) => {
      const cuerpo = r.request().method() === 'POST' ? (r.request().postDataJSON() as Cuerpo) : null
      if (cuerpo?.accion !== 'cotizar') return r.continue()
      if (fallar) { fallar = false; return r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'El servicio está ocupado. Intenta de nuevo.' }) }) }
      if (!invertir) return r.continue()
      const real = await r.fetch()
      const j = await real.json() as { lineas: unknown[] }
      return r.fulfill({ response: real, json: { ...j, lineas: [...j.lineas].reverse() } })
    })
    await page.goto(`/pedir/${SLUG}`)
    await page.getByTestId(`pedido-agregar-${id.gaseosa}`).click()
    await expect(page.getByTestId('pedido-error')).toContainText('El servicio está ocupado')
    await expect(page.getByTestId('pedido-subtotal')).toHaveText('—')
    await page.getByTestId('pedido-reintentar').click()
    await expect(page.getByTestId('pedido-subtotal')).toHaveText(/3\.000/)
    await expect(page.getByTestId('pedido-error')).toHaveCount(0)
    expect(cotizaciones(cuerpos), 'el reintento es una consulta más').toHaveLength(2)

    // Si el servidor devolviera las líneas en otro orden, la pantalla no empareja precios ajenos.
    await agregarPerroConQueso(page)
    await expect(page.getByTestId('pedido-subtotal'), 'contraste: en orden sí hay subtotal').toHaveText(/17\.000/)
    invertir = true
    await page.getByTestId('pedido-ver').click()
    await page.getByTestId('pedido-linea-mas-0').click()
    await expect.poll(() => cotizaciones(cuerpos).length).toBe(4)
    await page.waitForTimeout(500)
    await expect(page.getByTestId('pedido-linea-total-0')).toHaveText('…')
    await expect(page.getByTestId('pedido-total-subtotal')).toHaveText('…')
    await expect(page.getByTestId('pedido-pagar')).toBeDisabled()
  })

  test('stock: "no alcanza para esa cantidad" sin decir cuánto queda; agotado no se puede agregar', async ({ page }) => {
    psql(`update public.products set stock_qty = 2 where id = '${id.gaseosa}';`)
    await page.goto(`/pedir/${SLUG}`)
    await page.getByTestId(`pedido-agregar-${id.gaseosa}`).click()
    await page.getByTestId('pedido-ver').click()
    await page.getByTestId('pedido-linea-mas-0').click()
    await expect(page.getByTestId('pedido-linea-total-0'), 'contraste: 2 sí alcanzan').toHaveText(/6\.000/)
    await expect(page.getByTestId('pedido-linea-problema-0')).toHaveCount(0)
    await expect(page.getByTestId('pedido-razones'), 'pedido mínimo de 15.000').toContainText(/Te faltan .*9\.000 para el pedido mínimo\./)
    await page.getByTestId('pedido-linea-mas-0').click()
    await expect(page.getByTestId('pedido-linea-problema-0')).toHaveText('No alcanza para esa cantidad. Pide menos.')
    await expect(page.getByTestId('pedido-linea-total-0')).toHaveText('—')
    await expect(page.getByTestId('pedido-razones')).toContainText('Revisa los productos marcados en tu pedido.')
    await expect(page.getByTestId('pedido-pagar')).toBeDisabled()
    // Prueba de AUSENCIA (marcada, R10): la protección real es que el servidor no manda el número.
    expect(await page.locator('main').innerText(), 'nunca el número que queda').not.toMatch(/quedan?\s*\d|\d+\s*disponibles?/i)

    psql(`update public.products set stock_qty = 0 where id = '${id.gaseosa}';`)
    await page.goto(`/pedir/${SLUG}`)
    await expect(page.getByTestId(`pedido-item-${id.gaseosa}`)).toContainText('Agotado hoy')
    await expect(page.getByTestId(`pedido-agregar-${id.gaseosa}`)).toBeDisabled()
    await expect(page.getByTestId(`pedido-agregar-${id.perro}`), 'contraste').toBeEnabled()
  })

  test('cerrado: el menú se ve, pero no se puede agregar', async ({ page }) => {
    psql(`update public.portal_sedes set pausado = true where restaurant_id = '${SEDE}';`)
    await page.goto(`/pedir/${SLUG}`)
    await expect(page.getByTestId('pedido-cerrado')).toBeVisible()
    await expect(page.getByTestId(`pedido-agregar-${id.perro}`)).toBeDisabled()
    psql(`update public.portal_sedes set pausado = false where restaurant_id = '${SEDE}';`)
    await page.reload()
    await expect(page.getByTestId('pedido-cerrado'), 'contraste').toHaveCount(0)
    await expect(page.getByTestId(`pedido-agregar-${id.perro}`)).toBeEnabled()
  })

  test('recordar mis datos: quedan solo en este navegador y se borran al desmarcar', async ({ page, context }) => {
    await context.grantPermissions(['geolocation'])
    await context.setGeolocation(A_1500)
    await page.goto(`/pedir/${SLUG}`)
    const guardado = () => page.evaluate((k) => localStorage.getItem(k), CLAVE_DATOS)
    await page.getByTestId(`pedido-agregar-${id.gaseosa}`).click()
    await page.getByTestId('pedido-ver').click()
    await llenarDatos(page)
    await page.getByTestId('pedido-mi-ubicacion').click()
    await expect(page.getByTestId('pedido-total-envio')).toHaveText(/4\.000/)
    await page.waitForTimeout(300)
    expect(await guardado(), 'sin marcar, no se guarda').toBeNull()
    await page.getByTestId('pedido-recordar').check()
    await expect.poll(guardado).toContain('Laura Prueba')

    await page.reload()
    await page.getByTestId(`pedido-agregar-${id.gaseosa}`).click()
    await page.getByTestId('pedido-ver').click()
    await expect(page.getByTestId('pedido-nombre')).toHaveValue('Laura Prueba')
    await expect(page.getByTestId('pedido-celular')).toHaveValue('300 123 4567')
    await expect(page.getByTestId('pedido-recordar')).toBeChecked()
    await expect(page.getByTestId('pedido-acepta'), 'la autorización se da en cada pedido').not.toBeChecked()
    await expect(page.getByTestId('pedido-total-envio'), 'el punto recordado ya cotiza el envío').toHaveText(/4\.000/)

    await page.getByTestId('pedido-recordar').uncheck()
    await expect.poll(guardado).toBeNull()
    await page.reload()
    await page.getByTestId(`pedido-agregar-${id.gaseosa}`).click()
    await page.getByTestId('pedido-ver').click()
    await expect(page.getByTestId('pedido-nombre')).toHaveValue('')
  })
})
