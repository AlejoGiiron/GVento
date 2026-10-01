import { expect } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ownerCreds } from './auth'

// ============================================================================
// Higiene del laboratorio: mesas FIJAS por spec, liberadas en un afterAll.
//
// POR QUÉ EXISTE (medido 2026-09-21): LAB tenía 188 mesas, ~25 por spec — una
// por corrida. Dos causas encadenadas:
//   1. La limpieza era el ÚLTIMO test de un `describe.serial`: si un test previo
//      falla, se saltea. `afterAll` corre igual.
//   2. La limpieza no tenía aserción (`if (await del.count() > 0) await del.click()`),
//      así que no borrar era indistinguible de borrar (DEUDAS → "el lab no es
//      determinista entre corridas").
// Y el volumen no es cosmético: el flake de `pago-mixto.spec.ts:247` falló con
// "15 ocupadas · 161 libres" en pantalla.
//
// POR QUÉ MESA FIJA Y NO BORRARLA: una mesa que YA tuvo una orden `dine_in`
// probablemente no se puede borrar nunca — `orders.table_id` es ON DELETE SET
// NULL y choca con `chk_dine_in_has_table`. Está en verificación
// (`supabase/diag/borrar-mesa-simulacion.sql`); mientras tanto el diseño no
// depende de la respuesta: reusar una mesa por nombre fijo deja el conteo
// ESTABLE aunque borrar sea imposible.
//
// POR QUÉ POR API Y NO POR LA UI: la limpieza tiene que correr aunque la UI esté
// rota, que es justo cuando el test falló. Va con anon key + login de LAB (NO
// service role: ese saltea RLS y get_my_role, R4). El entorno (Supabase LOCAL)
// lo pone playwright.config.ts: acá no se lee ningún .env.
// ============================================================================

/** Estados de orden que mantienen la mesa OCUPADA (los que mira TablesPage). */
const ACTIVOS = ['pending', 'preparing', 'ready'] as const

let _db: SupabaseClient | null = null
let _sede = ''
let _uid = ''

async function db(): Promise<SupabaseClient> {
  if (_db) return _db
  const c = createClient(
    process.env.VITE_GVENTO_SUPABASE_URL!, process.env.VITE_GVENTO_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  )
  const { email, password } = ownerCreds()
  const { error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`lab: login de owner falló: ${error.message}`)
  _uid = (await c.auth.getUser()).data.user!.id
  const { data, error: e2 } = await c.from('profiles').select('restaurant_id').eq('id', _uid).single()
  if (e2) throw new Error(`lab: no pude leer la sede del owner: ${e2.message}`)
  _sede = data!.restaurant_id as string
  _db = c
  return c
}

async function filaMesa(nombre: string) {
  const c = await db()
  const { data, error } = await c.from('tables')
    .select('id, name, status').eq('restaurant_id', _sede).eq('name', nombre).maybeSingle()
  if (error) throw new Error(`lab: buscar mesa "${nombre}": ${error.message}`)
  return data as { id: string; name: string; status: string } | null
}

/**
 * Garantiza que la mesa del spec exista y esté LIBRE. Idempotente: la crea la
 * primera vez y la reusa siempre. Devuelve su UUID.
 *
 * El nombre es FIJO (sin sufijo de timestamp) a propósito: es lo que hace que el
 * conteo de mesas del lab no crezca corrida a corrida.
 */
export async function mesaFija(nombre: string): Promise<string> {
  const c = await db()
  const existente = await filaMesa(nombre)
  if (existente) {
    await liberarMesa(nombre)
    return existente.id
  }
  const { data, error } = await c.from('tables')
    .insert({ name: nombre, restaurant_id: _sede, status: 'free', zone: 'Salón' })
    .select('id').single()
  if (error) throw new Error(`lab: crear mesa "${nombre}": ${error.message}`)
  return data!.id as string
}

/**
 * Deja la mesa LIBRE: cancela sus órdenes activas y la marca `free`.
 * Termina VERIFICANDO — una limpieza sin aserción es indistinguible de una que
 * no corre. Si la mesa no existe, no hace nada (no es un error: el test pudo
 * fallar antes de crearla).
 */
export async function liberarMesa(nombre: string): Promise<void> {
  const c = await db()
  const mesa = await filaMesa(nombre)
  if (!mesa) return

  const cancel = await c.from('orders')
    .update({ status: 'cancelled' })
    .eq('table_id', mesa.id).in('status', ACTIVOS as unknown as string[])
  if (cancel.error) throw new Error(`lab: cancelar órdenes de "${nombre}": ${cancel.error.message}`)

  const libre = await c.from('tables').update({ status: 'free' }).eq('id', mesa.id)
  if (libre.error) throw new Error(`lab: liberar "${nombre}": ${libre.error.message}`)

  // Verificación (releída de la BD, no del resultado del update).
  const despues = await filaMesa(nombre)
  const activas = (await c.from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('table_id', mesa.id).in('status', ACTIVOS as unknown as string[])).count
  expect(despues?.status, `la mesa "${nombre}" quedó ocupada tras la limpieza`).toBe('free')
  expect(activas, `la mesa "${nombre}" quedó con órdenes activas`).toBe(0)
}

/**
 * Borra una mesa TRANSITORIA (creada y descartada dentro de la misma corrida,
 * sin órdenes) y verifica que ya no esté. Para mesas que tuvieron ventas usar
 * `liberarMesa`: el borrado puede ser imposible (ver el encabezado).
 */
export async function borrarMesaTransitoria(nombre: string): Promise<void> {
  const c = await db()
  const mesa = await filaMesa(nombre)
  if (!mesa) return
  const { error } = await c.from('tables').delete().eq('id', mesa.id)
  if (error) throw new Error(`lab: borrar mesa transitoria "${nombre}": ${error.message}`)
  expect(await filaMesa(nombre), `la mesa transitoria "${nombre}" sigue existiendo`).toBeNull()
}

/**
 * Red de seguridad para clientes de fiado creados por un spec: los desactiva
 * (borrado lógico, `is_active=false`) y verifica. Los nombres deben llevar el
 * sufijo único de la corrida — así no hay forma de tocar un cliente ajeno, y la
 * RLS acota a la sede del owner de LAB.
 */
export async function desactivarClientes(nombres: string[]): Promise<void> {
  if (!nombres.length) return
  const c = await db()
  const { error } = await c.from('customers')
    .update({ is_active: false }).eq('restaurant_id', _sede).in('name', nombres)
  if (error) throw new Error(`lab: desactivar clientes: ${error.message}`)
  const activos = (await c.from('customers').select('id', { count: 'exact', head: true })
    .eq('restaurant_id', _sede).in('name', nombres).eq('is_active', true)).count
  expect(activos, `clientes de prueba que quedaron activos: ${nombres.join(', ')}`).toBe(0)
}

/** Cuántas mesas tiene la sede del lab. Para medir que el conteo no crece. */
export async function contarMesas(): Promise<number> {
  const c = await db()
  const { count, error } = await c.from('tables')
    .select('id', { count: 'exact', head: true }).eq('restaurant_id', _sede)
  if (error) throw new Error(`lab: contar mesas: ${error.message}`)
  return count ?? 0
}
