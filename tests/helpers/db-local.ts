import { spawn, spawnSync } from 'node:child_process'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Creds } from './auth'

// ============================================================================
// Acceso directo a la base LOCAL de Docker para los specs de concurrencia.
// playwright.config.ts garantiza que el backend es loopback; esto habla con el
// contenedor supabase_db_gvento.
//
// La pieza central es `sesionRetenida`: corre SQL COMO un usuario de la app
// (request.jwt.claims + role authenticated → auth.uid(), RLS y has_permission
// funcionan igual que desde la API) dentro de una transacción que NO confirma
// hasta pasados N segundos. Mientras tanto, los locks que tomó siguen tomados:
// así se fuerza una carrera de forma DETERMINISTA, sin depender de que dos
// requests coincidan por azar en una ventana de microsegundos (medido: por red,
// 0/160 dobles cobros con el defecto presente).
// ============================================================================

export const DB = 'supabase_db_gvento'

export function psql(sql: string): string {
  const r = spawnSync('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'],
    { input: sql, encoding: 'utf-8' })
  if (r.status !== 0) throw new Error(`psql: ${r.stderr}`)
  return r.stdout.trim()
}

export async function cliente(creds: Creds): Promise<{ c: SupabaseClient; uid: string; sede: string }> {
  const c = createClient(process.env.VITE_GVENTO_SUPABASE_URL!, process.env.VITE_GVENTO_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } })
  const { error } = await c.auth.signInWithPassword(creds)
  if (error) throw error
  const uid = (await c.auth.getUser()).data.user!.id
  const sede = (await c.rpc('get_my_restaurant_id')).data as string
  return { c, uid, sede }
}

/**
 * Corre `sql` como el usuario `uid`, dentro de una transacción que se RETIENE
 * `segundos` antes de confirmar. Resuelve cuando la sesión ya está dormida (los
 * locks de `sql` están tomados); `fin` resuelve cuando confirma (o rechaza si
 * falló).
 */
export async function sesionRetenida(uid: string, sql: string, segundos = 3): Promise<{ fin: Promise<void> }> {
  const marca = `retenida_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const script = `begin;
select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true);
set local role authenticated;
${sql};
select pg_sleep(${segundos}) /* ${marca} */;
commit;`
  const p = spawn('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'])
  let err = ''
  p.stderr.on('data', (d) => { err += d })
  const fin = new Promise<void>((ok, ko) => p.on('close', (code) => (code === 0 ? ok() : ko(new Error(`sesión retenida: ${err}`)))))
  p.stdin.end(script)
  for (let i = 0; i < 80; i++) {
    if (psql(`select count(*) from pg_stat_activity where query like '%${marca}%' and query not like '%pg_stat_activity%';`) === '1') {
      return { fin }
    }
    // Si la sesión ya terminó (falló antes de dormir), no esperar en vano.
    if (p.exitCode !== null) break
    await new Promise((ok) => setTimeout(ok, 100))
  }
  await fin   // propaga el error de la sesión si lo hubo
  throw new Error('la sesión retenida nunca llegó al pg_sleep')
}

/**
 * El invariante del turno: arqueo congelado == recalculado desde la base.
 * Cada suma se coalesce POR SEPARADO (sum() sin filas es NULL, y NULL − egresos
 * = NULL: un coalesce de afuera se tragaba los egresos).
 */
export function invarianteTurno(shiftId: string): { congelado: number; recalculado: number } {
  const [congelado, recalculado] = psql(`
    select s.expected_amount,
           s.opening_amount
           + coalesce((select sum(p.amount) from public.payments p
                        where p.restaurant_id = s.restaurant_id and p.method = 'cash'
                          and p.created_at >= s.opened_at and p.created_at <= s.closed_at), 0)
           + (select coalesce(sum(m.amount) filter (where m.type = 'in'), 0)
                   - coalesce(sum(m.amount) filter (where m.type = 'out'), 0)
                from public.cash_movements m where m.shift_id = s.id)
      from public.cash_shifts s where s.id = '${shiftId}';`).split('|').map(Number)
  return { congelado, recalculado }
}
