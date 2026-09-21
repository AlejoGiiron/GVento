import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ownerCreds, cashierCreds } from './helpers/auth'

// ============================================================================
// register_sale_payment con VARIAS TERMINALES — spec de regresión (ver ESTADO MEDIDO: uno rojo, uno marcado).
//
// Es el experimento de B3 escrito como test (R10): mide dos huecos del cobro que
// una sola terminal no alcanza y que el POS móvil (varios celulares en el mismo
// turno) vuelve probables:
//
//  1. DOBLE COBRO. El paso 4 de la RPC (`if exists (select 1 from payments …)`)
//     es un check-then-act SIN lock sobre la orden. Dos transacciones
//     concurrentes pueden ver "sin pagos" las dos e insertar las dos.
//  2. COBRO SIN TURNO. La RPC no mira cash_shifts. Un pago con la caja cerrada
//     se acepta y no cae en ningún turno (el pago→turno es por ventana de hora).
//
// ESTADO MEDIDO (2026-09-21, contra LAB, exit leído del archivo):
//  · SIN TURNO: rojo 20/20. Determinista. Pasa a verde con el cambio (1) de
//    register_sale_payment (exigir turno abierto). Por eso este spec NO se
//    mergea a develop antes de ese cambio: pondría la suite en rojo. Viaja con él.
//  · DOBLE COBRO: VERDE 20/20 con 2 terminales y 20/20 con 8 simultáneas
//    (E2E_COBRO_PARALELO=8, 160 llamadas) — CONTRA EL CÓDIGO CON EL DEFECTO.
//    🔴 MARCADO (R10): este test NO caza la carrera. Las requests sí llegan
//    solapadas (medido: 8 llamadas en frío terminan en 476–494 ms), pero la
//    dispersión de llegada es de decenas de ms y la ventana del defecto (del
//    `exists` al commit, dentro de Postgres) es sub-milisegundo. El mecanismo es
//    real por semántica de READ COMMITTED (el insert sin commit de T1 es invisible
//    para el `exists` de T2); lo que no es, es observable por red.
//    Lo que SÍ custodia: el contrato de "gana exactamente uno y los demás pierden
//    con el mensaje del doble cobro". Un mutante que quite el `for update` del
//    cambio (1) SOBREVIVE a este test — la protección de la carrera la da el
//    lock, no este spec.
//
// Método (R4): anon key + login de usuarios de LAB — NO service role, que salta
// la RLS y get_my_role(). Dos clientes = dos terminales: owner.test (admin) y
// cajero.test (cashier), los dos en la misma sede activa.
// Medir la carrera: `--repeat-each=20` (y E2E_COBRO_PARALELO=N) y contar las líneas `CARRERA`.
//
// Deliberadamente NO es describe.serial: si el primero falla, los demás tienen
// que correr igual (si no, no hay medición de N repeticiones).
// ============================================================================

function loadEnv(path: string) {
  try {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* ignore */ }
}
loadEnv('.env'); loadEnv('.env.test')

async function cliente(creds: { email: string; password: string }): Promise<SupabaseClient> {
  const c = createClient(
    process.env.VITE_GVENTO_SUPABASE_URL!, process.env.VITE_GVENTO_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  )
  const { error } = await c.auth.signInWithPassword(creds)
  if (error) throw error
  return c
}

let owner: SupabaseClient
let cajero: SupabaseClient
let SEDE = ''
let OWNER_ID = ''
// UUIDs de las órdenes que ESTE spec creó. La limpieza borra solo estas.
const creadas: string[] = []

const TOTAL = 1000

test.beforeAll(async () => {
  owner = await cliente(ownerCreds())
  cajero = await cliente(cashierCreds())
  OWNER_ID = (await owner.auth.getUser()).data.user!.id
  const sedeOwner = (await owner.rpc('get_my_restaurant_id')).data as string
  const sedeCajero = (await cajero.rpc('get_my_restaurant_id')).data as string
  // Precondición del experimento: las dos terminales venden en la MISMA sede.
  expect(sedeCajero, 'owner y cajero tienen que estar en la misma sede').toBe(sedeOwner)
  SEDE = sedeOwner
})

// Orden de contado, sin ítems (no toca stock): total fijo, payment_status
// default 'paid'. Suficiente para la RPC, que solo mira sede/estado/pagos/total.
async function nuevaOrden(): Promise<string> {
  const { data, error } = await owner.from('orders')
    .insert({ restaurant_id: SEDE, type: 'takeaway', status: 'pending', created_by: OWNER_ID, total: TOTAL })
    .select('id').single()
  if (error) throw error
  creadas.push(data.id as string)
  return data.id as string
}

