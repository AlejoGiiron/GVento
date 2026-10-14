import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ownerCreds, cashierCreds, login } from './helpers/auth'
import { cliente, psql, sesionRetenida, invarianteTurno, invarianteMetodos } from './helpers/db-local'

// ============================================================================
// supabase/arqueo-abonos.sql — el esperado de TARJETA, TRANSFERENCIA y NEQUI en el cierre
// incluye los abonos de fiado de ese método cobrados en el turno; el EFECTIVO no cambia
// (su abono ya es un ingreso de caja). El abono toma el turno abierto FOR SHARE con
// cualquier método y queda ligado por debt_payments.shift_id. Contra eso se mide:
// el cierre congelado (servidor), la pantalla de cierre (esperadoMetodo) y el invariante
// recalculado desde la base. Base LOCAL de Docker; anon key + login de LAB.
// ============================================================================

let owner: SupabaseClient
let cajero: SupabaseClient
let OWNER_ID = ''
let SEDE = ''
let P_CERVEZA = ''
const ordenes: string[] = []
const clientes: string[] = []

test.beforeAll(async () => {
  const o = await cliente(ownerCreds())
  const c = await cliente(cashierCreds())
  expect(c.sede, 'owner y cajero en la misma sede').toBe(o.sede)
  owner = o.c; cajero = c.c; OWNER_ID = o.uid; SEDE = o.sede
  P_CERVEZA = psql(`select id from public.products where restaurant_id = '${SEDE}' and name = 'Lab Cerveza';`)
})

test.afterAll(() => {
  const lista = (xs: string[]) => xs.map((id) => `'${id}'`).join(',') || 'null'
  psql(`begin;
    delete from public.payments where order_id in (${lista(ordenes)});
    delete from public.orders where id in (${lista(ordenes)});
    delete from public.customers where id in (${lista(clientes)});
    commit;`)
  expect(psql(`select count(*) from public.orders where id in (${lista(ordenes)});`), 'residuos del spec').toBe('0')
})

async function sinTurno() {
  const abierto = (await owner.from('cash_shifts').select('id').eq('restaurant_id', SEDE).is('closed_at', null).maybeSingle()).data
  if (abierto) {
    const { error } = await owner.rpc('close_cash_shift', { p_shift_id: abierto.id, p_declarado: { cash: 0 } })
    if (error) throw error
  }
}
async function turnoNuevo(): Promise<string> {
  await sinTurno()
  const { data, error } = await owner.from('cash_shifts')
    .insert({ restaurant_id: SEDE, opened_by: OWNER_ID, opening_amount: 0 }).select('id').single()
  if (error) throw error
  return data!.id as string
}
/** Una venta a fiado pendiente por `total`. */
async function fiado(total: number): Promise<string> {
  const cli = (await owner.from('customers').insert({ restaurant_id: SEDE, name: `E2E AQ ${Date.now()}` }).select('id').single()).data!.id as string
  clientes.push(cli)
  const { data, error } = await owner.from('orders').insert({
    restaurant_id: SEDE, type: 'takeaway', status: 'delivered', created_by: OWNER_ID,
    total, payment_status: 'pending', customer_id: cli,
  }).select('id').single()
  if (error) throw error
  ordenes.push(data.id as string)
  return data.id as string
}
/** Una venta del POS por Nequi (para que el esperado de Nequi tenga ventas además de abonos). */
async function ventaNequi(): Promise<void> {
  const id = randomUUID()
  const r = await cajero.rpc('register_pos_sale', {
    p_sale_id: id, p_order: { type: 'takeaway', total: 8000 },
    p_items: [{ product_id: P_CERVEZA, qty: 1, unit_price: 8000, extras: [] }],
    p_payments: [{ method: 'nequi', amount: 8000 }],
  })
  expect(r.error, r.error?.message).toBeNull()
  ordenes.push(id)
}
const abonar = (orden: string, monto: number, metodo: string) =>
  cajero.rpc('register_debt_payment', { p_order_id: orden, p_amount: monto, p_payment_method: metodo })
const cerrar = (turno: string, declarado: Record<string, number>) =>
  owner.rpc('close_cash_shift', { p_shift_id: turno, p_declarado: declarado })
