import { test, expect, type Page } from '@playwright/test'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ownerCreds, cashierCreds, type Creds } from './helpers/auth'
import { cliente, psql } from './helpers/db-local'

// ============================================================================
// FIADO en el POS móvil (/m) — m-android (Chromium) y m-iphone (WebKit).
// La venta va por register_pos_sale con fiado = true: sin pagos, la deuda es la
// orden (payment_status 'pending', customer_id). Los abonos siguen en el escritorio.
//
// Fixtures SOLO en la base local: clientes creados acá (DESACTIVADOS por id en
// afterAll — borrarlos dejaría sus ventas sin customer_id, una deuda huérfana que
// otro spec podría contar) y, en un test, el rol cajero de la org LAB sin fiado.gestionar
// (restaurado al texto exacto). Todo por UUID de sede/rol, nunca por nombre de org.
// ============================================================================

test.describe.configure({ mode: 'serial' })

let owner: SupabaseClient
let OWNER_ID = ''
let CAJERO_ID = ''
let SEDE = ''
let ROL_CAJERO = ''
let PERMISOS_CAJERO = ''
const PREFIJO = `E2E Fiado ${Date.now().toString(36)}`
const creados: string[] = []

/** Crea un cliente de prueba en la sede LAB; devuelve su id. */
function crearCliente(nombre: string, telefono: string | null): string {
  // En un CTE: con -At, un INSERT … RETURNING suelto imprime además "INSERT 0 1".
  const id = psql(`with c as (insert into public.customers (restaurant_id, name, phone)
                   values ('${SEDE}', '${nombre}', ${telefono ? `'${telefono}'` : 'null'}) returning id) select id from c;`)
  expect(id).toMatch(/^[0-9a-f-]{36}$/)
  creados.push(id)
  return id
}

test.beforeAll(async () => {
  const o = await cliente(ownerCreds())
  const c = await cliente(cashierCreds())
  owner = o.c; OWNER_ID = o.uid; CAJERO_ID = c.uid; SEDE = o.sede
  expect(c.sede).toBe(SEDE)
  ROL_CAJERO = psql(`select role_id from public.profiles where id = '${CAJERO_ID}';`)
  PERMISOS_CAJERO = psql(`select permissions::text from public.roles where id = '${ROL_CAJERO}';`)
  expect(PERMISOS_CAJERO, 'el cajero de LAB parte CON fiado').toContain('fiado.gestionar')
})

test.afterAll(() => {
  psql(`update public.roles set permissions = '${PERMISOS_CAJERO}'::jsonb where id = '${ROL_CAJERO}';`)
  expect(psql(`select permissions::text from public.roles where id = '${ROL_CAJERO}';`), 'rol restaurado').toBe(PERMISOS_CAJERO)
  // Los creados desde la pantalla también se registran en `creados` (por id).
  if (creados.length) psql(`update public.customers set is_active = false where id in (${creados.map((id) => `'${id}'`).join(',')});`)
})

async function turnoAbierto() {
  const abierto = (await owner.from('cash_shifts').select('id').eq('restaurant_id', SEDE).is('closed_at', null).maybeSingle()).data
  if (abierto) return
  const { error } = await owner.from('cash_shifts').insert({ restaurant_id: SEDE, opened_by: OWNER_ID, opening_amount: 0 })
  if (error) throw error
}

async function entrar(page: Page, creds: Creds) {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill(creds.email)
  await page.locator('input[autocomplete="current-password"]').fill(creds.password)
  await page.getByRole('button', { name: 'Ingresar' }).click()
  await expect(page).toHaveURL(/\/m$/, { timeout: 15_000 })
}

async function agregar(page: Page, nombre: string) {
  await page.getByTestId('m-buscar').fill(nombre)
  await page.getByTestId('m-productos').getByTestId('m-producto').filter({ hasText: nombre }).first().click()
  await page.getByTestId('m-buscar').fill('')
}

/** Abre el paso Fiado con una cerveza en el carrito. */
async function irAFiado(page: Page) {
  await agregar(page, 'Lab Cerveza')
  await page.getByTestId('m-carrito-abrir').click()
  await page.getByTestId('m-pagar-fiado').click()
  await expect(page.getByTestId('m-fiado-clientes')).toBeVisible()
}

