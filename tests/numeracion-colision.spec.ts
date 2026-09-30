import { test, expect, type Page } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { loginAsOwner } from './helpers/auth'
import { openShiftIfClosed } from './helpers/shift'
import { agregarProductoSimple } from './helpers/pos'

// ============================================================================
// ¿Qué hace la app si, con el UNIQUE (restaurant_id, order_number) aplicado,
// dos ventas chocan en el número? (supabase/order-number-unique.sql)
//
// CUÁNDO puede chocar: NO por concurrencia — next_order_number es un upsert que
// serializa (dos cobros simultáneos reciben números distintos). Choca cuando el
// CONTADOR de la sede (store_sequences) queda POR DETRÁS del máximo real: un
// seed que lo reinicia sin purgar, un restore parcial, un UPDATE a mano. El
// test fuerza exactamente eso: retrasa el contador un número y cobra.
//
// Setup por `docker exec psql` contra la base LOCAL: store_sequences no se
// escribe desde la app (y está bien que no). La config garantiza loopback.
// PRECONDICIÓN: order-number-unique.sql aplicada a la base local. Si no, el
// test FALLA avisándolo — un skip escondería justo lo que se quiere ver.
// ============================================================================

const DB = 'supabase_db_gvento'
function psql(sql: string): string {
  const r = spawnSync('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'],
    { input: sql, encoding: 'utf-8' })
  if (r.status !== 0) throw new Error(`psql: ${r.stderr}`)
  return r.stdout.trim()
}
const SEDE = `(select id from public.restaurants where name = 'Sede Lab Norte')`

async function cobrar(page: Page) {
  await page.goto('/ventas')
  await openShiftIfClosed(page, 0)
  await agregarProductoSimple(page)
  await page.getByRole('button', { name: 'Cobrar' }).click()
  await page.getByText('Efectivo', { exact: true }).click()
  await page.getByRole('button', { name: /Continuar/ }).click()
  await page.getByTestId('checkout-received').fill('50000')
  await page.getByRole('button', { name: /Confirmar cobro/ }).click()
}

test.describe.serial('Numeración: colisión con el UNIQUE aplicado', () => {
  let maxAntes = 0

  test.beforeAll(() => {
    const hay = psql(`select count(*) from pg_constraint where conname = 'orders_restaurant_order_number_key';`)
    if (hay !== '1') {
      throw new Error('La base local NO tiene orders_restaurant_order_number_key. Aplicá supabase/order-number-unique.sql a la base local antes de este spec.')
    }
  })

  // Deja el contador alineado con la realidad, pase lo que pase.
  test.afterAll(() => {
    psql(`update public.store_sequences s
             set last_order_number = greatest(s.last_order_number,
               (select coalesce(max(order_number), 0) from public.orders where restaurant_id = s.restaurant_id))
           where s.restaurant_id = ${SEDE};`)
  })

  test('venta previa con número (el número que después va a chocar)', async ({ page }) => {
    await loginAsOwner(page)
    await cobrar(page)
    await expect(page.getByText(/¡Venta #\d+ registrada!/)).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Nueva venta' }).click()
    maxAntes = Number(psql(`select max(order_number) from public.orders where restaurant_id = ${SEDE};`))
    expect(maxAntes).toBeGreaterThan(0)
  })

  test('contador retrasado → el cobro NO se pierde, NO hay número repetido, y el cajero VE el aviso', async ({ page }) => {
    // Retrasar el contador: el próximo next_order_number devuelve maxAntes, que ya existe.
    psql(`update public.store_sequences set last_order_number = ${maxAntes - 1} where restaurant_id = ${SEDE};`)
    const ordenesAntes = Number(psql(`select count(*) from public.orders where restaurant_id = ${SEDE};`))

    await loginAsOwner(page)
    await cobrar(page)

    // 1) El cajero NO ve un "¡Venta #N registrada!" que miente: ve el aviso.
    await expect(page.getByTestId('success-sin-numero')).toBeVisible({ timeout: 15_000 })

    // 2) La venta quedó COBRADA (payments) y SIN número — no se perdió el cobro.
    const nueva = psql(`select o.id || '|' || coalesce(o.order_number::text, 'null') || '|' ||
                               (select count(*) from public.payments p where p.order_id = o.id)
                          from public.orders o where o.restaurant_id = ${SEDE}
                         order by o.created_at desc limit 1;`)
    const [, numero, pagos] = nueva.split('|')
    expect(Number(psql(`select count(*) from public.orders where restaurant_id = ${SEDE};`))).toBe(ordenesAntes + 1)
    expect(numero).toBe('null')
    expect(Number(pagos)).toBeGreaterThan(0)

    // 3) El UNIQUE hizo su trabajo: ningún número repetido en la sede.
    const dups = psql(`select count(*) from (select 1 from public.orders where restaurant_id = ${SEDE}
                         and order_number is not null group by order_number having count(*) > 1) d;`)
    expect(dups).toBe('0')

    // 4) "Reintentar" tiene que RESOLVERLO. Hoy reusa numeroReservado —el mismo
    //    número ocupado—, así que la predicción leyendo el código es que NO.
    await page.getByTestId('retry-order-number').click()
    await expect(page.getByTestId('success-sin-numero')).toBeHidden({ timeout: 15_000 })
    await expect(page.getByText(/¡Venta #\d+ registrada!/)).toBeVisible()
  })
})
