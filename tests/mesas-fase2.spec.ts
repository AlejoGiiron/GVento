import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ownerCreds } from './helpers/auth'
import { cliente, psql, psqlResultado } from './helpers/db-local'

// ============================================================================
// supabase/mesas-fase2.sql (Paso 11): un usuario CON sesión ya no escribe directo lo que el
// frontend del Paso 10 hace por funciones del servidor. Sin DELETE de ítems, mesas ni órdenes; en
// orders, UPDATE solo de status, courier_id y estimated_delivery_minutes (Cocina y Delivery); en
// order_items, UPDATE solo de sent_to_kitchen (Mesas al enviar a cocina).
// Y la GUARDA: la migración no se aplica si app_versiones muestra un equipo con una versión
// fuera de la lista del Paso 10.
// Que la app siga funcionando por los caminos del servidor (cobrar, quitar, cerrar, eliminar)
// lo prueban mesas-frontend, mesas-servidor, cocina y delivery, que corren con esto aplicado.
// ============================================================================

const FALSO = '00000000-0000-0000-0000-000000000000'
let owner: SupabaseClient
let OWNER_ID = ''

test.beforeAll(async () => {
  const o = await cliente(ownerCreds()); owner = o.c; OWNER_ID = o.uid
})

test.describe('Paso 11: sin escrituras directas de cobro, ítems ni mesas', () => {
  test('catálogo: sin DELETE en order_items, tables y orders; orders en 3 columnas y order_items solo en sent_to_kitchen', () => {
    expect(psql(`select has_table_privilege('authenticated','public.order_items','DELETE') || '|'
      || has_table_privilege('authenticated','public.tables','DELETE') || '|'
      || has_table_privilege('authenticated','public.orders','DELETE') || '|'
      || has_table_privilege('authenticated','public.orders','UPDATE') || '|'
      || has_table_privilege('authenticated','public.order_items','UPDATE');`)).toBe('false|false|false|false|false')
    expect(psql(`select string_agg(attname::text, ',' order by attname) from pg_attribute
       where attrelid = 'public.order_items'::regclass and attnum > 0 and not attisdropped
         and has_column_privilege('authenticated', 'public.order_items', attname, 'UPDATE');`))
      .toBe('sent_to_kitchen')
    expect(psql(`select string_agg(attname::text, ',' order by attname) from pg_attribute
       where attrelid = 'public.orders'::regclass and attnum > 0 and not attisdropped
         and has_column_privilege('authenticated', 'public.orders', attname, 'UPDATE');`))
      .toBe('courier_id,estimated_delivery_minutes,status')
  })

  test('por la API, con sesión: borrar ítems o mesas y tocar el cobro de una orden da "permission denied"', async () => {
    const intentos = {
      'delete order_items': await owner.from('order_items').delete().eq('id', FALSO),
      'delete tables': await owner.from('tables').delete().eq('id', FALSO),
      'update orders.total': await owner.from('orders').update({ total: 0 }).eq('id', FALSO),
      'update orders.payment_status': await owner.from('orders').update({ payment_status: 'paid' }).eq('id', FALSO),
      'update orders.order_number': await owner.from('orders').update({ order_number: 1 }).eq('id', FALSO),
      'update orders.customer_id (fiado)': await owner.from('orders').update({ customer_id: FALSO }).eq('id', FALSO),
      'update order_items.qty': await owner.from('order_items').update({ qty: 1 }).eq('id', FALSO),
      'update order_items.unit_price': await owner.from('order_items').update({ unit_price: 0 }).eq('id', FALSO),
      'delete orders (admin)': await owner.from('orders').delete().eq('id', FALSO),
    }
    const abiertos = Object.entries(intentos)
      .filter(([, r]) => !/permission denied/i.test(r.error?.message ?? ''))
      .map(([k, r]) => `${k}: ${r.error?.message ?? 'sin error'}`)
    expect(abiertos, 'escrituras directas que NO dieron "permission denied"').toEqual([])
  })

  test('contraste: lo que la app sí escribe directo sigue andando (status, repartidor y tiempo)', async () => {
    const st = await owner.from('orders').update({ status: 'pending' }).eq('id', FALSO)
    const rep = await owner.from('orders').update({ courier_id: null, estimated_delivery_minutes: null }).eq('id', FALSO)
    const env = await owner.from('order_items').update({ sent_to_kitchen: true }).eq('id', FALSO)
    expect([st.error?.message, rep.error?.message, env.error?.message]).toEqual([undefined, undefined, undefined])
  })
})