const metodos = (turno: string) => JSON.parse(psql(`select close_reconciliation::text from public.cash_shifts where id = '${turno}';`)) as {
  methods: Record<string, { expected: number; declared: number; difference: number; abonos?: number }>
  expected_total: number
}
const textoReconciliacion = (turno: string, ruta: string) => psql(`select close_reconciliation${ruta} from public.cash_shifts where id = '${turno}';`)

test.describe('Arqueo con abonos de fiado', () => {
  test('abono por Nequi con turno: entra al esperado de Nequi del cierre, ligado al turno', async () => {
    const turno = await turnoNuevo()
    await ventaNequi()
    const orden = await fiado(10000)
    const r = await abonar(orden, 3000, 'nequi')
    expect(r.error, r.error?.message).toBeNull()
    expect(psql(`select shift_id from public.debt_payments where order_id = '${orden}';`)).toBe(turno)
    expect((await cerrar(turno, { cash: 0, nequi: 11000 })).error).toBeNull()
    const m = metodos(turno)
    expect(m.methods.nequi).toMatchObject({ expected: 11000, declared: 11000, difference: 0, abonos: 3000 })
    // El precheck de la fase 2 reconoce un cierre del servidor por los 2 decimales.
    expect(textoReconciliacion(turno, "->>'expected_total'")).toMatch(/^-?\d+\.\d{2}$/)
    expect(textoReconciliacion(turno, "->'methods'->'cash'->>'expected'")).toMatch(/^-?\d+\.\d{2}$/)
    const inv = invarianteMetodos(turno)
    for (const k of ['card', 'transfer', 'nequi'] as const) expect(inv[k].congelado, k).toBe(inv[k].recalculado)
  })

  test('abono por Nequi SIN turno abierto: queda sin turno y no entra a ningún arqueo', async () => {
    await sinTurno()
    const orden = await fiado(10000)
    expect((await abonar(orden, 3000, 'nequi')).error).toBeNull()
    expect(psql(`select coalesce(shift_id::text, 'null') from public.debt_payments where order_id = '${orden}';`)).toBe('null')
    const turno = await turnoNuevo()
    expect((await cerrar(turno, { cash: 0 })).error).toBeNull()
    expect(metodos(turno).methods.nequi).toMatchObject({ expected: 0, abonos: 0 })
  })

  test('abono en EFECTIVO: entra UNA vez al esperado (como ingreso de caja), no dos', async () => {
    const turno = await turnoNuevo()
    const orden = await fiado(10000)
    expect((await abonar(orden, 5000, 'cash')).error).toBeNull()
    expect(psql(`select shift_id from public.debt_payments where order_id = '${orden}';`)).toBe(turno)
    expect((await cerrar(turno, { cash: 5000 })).error).toBeNull()
    const m = metodos(turno)
    expect(m.methods.cash).toMatchObject({ expected: 5000, difference: 0 })
    expect(m.methods.cash.abonos, 'el efectivo no lleva abonos aparte: ya están en los ingresos').toBeUndefined()
    const inv = invarianteTurno(turno)
    expect(inv.congelado).toBe(inv.recalculado)
  })

  test('abono en LOTE por transferencia: todos sus abonos entran al turno', async () => {
    const turno = await turnoNuevo()
    const a = await fiado(4000)
    const b = await fiado(6000)
    const cli = psql(`select customer_id from public.orders where id = '${a}';`)
    psql(`update public.orders set customer_id = '${cli}' where id = '${b}';`)
    const r = await cajero.rpc('register_debt_payments_batch', { p_order_ids: [a, b], p_amount: 7000, p_payment_method: 'transfer' })
    expect(r.error, r.error?.message).toBeNull()
    expect(psql(`select count(*) || '|' || count(*) filter (where shift_id = '${turno}') from public.debt_payments where order_id in ('${a}', '${b}');`)).toBe('2|2')
    expect((await cerrar(turno, { cash: 0, transfer: 7000 })).error).toBeNull()
    expect(metodos(turno).methods.transfer).toMatchObject({ expected: 7000, abonos: 7000, difference: 0 })
  })

  test('ABONO por Nequi vs CIERRE: el abono ESPERA al cierre, queda fuera, y el congelado = el recalculado', async () => {
    const turno = await turnoNuevo()
    const orden = await fiado(10000)
    const { fin } = await sesionRetenida(OWNER_ID, `select public.close_cash_shift('${turno}', '{"cash": 0}'::jsonb, null)`, 3)
    const t0 = Date.now()
    const r = await abonar(orden, 3000, 'nequi')
    const espero = Date.now() - t0
    await fin
    expect(r.error, r.error?.message).toBeNull()
    expect(espero, 'el abono no esperó al cierre (no tomó el turno)').toBeGreaterThan(1000)
    expect(psql(`select coalesce(shift_id::text, 'null') from public.debt_payments where order_id = '${orden}';`), 'el abono quedó en un turno ya cerrado').toBe('null')
    const inv = invarianteMetodos(turno)
    expect(inv.nequi.congelado).toBe(inv.nequi.recalculado)
  })

  test('la PANTALLA de cierre muestra el esperado de Nequi con sus abonos, igual que el servidor', async ({ page }) => {
    const turno = await turnoNuevo()
    await ventaNequi()
    const orden = await fiado(10000)
    expect((await abonar(orden, 3000, 'nequi')).error).toBeNull()
    await login(page, ownerCreds())
    await page.getByRole('button', { name: 'Cerrar turno', exact: true }).first().click()
    await expect(page.getByText('Cerrar turno de caja')).toBeVisible()
    await expect(page.getByTestId('pay-abonos-nequi')).toHaveText(/incluye abonos \$\s?3\.000/)
    await page.getByTestId('close-shift-declared').fill('0')
    await page.getByTestId('pay-declared-nequi').fill('11000')
    await expect(page.getByTestId('pay-diff-nequi')).toHaveText(/\$\s?0$/)
    await page.getByRole('button', { name: 'Confirmar cierre' }).click()
    await expect(page.getByText('Sin turno')).toBeVisible({ timeout: 15_000 })
    expect(metodos(turno).methods.nequi).toMatchObject({ expected: 11000, difference: 0 })
  })
})

