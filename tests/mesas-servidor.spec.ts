import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ownerCreds, cashierCreds, waiterCreds } from './helpers/auth'
import { cliente, psql, sesionRetenida, invarianteTurno } from './helpers/db-local'
import { abrirProxy, postDesdeElNavegador, type ModoCorte } from './helpers/proxy-reenvio'
import { prepararRoles, asignarRol, limpiarRoles } from './helpers/permisos'

// ============================================================================
// supabase/mesas-servidor.sql (Paso 9) — las mesas en el servidor:
//   · close_table_sale: el cobro de mesa en UNA transacción, idempotente por
//     p_close_id. Si OTRO cobro la cerró antes, devuelve esa venta marcada
//     (otro_cobro, cobrada_por, cobrada_at): la pantalla no la presenta como propia.
//   · quitar_item_mesa: pos.anular + motivo; preparado → merma (el stock no
//     cambia), no preparado → vuelve al inventario. Deja la baja registrada.
//   · register_sale_void: el MISMO stock que antes, ahora por el camino compartido
//     (decisión 4): anular una venta y quitar sus ítems con "No se preparó" dejan
//     el inventario igual.
//   · cerrar_mesa_sin_consumo y eliminar_mesa (con ventas se archiva).
// Base LOCAL de Docker. Anon key + login de LAB (R4): nada de service role.
// Fixtures propias por UUID (productos con control de stock, una receta y un extra
// vinculado): lab-seed no tiene un extra con producto vinculado.
// ============================================================================

const ANON = () => process.env.VITE_GVENTO_SUPABASE_ANON_KEY!
const URL_API = () => process.env.VITE_GVENTO_SUPABASE_URL!

let owner: SupabaseClient
let cajero: SupabaseClient
let mozo: SupabaseClient
let OWNER_ID = ''
let CAJERO_ID = ''
let SEDE = ''
let NOMBRE_OWNER = ''
let NOMBRE_CAJERO = ''

// Fixtures (UUID de lo que ESTE spec creó; la limpieza borra solo esto).
let P_SIMPLE = ''      // simple, con control de stock, 5.000
let P_INSUMO = ''      // simple, con control de stock, 0 (insumo de la receta y del extra)
let P_COMPUESTO = ''   // compuesto: 2 × insumo, 12.000
let X_EXTRA = ''       // extra de 1.000 vinculado al insumo, asignado al compuesto
const mesas: string[] = []
const ordenes: string[] = []
const clientes: string[] = []

const TOTAL = 18000    // simple 5.000 + compuesto 12.000 + extra 1.000

test.beforeAll(async () => {
  const o = await cliente(ownerCreds())
  const c = await cliente(cashierCreds())
  const m = await cliente(waiterCreds())
  expect(c.sede, 'owner y cajero en la misma sede').toBe(o.sede)
  expect(m.sede, 'owner y mozo en la misma sede').toBe(o.sede)
  owner = o.c; cajero = c.c; mozo = m.c; OWNER_ID = o.uid; CAJERO_ID = c.uid; SEDE = o.sede
  NOMBRE_OWNER = psql(`select full_name from public.profiles where id = '${OWNER_ID}';`)
  NOMBRE_CAJERO = psql(`select full_name from public.profiles where id = '${CAJERO_ID}';`)

  const cat = psql(`select category_id from public.products where restaurant_id = '${SEDE}' and name = 'Lab Cerveza';`)
  expect(cat, 'fixture de lab-seed: Lab Cerveza').toBeTruthy()
  const s = Date.now().toString(36)
  ;[P_SIMPLE, P_INSUMO, P_COMPUESTO, X_EXTRA] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()]
  psql(`begin;
    insert into public.products (id, name, price, category_id, restaurant_id, kind, stock_tracking, stock_qty) values
      ('${P_SIMPLE}',    'E2E MS Simple ${s}',    5000,  '${cat}', '${SEDE}', 'simple',    true,  50),
      ('${P_INSUMO}',    'E2E MS Insumo ${s}',    0,     '${cat}', '${SEDE}', 'simple',    true,  50),
      ('${P_COMPUESTO}', 'E2E MS Compuesto ${s}', 12000, '${cat}', '${SEDE}', 'composite', false, null);
    insert into public.product_components (restaurant_id, parent_id, component_id, qty)
      values ('${SEDE}', '${P_COMPUESTO}', '${P_INSUMO}', 2);
    insert into public.extras (id, restaurant_id, name, price, linked_product_id)
      values ('${X_EXTRA}', '${SEDE}', 'E2E MS Extra ${s}', 1000, '${P_INSUMO}');
    insert into public.product_extras (product_id, extra_id) values ('${P_COMPUESTO}', '${X_EXTRA}');
    commit;`)
})