async function pagosDe(orderId: string): Promise<number> {
  const { count, error } = await owner.from('payments')
    .select('id', { count: 'exact', head: true }).eq('order_id', orderId)
  if (error) throw error
  return count ?? 0
}

async function asegurarTurno(): Promise<void> {
  const abierto = (await owner.from('cash_shifts').select('id')
    .eq('restaurant_id', SEDE).is('closed_at', null).maybeSingle()).data
  if (abierto) return
  const { error } = await owner.from('cash_shifts')
    .insert({ restaurant_id: SEDE, opened_by: OWNER_ID, opening_amount: 0 })
  if (error) throw error
}

async function cerrarTurno(): Promise<void> {
  const { error } = await owner.from('cash_shifts')
    .update({ closed_at: new Date().toISOString(), closed_by: OWNER_ID, closing_amount: 0 })
    .eq('restaurant_id', SEDE).is('closed_at', null)
  if (error) throw error
  const abiertos = (await owner.from('cash_shifts').select('id', { count: 'exact', head: true })
    .eq('restaurant_id', SEDE).is('closed_at', null)).count
  expect(abiertos, 'precondición: la sede quedó SIN turno abierto').toBe(0)
}

const PAGO = [{ method: 'cash', amount: TOTAL }]

test.afterAll(async () => {
  if (!creadas.length) return
  // payments → orders (FK restrict). owner.test es admin: las policies
  // "payments: admin elimina" y "orders: admin elimina" lo permiten, bajo RLS.
  const p = await owner.from('payments').delete().in('order_id', creadas)
  expect(p.error, `borrar payments: ${p.error?.message}`).toBeNull()
  const o = await owner.from('orders').delete().in('id', creadas)
  expect(o.error, `borrar orders: ${o.error?.message}`).toBeNull()

  // Limpieza CON aserción: una limpieza sin aserción es indistinguible de una
  // que no corre (DEUDAS → "el lab no es determinista entre corridas").
  const quedanP = (await owner.from('payments').select('id', { count: 'exact', head: true }).in('order_id', creadas)).count
  const quedanO = (await owner.from('orders').select('id', { count: 'exact', head: true }).in('id', creadas)).count
  expect(quedanP, 'payments residuales del spec').toBe(0)
  expect(quedanO, 'orders residuales del spec').toBe(0)
  creadas.length = 0
})

// Cuántos cobros simultáneos disparar sobre la misma orden (alternando las dos
// terminales). 2 = el caso real de dos celulares. Más = más presión sobre la
// ventana, que es de sub-milisegundos (del `exists` al commit de la RPC).
const PARALELO = Math.max(2, Number(process.env.E2E_COBRO_PARALELO ?? 2))

test(`DOBLE COBRO: ${PARALELO} cobros simultáneos de la misma orden → UNA sola fila de payments`, async () => {
  await asegurarTurno()
  const orden = await nuevaOrden()

  const rs = await Promise.all(Array.from({ length: PARALELO }, (_, i) =>
    (i % 2 ? cajero : owner).rpc('register_sale_payment', { p_order_id: orden, p_payments: PAGO })))
  const n = await pagosDe(orden)
  const aceptados = rs.filter((r) => !r.error).length
  const errores = [...new Set(rs.filter((r) => r.error).map((r) => r.error!.message))]
  console.log(`MEDICION cobro-concurrente x${PARALELO} | pagos=${n} aceptados=${aceptados} | ` +
    `${n > 1 ? 'CARRERA' : 'ok'} | errores=${errores.join(' / ') || '-'}`)

  expect(n, 'la orden quedó cobrada más de una vez').toBe(1)
  // Contraste (R10): exactamente UNA llamada gana, y todas las demás pierden con
  // el mensaje del doble cobro — no por otra causa (red, permisos, sede).
  expect(aceptados).toBe(1)
  for (const r of rs.filter((x) => x.error)) expect(r.error!.message).toMatch(/ya tiene pagos/)
})

test('SIN TURNO: con la sede sin turno abierto, el cobro se rechaza', async () => {
  const orden = await nuevaOrden()
  await cerrarTurno()

  const r = await cajero.rpc('register_sale_payment', { p_order_id: orden, p_payments: PAGO })
  const n = await pagosDe(orden)
  console.log(`MEDICION cobro-sin-turno | error=${r.error?.message ?? '-'} | pagos=${n}`)

  // Contraste: rechazado Y sin efecto. Un rechazo que igual escribió no sirve.
  expect(r.error, 'la RPC aceptó un cobro sin turno abierto').not.toBeNull()
  expect(r.error!.message).toMatch(/turno/i)
  expect(n).toBe(0)
})
