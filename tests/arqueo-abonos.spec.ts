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
