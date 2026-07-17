import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { loginAsOwner } from './helpers/auth'
import { openTableAndAddItems } from './helpers/tables'
import { openShiftIfClosed, closeShiftIfOpen } from './helpers/shift'

// Pago mixto (dividir el cobro entre varios métodos). Corre contra el LAB.
// - Producto compuesto seeded "Lab Coctel" (18.000) que descuenta 1 "Lab Vaso"
//   (insumo con tracking) por venta → permite verificar que NO hay doble
//   descuento de stock al cobrar una mesa mixta.
// - Verifica el registro (2 filas payments), que el efectivo entra a caja y el
//   nequi no (cuadre por método), la validación bloqueante Σ≠total, que la
//   venta simple no se rompe, y que el fiado no se cruza con el split.

const PRODUCT = 'Lab Coctel'
const INSUMO = 'Lab Vaso'

const SUFFIX = Date.now().toString().slice(-6)
const MESA = `Mesa Mixto ${SUFFIX}`

// "$ 18.000" → 18000
const parseCOP = (text: string): number => Number(text.replace(/[^\d]/g, ''))

// ── Supabase directo (verificación de las filas payments) ─────────────
// VITE_GVENTO_* (backend del lab) viven en .env; playwright.config solo carga
// .env.test. Cargamos ambos aquí para consultar la BD con RLS del owner.
function loadEnv(path: string) {
  try {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* ignore */ }
}
loadEnv('.env')
loadEnv('.env.test')

type Pay = { method: string; amount: number }

// Lee las filas de `payments` de una venta por su número, autenticado como owner
// (RLS: solo la sede activa). Prueba directa de "una fila por método".
async function paymentsForOrder(orderNumber: number): Promise<Pay[]> {
  const client = createClient(
    process.env.VITE_GVENTO_SUPABASE_URL!,
    process.env.VITE_GVENTO_SUPABASE_ANON_KEY!,
  )
  const { error: authErr } = await client.auth.signInWithPassword({
    email: process.env.E2E_OWNER_EMAIL!,
    password: process.env.E2E_OWNER_PASSWORD!,
  })
  if (authErr) throw authErr

  const { data: order, error: oErr } = await client
    .from('orders')
    .select('id')
    .eq('order_number', orderNumber)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()
  if (oErr) throw oErr

  const { data, error } = await client
    .from('payments')
    .select('method, amount')
    .eq('order_id', order.id)
  if (error) throw error
  return (data ?? []).map((p) => ({ method: String(p.method), amount: Number(p.amount) }))
}

// ── Helpers de UI ─────────────────────────────────────────────────────

// Agrega 1 PRODUCT al carrito del POS (maneja el ItemConfigModal del compuesto).
async function addProductPOS(page: Page) {
  await page.getByTestId('product-card').filter({ hasText: PRODUCT }).first().click()
  await expect(page.getByTestId('item-config-modal')).toBeVisible()
  await page.getByTestId('item-config-confirm').click()
}

// En el step de método (ya con "Dividir pago" activo): reparte el total en
// efectivo + nequi. Devuelve los montos imputados.
async function fillSplitCashNequi(page: Page, total: number): Promise<{ cash: number; nequi: number }> {
  const cash = Math.floor(total / 2)
  const nequi = total - cash
  // Línea 0 = efectivo (semilla). Ajustar su monto.
  await page.getByTestId('pay-line-amount-0').fill(String(cash))
  // Agregar una segunda línea y ponerla en nequi.
  await page.getByTestId('pay-add-method').click()
  await page.getByTestId('pay-line-method-1').selectOption('nequi')
  await page.getByTestId('pay-line-amount-1').fill(String(nequi))
  return { cash, nequi }
}

// Lee las ventas por método del cuadre (abre el modal de cierre, lee y CANCELA
// sin cerrar el turno). Requiere turno abierto.
async function readShiftSales(page: Page): Promise<Record<string, number>> {
  await page.goto('/ventas')
  await page.getByRole('button', { name: 'Cerrar turno', exact: true }).click()
  await expect(page.getByText('Cerrar turno de caja')).toBeVisible()
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {})
  const read = async (m: string) => parseCOP(await page.getByTestId(`shift-sales-${m}`).innerText())
  const res = {
    cash: await read('cash'), card: await read('card'),
    transfer: await read('transfer'), nequi: await read('nequi'),
  }
  await page.getByRole('button', { name: 'Cancelar' }).click()
  await expect(page.getByText('Cerrar turno de caja')).toHaveCount(0)
  return res
}

// Lee el stock de un insumo desde Inventario → Niveles.
async function readStock(page: Page, name: string): Promise<number> {
  await page.goto('/inventario')
  await page.getByTestId('inventory-tab-levels').click()
  await page.getByPlaceholder('Buscar insumo...').fill(name)
  const row = page.getByTestId('stock-level-row').filter({ hasText: name })
  await expect(row).toBeVisible()
  return Number(await row.getByTestId('stock-level-qty').innerText())
}