test.afterAll(async () => {
  limpiarRoles()
  const lista = (xs: string[]) => xs.map((id) => `'${id}'`).join(',') || 'null'
  const prods = lista([P_SIMPLE, P_INSUMO, P_COMPUESTO].filter(Boolean))
  // payments → orders es RESTRICT; ítems, extras y bajas caen en cascada con la orden.
  // stock_movements → products es RESTRICT: se borran los de los productos del spec.
  psql(`begin;
    delete from public.payments where order_id in (${lista(ordenes)});
    delete from public.orders where id in (${lista(ordenes)});
    delete from public.tables where id in (${lista(mesas)});
    delete from public.customers where id in (${lista(clientes)});
    delete from public.stock_movements where product_id in (${prods});
    delete from public.product_extras where extra_id in (${lista([X_EXTRA].filter(Boolean))});
    delete from public.extras where id in (${lista([X_EXTRA].filter(Boolean))});
    delete from public.product_components where parent_id in (${prods});
    delete from public.products where id in (${prods});
    commit;`)
  // Limpieza CON aserción.
  expect(psql(`select (select count(*) from public.orders where id in (${lista(ordenes)}))
                    + (select count(*) from public.tables where id in (${lista(mesas)}))
                    + (select count(*) from public.products where id in (${prods}));`), 'residuos del spec').toBe('0')
})

// ── Ayudas ───────────────────────────────────────────────────────────────────

async function turnoAbierto() {
  const abierto = (await owner.from('cash_shifts').select('id').eq('restaurant_id', SEDE).is('closed_at', null).maybeSingle()).data
  if (abierto) return
  const { error } = await owner.from('cash_shifts').insert({ restaurant_id: SEDE, opened_by: OWNER_ID, opening_amount: 0 })
  if (error) throw error
}
async function sinTurno() {
  const abierto = (await owner.from('cash_shifts').select('id').eq('restaurant_id', SEDE).is('closed_at', null).maybeSingle()).data
  if (abierto) {
    const { error } = await owner.rpc('close_cash_shift', { p_shift_id: abierto.id, p_declarado: { cash: 0 } })
    if (error) throw error
  }
}
const contador = () => Number(psql(`select coalesce((select last_order_number from public.store_sequences where restaurant_id = '${SEDE}'), 0);`))

function mesaNueva(): { mesa: string; nombre: string } {
  const mesa = randomUUID()
  const nombre = `E2E MS ${mesa.slice(0, 6)}`
  psql(`insert into public.tables (id, name, restaurant_id, status) values ('${mesa}', '${nombre}', '${SEDE}', 'occupied');`)
  mesas.push(mesa)
  return { mesa, nombre }
}

/** Mesa ocupada con una orden abierta y SIN ítems. */
function mesaVacia(): { mesa: string; orden: string; nombre: string } {
  const { mesa, nombre } = mesaNueva()
  const orden = randomUUID()
  psql(`insert into public.orders (id, restaurant_id, type, status, table_id, created_by, total)
        values ('${orden}', '${SEDE}', 'dine_in', 'pending', '${mesa}', '${OWNER_ID}', 0);`)
  ordenes.push(orden)
  return { mesa, orden, nombre }
}

/** Mesa con el consumo estándar, cargado por el camino real (descuenta stock): 18.000. */
async function mesaConConsumo(): Promise<{ mesa: string; orden: string; nombre: string }> {
  const m = mesaVacia()
  const r = await cajero.rpc('add_order_items_with_extras', {
    p_order_id: m.orden, p_lote: randomUUID(), p_items: [
      { product_id: P_SIMPLE, qty: 1, unit_price: 5000, extras: [] },
      { product_id: P_COMPUESTO, qty: 1, unit_price: 12000, extras: [{ extra_id: X_EXTRA, qty: 1 }] },
    ],
  })
  expect(r.error, r.error?.message).toBeNull()
  expect(psql(`select total from public.orders where id = '${m.orden}';`)).toBe('18000.00')
  return m
}

const cobrar = (c: SupabaseClient, orden: string, clave: string, extra: Record<string, unknown> = {}) =>
  c.rpc('close_table_sale', {
    p_order_id: orden, p_close_id: clave, p_total_esperado: TOTAL,
    p_payments: [{ method: 'cash', amount: TOTAL }], ...extra,
  })

/** Huella de una mesa: estado | payment_status | pagos | Σ pagos | número? | total | mesa | close_id? */
const huella = (orden: string) => psql(`select o.status || '|' || o.payment_status || '|' ||
    (select count(*) from public.payments where order_id = o.id) || '|' ||
    (select coalesce(sum(amount), 0) from public.payments where order_id = o.id) || '|' ||
    (o.order_number is not null) || '|' || o.total || '|' || t.status || '|' || (o.close_id is not null)
  from public.orders o join public.tables t on t.id = o.table_id where o.id = '${orden}';`)

/** Stock de los dos productos con control: simple | insumo. */
const stock = () => psql(`select (select stock_qty from public.products where id = '${P_SIMPLE}') || '|' ||
                                 (select stock_qty from public.products where id = '${P_INSUMO}');`)