// Medido como usuario CON sesión sobre filas REALES (en una transacción que se deshace): el
// contraste por la API usa un id que no existe y no dispara los triggers; esto sí.
test.describe('Paso 11 medido sobre filas reales, como usuario con sesión', () => {
  const comoDuenio = () => `set local role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${OWNER_ID}","role":"authenticated"}', true);`
  const datos = () => {
    const [sede, org] = psql(`select r.id || '|' || r.organization_id from public.profiles p
      join public.restaurants r on r.id = p.restaurant_id where p.id = '${OWNER_ID}';`).split('|')
    const prod = psql(`select id from public.products where restaurant_id = '${sede}' limit 1;`)
    return { sede, org, prod }
  }

  test('enviar a cocina y cambiar el estado siguen andando con los triggers (updated_at, delivered_at); qty no', () => {
    const { sede, prod } = datos()
    const orden = crypto.randomUUID(), item = crypto.randomUUID()
    const base = `insert into public.orders (id, restaurant_id, type, created_by) values ('${orden}', '${sede}', 'delivery', '${OWNER_ID}');
      insert into public.order_items (id, order_id, product_id, qty, unit_price) values ('${item}', '${orden}', '${prod}', 1, 1000);`
    const ok = psqlResultado(`begin; ${base} ${comoDuenio()}
      update public.order_items set sent_to_kitchen = true where id = '${item}' returning 'ITEM|' || sent_to_kitchen;
      update public.orders set status = 'delivered' where id = '${orden}' returning 'ORDEN|' || status || '|' || (delivered_at is not null);
      rollback;`)
    expect(ok.stderr, 'el UPDATE permitido no debería fallar').not.toMatch(/ERROR/)
    expect(ok.stdout).toContain('ITEM|true')
    expect(ok.stdout).toContain('ORDEN|delivered|true')
    // Contraste sobre la MISMA fila: qty y el DELETE de la orden se rechazan.
    const qty = psqlResultado(`begin; ${base} ${comoDuenio()}
      update public.order_items set qty = 2 where id = '${item}'; rollback;`)
    expect(qty.stderr).toMatch(/permission denied/)
    const borrar = psqlResultado(`begin; ${base} ${comoDuenio()}
      delete from public.orders where id = '${orden}'; rollback;`)
    expect(borrar.stderr).toMatch(/permission denied/)
  })

  test('borrar una sede sigue borrando sus órdenes en cascada (la cascada corre como el dueño de la tabla)', () => {
    const { org, prod } = datos()
    const sedeX = crypto.randomUUID(), orden = crypto.randomUUID()
    const r = psqlResultado(`begin;
      insert into public.restaurants (id, name, organization_id) values ('${sedeX}', 'E2E sede a borrar', '${org}');
      insert into public.orders (id, restaurant_id, type, created_by) values ('${orden}', '${sedeX}', 'takeaway', '${OWNER_ID}');
      insert into public.order_items (order_id, product_id, qty, unit_price) values ('${orden}', '${prod}', 1, 1000);
      ${comoDuenio()}
      delete from public.restaurants where id = '${sedeX}' returning 'BORRADA|' || id;
      reset role;
      select 'QUEDAN|' || (select count(*) from public.orders where id = '${orden}')
                || '|' || (select count(*) from public.order_items where order_id = '${orden}');
      rollback;`)
    expect(r.stderr, 'borrar la sede no debería fallar').not.toMatch(/ERROR/)
    expect(r.stdout).toContain(`BORRADA|${sedeX}`)
    expect(r.stdout).toContain('QUEDAN|0|0')
  })
})

test.describe('la guarda de mesas-fase2.sql', () => {
  const cuerpo = () => {
    const ls = readFileSync('supabase/mesas-fase2.sql', 'utf-8').replace(/\r\n/g, '\n').split('\n')
    return ls.filter((l) => l !== 'begin;' && l !== 'commit;').join('\n')
  }
  const MARCA = "array['PEGA-AQUI-LOS-HASH-DEL-PASO-10']"
  const correr = (previo: string, lista: string | null) => {
    const sql = lista === null ? cuerpo() : cuerpo().replace(MARCA, lista)
    return psqlResultado(`begin;\n${previo}\n${sql}\nrollback;`)
  }

  test('tal cual (sin llenar la lista de versiones): aborta sin cambiar nada', () => {
    expect(readFileSync('supabase/mesas-fase2.sql', 'utf-8')).toContain(MARCA)
    const r = correr('', null)
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain('La lista de versiones del Paso 10 no está llena')
  })

  test('un equipo con una versión fuera de la lista: aborta y dice cuál', () => {
    const r = correr(`insert into public.app_versiones (user_id, equipo, version) values ('${OWNER_ID}', 'equipo-viejo-e2e', '0123abc');`,
      "array['dev','abc1234']")
    expect(r.status).not.toBe(0)
    expect(r.stderr).toMatch(/equipo\(s\) con una versión anterior al Paso 10.*0123abc/)
  })

  // El estado de partida (antes del Paso 11), armado dentro de la transacción que se deshace.
  const PARTIDA = `revoke update (status, courier_id, estimated_delivery_minutes) on public.orders from authenticated;
    revoke update (sent_to_kitchen) on public.order_items from authenticated;
    grant update on public.orders to authenticated;
    grant delete on public.orders to authenticated;
    grant update on public.order_items to authenticated;
    grant delete on public.order_items to authenticated;
    grant delete on public.tables to authenticated;`

  test('guarda 0e: si anon todavía escribe (P0.2 sin aplicar), aborta; sin eso, se aplica entera (contraste)', () => {
    const conAnon = correr(`${PARTIDA}\n grant update on public.orders to anon;`, "array['dev']")
    expect(conAnon.status).not.toBe(0)
    expect(conAnon.stderr).toContain('falta anon-sin-escritura.sql (P0.2)')
    const sinAnon = correr(PARTIDA, "array['dev']")
    expect(sinAnon.stderr, 'desde el estado de partida, con P0.2, la migración no debería abortar').not.toMatch(/ERROR/)
    expect(sinAnon.status).toBe(0)
  })

  test('con todos los equipos en la lista pasa la guarda; ya aplicada, aborta en el estado de partida (re-aplicar no cambia nada)', () => {
    const r = correr(`insert into public.app_versiones (user_id, equipo, version) values ('${OWNER_ID}', 'equipo-viejo-e2e', '0123abc');`,
      "array['dev','0123abc']")
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain('no está en el estado de partida')
    expect(r.stderr).not.toContain('versión anterior al Paso 10')
  })
})
