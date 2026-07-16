import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { loginAsOwner } from './helpers/auth'
import { openTableAndAddItems } from './helpers/tables'
import { openShiftIfClosed, closeShiftIfOpen } from './helpers/shift'

// Vale descuento / ruletazo. Corre en LAB. Cubre: vale en Mesa y POS (persiste
// kind='vale' + fixed, baja el total, el pago cuadra), descuento normal ≠ vale,
// idempotencia del descuento de mesa (subtotal recuperado), el vale en el arqueo
// (informativo, no altera el cuadre), el reporte mensual, el clamp del vale que
// excede el total, y el borde del vale-sin-monto.

const PRODUCT = 'Lab Coctel'
const PRICE = 18000

const SUFFIX = Date.now().toString().slice(-6)
const parseCOP = (t: string) => Number(t.replace(/[^\d]/g, ''))

// ── Supabase directo (RLS del owner) ──────────────────────────────────
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

let _client: SupabaseClient | null = null
async function db(): Promise<SupabaseClient> {
  if (_client) return _client
  const c = createClient(process.env.VITE_GVENTO_SUPABASE_URL!, process.env.VITE_GVENTO_SUPABASE_ANON_KEY!)
  const { error } = await c.auth.signInWithPassword({
    email: process.env.E2E_OWNER_EMAIL!, password: process.env.E2E_OWNER_PASSWORD!,
  })
  if (error) throw error
  _client = c
  return c
}

type OrderRow = {
  id: string; total: number
  discount_amount: number; discount_type: string | null; discount_kind: string
}
async function orderByNumber(n: number): Promise<OrderRow> {
  const c = await db()
  const { data, error } = await c
    .from('orders')
    .select('id, total, discount_amount, discount_type, discount_kind')
    .eq('order_number', n)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()
  if (error) throw error
  return data as OrderRow
}

async function paymentCount(orderId: string): Promise<number> {
  const c = await db()
  const { count, error } = await c
    .from('payments').select('id', { count: 'exact', head: true }).eq('order_id', orderId)
  if (error) throw error
  return count ?? 0
}

async function openShiftId(): Promise<string> {
  const c = await db()
  const { data, error } = await c
    .from('cash_shifts').select('id').is('closed_at', null)
    .order('opened_at', { ascending: false }).limit(1).single()
  if (error) throw error
  return data.id as string
}

async function reconciliationOf(shiftId: string): Promise<{ methods: Record<string, { expected: number; declared: number; difference: number }>; vouchers_total: number }> {
  const c = await db()
  const { data, error } = await c
    .from('cash_shifts').select('close_reconciliation').eq('id', shiftId).single()
  if (error) throw error
  return data.close_reconciliation as { methods: Record<string, { expected: number; declared: number; difference: number }>; vouchers_total: number }
}

