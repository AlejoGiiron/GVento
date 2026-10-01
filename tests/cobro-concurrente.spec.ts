import { test, expect } from '@playwright/test'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ownerCreds, cashierCreds } from './helpers/auth'
import { cliente, psql, sesionRetenida, invarianteTurno } from './helpers/db-local'

// ============================================================================
// Cobro y abonos contra el TURNO — supabase/cobro-turno.sql (cambio (1)).
//
// Contrato que custodia:
//  · COBRO (register_sale_payment): sin turno abierto se rechaza, con CUALQUIER
//    método; la orden se bloquea FOR UPDATE (dos terminales no la cobran dos
//    veces); y respeta el protocolo de locks del turno (un cobro durante un
//    cierre espera, y al confirmar el cierre se rechaza).
//  · ABONO (register_debt_payment / _batch): EFECTIVO exige turno; los demás
//    métodos no. El abono simple bloquea la orden: dos abonos simultáneos no
//    pasan juntos del saldo.
//
// Cómo se fuerzan las carreras: una SESIÓN RETENIDA (tests/helpers/db-local.ts)
// hace la operación como el owner y no confirma hasta pasados unos segundos;
// la segunda operación va por la API real como el cajero. Antes este spec
// disparaba N requests simultáneas y NO cazaba el doble cobro (0/160 con el
// defecto presente: la ventana es sub-milisegundo). Con la sesión retenida la
// ventana dura segundos, y el mutante sin `for update` da 2 pagos.
//
// Método (R4): anon key + login de usuarios de LAB, NO service role (salta RLS
// y has_permission). Base LOCAL de Docker (playwright.config.ts: loopback).
// ============================================================================

const RETENCION_S = 3
const TOTAL = 1000

let owner: SupabaseClient
let cajero: SupabaseClient
let OWNER_ID = ''
let SEDE = ''
// UUIDs de lo que ESTE spec creó. La limpieza borra solo estos.
const ordenes: string[] = []
const clientes: string[] = []

test.beforeAll(async () => {
  const o = await cliente(ownerCreds())
  const c = await cliente(cashierCreds())
  // Precondición: las dos "terminales" venden en la MISMA sede.
  expect(c.sede, 'owner y cajero tienen que estar en la misma sede').toBe(o.sede)
  owner = o.c; cajero = c.c; OWNER_ID = o.uid; SEDE = o.sede
})

test.afterAll(async () => {
  if (!ordenes.length) return
  const ids = ordenes.map((id) => `'${id}'`).join(',')
  // payments → orders es RESTRICT; debt_payments cae en cascada con la orden.
  // Los cash_movements de los abonos se QUEDAN: son parte del arqueo de su turno.
  psql(`begin;
    delete from public.payments where order_id in (${ids});
    delete from public.orders   where id in (${ids});
    ${clientes.length ? `delete from public.customers where id in (${clientes.map((id) => `'${id}'`).join(',')});` : ''}
    commit;`)
  // Limpieza CON aserción: una sin aserción es indistinguible de una que no corre.
  expect(psql(`select count(*) from public.orders where id in (${ids});`), 'órdenes residuales del spec').toBe('0')
  ordenes.length = 0; clientes.length = 0
})

async function sinTurno(): Promise<void> {
  const abierto = (await owner.from('cash_shifts').select('id').eq('restaurant_id', SEDE).is('closed_at', null).maybeSingle()).data
  if (abierto) {
    const { error } = await owner.rpc('close_cash_shift', { p_shift_id: abierto.id, p_declarado: { cash: 0 } })
    if (error) throw new Error(`cerrar turno: ${error.message}`)
  }
  expect(psql(`select count(*) from public.cash_shifts where restaurant_id = '${SEDE}' and closed_at is null;`),
    'precondición: la sede quedó SIN turno abierto').toBe('0')
}

async function turnoNuevo(): Promise<string> {
  await sinTurno()
  const { data, error } = await owner.from('cash_shifts')
    .insert({ restaurant_id: SEDE, opened_by: OWNER_ID, opening_amount: 0 }).select('id').single()
  if (error) throw error
  return data!.id as string
}

/** Orden de contado sin ítems (no toca stock): total fijo, payment_status default 'paid'. */
async function ordenContado(): Promise<string> {
  const { data, error } = await owner.from('orders')
    .insert({ restaurant_id: SEDE, type: 'takeaway', status: 'pending', created_by: OWNER_ID, total: TOTAL })
    .select('id').single()
  if (error) throw error
  ordenes.push(data.id as string)
  return data.id as string
}