/** Confirma el fiado y devuelve el número de venta. */
async function fiar(page: Page, nombre: string): Promise<number> {
  await expect(page.getByTestId('m-confirmar')).toContainText(nombre)
  await page.getByTestId('m-confirmar').click()
  await expect(page.getByTestId('m-exito')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('m-exito-detalle')).toContainText(`Fiado a ${nombre}`)
  const n = Number(((await page.getByTestId('m-exito-numero').textContent()) ?? '').replace(/\D/g, ''))
  await page.getByTestId('m-nueva-venta').click()
  return n
}

/** La venta en la base: 'tipo|total|estado|cliente|autor|pagos'. */
const ventaEnBase = (numero: number) =>
  psql(`select o.type || '|' || o.total || '|' || o.payment_status || '|' || coalesce(o.customer_id::text, '-') || '|' || o.created_by
               || '|' || (select count(*) from public.payments p where p.order_id = o.id)
          from public.orders o where o.restaurant_id = '${SEDE}' and o.order_number = ${numero};`)

test('fiado a un cliente existente: la búsqueda lo encuentra por TELÉFONO, la venta queda pendiente y sin pagos', async ({ page }) => {
  const nombre = `${PREFIJO} Ana`
  const id = crearCliente(nombre, '300 555 0101')
  await turnoAbierto()
  await entrar(page, cashierCreds())
  await irAFiado(page)
  // Sin cliente elegido no se puede confirmar.
  await expect(page.getByTestId('m-confirmar')).toBeDisabled()
  await page.getByTestId('m-fiado-buscar').fill('3005550101')
  await expect(page.getByTestId('m-fiado-cliente')).toHaveCount(1)
  await page.getByTestId('m-fiado-cliente').click()
  await expect(page.getByTestId('m-fiado-cliente')).toHaveAttribute('aria-pressed', 'true')
  const numero = await fiar(page, nombre)
  expect(ventaEnBase(numero)).toBe(`takeaway|8000.00|pending|${id}|${CAJERO_ID}|0`)
})

test('RECIENTES primero: el cliente con un fiado nuevo sube arriba del orden alfabético', async ({ page }) => {
  const abel = crearCliente(`${PREFIJO} Abel`, null)
  const zoe = crearCliente(`${PREFIJO} Zoe`, null)
  await turnoAbierto()
  await entrar(page, cashierCreds())
  await irAFiado(page)
  await page.getByTestId('m-fiado-buscar').fill(`${PREFIJO} `)
  const primero = page.getByTestId('m-fiado-cliente').first()
  // Contraste: sin fiados, alfabético (Abel antes que Zoe; Ana, del test anterior, es reciente).
  const ordenAntes = await page.getByTestId('m-fiado-cliente').evaluateAll((els) => els.map((e) => e.getAttribute('data-cliente-id')))
  expect(ordenAntes.indexOf(abel)).toBeLessThan(ordenAntes.indexOf(zoe))
  await page.locator(`[data-cliente-id="${zoe}"]`).click()
  await fiar(page, `${PREFIJO} Zoe`)

  await irAFiado(page)
  await page.getByTestId('m-fiado-buscar').fill(`${PREFIJO} `)
  await expect(primero).toHaveAttribute('data-cliente-id', zoe)
  await expect(primero).toContainText('último fiado')
})

test('ALTA RÁPIDA: escribir un teléfono y "Crear" lo precarga; el cliente nuevo queda elegido y la venta es suya', async ({ page }) => {
  const nombre = `${PREFIJO} Nuevo`
  const telefono = '3209990' + String(Date.now()).slice(-3)
  await turnoAbierto()
  await entrar(page, cashierCreds())
  await irAFiado(page)
  await page.getByTestId('m-fiado-buscar').fill(telefono)
  await page.getByTestId('m-fiado-nuevo').click()
  await expect(page.getByTestId('m-fiado-telefono')).toHaveValue(telefono)
  await expect(page.getByTestId('m-fiado-telefono')).toHaveAttribute('inputmode', 'tel')
  await expect(page.getByTestId('m-fiado-guardar')).toBeDisabled()       // sin nombre, no
  await page.getByTestId('m-fiado-nombre').fill(nombre)
  await page.getByTestId('m-fiado-guardar').click()
  await expect(page.getByTestId('m-fiado-clientes')).toBeVisible()
  const id = psql(`select id from public.customers where restaurant_id = '${SEDE}' and name = '${nombre}' and phone = '${telefono}';`)
  expect(id).toMatch(/^[0-9a-f-]{36}$/)
  creados.push(id)
  const numero = await fiar(page, nombre)
  expect(ventaEnBase(numero)).toBe(`takeaway|8000.00|pending|${id}|${CAJERO_ID}|0`)
})