/** Movimientos de una orden por (producto, tipo, cantidad), sin notas: para comparar caminos. */
const movimientos = (orden: string, tipo: string) => psql(`select coalesce(string_agg(nombre || ':' || qty, ',' order by nombre), '')
  from (select case product_id when '${P_SIMPLE}' then 'simple' when '${P_INSUMO}' then 'insumo' else 'otro' end as nombre,
               sum(qty) as qty
          from public.stock_movements
         where reference_id = '${orden}' and type = '${tipo}' group by product_id) m;`)

const itemsDe = (orden: string) => psql(`select id from public.order_items where order_id = '${orden}';`).split('\n').filter(Boolean)
/** La línea de un producto (los dos ítems de una tanda comparten created_at: no se ordena por fecha). */
const itemDe = (orden: string, producto: string) => psql(`select id from public.order_items where order_id = '${orden}' and product_id = '${producto}';`)

// ── close_table_sale ─────────────────────────────────────────────────────────

test.describe('close_table_sale', () => {
  test('contado: pago, número, entregada, mesa libre y quién cobró — en UNA llamada', async () => {
    await turnoAbierto()
    const { orden, nombre } = await mesaConConsumo()
    const antes = contador()
    const clave = randomUUID()
    const r = await cobrar(cajero, orden, clave)
    expect(r.error, r.error?.message).toBeNull()
    expect(r.data).toMatchObject({
      order_id: orden, order_number: antes + 1, ya_existia: false, otro_cobro: false,
      metodos: ['cash'], fiado: false, cobrada_por: NOMBRE_CAJERO, mesa: nombre,
    })
    expect(huella(orden)).toBe(`delivered|paid|1|${TOTAL}.00|true|${TOTAL}.00|free|true`)
    expect(psql(`select cobrada_por from public.orders where id = '${orden}';`)).toBe(CAJERO_ID)
    expect(contador()).toBe(antes + 1)
  })

  test('la MISMA clave dos veces: la segunda devuelve la hecha, no escribe y no quema número', async () => {
    await turnoAbierto()
    const { orden } = await mesaConConsumo()
    const clave = randomUUID()
    expect((await cobrar(cajero, orden, clave)).error).toBeNull()
    const h = huella(orden)
    const n = contador()
    const r = await cobrar(cajero, orden, clave)
    expect(r.error, r.error?.message).toBeNull()
    expect(r.data).toMatchObject({ order_id: orden, ya_existia: true, otro_cobro: false })
    expect(huella(orden)).toBe(h)
    expect(contador()).toBe(n)
  })

  test('la MISMA clave después de cerrar el turno: devuelve la venta hecha (la clave se mira ANTES que todo)', async () => {
    await turnoAbierto()
    const { orden } = await mesaConConsumo()
    const clave = randomUUID()
    expect((await cobrar(cajero, orden, clave)).error).toBeNull()
    await sinTurno()
    try {
      const r = await cobrar(cajero, orden, clave)
      expect(r.error, 'un reintento del cobro hecho no puede fallar por el turno').toBeNull()
      expect(r.data).toMatchObject({ order_id: orden, ya_existia: true, otro_cobro: false })
    } finally {
      await turnoAbierto()
    }
  })

  test('OTRO equipo ya la cobró (otra clave): devuelve ESA venta marcada como de otro, con quién y cuándo', async () => {
    await turnoAbierto()
    const { orden } = await mesaConConsumo()
    expect((await cobrar(owner, orden, randomUUID())).error).toBeNull()
    const h = huella(orden)
    const r = await cobrar(cajero, orden, randomUUID(), { p_payments: [{ method: 'card', amount: TOTAL }] })
    expect(r.error, r.error?.message).toBeNull()
    expect(r.data).toMatchObject({ order_id: orden, ya_existia: true, otro_cobro: true, cobrada_por: NOMBRE_OWNER, metodos: ['cash'] })
    expect((r.data as { cobrada_at: string | null }).cobrada_at, 'falta la hora del otro cobro').toBeTruthy()
    expect(huella(orden), 'el segundo cobro escribió algo').toBe(h)
  })

  test('DOS equipos A LA VEZ: el segundo ESPERA, no cobra, y recibe la venta del primero como de otro', async () => {
    await turnoAbierto()
    const { orden } = await mesaConConsumo()
    const antes = contador()
    const { fin } = await sesionRetenida(OWNER_ID,
      `select public.close_table_sale('${orden}', '${randomUUID()}', ${TOTAL}, '[{"method":"cash","amount":${TOTAL}}]'::jsonb)`, 3)
    const t0 = Date.now()
    const r = await cobrar(cajero, orden, randomUUID(), { p_payments: [{ method: 'card', amount: TOTAL }] })
    const espero = Date.now() - t0
    await fin
    expect(espero, 'el segundo cobro no esperó (la orden no se bloqueó)').toBeGreaterThan(1000)
    expect(r.error, r.error?.message).toBeNull()
    expect(r.data).toMatchObject({ ya_existia: true, otro_cobro: true, cobrada_por: NOMBRE_OWNER, metodos: ['cash'] })
    expect(huella(orden), 'la mesa quedó cobrada dos veces').toBe(`delivered|paid|1|${TOTAL}.00|true|${TOTAL}.00|free|true`)
    expect(contador(), 'se quemó más de un número').toBe(antes + 1)
  })

  test('la MISMA clave A LA VEZ (reenvío simultáneo): el segundo espera y recibe la misma venta, no de otro', async () => {
    await turnoAbierto()
    const { orden } = await mesaConConsumo()
    const clave = randomUUID()
    const { fin } = await sesionRetenida(CAJERO_ID,
      `select public.close_table_sale('${orden}', '${clave}', ${TOTAL}, '[{"method":"cash","amount":${TOTAL}}]'::jsonb)`, 3)
    const r = await cobrar(cajero, orden, clave)
    await fin
    expect(r.error, r.error?.message).toBeNull()
    expect(r.data).toMatchObject({ ya_existia: true, otro_cobro: false })
    expect(huella(orden)).toBe(`delivered|paid|1|${TOTAL}.00|true|${TOTAL}.00|free|true`)
  })

  // El turno es el PRIMER lock de todo cobro de mesa, también del fiado (que no pasa por
  // register_sale_payment, la que toma el turno en el contado): si no, un fiado entra durante
  // el cierre y el contado bloquea orden→turno, al revés del protocolo (close-cash-shift.sql).
  for (const modo of ['contado', 'fiado'] as const) {
    test(`COBRO (${modo}) vs CIERRE de turno: el cobro ESPERA al cierre y se rechaza; el arqueo congelado no cambia`, async () => {
      await turnoAbierto()
      const turno = psql(`select id from public.cash_shifts where restaurant_id = '${SEDE}' and closed_at is null;`)
      const { orden } = await mesaConConsumo()
      let extra: Record<string, unknown> = {}
      if (modo === 'fiado') {
        const cli = (await owner.from('customers').insert({ restaurant_id: SEDE, name: `E2E MS ${Date.now()}` }).select('id').single()).data!.id as string
        clientes.push(cli)
        extra = { p_payments: [], p_fiado: { customer_id: cli } }
      }
      const h = huella(orden)
      const { fin } = await sesionRetenida(OWNER_ID, `select public.close_cash_shift('${turno}', '{"cash": 0}'::jsonb, null)`, 3)
      const t0 = Date.now()
      const r = await cobrar(cajero, orden, randomUUID(), extra)
      const espero = Date.now() - t0
      await fin
      try {
        expect(espero, 'el cobro no esperó al cierre (no tomó el turno primero)').toBeGreaterThan(1000)
        expect(r.error?.message ?? '', 'el cobro entró con el turno ya cerrado').toMatch(/No hay un turno de caja abierto/)
        expect(huella(orden)).toBe(h)
        const inv = invarianteTurno(turno)
        expect(inv.congelado).toBe(inv.recalculado)
      } finally {
        await turnoAbierto()
      }
    })
  }

  test('B1: un total que no es el de la mesa se RECHAZA sin efecto', async () => {
    await turnoAbierto()
    const { orden } = await mesaConConsumo()
    const h = huella(orden)
    const r = await cobrar(cajero, orden, randomUUID(), { p_total_esperado: 17000, p_payments: [{ method: 'cash', amount: 17000 }] })
    expect(r.error?.message ?? '').toMatch(/no coincide con el de la pantalla/)
    expect(huella(orden)).toBe(h)
    // Contraste: el mismo cobro con el total correcto pasa.
    expect((await cobrar(cajero, orden, randomUUID())).error).toBeNull()
  })

  test('descuento: con pos.descuento baja el total; sin él (mozo) se rechaza; mayor que la mesa se rechaza', async () => {
    await turnoAbierto()
    const a = await mesaConConsumo()
    const sinPermiso = await cobrar(mozo, a.orden, randomUUID(), {
      p_total_esperado: 15000, p_payments: [{ method: 'cash', amount: 15000 }], p_descuento: { amount: 3000, reason: 'E2E' } })
    expect(sinPermiso.error?.message ?? '').toMatch(/No tienes permiso para aplicar descuentos/)
    const demas = await cobrar(cajero, a.orden, randomUUID(), {
      p_total_esperado: 0, p_payments: [], p_descuento: { amount: 19000 } })
    expect(demas.error?.message ?? '').toMatch(/supera el total/)
    const r = await cobrar(cajero, a.orden, randomUUID(), {
      p_total_esperado: 15000, p_payments: [{ method: 'cash', amount: 15000 }], p_descuento: { amount: 3000, reason: 'E2E' } })
    expect(r.error, r.error?.message).toBeNull()
    expect(psql(`select discount_amount || '|' || discount_type || '|' || discount_kind || '|' || discount_reason || '|' || total
                   from public.orders where id = '${a.orden}';`)).toBe('3000.00|fixed|normal|E2E|15000.00')
  })

  test('cortesía: descuento = total → total 0, sin pagos, entregada', async () => {
    await turnoAbierto()
    const { orden } = await mesaConConsumo()
    const r = await cobrar(cajero, orden, randomUUID(), { p_total_esperado: 0, p_payments: [], p_descuento: { amount: TOTAL, reason: 'Cortesía' } })
    expect(r.error, r.error?.message).toBeNull()
    expect(huella(orden)).toBe('delivered|paid|0|0|true|0.00|free|true')
  })

  test('fiado: pendiente, con cliente, sin pagos; con pagos o con cliente ajeno se rechaza', async () => {
    await turnoAbierto()
    const { orden } = await mesaConConsumo()
    const cli = (await owner.from('customers').insert({ restaurant_id: SEDE, name: `E2E MS ${Date.now()}` }).select('id').single()).data!.id as string
    clientes.push(cli)
    const conPagos = await cobrar(cajero, orden, randomUUID(), { p_fiado: { customer_id: cli } })
    expect(conPagos.error?.message ?? '').toMatch(/no lleva pagos/)
    const ajeno = await cobrar(cajero, orden, randomUUID(), { p_payments: [], p_fiado: { customer_id: randomUUID() } })
    expect(ajeno.error?.message ?? '').toMatch(/no es de tu sede/)
    const r = await cobrar(cajero, orden, randomUUID(), { p_payments: [], p_fiado: { customer_id: cli } })
    expect(r.error, r.error?.message).toBeNull()
    expect(r.data).toMatchObject({ fiado: true, metodos: [] })
    expect(huella(orden)).toBe(`delivered|pending|0|0|true|${TOTAL}.00|free|true`)
    expect(psql(`select customer_id from public.orders where id = '${orden}';`)).toBe(cli)
  })

  test('sin turno abierto → rechazado sin efecto; sin consumo → rechazado', async () => {
    const { orden } = await mesaConConsumo()
    await sinTurno()
    try {
      const h = huella(orden)
      const r = await cobrar(cajero, orden, randomUUID())
      expect(r.error?.message ?? '').toMatch(/No hay un turno de caja abierto/)
      expect(huella(orden)).toBe(h)
    } finally {
      await turnoAbierto()
    }
    const vacia = mesaVacia()
    const r2 = await cobrar(cajero, vacia.orden, randomUUID(), { p_total_esperado: 0, p_payments: [] })
    expect(r2.error?.message ?? '').toMatch(/no tiene consumo/)
  })

  test('sin mesas.cobrar → rechazado sin efecto (contraste: el mismo usuario con el permiso cobra)', async () => {
    await turnoAbierto()
    const { orden } = await mesaConConsumo()
    prepararRoles()
    try {
      asignarRol('e2e-sin-cobro')
      const h = huella(orden)
      const r = await cobrar(mozo, orden, randomUUID())
      expect(r.error?.message ?? '').toMatch(/No tienes permiso para cobrar mesas/)
      expect(huella(orden)).toBe(h)
      // Una mesa de total 0 no lleva pagos: register_sale_payment (que también exige
      // mesas.cobrar) no corre, y la compuerta de close_table_sale es la ÚNICA.
      const cero = mesaVacia()
      expect((await cajero.rpc('add_order_items_with_extras', {
        p_order_id: cero.orden, p_lote: randomUUID(), p_items: [{ product_id: P_INSUMO, qty: 1, unit_price: 0, extras: [] }],
      })).error).toBeNull()
      const hc = huella(cero.orden)
      const r0 = await cobrar(mozo, cero.orden, randomUUID(), { p_total_esperado: 0, p_payments: [] })
      expect(r0.error?.message ?? '', 'una mesa de total 0 se cerró sin mesas.cobrar').toMatch(/No tienes permiso para cobrar mesas/)
      expect(huella(cero.orden)).toBe(hc)
      asignarRol('e2e-solo-mesa')
      const ok = await cobrar(mozo, orden, randomUUID())
      expect(ok.error, ok.error?.message).toBeNull()
      const ok0 = await cobrar(mozo, cero.orden, randomUUID(), { p_total_esperado: 0, p_payments: [] })
      expect(ok0.error, ok0.error?.message).toBeNull()
    } finally {
      limpiarRoles()
    }
  })
})

