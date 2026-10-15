import { test, expect, type Request } from '@playwright/test'
import { ownerCreds } from './helpers/auth'
import { cliente, psql } from './helpers/db-local'

// ============================================================================
// Pedidos en línea, P2 parte 3: la entrada del portal del cliente (pedido.html).
//   · /pedir/<negocio> sirve el portal, con su PROPIO paquete: no descarga el POS ni supabase-js.
//   · El portal habla solo con la Edge Function `portal` (catálogo).
//   · Un link sin negocio, con formato inválido o de un negocio sin publicar dice qué pasa.
//   · Contraste: las rutas del POS (/login, /pedidos) siguen siendo del POS.
// La regla del documento por ruta y por dominio (R1 #9) la vigila src/lib/identidadRutas.test.ts.
// ============================================================================

const SLUG = 'e2e-p3-lab'
const HORARIO_TODO_EL_DIA = Object.fromEntries(['1', '2', '3', '4', '5', '6', '7'].map((d) => [d, [['00:00', '12:00'], ['12:00', '00:00']]]))
let SEDE = ''
let OWNER = ''
let PROD = ''
let NOMBRE_SEDE = ''
let TURNO_PROPIO = ''

test.beforeAll(async () => {
  const o = await cliente(ownerCreds()); SEDE = o.sede; OWNER = o.uid
  NOMBRE_SEDE = psql(`select name from public.restaurants where id = '${SEDE}';`)
  PROD = psql(`select p.id from public.products p join public.categories c on c.id = p.category_id
    where p.restaurant_id = '${SEDE}' and p.is_active and c.is_active and p.price > 0 order by p.name limit 1;`)
  expect(PROD, 'la sede del owner necesita un producto activo con precio').toBeTruthy()
  psql(`delete from public.portal_productos where restaurant_id = '${SEDE}';
        delete from public.portal_sedes where restaurant_id = '${SEDE}' or slug = '${SLUG}';
        insert into public.portal_sedes (restaurant_id, slug, lat, lng, zona_tipo, zona_radio_m, envio_tipo, envio_fijo,
               pedido_minimo, tiempo_min, tiempo_max, horario, color)
        values ('${SEDE}', '${SLUG}', 3.45, -76.53, 'radio', 3000, 'fijo', 4000, 0, 20, 35,
                '${JSON.stringify(HORARIO_TODO_EL_DIA)}', '#9a3412');
        insert into public.portal_productos (product_id, restaurant_id, publicado, precio_domicilio)
        values ('${PROD}', '${SEDE}', true, 12345);
        update public.portal_sedes set activo = true where restaurant_id = '${SEDE}';`)
  if (psql(`select count(*) from public.cash_shifts where restaurant_id = '${SEDE}' and closed_at is null;`) === '0') {
    TURNO_PROPIO = psql(`insert into public.cash_shifts (restaurant_id, opened_by, opening_amount) values ('${SEDE}', '${OWNER}', 0) returning id;`).split(/\r?\n/)[0]
  }
})

test.afterAll(() => {
  if (!SEDE) return
  psql(`delete from public.portal_productos where restaurant_id = '${SEDE}';
        delete from public.portal_sedes where restaurant_id = '${SEDE}';
        delete from public.portal_limites;
        ${TURNO_PROPIO ? `delete from public.cash_shifts where id = '${TURNO_PROPIO}';` : ''}`)
})

test.describe('Pedidos en línea · entrada del portal (pedido.html)', () => {
  test('/pedir/<negocio>: el portal con su negocio, su estado y su menú, sin descargar el POS', async ({ page }) => {
    const pedidas: string[] = []
    page.on('request', (r: Request) => pedidas.push(r.url()))
    await page.goto(`/pedir/${SLUG}`)
    await expect(page.getByTestId('portal-negocio')).toHaveText(NOMBRE_SEDE)
    await expect(page.getByTestId('portal-estado')).toHaveText('Recibiendo pedidos')
    await expect(page.getByTestId(`portal-item-${PROD}`)).toContainText('12.345')
    await expect(page).toHaveTitle(`${NOMBRE_SEDE} · Pedidos en línea`)
    // El paquete del portal, no el del POS: ni su main.tsx, ni supabase-js, ni el service worker de Cocina.
    expect(pedidas.filter((u) => /\/src\/main\.tsx|@supabase|supabase-js|\/sw\.js/.test(u))).toEqual([])
    expect(pedidas.some((u) => u.includes('/src/portal/main.tsx')), 'contraste: sí carga el del portal').toBe(true)
    expect(pedidas.filter((u) => u.includes('/functions/v1/portal')).length).toBeGreaterThanOrEqual(1)
    expect(pedidas.some((u) => u.includes('/rest/v1/')), 'el navegador no le habla a la base').toBe(false)
  })

  test('el estado que manda el servidor: pausado', async ({ page }) => {
    psql(`update public.portal_sedes set pausado = true where restaurant_id = '${SEDE}';`)
    try {
      await page.goto(`/pedir/${SLUG}`)
      await expect(page.getByTestId('portal-estado')).toHaveText('Pausamos los pedidos por un momento')
    } finally {
      psql(`update public.portal_sedes set pausado = false where restaurant_id = '${SEDE}';`)
    }
  })

  test('links que no llevan a un negocio publicado dicen qué pasa', async ({ page }) => {
    const casos: [string, RegExp][] = [
      ['/pedir', /no corresponde a ningún negocio/],
      ['/pedir/Mal_Link', /no corresponde a ningún negocio/],
      ['/pedir/e2e-no-existe-p3', /no está recibiendo pedidos en línea/],
    ]
    for (const [ruta, texto] of casos) {
      await page.goto(ruta)
      await expect(page.getByTestId('portal-mensaje'), ruta).toHaveText(texto)
    }
    psql(`update public.portal_sedes set activo = false where restaurant_id = '${SEDE}';`)
    try {
      await page.goto(`/pedir/${SLUG}`)
      await expect(page.getByTestId('portal-mensaje'), 'sin publicar').toHaveText(/no está recibiendo pedidos en línea/)
    } finally {
      psql(`update public.portal_sedes set activo = true where restaurant_id = '${SEDE}';`)
    }
  })

  test('contraste: las rutas del POS siguen siendo del POS (no del portal)', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Ingresa a tu cuenta' })).toBeVisible()
    await expect(page.getByTestId('portal-mensaje')).toHaveCount(0)
  })
})