async function nuevoCliente(): Promise<string> {
  const cli = (await owner.from('customers').insert({ restaurant_id: SEDE, name: `E2E Cobro ${Date.now()}` }).select('id').single()).data!.id as string
  clientes.push(cli)
  return cli
}

async function ordenFiado(total: number, cli?: string): Promise<string> {
  cli ??= await nuevoCliente()
  const { data, error } = await owner.from('orders').insert({
    restaurant_id: SEDE, type: 'takeaway', status: 'delivered', created_by: OWNER_ID,
    total, payment_status: 'pending', customer_id: cli,
  }).select('id').single()
  if (error) throw error
  ordenes.push(data.id as string)
  return data.id as string
}

const pagos = (orden: string) => Number(psql(`select count(*) from public.payments where order_id = '${orden}';`))
const abonado = (orden: string) => Number(psql(`select coalesce(sum(amount), 0) from public.debt_payments where order_id = '${orden}';`))
const ingresos = (turno: string) => Number(psql(`select count(*) from public.cash_movements where shift_id = '${turno}' and type = 'in';`))

const SIN_TURNO_ABONO = /No hay un turno de caja abierto: para recibir efectivo/

// NO es serial a propósito: cada test arma su estado de turno, y si uno cae los
// demás tienen que correr igual (si no, un mutante mata el primero y no mide nada).
test.describe('Cobro y abonos contra el turno', () => {
  // ── COBRO ──────────────────────────────────────────────────────────────────

  test('COBRO sin turno → rechazado, con efectivo Y con tarjeta, y sin efecto', async () => {
    await sinTurno()
    for (const method of ['cash', 'card']) {
      const orden = await ordenContado()
      const r = await cajero.rpc('register_sale_payment', { p_order_id: orden, p_payments: [{ method, amount: TOTAL }] })
      // Contraste: rechazado Y sin efecto. Un rechazo que igual escribió no sirve.
      expect(r.error?.message ?? '', `${method}: la RPC aceptó un cobro sin turno abierto`).toMatch(/No hay un turno de caja abierto/)
      expect(pagos(orden), `${method}: quedaron pagos`).toBe(0)
    }
  })

  test('COBRO con turno → aceptado (control positivo del anterior)', async () => {
    await turnoNuevo()
    const orden = await ordenContado()
    const r = await cajero.rpc('register_sale_payment', { p_order_id: orden, p_payments: [{ method: 'cash', amount: TOTAL }] })
    expect(r.error, r.error?.message).toBeNull()
    expect(pagos(orden)).toBe(1)
  })

  test('DOBLE COBRO: con un cobro en curso, el segundo ESPERA y se rechaza → UNA fila de payments', async () => {
    await turnoNuevo()
    const orden = await ordenContado()
    const { fin } = await sesionRetenida(OWNER_ID,
      `select public.register_sale_payment('${orden}', '[{"method":"cash","amount":${TOTAL}}]'::jsonb)`, RETENCION_S)
    const t0 = Date.now()
    const r = await cajero.rpc('register_sale_payment', { p_order_id: orden, p_payments: [{ method: 'cash', amount: TOTAL }] })
    const espero = Date.now() - t0
    await fin
    console.log(`MEDICION doble-cobro | espero=${espero}ms | error=${r.error?.message ?? '-'} | pagos=${pagos(orden)}`)
    expect(pagos(orden), 'la orden quedó cobrada dos veces').toBe(1)
    expect(espero, 'el segundo cobro no esperó (la orden no se bloqueó)').toBeGreaterThan(1000)
    expect(r.error?.message ?? '').toMatch(/ya tiene pagos/)
  })

  test('COBRO vs CIERRE: el cobro ESPERA al cierre y se rechaza; el arqueo congelado no cambia', async () => {
    const turno = await turnoNuevo()
    const orden = await ordenContado()
    const { fin } = await sesionRetenida(OWNER_ID,
      `select public.close_cash_shift('${turno}', '{"cash": 0}'::jsonb, null)`, RETENCION_S)
    const t0 = Date.now()
    const r = await cajero.rpc('register_sale_payment', { p_order_id: orden, p_payments: [{ method: 'cash', amount: TOTAL }] })
    const espero = Date.now() - t0
    await fin
    expect(espero, 'el cobro no esperó al cierre (no tomó el turno)').toBeGreaterThan(1000)
    expect(r.error?.message ?? '', 'el cobro entró con el turno ya cerrado').toMatch(/No hay un turno de caja abierto/)
    expect(pagos(orden)).toBe(0)
    const inv = invarianteTurno(turno)
    expect(inv.congelado).toBe(inv.recalculado)
  })

  // ── ABONO ──────────────────────────────────────────────────────────────────

  test('ABONO en efectivo sin turno → rechazado con un mensaje claro, sin efecto', async () => {
    await sinTurno()
    const orden = await ordenFiado(8000)
    const r = await cajero.rpc('register_debt_payment', { p_order_id: orden, p_amount: 3000, p_payment_method: 'cash' })
    expect(r.error?.message ?? '', 'se aceptó efectivo sin turno').toMatch(SIN_TURNO_ABONO)
    expect(abonado(orden)).toBe(0)
  })

  test('ABONO por transferencia sin turno → aceptado (no toca caja)', async () => {
    await sinTurno()
    const orden = await ordenFiado(8000)
    const r = await cajero.rpc('register_debt_payment', { p_order_id: orden, p_amount: 3000, p_payment_method: 'transfer' })
    expect(r.error, r.error?.message).toBeNull()
    expect((r.data as { cash_movement_created: boolean }).cash_movement_created).toBe(false)
    expect(abonado(orden)).toBe(3000)
  })

  test('ABONO en efectivo con turno → crea el ingreso de caja en ESE turno', async () => {
    const turno = await turnoNuevo()
    const orden = await ordenFiado(8000)
    const r = await cajero.rpc('register_debt_payment', { p_order_id: orden, p_amount: 3000, p_payment_method: 'cash' })
    expect(r.error, r.error?.message).toBeNull()
    expect((r.data as { cash_movement_created: boolean }).cash_movement_created).toBe(true)
    expect(psql(`select count(*) || '|' || coalesce(sum(amount), 0) from public.cash_movements
                  where shift_id = '${turno}' and type = 'in';`)).toBe('1|3000')
    expect(abonado(orden)).toBe(3000)
  })

  test('LOTE: efectivo sin turno → rechazado; transferencia sin turno → aceptado', async () => {
    await sinTurno()
    const o1 = await ordenFiado(5000)
    const efectivo = await cajero.rpc('register_debt_payments_batch', { p_order_ids: [o1], p_amount: 2000, p_payment_method: 'cash' })
    expect(efectivo.error?.message ?? '', 'el lote aceptó efectivo sin turno').toMatch(SIN_TURNO_ABONO)
    expect(abonado(o1)).toBe(0)

    const transfer = await cajero.rpc('register_debt_payments_batch', { p_order_ids: [o1], p_amount: 2000, p_payment_method: 'transfer' })
    expect(transfer.error, transfer.error?.message).toBeNull()
    expect(abonado(o1)).toBe(2000)
  })

  test('LOTE en efectivo con turno → UN ingreso de caja en ese turno', async () => {
    const turno = await turnoNuevo()
    const cli = await nuevoCliente()   // el lote exige un solo cliente
    const [o1, o2] = [await ordenFiado(5000, cli), await ordenFiado(5000, cli)]
    const r = await cajero.rpc('register_debt_payments_batch', { p_order_ids: [o1, o2], p_amount: 7000, p_payment_method: 'cash' })
    expect(r.error, r.error?.message).toBeNull()
    expect(ingresos(turno)).toBe(1)
    expect(abonado(o1) + abonado(o2)).toBe(7000)
  })

  test('DOS ABONOS simultáneos que juntos se pasan del saldo → el segundo ESPERA y se rechaza', async () => {
    await turnoNuevo()
    const orden = await ordenFiado(8000)
    // Cada uno cabe solo (5000 ≤ 8000); juntos (10000) no.
    const { fin } = await sesionRetenida(OWNER_ID,
      `select public.register_debt_payment('${orden}', 5000, 'cash')`, RETENCION_S)
    const t0 = Date.now()
    const r = await cajero.rpc('register_debt_payment', { p_order_id: orden, p_amount: 5000, p_payment_method: 'cash' })
    const espero = Date.now() - t0
    await fin
    console.log(`MEDICION dos-abonos | espero=${espero}ms | error=${r.error?.message ?? '-'} | abonado=${abonado(orden)}`)
    expect(abonado(orden), 'los dos abonos pasaron: la venta quedó sobre-pagada').toBe(5000)
    expect(espero, 'el segundo abono no esperó (la orden no se bloqueó)').toBeGreaterThan(1000)
    expect(r.error?.message ?? '').toMatch(/excede el saldo/i)
  })
})