// ── Los cuatro modos del reenvío de Chromium ────────────────────────────────
const MODOS: ModoCorte[] = ['rst', 'fin', 'colgada', 'nueva']

test.describe('close_table_sale: reenvío del navegador', () => {
  for (const modo of MODOS) {
    test(`cobro de mesa (${modo}): queda UN pago y UN número`, async ({ page }) => {
      test.setTimeout(90_000)
      await turnoAbierto()
      const { c } = await cliente(cashierCreds())
      const token = (await c.auth.getSession()).data.session!.access_token
      const { orden } = await mesaConConsumo()
      const antes = contador()
      const cuerpo = { p_order_id: orden, p_close_id: randomUUID(), p_total_esperado: TOTAL, p_payments: [{ method: 'cash', amount: TOTAL }] }
      const proxy = await abrirProxy(URL_API(), 'rpc/close_table_sale', modo, 19)
      try {
        const visto = await postDesdeElNavegador(page, proxy, modo, ANON(), token, 'close_table_sale', cuerpo)
        if (modo === 'nueva') {
          expect(visto, 'en conexión nueva el navegador no reenvía: el código ve el error').toMatch(/^ERROR/)
          const r = await c.rpc('close_table_sale', cuerpo)   // el cajero reintenta con la MISMA clave
          expect(r.error, r.error?.message).toBeNull()
          expect(r.data).toMatchObject({ ya_existia: true, otro_cobro: false })
        } else {
          expect(visto, 'el código tiene que ver éxito').toBe('HTTP 200')
          expect(proxy.postsQueLlegaron(), 'el navegador no reenvió: el test no reproduce el caso').toBe(2)
        }
      } finally {
        await proxy.cerrar()
      }
      expect(huella(orden), 'la mesa quedó cobrada dos veces').toBe(`delivered|paid|1|${TOTAL}.00|true|${TOTAL}.00|free|true`)
      expect(contador()).toBe(antes + 1)
    })
  }
})

