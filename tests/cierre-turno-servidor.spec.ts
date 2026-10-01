import { test, expect, type Page } from '@playwright/test'
import { spawn, spawnSync } from 'node:child_process'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { loginAsOwner, ownerCreds, cashierCreds, type Creds } from './helpers/auth'
import { closeShiftIfOpen, openShiftIfClosed } from './helpers/shift'

// ============================================================================
// El cierre de turno en el SERVIDOR y el protocolo de locks del turno
// (supabase/close-cash-shift.sql).
//
// UN INVARIANTE para todas las carreras: el arqueo congelado es el que se
// RECALCULA desde la base —
//   expected_amount = apertura + pagos en efectivo en [opened_at, closed_at]
//                     + ingresos − egresos (cash_movements del turno)
// Si un abono, un movimiento o una anulación cambia las cifras del turno
// mientras se cierra (o después), el invariante se rompe.
//
// Cómo se fuerza la carrera sin depender del azar: un CIERRE LENTO — una sesión
// psql autenticada como el owner que llama close_cash_shift y RETIENE la
// transacción (pg_sleep) antes de confirmar. Mientras la retiene, el turno está
// tomado FOR UPDATE. Se espera a verla dormida en pg_stat_activity (no un sleep
// a ciegas) y recién ahí se dispara el escritor por la API real.
//
// Base LOCAL de Docker (playwright.config.ts garantiza loopback): el psql va
// contra el contenedor supabase_db_gvento.
// ============================================================================

const DB = 'supabase_db_gvento'
const APERTURA = 100000
const ESPERA_CIERRE_S = 3

function psql(sql: string): string {
  const r = spawnSync('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'],
    { input: sql, encoding: 'utf-8' })
  if (r.status !== 0) throw new Error(`psql: ${r.stderr}`)
  return r.stdout.trim()
}

async function cliente(creds: Creds): Promise<SupabaseClient> {
  const c = createClient(process.env.VITE_GVENTO_SUPABASE_URL!, process.env.VITE_GVENTO_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } })
  const { error } = await c.auth.signInWithPassword(creds)
  if (error) throw error
  return c
}

let owner: SupabaseClient
let cajero: SupabaseClient
let OWNER_ID = ''
let SEDE = ''

test.beforeAll(async () => {
  owner = await cliente(ownerCreds())
  cajero = await cliente(cashierCreds())
  OWNER_ID = (await owner.auth.getUser()).data.user!.id
  SEDE = (await owner.rpc('get_my_restaurant_id')).data as string
})

/** Cierra lo que haya abierto (por la RPC) y abre un turno limpio. */
async function turnoNuevo(): Promise<string> {
  const abierto = (await owner.from('cash_shifts').select('id').eq('restaurant_id', SEDE).is('closed_at', null).maybeSingle()).data
  if (abierto) {
    const { error } = await owner.rpc('close_cash_shift', { p_shift_id: abierto.id, p_declarado: { cash: 0 } })
    if (error) throw new Error(`cerrar turno previo: ${error.message}`)
  }
  const { data, error } = await owner.from('cash_shifts')
    .insert({ restaurant_id: SEDE, opened_by: OWNER_ID, opening_amount: APERTURA }).select('id').single()
  if (error) throw error
  return data!.id as string
}

/** El invariante: arqueo congelado == recalculado desde la base. */
function invariante(shiftId: string): { congelado: number; recalculado: number } {
  const [congelado, recalculado] = psql(`
    select s.expected_amount,
           s.opening_amount
           + coalesce((select sum(p.amount) from public.payments p
                        where p.restaurant_id = s.restaurant_id and p.method = 'cash'
                          and p.created_at >= s.opened_at and p.created_at <= s.closed_at), 0)
           -- Cada suma se coalesce POR SEPARADO: sum() sin filas es NULL, y
           -- NULL − egresos = NULL, que un coalesce de afuera volvía 0 tragándose
           -- los egresos (le pasó a la primera versión de este test).
           + (select coalesce(sum(m.amount) filter (where m.type = 'in'), 0)
                   - coalesce(sum(m.amount) filter (where m.type = 'out'), 0)
                from public.cash_movements m where m.shift_id = s.id)
      from public.cash_shifts s where s.id = '${shiftId}';`).split('|').map(Number)
  return { congelado, recalculado }
}

/**
 * Cierre LENTO: close_cash_shift como el owner, y la transacción retenida
 * ESPERA_CIERRE_S segundos antes de confirmar. Resuelve cuando la sesión ya está
 * dormida (el turno está tomado FOR UPDATE); `fin` resuelve cuando confirma.
 */