function orderNumberFromBanner(text: string): number {
  return Number(text.match(/#(\d+)/)![1])
}

// ── Suite ─────────────────────────────────────────────────────────────

test.describe.serial('Pago mixto (pago dividido)', () => {
  test('POS: venta mixta → 2 filas payments; el efectivo entra a caja, el nequi no', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/ventas')
    await openShiftIfClosed(page, 0)

    // Cuadre por método ANTES de la venta.
    const before = await readShiftSales(page)

    await addProductPOS(page)
    await page.getByRole('button', { name: 'Cobrar' }).click()
    const total = parseCOP(await page.getByTestId('checkout-total').innerText())

    // Dividir: efectivo + nequi que suman el total.
    await page.getByTestId('pay-split-toggle').click()
    const { cash, nequi } = await fillSplitCashNequi(page, total)
    await expect(page.getByTestId('checkout-confirm')).toBeEnabled()
    await page.getByTestId('checkout-confirm').click()

    const banner = page.getByText(/Venta #\d+ registrada/)
    await expect(banner).toBeVisible({ timeout: 15_000 })
    const n = orderNumberFromBanner(await banner.innerText())
    await page.getByRole('button', { name: 'Nueva venta' }).click()

    // Se registraron 2 filas payments, una por método, con los montos imputados.
    const pays = await paymentsForOrder(n)
    expect(pays).toHaveLength(2)
    const byMethod = Object.fromEntries(pays.map((p) => [p.method, p.amount]))
    expect(byMethod['cash']).toBe(cash)
    expect(byMethod['nequi']).toBe(nequi)

    // Caja: el efectivo subió SOLO por la parte efectivo (no por el total); el
    // nequi fue a su propio cubo, no a la caja de efectivo.
    const after = await readShiftSales(page)
    expect(after.cash - before.cash).toBe(cash)
    expect(after.nequi - before.nequi).toBe(nequi)
    expect(after.cash - before.cash).not.toBe(total)
  })

  test('POS: historial muestra ambos métodos ("Efectivo + Nequi")', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/ventas')
    await openShiftIfClosed(page, 0)

    await addProductPOS(page)
    await page.getByRole('button', { name: 'Cobrar' }).click()
    const total = parseCOP(await page.getByTestId('checkout-total').innerText())
    await page.getByTestId('pay-split-toggle').click()
    await fillSplitCashNequi(page, total)
    await page.getByTestId('checkout-confirm').click()
    const banner = page.getByText(/Venta #\d+ registrada/)
    await expect(banner).toBeVisible({ timeout: 15_000 })
    const n = orderNumberFromBanner(await banner.innerText())
    await page.getByRole('button', { name: 'Nueva venta' }).click()

    // La fila del historial agrega los métodos (no payments[0]).
    await page.goto('/historial')
    const row = page.getByRole('button', { name: new RegExp(`^#${n}\\s`) })
    await expect(row).toBeVisible()
    await expect(row.getByTestId('sale-row-method')).toContainText('Efectivo')
    await expect(row.getByTestId('sale-row-method')).toContainText('Nequi')

    // El detalle desglosa método + monto por línea.
    await row.click()
    await expect(page.getByTestId('sale-detail-method')).toContainText('Efectivo')
    await expect(page.getByTestId('sale-detail-method')).toContainText('Nequi')
    await expect(page.getByTestId('sale-detail-payments')).toBeVisible()
  })

  test('POS: validación bloqueante — Σ≠total deshabilita Cobrar (falta y excedido)', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/ventas')
    await openShiftIfClosed(page, 0)

    await addProductPOS(page)
    await page.getByRole('button', { name: 'Cobrar' }).click()
    const total = parseCOP(await page.getByTestId('checkout-total').innerText())
    await page.getByTestId('pay-split-toggle').click()

    const confirm = page.getByTestId('checkout-confirm')
    // Semilla [efectivo: total] → válido (Σ = total exacto).
    await expect(confirm).toBeEnabled()

    // Falta: Σ < total.
    await page.getByTestId('pay-line-amount-0').fill(String(total - 5000))
    await expect(page.getByTestId('pay-remaining')).toBeVisible()
    await expect(confirm).toBeDisabled()

    // Excedido: Σ > total.
    await page.getByTestId('pay-line-amount-0').fill(String(total + 5000))
    await expect(confirm).toBeDisabled()

    // Exacto de nuevo → habilitado (bloqueo es solo por Σ≠total).
    await page.getByTestId('pay-line-amount-0').fill(String(total))
    await expect(confirm).toBeEnabled()
  })

  test('POS: venta simple (un método) sigue funcionando — 1 fila payment', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/ventas')
    await openShiftIfClosed(page, 0)

    await addProductPOS(page)
    await page.getByRole('button', { name: 'Cobrar' }).click()
    const total = parseCOP(await page.getByTestId('checkout-total').innerText())

    // Flujo de hoy: un método (nequi evita el step de vuelto), Continuar.
    await page.getByTestId('pay-method-nequi').click()
    await page.getByTestId('checkout-continue').click()
    const banner = page.getByText(/Venta #\d+ registrada/)
    await expect(banner).toBeVisible({ timeout: 15_000 })
    const n = orderNumberFromBanner(await banner.innerText())
    await page.getByRole('button', { name: 'Nueva venta' }).click()

    const pays = await paymentsForOrder(n)
    expect(pays).toHaveLength(1)
    expect(pays[0].method).toBe('nequi')
    expect(pays[0].amount).toBe(total)
  })

  test('MESA: cierre mixto registra pagos, sin doble descuento de stock', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/ventas')
    await openShiftIfClosed(page, 0)

    // Stock del insumo ANTES de todo.
    const before = await readStock(page, INSUMO)

    // Crear una mesa dedicada.
    await page.goto('/mesas')
    await page.getByRole('button', { name: 'Configurar' }).click()
    await page.getByPlaceholder('Mesa 1').fill(MESA)
    await page.getByRole('button', { name: 'Crear mesa' }).click()
    await expect(page.getByText(MESA)).toBeVisible()

    // Abrir la mesa y abrir el picker.
    await openTableAndAddItems(page, MESA)

    // Agregar 1 Lab Coctel → AQUÍ baja el stock del insumo (una vez).
    await page.getByRole('button').filter({ has: page.getByText(PRODUCT, { exact: true }) }).first().click()
    await expect(page.getByTestId('item-config-modal')).toBeVisible()
    await page.getByTestId('item-config-confirm').click()
    await page.getByRole('button', { name: 'Agregar a la mesa' }).click()
    // El picker cierra SOLO tras commitear la RPC (alta + descuento de stock).
    await expect(page.getByRole('button', { name: 'Agregar a la mesa' })).toHaveCount(0)
    await expect(page.getByText('Sin ítems — agrega productos')).toHaveCount(0)

    const afterAdd = await readStock(page, INSUMO)
    expect(afterAdd).toBe(before - 1)

    // Cerrar la mesa con pago MIXTO.
    await page.goto('/mesas')
    await page.getByRole('button', { name: new RegExp(MESA) }).click()
    await page.getByRole('button', { name: 'Cobrar' }).click()
    const total = parseCOP(await page.getByTestId('checkout-total').innerText())
    await page.getByTestId('pay-split-toggle').click()
    const { cash, nequi } = await fillSplitCashNequi(page, total)
    await expect(page.getByTestId('checkout-confirm')).toBeEnabled()
    await page.getByTestId('checkout-confirm').click()
    const banner = page.getByText(/Venta #\d+ registrada/)
    await expect(banner).toBeVisible({ timeout: 15_000 })
    const n = orderNumberFromBanner(await banner.innerText())

    // Anti doble-descuento: cobrar NO vuelve a tocar stock.
    const afterClose = await readStock(page, INSUMO)
    expect(afterClose).toBe(afterAdd)
    expect(afterClose).toBe(before - 1)

    // Se registraron los 2 pagos de la mesa.
    const pays = await paymentsForOrder(n)
    expect(pays).toHaveLength(2)
    const byMethod = Object.fromEntries(pays.map((p) => [p.method, p.amount]))
    expect(byMethod['cash']).toBe(cash)
    expect(byMethod['nequi']).toBe(nequi)

    // La mesa quedó LIBERADA (al hacer click pide abrir).
    await page.goto('/mesas')
    await page.getByRole('button', { name: new RegExp(MESA) }).click()
    await expect(page.getByRole('button', { name: 'Abrir mesa' })).toBeVisible()
  })

  test('El fiado NO se cruza con el split (no hay opción de fiado al dividir)', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/ventas')
    await openShiftIfClosed(page, 0)

    await addProductPOS(page)
    await page.getByRole('button', { name: 'Cobrar' }).click()

    // Con efectivo (default, no fiado) el toggle "Dividir pago" está visible.
    await expect(page.getByTestId('pay-split-toggle')).toBeVisible()

    // Al seleccionar fiado, el toggle desaparece: fiado no se puede dividir.
    await page.getByTestId('pay-method-fiado').click()
    await expect(page.getByTestId('pay-split-toggle')).toHaveCount(0)

    // Volver a no-fiado y entrar a modo dividir: el método fiado NO existe ahí.
    await page.getByTestId('pay-method-efectivo').click()
    await expect(page.getByTestId('pay-split-toggle')).toBeVisible()
    await page.getByTestId('pay-split-toggle').click()
    await expect(page.getByTestId('pay-method-fiado')).toHaveCount(0)
  })

  test('limpieza: cerrar turno y borrar la mesa creada', async ({ page }) => {
    page.on('dialog', (d) => d.accept())
    await loginAsOwner(page)

    await page.goto('/ventas')
    await closeShiftIfOpen(page)

    // Borrado best-effort de la mesa (la orden quedó 'delivered' y la mesa libre).
    await page.goto('/mesas')
    await page.getByRole('button', { name: 'Configurar' }).click()
    const del = page.locator('div')
      .filter({ has: page.getByText(MESA, { exact: true }) })
      .filter({ has: page.getByTitle('Eliminar mesa') })
      .last()
      .getByTitle('Eliminar mesa')
    if (await del.count() > 0) await del.click()
  })
})