// ── quitar_item_mesa ─────────────────────────────────────────────────────────

test.describe('quitar_item_mesa', () => {
  test('NO se preparó: el stock vuelve, el total baja y la baja queda registrada', async () => {
    const s0 = stock()
    const { orden, mesa } = await mesaConConsumo()
    const compuesto = itemDe(orden, P_COMPUESTO)
    const baja = randomUUID()
    const r = await cajero.rpc('quitar_item_mesa', { p_item_id: compuesto, p_baja_id: baja, p_motivo: 'Se equivocó el mozo', p_preparado: false })
    expect(r.error, r.error?.message).toBeNull()
    expect(r.data).toMatchObject({ baja_id: baja, order_id: orden, preparado: false, monto: 13000, total: 5000, ya_existia: false })
    // El compuesto descontó 2 insumos por receta + 1 por el extra; vuelven los 3. El simple sigue vendido.
    const [simple0, insumo0] = s0.split('|').map(Number)
    expect(stock()).toBe(`${simple0 - 1}|${insumo0}`)
    expect(movimientos(orden, 'return')).toBe('insumo:3')
    expect(movimientos(orden, 'merma')).toBe('')
    expect(psql(`select count(*) from public.order_items where order_id = '${orden}';`)).toBe('1')
    expect(psql(`select total from public.orders where id = '${orden}';`)).toBe('5000.00')
    expect(psql(`select table_id || '|' || qty || '|' || monto || '|' || preparado || '|' || motivo || '|' || created_by || '|' || jsonb_array_length(extras)
                   from public.order_item_bajas where id = '${baja}';`)).toBe(`${mesa}|1|13000.00|false|Se equivocó el mozo|${CAJERO_ID}|1`)
  })

  test('SÍ se preparó: el stock NO vuelve; queda return + merma; el total baja', async () => {
    const { orden } = await mesaConConsumo()
    const s1 = stock()
    const simple = itemDe(orden, P_SIMPLE)
    const r = await cajero.rpc('quitar_item_mesa', { p_item_id: simple, p_baja_id: randomUUID(), p_motivo: 'Se cayó', p_preparado: true })
    expect(r.error, r.error?.message).toBeNull()
    expect(stock(), 'una merma no devuelve stock').toBe(s1)
    expect(movimientos(orden, 'return')).toBe('simple:1')
    expect(movimientos(orden, 'merma')).toBe('simple:-1')
    expect(psql(`select total from public.orders where id = '${orden}';`)).toBe('13000.00')
  })

  test('la MISMA baja dos veces: la segunda no mueve nada', async () => {
    const { orden } = await mesaConConsumo()
    const simple = itemDe(orden, P_SIMPLE)
    const baja = randomUUID()
    const cuerpo = { p_item_id: simple, p_baja_id: baja, p_motivo: 'E2E', p_preparado: false }
    expect((await cajero.rpc('quitar_item_mesa', cuerpo)).error).toBeNull()
    const s = stock()
    const r = await cajero.rpc('quitar_item_mesa', cuerpo)
    expect(r.error, r.error?.message).toBeNull()
    expect(r.data).toMatchObject({ baja_id: baja, ya_existia: true })
    expect(stock()).toBe(s)
    expect(movimientos(orden, 'return')).toBe('simple:1')
  })

  test('sin pos.anular (mozo) o sin motivo → rechazado sin efecto', async () => {
    const { orden } = await mesaConConsumo()
    const simple = itemDe(orden, P_SIMPLE)
    const s = stock()
    const r1 = await mozo.rpc('quitar_item_mesa', { p_item_id: simple, p_baja_id: randomUUID(), p_motivo: 'E2E', p_preparado: false })
    expect(r1.error?.message ?? '').toMatch(/No tienes permiso para quitar/)
    const r2 = await cajero.rpc('quitar_item_mesa', { p_item_id: simple, p_baja_id: randomUUID(), p_motivo: '   ', p_preparado: false })
    expect(r2.error?.message ?? '').toMatch(/Escribe el motivo/)
    expect(itemsDe(orden).length).toBe(2)
    expect(stock()).toBe(s)
  })

  test('con un cobro en curso, quitar ESPERA y se rechaza: la mesa ya está cerrada', async () => {
    await turnoAbierto()
    const { orden } = await mesaConConsumo()
    const simple = itemDe(orden, P_SIMPLE)
    const { fin } = await sesionRetenida(OWNER_ID,
      `select public.close_table_sale('${orden}', '${randomUUID()}', ${TOTAL}, '[{"method":"cash","amount":${TOTAL}}]'::jsonb)`, 3)
    const t0 = Date.now()
    const r = await cajero.rpc('quitar_item_mesa', { p_item_id: simple, p_baja_id: randomUUID(), p_motivo: 'E2E', p_preparado: false })
    const espero = Date.now() - t0
    await fin
    expect(espero, 'quitar no esperó al cobro').toBeGreaterThan(1000)
    expect(r.error?.message ?? '').toMatch(/ya está cerrada/)
    expect(itemsDe(orden).length, 'se quitó un ítem de una venta cobrada').toBe(2)
    expect(huella(orden)).toBe(`delivered|paid|1|${TOTAL}.00|true|${TOTAL}.00|free|true`)
  })

  test('order_item_bajas: se lee por la sede, pero no se escribe directo', async () => {
    const ins = await cajero.from('order_item_bajas').insert({
      id: randomUUID(), restaurant_id: SEDE, order_id: randomUUID(), order_item_id: randomUUID(),
      producto: 'x', qty: 1, unit_price: 1, monto: 1, preparado: false, motivo: 'x',
    })
    expect(ins.error, 'se pudo escribir order_item_bajas directo').not.toBeNull()
    const sel = await cajero.from('order_item_bajas').select('id').limit(1)
    expect(sel.error, sel.error?.message).toBeNull()
  })
})