async function cierreLento(shiftId: string): Promise<{ fin: Promise<void> }> {
  const marca = `cierre_lento_${Date.now()}`
  const sql = `begin;
select set_config('request.jwt.claims', '{"sub":"${OWNER_ID}","role":"authenticated"}', true);
set local role authenticated;
select public.close_cash_shift('${shiftId}', '{"cash": 0}'::jsonb, null);
select pg_sleep(${ESPERA_CIERRE_S}) /* ${marca} */;
commit;`
  const p = spawn('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'])
  let err = ''
  p.stderr.on('data', (d) => { err += d })
  const fin = new Promise<void>((ok, ko) => p.on('close', (code) => (code === 0 ? ok() : ko(new Error(`cierre lento: ${err}`)))))
  p.stdin.end(sql)
  // Esperar a verla DORMIDA (= close_cash_shift ya tomó el turno y calculó).
  for (let i = 0; i < 60; i++) {
    if (psql(`select count(*) from pg_stat_activity where query like '%${marca}%' and query not like '%pg_stat_activity%';`) === '1') {
      return { fin }
    }
    await new Promise((ok) => setTimeout(ok, 100))
  }
  throw new Error('el cierre lento nunca llegó al pg_sleep')
}

async function ordenFiado(total: number): Promise<string> {
  const cli = (await owner.from('customers').insert({ restaurant_id: SEDE, name: `E2E Cierre ${Date.now()}` }).select('id').single()).data!.id
  const { data, error } = await owner.from('orders').insert({
    restaurant_id: SEDE, type: 'takeaway', status: 'delivered', created_by: OWNER_ID,
    total, payment_status: 'pending', customer_id: cli,
  }).select('id').single()
  if (error) throw error
  return data!.id as string
}

async function ventaCobrada(total: number): Promise<string> {
  const { data, error } = await owner.from('orders').insert({
    restaurant_id: SEDE, type: 'takeaway', status: 'delivered', created_by: OWNER_ID, total,
  }).select('id').single()
  if (error) throw error
  const pago = await owner.rpc('register_sale_payment', { p_order_id: data!.id, p_payments: [{ method: 'cash', amount: total }] })
  if (pago.error) throw pago.error
  return data!.id as string
}

