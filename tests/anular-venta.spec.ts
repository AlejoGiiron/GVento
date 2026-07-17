import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { loginAsOwner, loginAsCashier, ownerCreds, cashierCreds } from './helpers/auth'
import { closeShiftIfOpen, openShiftIfClosed } from './helpers/shift'

// ============================================================================
// Anulación de ventas (register_sale_void) — cubre F2 (RPC + 6 guardas), F3
// (exclusiones por cancelled_at) y F4 (UI: botón/diálogo/badge/sección).
//
// Corre en LAB, serial. La creación de ventas se hace vía Supabase directo (RLS
// del owner: rápido y determinista); las aserciones de UI se manejan por página.
// Cada caso arma su propio dato; el turno del lab se cierra al final.
// ============================================================================

const SUFFIX = Date.now().toString().slice(-6)
const parseCOP = (t: string) => Number(t.replace(/[^\d]/g, ''))

// ── Supabase directo ────────────────────────────────────────────────────────
function loadEnv(path: string) {
  try {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* ignore */ }
}
loadEnv('.env'); loadEnv('.env.test')

let _owner: SupabaseClient | null = null
async function db(): Promise<SupabaseClient> {
  if (_owner) return _owner
  const c = createClient(process.env.VITE_GVENTO_SUPABASE_URL!, process.env.VITE_GVENTO_SUPABASE_ANON_KEY!, { auth: { persistSession: false } })
  const { email, password } = ownerCreds()
  const { error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw error
  _owner = c
  return c
}
// Cliente cajero (para el rechazo por permiso: la RPC debe negar server-side).
async function dbCajero(): Promise<SupabaseClient> {
  const c = createClient(process.env.VITE_GVENTO_SUPABASE_URL!, process.env.VITE_GVENTO_SUPABASE_ANON_KEY!, { auth: { persistSession: false } })
  const { email, password } = cashierCreds()
  const { error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw error
  return c
}

let SEDE = ''
let OWNER_ID = ''
async function ctx() {
  const c = await db()
  if (!SEDE) {
    OWNER_ID = (await c.auth.getUser()).data.user!.id
    SEDE = (await c.from('profiles').select('restaurant_id').eq('id', OWNER_ID).single()).data!.restaurant_id as string
  }
  return c
}

// Abre turno si no hay; devuelve { id, opened_at }. Idempotente (índice único).
async function ensureShift(): Promise<{ id: string; opened_at: string }> {
  const c = await ctx()
  const open = (await c.from('cash_shifts').select('id, opened_at').eq('restaurant_id', SEDE).is('closed_at', null).maybeSingle()).data
  if (open) return open as { id: string; opened_at: string }
  const ins = await c.from('cash_shifts').insert({ restaurant_id: SEDE, opened_by: OWNER_ID, opening_amount: 0 }).select('id, opened_at').single()
  if (ins.error) throw ins.error
  return ins.data as { id: string; opened_at: string }
}
async function closeShifts(): Promise<void> {
  const c = await ctx()
  await c.from('cash_shifts').update({ closed_at: new Date().toISOString(), closed_by: OWNER_ID, closing_amount: 0 }).eq('restaurant_id', SEDE).is('closed_at', null)
}

async function prodByName(name: string): Promise<{ id: string; kind: string; stock_tracking: boolean }> {
  const c = await ctx()
  const { data, error } = await c.from('products').select('id, kind, stock_tracking').eq('restaurant_id', SEDE).eq('name', name).limit(1).single()
  if (error) throw new Error(`prod ${name}: ${error.message}`)
  return data as { id: string; kind: string; stock_tracking: boolean }
}
async function stockOf(id: string): Promise<number> {
  const c = await ctx()
  const { data, error } = await c.from('products').select('stock_qty').eq('id', id).single()
  if (error) throw error
  return data!.stock_qty as number
}
async function paymentCount(orderId: string): Promise<number> {
  const c = await ctx()
  const { count, error } = await c.from('payments').select('id', { count: 'exact', head: true }).eq('order_id', orderId)
  if (error) throw error
  return count ?? 0
}
async function returnMovs(orderId: string): Promise<{ product_id: string; qty: number }[]> {
  const c = await ctx()
  const { data, error } = await c.from('stock_movements').select('product_id, qty').eq('reference_id', orderId).eq('type', 'return')
  if (error) throw error
  return (data ?? []).map((m) => ({ product_id: m.product_id as string, qty: Number(m.qty) }))
}
async function orderRow(orderId: string) {
  const c = await ctx()
  const { data, error } = await c.from('orders').select('status, cancelled_at, cancelled_by, cancel_reason, payment_status').eq('id', orderId).single()
  if (error) throw error
  return data as { status: string; cancelled_at: string | null; cancelled_by: string | null; cancel_reason: string | null; payment_status: string }
}

type Item = { product_id: string; qty: number; unit_price: number; extras?: { extra_id: string; qty: number }[] }
// Crea una venta real (order + items con descuento de stock + pago). Devuelve id + número.
async function createSale(opts: {
  items: Item[]; total: number; paid?: boolean
  payments?: { method: string; amount: number }[]
  discount?: { amount: number; kind: 'vale' | 'normal'; type: 'fixed' | 'pct' }
  customerId?: string; customerName?: string
}): Promise<{ id: string; number: number }> {
  const c = await ctx()
  const paid = opts.paid ?? true
  const insert: Record<string, unknown> = {
    type: 'takeaway', status: 'preparing', total: opts.total,
    restaurant_id: SEDE, created_by: OWNER_ID,
    payment_status: paid ? 'paid' : 'pending',
  }
  if (opts.discount) {
    insert.discount_amount = opts.discount.amount
    insert.discount_kind = opts.discount.kind
    insert.discount_type = opts.discount.type
  }
  if (opts.customerId) { insert.customer_id = opts.customerId; insert.customer_name = opts.customerName }
  const { data: order, error: oe } = await c.from('orders').insert(insert).select('id').single()
  if (oe) throw new Error('order: ' + oe.message)
  if (opts.items.length > 0) {
    const { error: ie } = await c.rpc('add_order_items_with_extras', {
      p_order_id: order!.id,
      p_items: opts.items.map((it) => ({ product_id: it.product_id, qty: it.qty, unit_price: it.unit_price, extras: it.extras ?? [] })),
    })
    if (ie) throw new Error('items: ' + ie.message)
  }
  if (paid && opts.total > 0) {
    const { error: pe } = await c.rpc('register_sale_payment', { p_order_id: order!.id, p_payments: opts.payments ?? [{ method: 'cash', amount: opts.total }] })
    if (pe) throw new Error('pay: ' + pe.message)
  }
  const n = await c.rpc('next_order_number', { p_restaurant_id: SEDE })
  if (n.error) throw n.error
  await c.from('orders').update({ order_number: n.data }).eq('id', order!.id)
  return { id: order!.id, number: n.data as number }
}
async function voidRpc(client: SupabaseClient, orderId: string, reason = 'error del cajero') {
  return client.rpc('register_sale_void', { p_order_id: orderId, p_reason: reason })
}

// ── Fixtures (creados en el setup, reutilizados) ────────────────────────────
let P_SIMPLE = ''   // simple + tracking, precio 5000
let P_NOTRK = ''    // simple SIN tracking, precio 7000
let P_INSUMO = ''   // insumo simple + tracking (para el extra vinculado)
let EXTRA = ''      // extra vinculado a P_INSUMO, asignado a P_SIMPLE
let COCTEL = ''     // seed: compuesto → 1 Lab Vaso
let VASO = ''       // seed: insumo con tracking
let CERVEZA = ''    // seed: simple SIN tracking

// ── UI helpers ──────────────────────────────────────────────────────────────
async function openSaleDetail(page: Page, number: number) {
  await page.goto('/historial')
  await page.getByTestId('sales-search').fill(String(number))
  await page.getByTestId('sale-row').filter({ hasText: `#${number}` }).first().click()
  await expect(page.getByTestId('sale-detail-modal')).toBeVisible()
}

// ── Suite ────────────────────────────────────────────────────────────────────
test.describe.serial('Anulación de ventas', () => {
  test('setup: fixtures + turno abierto', async () => {
    const c = await ctx()
    const cat = (await c.from('categories').select('id').eq('restaurant_id', SEDE).limit(1).single()).data!.id
    const mk = async (name: string, price: number, tracking: boolean, qty?: number) => {
      const { data, error } = await c.from('products').insert({
        restaurant_id: SEDE, category_id: cat, name, price, kind: 'simple',
        stock_tracking: tracking, ...(tracking ? { stock_qty: qty, min_stock: 0 } : {}),
      }).select('id').single()
      if (error) throw new Error(`mk ${name}: ${error.message}`)
      return data!.id as string
    }
    P_SIMPLE = await mk(`AV Simple ${SUFFIX}`, 5000, true, 60)
    P_NOTRK = await mk(`AV NoTrack ${SUFFIX}`, 7000, false)
    P_INSUMO = await mk(`AV Insumo ${SUFFIX}`, 0, true, 60)
    EXTRA = (await c.from('extras').insert({ restaurant_id: SEDE, name: `AV ExtraLinked ${SUFFIX}`, price: 3000, linked_product_id: P_INSUMO, is_active: true }).select('id').single()).data!.id as string
    await c.from('product_extras').insert({ product_id: P_SIMPLE, extra_id: EXTRA })
    COCTEL = (await prodByName('Lab Coctel')).id
    VASO = (await prodByName('Lab Vaso')).id
    CERVEZA = (await prodByName('Lab Cerveza')).id
    await ensureShift()
  })

  // ── EFECTOS ────────────────────────────────────────────────────────────────
  test('efecto: simple + tracking → stock vuelve, 1 return, payments borrados, marca completa', async () => {
    await ensureShift()
    const s0 = await stockOf(P_SIMPLE)
    const { id } = await createSale({ items: [{ product_id: P_SIMPLE, qty: 2, unit_price: 5000 }], total: 10000 })
    expect(await stockOf(P_SIMPLE)).toBe(s0 - 2)
    const { data, error } = await voidRpc(await db(), id)
    expect(error).toBeNull()
    expect(await stockOf(P_SIMPLE)).toBe(s0)
    const movs = await returnMovs(id)
    expect(movs).toHaveLength(1)
    expect(movs[0].qty).toBe(2)
    expect(await paymentCount(id)).toBe(0)
    const o = await orderRow(id)
    expect(o.status).toBe('cancelled')
    expect(o.cancelled_at).not.toBeNull()
    expect(o.cancelled_by).toBe(OWNER_ID)
    expect(o.cancel_reason).toBe('error del cajero')
    expect((data as { stock_returned: number; payments_deleted: number }).stock_returned).toBe(1)
    expect((data as { payments_deleted: number }).payments_deleted).toBe(1)
  })

  test('efecto: mixta → las 2 filas payments borradas', async () => {
    await ensureShift()
    const { id } = await createSale({
      items: [{ product_id: P_SIMPLE, qty: 2, unit_price: 5000 }], total: 10000,
      payments: [{ method: 'cash', amount: 6000 }, { method: 'nequi', amount: 4000 }],
    })
    expect(await paymentCount(id)).toBe(2)
    const { data, error } = await voidRpc(await db(), id)
    expect(error).toBeNull()
    expect(await paymentCount(id)).toBe(0)
    expect((data as { payments_deleted: number }).payments_deleted).toBe(2)
  })

  test('efecto: compuesto → devuelve el insumo (recipe×qty), no el compuesto', async () => {
    await ensureShift()
    const v0 = await stockOf(VASO)
    const { id } = await createSale({ items: [{ product_id: COCTEL, qty: 2, unit_price: 18000 }], total: 36000 })
    expect(await stockOf(VASO)).toBe(v0 - 2)
    const { error } = await voidRpc(await db(), id)
    expect(error).toBeNull()
    expect(await stockOf(VASO)).toBe(v0)
    const movs = await returnMovs(id)
    expect(movs.filter((m) => m.product_id === VASO)).toHaveLength(1)
    expect(movs.filter((m) => m.product_id === VASO)[0].qty).toBe(2)
    expect(movs.filter((m) => m.product_id === COCTEL)).toHaveLength(0)
  })

  test('efecto: extra vinculado → devuelve oie.qty tal cual (no re-multiplicado)', async () => {
    await ensureShift()
    const i0 = await stockOf(P_INSUMO)
    // 2 unidades con extra 1/u → oie.qty persistido = 2 (no 4).
    const { id } = await createSale({
      items: [{ product_id: P_SIMPLE, qty: 2, unit_price: 5000, extras: [{ extra_id: EXTRA, qty: 1 }] }],
      total: 16000,
    })
    expect(await stockOf(P_INSUMO)).toBe(i0 - 2)
    const { error } = await voidRpc(await db(), id)
    expect(error).toBeNull()
    expect(await stockOf(P_INSUMO)).toBe(i0)
    const onInsumo = (await returnMovs(id)).filter((m) => m.product_id === P_INSUMO)
    expect(onInsumo).toHaveLength(1)
    expect(onInsumo[0].qty).toBe(2)   // tal cual, no 4
  })

  test('efecto: sin tracking → no toca stock, 0 movements', async () => {
    await ensureShift()
    const { id, number } = await createSale({ items: [{ product_id: CERVEZA, qty: 2, unit_price: 8000 }], total: 16000 })
    const { data, error } = await voidRpc(await db(), id)
    expect(error).toBeNull()
    expect(await returnMovs(id)).toHaveLength(0)
    expect((data as { stock_returned: number }).stock_returned).toBe(0)
    expect(number).toBeGreaterThan(0)
  })

  test('efecto: fiado sin abonos → 0 payments borrados pero el stock vuelve', async () => {
    await ensureShift()
    const s0 = await stockOf(P_SIMPLE)
    const { id } = await createSale({ items: [{ product_id: P_SIMPLE, qty: 1, unit_price: 5000 }], total: 5000, paid: false })
    expect(await stockOf(P_SIMPLE)).toBe(s0 - 1)
    const { data, error } = await voidRpc(await db(), id)
    expect(error).toBeNull()
    expect(await stockOf(P_SIMPLE)).toBe(s0)
    expect((data as { payments_deleted: number; stock_returned: number; was_fiado: boolean }).payments_deleted).toBe(0)
    expect((data as { stock_returned: number }).stock_returned).toBe(1)
    expect((data as { was_fiado: boolean }).was_fiado).toBe(true)
  })

  // ── RECHAZOS (server-side) ──────────────────────────────────────────────────
  test('rechazo: sin permiso (cajero) → RPC niega + botón anular no visible en el historial', async ({ page }) => {
    await ensureShift()
    const { id, number } = await createSale({ items: [{ product_id: P_SIMPLE, qty: 1, unit_price: 5000 }], total: 5000 })
    // Garantía server-side: la RPC niega al cajero (sin ventas.anular).
    const { error } = await voidRpc(await dbCajero(), id)
    expect(error?.message ?? '').toContain('No autorizado')
    // UI (barrera en el lugar correcto): el cajero SÍ ve el historial (tiene
    // ventas.historial, igual que en prod) y abre el detalle de la venta, pero
    // el botón "Anular venta" NO se renderiza (sin ventas.anular). Está en la
    // pantalla de anular y aun así no puede.
    await loginAsCashier(page)
    await openSaleDetail(page, number)
    await expect(page.getByTestId('sale-void-button')).toHaveCount(0)
    // limpieza: anular de verdad como owner (no dejar la venta viva)
    await voidRpc(await db(), id)
  })

  test('rechazo: turno cerrado → RPC niega (devolución) + botón deshabilitado con tooltip', async ({ page }) => {
    // Venta en un turno, luego se cierra y se abre otro → la venta es de un turno cerrado.
    await ensureShift()
    const { id, number } = await createSale({ items: [{ product_id: P_SIMPLE, qty: 1, unit_price: 5000 }], total: 5000 })
    await closeShifts()
    await ensureShift()   // turno nuevo: la venta quedó antes de su opened_at
    const { error } = await voidRpc(await db(), id)
    expect(error?.message ?? '').toContain('turno cerrado')
    // UI: botón visible pero DESHABILITADO con el tooltip = mensaje de la RPC
    await loginAsOwner(page)
    await openSaleDetail(page, number)
    const btn = page.getByTestId('sale-void-button')
    await expect(btn).toBeVisible()
    await expect(btn).toBeDisabled()
    await expect(btn).toHaveAttribute('title', /turno cerrado.*devolución/)
  })

  test('rechazo: re-anular una venta ya anulada → niega', async () => {
    await ensureShift()
    const { id } = await createSale({ items: [{ product_id: P_SIMPLE, qty: 1, unit_price: 5000 }], total: 5000 })
    expect((await voidRpc(await db(), id)).error).toBeNull()
    const { error } = await voidRpc(await db(), id)
    expect(error?.message ?? '').toContain('ya está anulada')
  })

  test('rechazo: fiado con abono → niega', async () => {
    await ensureShift()
    const c = await ctx()
    const { id } = await createSale({ items: [{ product_id: P_SIMPLE, qty: 1, unit_price: 5000 }], total: 5000, paid: false })
    const { error: ae } = await c.from('debt_payments').insert({ restaurant_id: SEDE, order_id: id, amount: 1000, payment_method: 'cash', created_by: OWNER_ID })
    expect(ae).toBeNull()
    const { error } = await voidRpc(await db(), id)
    expect(error?.message ?? '').toContain('ya tiene abonos')
  })

  test('rechazo: sin turno abierto → niega', async () => {
    await ensureShift()
    const { id } = await createSale({ items: [{ product_id: P_SIMPLE, qty: 1, unit_price: 5000 }], total: 5000, paid: false })
    await closeShifts()
    const { error } = await voidRpc(await db(), id)
    expect(error?.message ?? '').toContain('No hay un turno')
  })

  // ── EXCLUSIONES (Fase 3) ─────────────────────────────────────────────────────
  test('exclusión: fiado anulado sale de Cartera (getDebts)', async ({ page }) => {
    await ensureShift()
    const c = await ctx()
    const cliente = `AV Fiado ${SUFFIX}`
    const cust = (await c.from('customers').insert({ restaurant_id: SEDE, name: cliente }).select('id').single()).data!.id as string
    const { id } = await createSale({ items: [{ product_id: P_SIMPLE, qty: 1, unit_price: 5000 }], total: 5000, paid: false, customerId: cust, customerName: cliente })

    // Antes de anular: el cliente aparece en Cartera (deuda pendiente).
    await loginAsOwner(page)
    await page.goto('/fiado')
    await expect(page.getByTestId('customer-row').filter({ hasText: cliente })).toBeVisible()

    // Anular → getDebts excluye por cancelled_at → el cliente ya NO aparece.
    expect((await voidRpc(await db(), id)).error).toBeNull()
    await page.goto('/fiado')
    await expect(page.getByTestId('customer-row')).toBeVisible()   // la lista cargó
    await expect(page.getByTestId('customer-row').filter({ hasText: cliente })).toHaveCount(0)
  })

  test('exclusión: vale/venta gratis anulada sale del conteo y de vouchers (arqueo)', async ({ page }) => {
    // Turno fresco y determinista para el snapshot.
    await loginAsOwner(page)
    await page.goto('/ventas')
    await closeShiftIfOpen(page)
    await openShiftIfClosed(page, 0)
    await ctx()
    const fresh = (await (await db()).from('cash_shifts').select('id').eq('restaurant_id', SEDE).is('closed_at', null).order('opened_at', { ascending: false }).limit(1).single()).data
    const shiftId = fresh!.id as string

    // Una venta gratis (vale 100%) VIVA y otra ANULADA, ambas en el turno.
    await createSale({ items: [{ product_id: P_SIMPLE, qty: 1, unit_price: 3000 }], total: 0, paid: true, discount: { amount: 3000, kind: 'vale', type: 'fixed' } })   // viva
    const anulada = await createSale({ items: [{ product_id: P_SIMPLE, qty: 1, unit_price: 5000 }], total: 0, paid: true, discount: { amount: 5000, kind: 'vale', type: 'fixed' } })
    expect((await voidRpc(await db(), anulada.id)).error).toBeNull()

    // Cerrar turno (la mutación calcula sales_count + vouchers con los filtros F3).
    await page.goto('/ventas')
    await closeShiftIfOpen(page)

    const { data, error } = await (await db()).from('cash_shifts').select('close_reconciliation').eq('id', shiftId).single()
    expect(error).toBeNull()
    const rec = data!.close_reconciliation as { vouchers_total: number; sales_count: number }
    // Solo el vale VIVO cuenta: vouchers_total = 3000 (no 8000), y la gratis
    // anulada no suma al conteo de ventas.
    expect(rec.vouchers_total).toBe(3000)
    expect(rec.sales_count).toBe(1)
  })

  // ── UI (Fase 4) ──────────────────────────────────────────────────────────────
  test('UI: diálogo con motivo obligatorio + badge con motivo/quién en fila y modal', async ({ page }) => {
    await ensureShift()
    const { number } = await createSale({ items: [{ product_id: P_SIMPLE, qty: 1, unit_price: 5000 }], total: 5000 })

    await loginAsOwner(page)
    await openSaleDetail(page, number)

    // Botón habilitado → abre el diálogo; confirmar bloqueado con motivo vacío.
    await page.getByTestId('sale-void-button').click()
    await expect(page.getByTestId('sale-void-dialog')).toBeVisible()
    await expect(page.getByTestId('sale-void-confirm')).toBeDisabled()
    await page.getByTestId('sale-void-reason').fill('cliente se arrepintió')
    await expect(page.getByTestId('sale-void-confirm')).toBeEnabled()
    await page.getByTestId('sale-void-confirm').click()

    // El modal repinta el badge "Anulada" con el motivo (sin cerrarse).
    const badge = page.getByTestId('sale-detail-modal').getByTestId('sale-voided-badge')
    await expect(badge).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('sale-detail-modal')).toContainText('cliente se arrepintió')
    // Ya anulada: el botón de anular desaparece.
    await expect(page.getByTestId('sale-void-button')).toHaveCount(0)

    // La fila del historial muestra el badge (navegar desmonta el modal).
    await page.goto('/historial')
    await page.getByTestId('sales-search').fill(String(number))
    await expect(page.getByTestId('sale-row').filter({ hasText: `#${number}` }).getByTestId('sale-voided-badge')).toBeVisible()
  })

  test('UI: con filtro de método, la anulada sale de la lista y aparece en cancelled-sales-section', async ({ page }) => {
    await ensureShift()
    const { id, number } = await createSale({ items: [{ product_id: P_SIMPLE, qty: 1, unit_price: 5000 }], total: 5000, payments: [{ method: 'cash', amount: 5000 }] })
    expect((await voidRpc(await db(), id)).error).toBeNull()

    await loginAsOwner(page)
    await page.goto('/historial')
    // Filtro de método = Efectivo (cash).
    await page.getByTestId('sales-method').selectOption('cash')

    // La anulada NO está en la lista paginada (perdió sus payments)...
    await expect(page.getByTestId('sale-row').filter({ hasText: `#${number}` })).toHaveCount(0)
    // ...pero SÍ en la sección "Anuladas", con su badge y clickeable al detalle.
    const section = page.getByTestId('cancelled-sales-section')
    await expect(section).toBeVisible()
    const row = section.getByTestId('cancelled-sale-row').filter({ hasText: `#${number}` })
    await expect(row).toBeVisible()
    await expect(row.getByTestId('sale-voided-badge')).toBeVisible()
    await row.click()
    await expect(page.getByTestId('sale-detail-modal').getByTestId('sale-voided-badge')).toBeVisible()
  })

  // ── Limpieza ─────────────────────────────────────────────────────────────────
  test('limpieza: borrar residuo fiado + cerrar turno del lab', async ({ page }) => {
    // Este spec deja fiados pending que NO se pueden anular (p. ej. el de
    // "fiado con abono"). Se borran para no contaminar el baseline de Cartera de
    // otros specs (getDebts los vería como deuda viva).
    const c = await ctx()
    const pend = ((await c.from('orders').select('id').eq('restaurant_id', SEDE).in('payment_status', ['pending', 'partial']).is('cancelled_at', null)).data ?? []).map((o) => o.id)
    if (pend.length) {
      await c.from('debt_payments').delete().in('order_id', pend)
      await c.from('orders').delete().in('id', pend)
    }
    await loginAsOwner(page)
    await page.goto('/ventas')
    await closeShiftIfOpen(page)
  })
})