// ── Decisión 4: anular y "No se preparó" dejan el MISMO inventario ───────────

test('anular la venta de una mesa y quitar sus ítems con "No se preparó" devuelven EXACTAMENTE el mismo stock', async () => {
  await turnoAbierto()
  const s0 = stock()

  // A: se cobra y se anula (register_sale_void, por el camino compartido).
  const a = await mesaConConsumo()
  const s1 = stock()
  expect(s1, 'la carga no descontó stock: el test no mide nada').not.toBe(s0)
  expect((await cobrar(cajero, a.orden, randomUUID())).error).toBeNull()
  const v = await owner.rpc('register_sale_void', { p_order_id: a.orden, p_reason: 'E2E igualdad de stock' })
  expect(v.error, v.error?.message).toBeNull()
  expect((v.data as { stock_returned: number }).stock_returned, 'productos movidos: simple, insumo por receta, insumo por extra').toBe(3)
  expect(stock(), 'la anulación no devolvió el stock').toBe(s0)

  // B: el mismo consumo, quitado ítem por ítem con "No se preparó".
  const b = await mesaConConsumo()
  expect(stock()).toBe(s1)
  for (const item of itemsDe(b.orden)) {
    const r = await cajero.rpc('quitar_item_mesa', { p_item_id: item, p_baja_id: randomUUID(), p_motivo: 'E2E', p_preparado: false })
    expect(r.error, r.error?.message).toBeNull()
  }
  expect(stock(), 'quitar con "No se preparó" no devolvió lo mismo que la anulación').toBe(s0)
  // Y los mismos movimientos, producto por producto (las notas cambian; las cantidades no).
  expect(movimientos(b.orden, 'return')).toBe(movimientos(a.orden, 'return'))
  expect(movimientos(a.orden, 'return')).toBe('insumo:3,simple:1')
})