test.describe.serial('Cierre de turno en el servidor', () => {
  test('el escenario medido: egreso y cierre enseguida con la red lenta → se congela el esperado CORRECTO', async ({ page }) => {
    // Medido el 2026-09-21 (nube): con el GET de cash_movements demorado 2 s y
    // cerrando sin pausa, se congelaba la apertura SIN el egreso (3/3).
    const EGRESO = 10000 + (Date.now() % 900)
    await loginAsOwner(page)
    await page.goto('/ventas')
    await closeShiftIfOpen(page)
    await openShiftIfClosed(page, APERTURA)
    await page.route(/\/rest\/v1\/cash_movements/, async (r) => {
      if (r.request().method() === 'GET') await new Promise((ok) => setTimeout(ok, 2000))
      await r.continue()
    })
    await registrarEgreso(page, EGRESO)
    await page.getByRole('button', { name: 'Cerrar turno', exact: true }).click()
    await expect(page.getByText('Cerrar turno de caja')).toBeVisible()
    await page.getByTestId('close-shift-declared').fill('1000')
    await page.getByRole('button', { name: 'Confirmar cierre' }).click()
    await expect(page.getByText('Sin turno')).toBeVisible({ timeout: 15_000 })
    await page.unrouteAll({ behavior: 'ignoreErrors' })

    const ultimo = psql(`select id || '|' || expected_amount from public.cash_shifts
                          where restaurant_id = '${SEDE}' order by closed_at desc nulls last limit 1;`)
    const [id, congelado] = ultimo.split('|')
    expect(Number(congelado), 'se congeló el esperado del navegador (sin el egreso)').toBe(APERTURA - EGRESO)
    const inv = invariante(id)
    expect(inv.congelado).toBe(inv.recalculado)
  })

  test('el camino viejo está cerrado: un UPDATE directo que intenta cerrar da 42501', async () => {
    const turno = await turnoNuevo()
    const { error } = await owner.from('cash_shifts')
      .update({ closed_at: new Date().toISOString(), closed_by: OWNER_ID, closing_amount: 0, expected_amount: 999 })
      .eq('id', turno)
    expect(error?.code, `el UPDATE directo pasó: ${error?.message}`).toBe('42501')
    expect(psql(`select closed_at is null from public.cash_shifts where id = '${turno}';`)).toBe('t')
  })

  test('un movimiento a un turno CERRADO se rechaza', async () => {
    const turno = await turnoNuevo()
    expect((await owner.rpc('close_cash_shift', { p_shift_id: turno, p_declarado: { cash: 0 } })).error).toBeNull()
    const { error } = await owner.from('cash_movements').insert({
      shift_id: turno, restaurant_id: SEDE, type: 'out', amount: 5000, reason: 'E2E tarde', created_by: OWNER_ID,
    })
    expect(error?.message ?? '', 'se registró un movimiento en un turno cerrado').toMatch(/turno de caja ya está cerrado/)
    expect(psql(`select count(*) from public.cash_movements where shift_id = '${turno}';`)).toBe('0')
  })

  test('un movimiento de un turno CERRADO no se puede borrar ni mover a otro turno', async () => {
    const turno = await turnoNuevo()
    const mov = async (amount: number) => (await owner.from('cash_movements').insert({
      shift_id: turno, restaurant_id: SEDE, type: 'out', amount, reason: 'E2E borrar', created_by: OWNER_ID,
    }).select('id').single()).data!.id as string
    const [queda, sobra] = [await mov(4000), await mov(1000)]

    // Control positivo: con el turno ABIERTO, borrar sí se puede. Si esto
    // fallara, el rechazo de abajo no probaría nada sobre el turno cerrado.
    const abierto = await cajero.from('cash_movements').delete().eq('id', sobra)
    expect(abierto.error, abierto.error?.message).toBeNull()
    expect(psql(`select count(*) from public.cash_movements where id = '${sobra}';`)).toBe('0')

    expect((await owner.rpc('close_cash_shift', { p_shift_id: turno, p_declarado: { cash: 0 } })).error).toBeNull()

    const borrar = await cajero.from('cash_movements').delete().eq('id', queda)
    expect(borrar.error?.message ?? '', 'se borró un movimiento de un turno cerrado').toMatch(/turno de caja ya está cerrado: sus movimientos no se pueden borrar/)

    // Mover el movimiento a un turno ABIERTO también lo saca del arqueo congelado.
    const otro = await turnoNuevo()
    const mover = await owner.from('cash_movements').update({ shift_id: otro }).eq('id', queda)
    expect(mover.error?.message ?? '', 'se movió un movimiento fuera de un turno cerrado').toMatch(/turno de caja ya está cerrado/)

    expect(psql(`select shift_id from public.cash_movements where id = '${queda}';`)).toBe(turno)
    const inv = invariante(turno)
    expect(inv.congelado).toBe(inv.recalculado)
  })

  test('CARRERA borrar movimiento vs cierre: el DELETE espera y se rechaza', async () => {
    const turno = await turnoNuevo()
    const id = (await owner.from('cash_movements').insert({
      shift_id: turno, restaurant_id: SEDE, type: 'out', amount: 6000, reason: 'E2E carrera borrar', created_by: OWNER_ID,
    }).select('id').single()).data!.id as string
    const { fin } = await cierreLento(turno)
    const t0 = Date.now()
    const { error } = await cajero.from('cash_movements').delete().eq('id', id)
    const espero = Date.now() - t0
    await fin
    expect(espero, 'el DELETE no esperó al cierre (no tomó el turno)').toBeGreaterThan(1000)
    expect(error?.message ?? '', 'se borró un movimiento de un turno que se estaba congelando').toMatch(/turno de caja ya está cerrado/)
    expect(psql(`select count(*) from public.cash_movements where id = '${id}';`)).toBe('1')
    const inv = invariante(turno)
    expect(inv.congelado).toBe(inv.recalculado)
  })

  // Con supabase/cobro-turno.sql el efectivo EXIGE turno: al confirmar el
  // cierre, el abono que esperaba ya no tiene turno y se RECHAZA (antes de ese
  // cambio se aceptaba sin ingreso de caja, la plata fuera de todo arqueo).
  test('CARRERA abono en efectivo vs cierre: el abono ESPERA y se rechaza; no cae en el turno congelado', async () => {
    const turno = await turnoNuevo()
    const orden = await ordenFiado(8000)
    const { fin } = await cierreLento(turno)
    const t0 = Date.now()
    const r = await cajero.rpc('register_debt_payment', { p_order_id: orden, p_amount: 3000, p_payment_method: 'cash' })
    const espero = Date.now() - t0
    await fin
    expect(espero, 'el abono no esperó al cierre (no tomó el turno)').toBeGreaterThan(1000)
    expect(r.error?.message ?? '', 'el abono en efectivo pasó sin turno').toMatch(/No hay un turno de caja abierto/)
    expect(psql(`select count(*) from public.debt_payments where order_id = '${orden}';`)).toBe('0')
    const inv = invariante(turno)
    expect(inv.congelado, 'el abono cambió un arqueo ya congelado').toBe(inv.recalculado)
  })

  test('CARRERA abono en LOTE vs cierre: espera y se rechaza; no cae en el turno congelado', async () => {
    const turno = await turnoNuevo()
    const orden = await ordenFiado(6000)
    const { fin } = await cierreLento(turno)
    const t0 = Date.now()
    const r = await cajero.rpc('register_debt_payments_batch', { p_order_ids: [orden], p_amount: 2000, p_payment_method: 'cash' })
    const espero = Date.now() - t0
    await fin
    expect(espero, 'el lote no esperó al cierre').toBeGreaterThan(1000)
    expect(r.error?.message ?? '', 'el lote en efectivo pasó sin turno').toMatch(/No hay un turno de caja abierto/)
    expect(psql(`select count(*) from public.debt_payments where order_id = '${orden}';`)).toBe('0')
    const inv = invariante(turno)
    expect(inv.congelado, 'el lote cambió un arqueo ya congelado').toBe(inv.recalculado)
  })

  test('CARRERA movimiento manual vs cierre: espera y se rechaza', async () => {
    const turno = await turnoNuevo()
    const { fin } = await cierreLento(turno)
    const t0 = Date.now()
    const { error } = await owner.from('cash_movements').insert({
      shift_id: turno, restaurant_id: SEDE, type: 'out', amount: 7000, reason: 'E2E carrera', created_by: OWNER_ID,
    })
    const espero = Date.now() - t0
    await fin
    expect(espero, 'el movimiento no esperó al cierre').toBeGreaterThan(1000)
    expect(error?.message ?? '', 'el movimiento entró a un turno congelado').toMatch(/turno de caja ya está cerrado/)
    const inv = invariante(turno)
    expect(inv.congelado).toBe(inv.recalculado)
  })

  test('CARRERA anulación vs cierre: espera y se rechaza, el pago queda', async () => {
    const turno = await turnoNuevo()
    const venta = await ventaCobrada(9000)
    const { fin } = await cierreLento(turno)
    const t0 = Date.now()
    const r = await owner.rpc('register_sale_void', { p_order_id: venta, p_reason: 'E2E carrera' })
    const espero = Date.now() - t0
    await fin
    expect(espero, 'la anulación no esperó al cierre').toBeGreaterThan(1000)
    expect(r.error?.message ?? '', 'la anulación borró el pago de una venta ya congelada').toMatch(/No hay un turno de caja abierto/)
    expect(psql(`select count(*) from public.payments where order_id = '${venta}';`)).toBe('1')
    const inv = invariante(turno)
    expect(inv.congelado).toBe(inv.recalculado)
  })

  test('TODOS A LA VEZ, 10 veces: cierre + abono + lote + anulación + movimiento → sin deadlock (40P01) y arqueo consistente', async () => {
    test.setTimeout(120_000)
    for (let i = 0; i < 10; i++) {
      const turno = await turnoNuevo()
      const [o1, o2, venta] = [await ordenFiado(5000), await ordenFiado(5000), await ventaCobrada(4000)]
      const rs = await Promise.all([
        owner.rpc('close_cash_shift', { p_shift_id: turno, p_declarado: { cash: 0 } }),
        cajero.rpc('register_debt_payment', { p_order_id: o1, p_amount: 1000, p_payment_method: 'cash' }),
        cajero.rpc('register_debt_payments_batch', { p_order_ids: [o2], p_amount: 1000, p_payment_method: 'cash' }),
        owner.rpc('register_sale_void', { p_order_id: venta, p_reason: 'E2E todos' }),
        owner.from('cash_movements').insert({ shift_id: turno, restaurant_id: SEDE, type: 'out', amount: 500, reason: 'E2E todos', created_by: OWNER_ID }),
      ])
      const deadlocks = rs.filter((r) => r.error && (r.error.code === '40P01' || /deadlock/i.test(r.error.message)))
      expect(deadlocks.length, `ronda ${i}: deadlock`).toBe(0)
      expect(rs[0].error, `ronda ${i}: el cierre falló: ${rs[0].error?.message}`).toBeNull()
      const inv = invariante(turno)
      expect(inv.congelado, `ronda ${i}: arqueo inconsistente`).toBe(inv.recalculado)
    }
  })
})

async function registrarEgreso(page: Page, monto: number) {
  await page.getByRole('button', { name: 'Movimientos' }).click()
  await expect(page.getByText('Movimientos manuales', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Egreso', exact: true }).click()
  await page.getByTestId('movement-reason-out').selectOption({ label: 'Otro' })
  await page.getByTestId('movement-reason-custom').fill(`E2E carrera ${monto}`)
  await page.getByTestId('movement-amount').fill(String(monto))
  await page.getByTestId('movement-submit').click()
  await expect(page.getByText('Egreso registrado')).toBeVisible()
  await page.getByTestId('movements-close').click()
}
