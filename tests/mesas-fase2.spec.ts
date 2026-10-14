import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ownerCreds } from './helpers/auth'
import { cliente, psql, psqlResultado } from './helpers/db-local'

// ============================================================================
// supabase/mesas-fase2.sql (Paso 11): un usuario CON sesión ya no escribe directo lo que el
// frontend del Paso 10 hace por funciones del servidor. Sin DELETE de ítems ni de mesas; en
// orders, UPDATE solo de status, courier_id y estimated_delivery_minutes (Cocina y Delivery).
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
  test('catálogo: authenticated sin DELETE en order_items y tables; orders actualizable solo en 3 columnas', () => {
    expect(psql(`select has_table_privilege('authenticated','public.order_items','DELETE') || '|'
      || has_table_privilege('authenticated','public.tables','DELETE') || '|'
      || has_table_privilege('authenticated','public.orders','UPDATE');`)).toBe('false|false|false')
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

  test('con todos los equipos en la lista pasa la guarda; ya aplicada, aborta en el estado de partida (re-aplicar no cambia nada)', () => {
    const r = correr(`insert into public.app_versiones (user_id, equipo, version) values ('${OWNER_ID}', 'equipo-viejo-e2e', '0123abc');`,
      "array['dev','0123abc']")
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain('no está en el estado de partida')
    expect(r.stderr).not.toContain('versión anterior al Paso 10')
  })
})