test('DOS anulaciones A LA VEZ de la misma venta: la segunda ESPERA y se rechaza; el stock vuelve UNA vez', async () => {
  await turnoAbierto()
  const s0 = stock()
  const { orden } = await mesaConConsumo()
  expect((await cobrar(cajero, orden, randomUUID())).error).toBeNull()
  const { fin } = await sesionRetenida(OWNER_ID, `select public.register_sale_void('${orden}', 'E2E retenida')`, 3)
  const t0 = Date.now()
  const r = await owner.rpc('register_sale_void', { p_order_id: orden, p_reason: 'E2E segunda' })
  const espero = Date.now() - t0
  await fin
  // La señal de la consulta 5 de supabase/diag/mesas-preflight.sql: cada anulación escribe sus
  // devoluciones en UNA transacción (created_at = now() de esa transacción); dos valores = dos anulaciones.
  const anulaciones = psql(`select count(distinct created_at) from public.stock_movements
                             where reference_id = '${orden}' and type = 'return' and notes like 'Anulación de venta%';`)
  console.log(`MEDICION doble-anulacion | espero=${espero}ms | error=${r.error?.message ?? '-'} | return=${movimientos(orden, 'return')} | anulaciones=${anulaciones}`)
  expect(anulaciones, 'la venta se anuló dos veces').toBe('1')
  expect(movimientos(orden, 'return'), 'la venta devolvió el stock dos veces').toBe('insumo:3,simple:1')
  expect(stock()).toBe(s0)
  expect(espero, 'la segunda anulación no esperó (la orden no se bloqueó)').toBeGreaterThan(1000)
  expect(r.error?.message ?? '').toMatch(/ya está anulada/)
})