// ── Abonos FUERA de las ventas (fix/abonos-fuera-de-ventas, 2026-10-13) ──────────────────
// Antes: el detalle y el comprobante derivaban las "ventas" del esperado, que desde
// arqueo-abonos.sql incluye los abonos ("Nequi $5.000 · 0 vta(s)"), y el abono en efectivo
// salía como "Ingresos" / "Ingresos manuales". El esperado del arqueo NO cambia.
test.describe('Abonos fuera de las ventas: cierre, comprobante y detalle del turno', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      ;(window as unknown as { __arqueoPrinted: string | null }).__arqueoPrinted = null
      window.print = () => {
        ;(window as unknown as { __arqueoPrinted: string | null }).__arqueoPrinted =
          document.getElementById('gvento-cash-report-content')?.innerHTML ?? null
      }
    })
  })

  test('venta Nequi 8.000 + abono Nequi 5.000 + abono efectivo 3.000 + ingreso manual 2.000', async ({ page }) => {
    test.setTimeout(90_000)
    await sinTurno()
    const APERTURA = 60_000 + Math.floor(Math.random() * 9_000)    // única: localiza la fila del historial
    const { data: t, error } = await owner.from('cash_shifts')
      .insert({ restaurant_id: SEDE, opened_by: OWNER_ID, opening_amount: APERTURA }).select('id').single()
    if (error) throw error
    const turno = t!.id as string
    await ventaNequi()
    const orden = await fiado(20_000)
    expect((await abonar(orden, 5_000, 'nequi')).error).toBeNull()
    expect((await abonar(orden, 3_000, 'cash')).error).toBeNull()
    const manual = await owner.from('cash_movements')
      .insert({ shift_id: turno, restaurant_id: SEDE, type: 'in', amount: 2_000, reason: 'E2E ingreso manual', created_by: OWNER_ID })
    expect(manual.error).toBeNull()

    await login(page, ownerCreds())

    // ── Movimientos del turno abierto: la fila del abono dice que es un abono; la manual, no.
    await page.getByRole('button', { name: 'Movimientos' }).click()
    await expect(page.getByText('Movimientos manuales', { exact: true })).toBeVisible()
    const items = page.getByTestId('movement-item')
    await expect(items.filter({ hasText: 'Abono de' }).getByTestId('movement-abono')).toHaveText('Abono de fiado')
    await expect(items.filter({ hasText: 'E2E ingreso manual' }).getByTestId('movement-abono')).toHaveCount(0)
    await page.getByTestId('movements-close').click()

    // ── Cierre en vivo: los ingresos manuales sin el abono; el esperado de efectivo, con todo.
    await page.getByRole('button', { name: 'Cerrar turno', exact: true }).first().click()
    await expect(page.getByText('Cerrar turno de caja')).toBeVisible()
    await expect(page.getByTestId('shift-ingresos-manuales')).toHaveText(/\$\s?2\.000/)
    await expect(page.getByTestId('shift-abonos-efectivo')).toHaveText(/\$\s?3\.000/)
    await expect(page.getByTestId('shift-sales-nequi')).toHaveText(/\$\s?8\.000/)
    const esperadoEfectivo = APERTURA + 5_000
    await page.getByTestId('close-shift-declared').fill(String(esperadoEfectivo))
    await page.getByTestId('pay-declared-nequi').fill('13000')
    await page.getByRole('button', { name: 'Confirmar cierre' }).click()
    await expect(page.getByText('Sin turno')).toBeVisible({ timeout: 15_000 })
    expect(metodos(turno).methods.nequi).toMatchObject({ expected: 13_000, difference: 0 })   // el arqueo no cambia

    // ── Comprobante del cierre: ventas sin abonos, abonos aparte, ingresos separados.
    await expect.poll(() => page.evaluate(() => (window as unknown as { __arqueoPrinted: string | null }).__arqueoPrinted),
      { timeout: 10_000 }).not.toBeNull()
    const html = (await page.evaluate(() => (window as unknown as { __arqueoPrinted: string | null }).__arqueoPrinted))!
    const linea = (etiqueta: string) =>
      // innerHTML serializa el espacio duro de Intl.NumberFormat como &nbsp;
      html.match(new RegExp(`<span>${etiqueta}</span><span[^>]*>([^<]*)</span>`))?.[1].replace(/&nbsp;|\s+/g, ' ').replace(/ +/g, ' ').trim()
    expect(linea('Total ventas')).toMatch(/^\$ 8\.000 · 1 vta\(s\)$/)
    expect(html).toContain('ABONOS DE FIADO')
    expect(linea('Total abonos')).toMatch(/^\$ 8\.000$/)
    expect(linea('Ingresos manuales')).toMatch(/^\+\$ 2\.000$/)
    expect(linea('Abonos en efectivo')).toMatch(/^\+\$ 3\.000$/)

    // ── Detalle del turno en el historial: lo mismo que el papel.
    await page.goto('/historial-turnos')
    const row = page.getByTestId('shift-history-row')
      .filter({ has: page.getByTestId('shift-opening').filter({ hasText: APERTURA.toLocaleString('es-CO') }) })
    await expect(row).toBeVisible({ timeout: 15_000 })
    await row.getByTestId('shift-detail-btn').click()
    const modal = page.getByTestId('shift-detail-modal')
    await expect(modal.getByTestId('detail-sales-nequi')).toHaveText(/\$\s?8\.000/)
    await expect(modal.getByTestId('detail-sales-total')).toContainText(/\$\s?8\.000/)
    await expect(modal.getByTestId('detail-abonos-nequi')).toHaveText(/\$\s?5\.000/)
    await expect(modal.getByTestId('detail-abonos-cash')).toHaveText(/\$\s?3\.000/)
    await expect(modal.getByTestId('detail-abonos-total')).toHaveText(/\$\s?8\.000/)
    await expect(modal.getByTestId('detail-mov-in')).toHaveText(/\$\s?2\.000/)
    await expect(modal.getByTestId('detail-mov-abonos')).toHaveText(/\$\s?3\.000/)
    await expect(modal.getByTestId('detail-arqueo-nequi')).toContainText(/\$\s?13\.000/)    // esperado congelado

    // Contraste en el mismo detalle: un método sin abonos no aparece en la sección.
    await expect(modal.getByTestId('detail-abonos-card')).toHaveCount(0)
  })
})