// ── Helpers de UI ──────────────────────────────────────────────────────
async function addProductPOS(page: Page) {
  await page.getByTestId('product-card').filter({ hasText: PRODUCT }).first().click()
  await expect(page.getByTestId('item-config-modal')).toBeVisible()
  await page.getByTestId('item-config-confirm').click()
}
function orderNumberFromBanner(text: string): number {
  return Number(text.match(/#(\d+)/)![1])
}
async function payNequiAndFinish(page: Page): Promise<number> {
  await page.getByTestId('pay-method-nequi').click()
  await page.getByTestId('checkout-continue').click()
  const banner = page.getByText(/Venta #\d+ registrada/)
  await expect(banner).toBeVisible({ timeout: 15_000 })
  const n = orderNumberFromBanner(await banner.innerText())
  return n
}

// Crea una mesa dedicada, la abre y le agrega 1 PRODUCT (subtotal = PRICE).
async function setupMesaWithItem(page: Page, mesaName: string) {
  await page.goto('/mesas')
  await page.getByRole('button', { name: 'Configurar' }).click()
  await page.getByPlaceholder('Mesa 1').fill(mesaName)
  await page.getByRole('button', { name: 'Crear mesa' }).click()
  await expect(page.getByText(mesaName)).toBeVisible()

  await openTableAndAddItems(page, mesaName)
  await page.getByRole('button').filter({ has: page.getByText(PRODUCT, { exact: true }) }).first().click()
  await expect(page.getByTestId('item-config-modal')).toBeVisible()
  await page.getByTestId('item-config-confirm').click()
  await page.getByRole('button', { name: 'Agregar a la mesa' }).click()
  await expect(page.getByRole('button', { name: 'Agregar a la mesa' })).toHaveCount(0)
  await expect(page.getByText('Sin ítems — agrega productos')).toHaveCount(0)
}

async function openMesaCheckout(page: Page, mesaName: string) {
  await page.goto('/mesas')
  await page.getByRole('button', { name: new RegExp(mesaName) }).click()
  await page.getByRole('button', { name: 'Cobrar' }).click()
  await expect(page.getByText(`${mesaName} · Total a cobrar`)).toBeVisible()
}

async function readVouchersKPI(page: Page): Promise<number> {
  await page.goto('/reportes')
  await expect(page.getByTestId('report-vouchers')).toBeVisible({ timeout: 15_000 })
  return parseCOP(await page.getByTestId('report-vouchers').innerText())
}

// ── Suite ───────────────────────────────────────────────────────────────
test.describe.serial('Vale descuento / ruletazo', () => {
  test('MESA: vale baja el total, persiste kind=vale/fixed y el pago cuadra', async ({ page }) => {
    const MESA = `Mesa Vale ${SUFFIX}`
    await loginAsOwner(page)
    await page.goto('/ventas')
    await closeShiftIfOpen(page)
    await openShiftIfClosed(page, 0)

    await setupMesaWithItem(page, MESA)
    await openMesaCheckout(page, MESA)

    // Vale de 5.000 sobre 18.000 → total 13.000.
    await page.getByTestId('discount-vale-toggle').check()
    await page.getByTestId('discount-amount').fill('5000')
    await page.getByTestId('discount-reason').fill(`Ruletazo ${SUFFIX}`)
    await expect(page.getByTestId('checkout-total')).toContainText('13.000')

    const n = await payNequiAndFinish(page)

    const order = await orderByNumber(n)
    expect(order.total).toBe(PRICE - 5000)          // 13.000
    expect(order.discount_amount).toBe(5000)
    expect(order.discount_type).toBe('fixed')       // vale ⇒ fixed
    expect(order.discount_kind).toBe('vale')
    // El subtotal invariante se recupera de total + discount_amount.
    expect(order.total + order.discount_amount).toBe(PRICE)
  })

  test('POS: vale baja el total, persiste kind=vale/fixed', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/ventas')
    await openShiftIfClosed(page, 0)

    await addProductPOS(page)
    // Vale de 4.000 en el carrito → total 14.000.
    await page.getByTestId('discount-vale-toggle').check()
    await page.getByTestId('discount-amount').fill('4000')
    await expect(page.getByTestId('cart-total')).toContainText('14.000')

    await page.getByRole('button', { name: 'Cobrar' }).click()
    const n = await payNequiAndFinish(page)
    await page.getByRole('button', { name: 'Nueva venta' }).click()

    const order = await orderByNumber(n)
    expect(order.total).toBe(PRICE - 4000)          // 14.000
    expect(order.discount_amount).toBe(4000)
    expect(order.discount_type).toBe('fixed')
    expect(order.discount_kind).toBe('vale')
  })

  test('POS: descuento NORMAL (no vale) → kind=normal, no cuenta como vale', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/ventas')
    await openShiftIfClosed(page, 0)

    await addProductPOS(page)
    // Descuento normal 10% (toggle vale APAGADO) → discount_kind='normal'.
    await page.getByRole('button', { name: '10%', exact: true }).click()
    await expect(page.getByTestId('discount-vale-toggle')).not.toBeChecked()

    await page.getByRole('button', { name: 'Cobrar' }).click()
    const n = await payNequiAndFinish(page)
    await page.getByRole('button', { name: 'Nueva venta' }).click()

    const order = await orderByNumber(n)
    expect(order.discount_kind).toBe('normal')      // NO es vale
    expect(order.discount_type).toBe('pct')
    expect(order.discount_amount).toBe(Math.round(PRICE * 0.1))  // 1.800
  })

  test('ARQUEO: el vale entra a vouchers_total (informativo) y NO altera el cuadre', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/ventas')
    await closeShiftIfOpen(page)
    await openShiftIfClosed(page, 0)
    const shiftId = await openShiftId()

    // Venta en EFECTIVO con vale 5.000 → total 13.000, pago efectivo 13.000.
    await addProductPOS(page)
    await page.getByTestId('discount-vale-toggle').check()
    await page.getByTestId('discount-amount').fill('5000')
    await page.getByRole('button', { name: 'Cobrar' }).click()
    await page.getByTestId('pay-method-efectivo').click()
    await page.getByTestId('checkout-continue').click()
    await page.getByTestId('checkout-received').fill('13000')
    await page.getByRole('button', { name: /Confirmar cobro/ }).click()
    await expect(page.getByText(/Venta #\d+ registrada/)).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Nueva venta' }).click()

    // El cierre muestra los vales del turno (informativo).
    await page.goto('/ventas')
    await page.getByRole('button', { name: 'Cerrar turno', exact: true }).click()
    await expect(page.getByText('Cerrar turno de caja')).toBeVisible()
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {})
    await expect(page.getByTestId('shift-vouchers-total')).toContainText('5.000')
    // Cuadre: el esperado en efectivo es lo COBRADO (13.000), NO se le suma el
    // vale de vuelta. Declarar exacto y cerrar.
    await page.getByTestId('close-shift-declared').fill('13000')
    await page.getByRole('button', { name: 'Confirmar cierre' }).click()
    await expect(page.getByText('Sin turno')).toBeVisible({ timeout: 15_000 })

    const rec = await reconciliationOf(shiftId)
    expect(rec.methods.cash.expected).toBe(13000)   // cobrado (post-vale), NO 18.000
    expect(rec.methods.cash.declared).toBe(13000)
    expect(rec.methods.cash.difference).toBe(0)     // cuadre intacto
    expect(rec.vouchers_total).toBe(5000)           // vale, informativo aparte
  })

  test('REPORTE: "Regalado en vales" suma los vales del período', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/ventas')
    await openShiftIfClosed(page, 0)

    const before = await readVouchersKPI(page)

    // Un vale de 7.000 en POS.
    await page.goto('/ventas')
    await addProductPOS(page)
    await page.getByTestId('discount-vale-toggle').check()
    await page.getByTestId('discount-amount').fill('7000')
    await page.getByRole('button', { name: 'Cobrar' }).click()
    await payNequiAndFinish(page)
    await page.getByRole('button', { name: 'Nueva venta' }).click()

    const after = await readVouchersKPI(page)
    expect(after - before).toBe(7000)
  })

  test('VENTA GRATIS: vale 100% (total 0) → clamp + se cierra sin pago, queda registrada', async ({ page }) => {
    const MESA = `Mesa Clamp ${SUFFIX}`
    await loginAsOwner(page)
    await page.goto('/ventas')
    await openShiftIfClosed(page, 0)

    await setupMesaWithItem(page, MESA)
    await openMesaCheckout(page, MESA)

    // Vale 25.000 sobre 18.000 → clamp a 18.000 (input) y total 0 (no negativo).
    await page.getByTestId('discount-vale-toggle').check()
    await page.getByTestId('discount-amount').fill('25000')
    await expect(page.getByTestId('discount-amount')).toHaveValue('18.000')
    await expect(page.getByTestId('checkout-total')).toContainText('$ 0')

    // Se cierra SIN pago: continuar dispara handleConfirm que salta el pago.
    const n = await payNequiAndFinish(page)

    const order = await orderByNumber(n)
    expect(order.total).toBe(0)
    expect(order.discount_amount).toBe(PRICE)       // vale clampeado al subtotal
    expect(order.discount_kind).toBe('vale')
    expect(await paymentCount(order.id)).toBe(0)    // sin filas en payments

    // Historial: se muestra como "Cortesía" (no en blanco, no "Fiado").
    await page.goto('/historial')
    const row = page.getByRole('button', { name: new RegExp(`^#${n}\\s`) })
    await expect(row).toBeVisible({ timeout: 15_000 })
    await expect(row.getByTestId('sale-row-method')).toContainText('Cortesía')
  })

  test('BORDE: toggle vale + monto 0 → kind=normal (no viola chk_vale_is_fixed)', async ({ page }) => {
    await loginAsOwner(page)
    await page.goto('/ventas')
    await openShiftIfClosed(page, 0)

    await addProductPOS(page)
    // Vale activado pero SIN monto → no es un vale real.
    await page.getByTestId('discount-vale-toggle').check()
    await expect(page.getByTestId('cart-total')).toContainText('18.000')  // sin descuento

    await page.getByRole('button', { name: 'Cobrar' }).click()
    const n = await payNequiAndFinish(page)
    await page.getByRole('button', { name: 'Nueva venta' }).click()

    const order = await orderByNumber(n)
    expect(order.discount_kind).toBe('normal')      // guardado, NO 'vale'
    expect(order.discount_amount).toBe(0)
    expect(order.discount_type).toBeNull()
  })

  test('limpieza: cerrar turno y borrar las mesas creadas', async ({ page }) => {
    page.on('dialog', (d) => d.accept())
    await loginAsOwner(page)
    await page.goto('/ventas')
    await closeShiftIfOpen(page)

    await page.goto('/mesas')
    await page.getByRole('button', { name: 'Configurar' }).click()
    for (const name of [`Mesa Vale ${SUFFIX}`, `Mesa Clamp ${SUFFIX}`]) {
      const del = page.locator('div')
        .filter({ has: page.getByText(name, { exact: true }) })
        .filter({ has: page.getByTitle('Eliminar mesa') })
        .last()
        .getByTitle('Eliminar mesa')
      if (await del.count() > 0) await del.click()
    }
  })
})