test('ALTA RÁPIDA con un nombre que ya existe: lo ofrece, y elegirlo NO crea un duplicado', async ({ page }) => {
  const nombre = `${PREFIJO} Duplicado`
  const id = crearCliente(nombre, null)
  await turnoAbierto()
  await entrar(page, cashierCreds())
  await irAFiado(page)
  await page.getByTestId('m-fiado-nuevo').click()
  await page.getByTestId('m-fiado-nombre').fill(nombre.toUpperCase())
  await expect(page.getByTestId('m-fiado-parecido')).toHaveCount(1)
  await expect(page.getByTestId('m-fiado-guardar')).toHaveText('Crear igual')
  await page.getByTestId('m-fiado-parecido').click()
  await expect(page.getByTestId('m-confirmar')).toContainText(nombre)
  expect(psql(`select count(*) from public.customers where restaurant_id = '${SEDE}' and lower(name) = lower('${nombre}');`)).toBe('1')
  const numero = await fiar(page, nombre)
  expect(ventaEnBase(numero).split('|')[3]).toBe(id)
})

test('MIS VENTAS: el fiado aparece aparte (con el cliente) y NO suma al efectivo', async ({ page }) => {
  const nombre = `${PREFIJO} Mis ventas`
  crearCliente(nombre, null)
  await turnoAbierto()
  await entrar(page, cashierCreds())
  await page.getByTestId('m-nav-ventas').click()
  const efectivoAntes = (await page.getByTestId('m-mis-efectivo').textContent()) ?? ''
  const cantidadAntes = Number((await page.getByTestId('m-mis-cantidad').textContent()) ?? '0')
  await page.getByTestId('m-nav-vender').click()
  await irAFiado(page)
  await page.getByTestId('m-fiado-buscar').fill(nombre)
  await page.getByTestId('m-fiado-cliente').click()
  await fiar(page, nombre)

  await page.getByTestId('m-nav-ventas').click()
  await expect(page.getByTestId('m-mis-cantidad')).toHaveText(String(cantidadAntes + 1))
  await expect(page.getByTestId('m-mi-venta').filter({ hasText: `Fiado · ${nombre}` })).toHaveCount(1)
  await expect(page.getByTestId('m-mis-fiado')).toBeVisible()
  await expect(page.getByTestId('m-mis-efectivo')).toHaveText(efectivoAntes)
})

test('SIN fiado.gestionar no hay botón Fiado (y el servidor tampoco lo acepta); con el permiso, sí — contraste', async ({ page }) => {
  const id = crearCliente(`${PREFIJO} Sin permiso`, null)
  await turnoAbierto()
  psql(`update public.roles set permissions = permissions - 'fiado.gestionar' where id = '${ROL_CAJERO}';`)
  try {
    await entrar(page, cashierCreds())
    await agregar(page, 'Lab Cerveza')
    await page.getByTestId('m-carrito-abrir').click()
    await expect(page.getByTestId('m-pagar-cash')).toBeVisible()
    await expect(page.getByTestId('m-pagar-fiado')).toHaveCount(0)

    // El servidor, por su lado (la UI no es la barrera).
    const c = await cliente(cashierCreds())
    const r = await c.c.rpc('register_pos_sale', {
      p_sale_id: crypto.randomUUID(),
      p_order: { type: 'takeaway', total: 8000, fiado: true, customer_id: id },
      p_items: [{ product_id: psql(`select id from public.products where restaurant_id = '${SEDE}' and name = 'Lab Cerveza';`), qty: 1, unit_price: 8000, extras: [] }],
      p_payments: [],
    })
    expect(r.error?.message).toMatch(/permiso para vender a fiado/)
  } finally {
    psql(`update public.roles set permissions = '${PERMISOS_CAJERO}'::jsonb where id = '${ROL_CAJERO}';`)
  }
  // El carrito vive en memoria: tras recargar se arma de nuevo.
  await page.reload()
  await agregar(page, 'Lab Cerveza')
  await page.getByTestId('m-carrito-abrir').click()
  await expect(page.getByTestId('m-pagar-fiado')).toBeVisible()
})