// ── cerrar_mesa_sin_consumo ──────────────────────────────────────────────────

test.describe('cerrar_mesa_sin_consumo', () => {
  test('mesa vacía: orden cancelada (sin pasar por Anuladas) y mesa libre; dos veces = una', async () => {
    const { orden, mesa } = mesaVacia()
    const r = await mozo.rpc('cerrar_mesa_sin_consumo', { p_order_id: orden })
    expect(r.error, r.error?.message).toBeNull()
    expect(r.data).toMatchObject({ ya_existia: false })
    expect(psql(`select o.status || '|' || (o.cancelled_at is null) || '|' || t.status
                   from public.orders o join public.tables t on t.id = o.table_id where o.id = '${orden}';`)).toBe('cancelled|true|free')
    const r2 = await mozo.rpc('cerrar_mesa_sin_consumo', { p_order_id: orden })
    expect(r2.data).toMatchObject({ ya_existia: true })
    expect(psql(`select status from public.tables where id = '${mesa}';`)).toBe('free')
  })

  test('con consumo o sin mesas.gestionar (cajero) → rechazado sin efecto', async () => {
    const llena = await mesaConConsumo()
    const r1 = await mozo.rpc('cerrar_mesa_sin_consumo', { p_order_id: llena.orden })
    expect(r1.error?.message ?? '').toMatch(/tiene consumo/)
    const vacia = mesaVacia()
    const r2 = await cajero.rpc('cerrar_mesa_sin_consumo', { p_order_id: vacia.orden })
    expect(r2.error?.message ?? '').toMatch(/No tienes permiso para cerrar mesas/)
    expect(psql(`select string_agg(status::text, ',' order by id) from public.orders where id in ('${llena.orden}', '${vacia.orden}');`))
      .toBe('pending,pending')
  })
})

// ── eliminar_mesa ────────────────────────────────────────────────────────────

test.describe('eliminar_mesa', () => {
  test('sin ventas → se borra; con ventas → se archiva (y dos veces = una)', async () => {
    const limpia = mesaNueva()
    psql(`update public.tables set status = 'free' where id = '${limpia.mesa}';`)
    const r1 = await owner.rpc('eliminar_mesa', { p_table_id: limpia.mesa })
    expect(r1.error, r1.error?.message).toBeNull()
    expect(r1.data).toMatchObject({ accion: 'eliminada' })
    expect(psql(`select count(*) from public.tables where id = '${limpia.mesa}';`)).toBe('0')

    const { orden, mesa } = mesaVacia()
    expect((await mozo.rpc('cerrar_mesa_sin_consumo', { p_order_id: orden })).error).toBeNull()
    const r2 = await owner.rpc('eliminar_mesa', { p_table_id: mesa })
    expect(r2.error, r2.error?.message).toBeNull()
    expect(r2.data).toMatchObject({ accion: 'archivada', ya_existia: false })
    expect(psql(`select (archived_at is not null) || '|' || archived_by from public.tables where id = '${mesa}';`)).toBe(`true|${OWNER_ID}`)
    const r3 = await owner.rpc('eliminar_mesa', { p_table_id: mesa })
    expect(r3.data).toMatchObject({ accion: 'archivada', ya_existia: true })
  })

  test('con una orden abierta, o sin config.acceder (cajero) → rechazado y la mesa sigue', async () => {
    const { mesa } = mesaVacia()
    const r1 = await owner.rpc('eliminar_mesa', { p_table_id: mesa })
    expect(r1.error?.message ?? '').toMatch(/tiene una orden abierta/)
    const otra = mesaNueva()
    const r2 = await cajero.rpc('eliminar_mesa', { p_table_id: otra.mesa })
    expect(r2.error?.message ?? '').toMatch(/No tienes permiso para eliminar mesas/)
    expect(psql(`select count(*) from public.tables where id in ('${mesa}', '${otra.mesa}') and archived_at is null;`)).toBe('2')
  })
})
