import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { psql } from './helpers/db-local'

// ============================================================================
// supabase/anon-sin-escritura.sql (Paso 11 / P0.2): el rol `anon` —cualquiera SIN sesión, con
// la anon key que viaja en el bundle— no escribe en NINGUNA tabla ni vista de `public`.
//
// Este spec es el TRIPWIRE: se pone rojo si anon vuelve a poder escribir por cualquier camino.
// Mira por la CLASE, no por una lista de tablas conocidas (R2): el catálogo entero de `public`,
// las políticas, las funciones SECURITY DEFINER, lo que nace después (privilegios por defecto)
// y, por la API real, un intento de escritura en cada tabla y vista.
// Antes de la migración (medido el 2026-10-13): 29 objetos escribibles, 1 política TO public
// de escritura (cash_movements), 1 función DEFINER ejecutable (rls_auto_enable).
// ============================================================================

// MAINTAIN (Postgres 17) no escribe filas, pero permite LOCK TABLE / VACUUM / REFRESH sin sesión.
const ESCRITURA = `'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'`

test.describe('anon (sin sesión) no escribe en public', () => {
  test('catálogo: ninguna tabla ni vista de public con escritura para anon', () => {
    const lista = psql(`select coalesce(string_agg(c.oid::regclass::text, ', ' order by 1), '')
      from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m','f')
       and has_table_privilege('anon', c.oid, ${ESCRITURA});`)
    expect(lista, 'objetos de public donde anon puede escribir').toBe('')
    // Contraste: el catálogo SÍ tiene tablas (si la consulta no viera nada, pasaría por la razón equivocada).
    expect(Number(psql(`select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r';`)))
      .toBeGreaterThan(20)
  })

  test('ninguna política de escritura alcanza a anon (TO anon o TO public)', () => {
    expect(psql(`select coalesce(string_agg(tablename || ' / ' || policyname, '; '), '') from pg_policies
       where schemaname = 'public' and cmd <> 'SELECT' and ('anon' = any(roles) or 'public' = any(roles));`),
      'políticas de escritura para anon').toBe('')
    // Contraste: la de cash_movements existe, ahora solo para authenticated.
    expect(psql(`select array_to_string(roles, ',') from pg_policies
       where schemaname = 'public' and tablename = 'cash_movements' and policyname = 'cash_movements: acceso por restaurante';`))
      .toBe('authenticated')
  })

  test('ninguna función SECURITY DEFINER de public es ejecutable por anon', () => {
    expect(psql(`select coalesce(string_agg(p.oid::regprocedure::text, ', '), '') from pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.prosecdef
         and has_function_privilege('anon', p.oid, 'EXECUTE');`), 'funciones DEFINER que anon ejecuta').toBe('')
  })

  test('lo que nazca después: una tabla nueva no da escritura a anon (sí a authenticated) y nace con RLS', () => {
    // Como lo crearía una migración (rol postgres), dentro de una transacción que se deshace.
    const salida = psql(`begin;
      create table public.__e2e_anon_nueva (id int);
      select 'R|' || has_table_privilege('anon', 'public.__e2e_anon_nueva', ${ESCRITURA})::text
          || '|' || has_table_privilege('authenticated', 'public.__e2e_anon_nueva', 'INSERT')::text
          || '|' || (select relrowsecurity from pg_class where oid = 'public.__e2e_anon_nueva'::regclass)::text;
      rollback;`)
    const fila = salida.split('\n').find((l) => l.startsWith('R|'))
    expect(fila, 'anon escribe | authenticated inserta | RLS activado').toBe('R|false|true|true')
  })

  test('por la API real, con la anon key y SIN login: insertar en cada tabla da "permission denied"', async () => {
    // Solo INSERT y solo tablas base: Postgres resuelve columnas y reescribe vistas ANTES de
    // revisar privilegios, así que un update/delete por una columna inexistente o un insert en
    // una vista de agregados darían otro error aunque el permiso esté cerrado. UPDATE, DELETE y
    // las vistas los cubre el test de catálogo de arriba.
    const anon = createClient(process.env.VITE_GVENTO_SUPABASE_URL!, process.env.VITE_GVENTO_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } })
    expect((await anon.auth.getSession()).data.session, 'sin sesión').toBeNull()
    const tablas = psql(`select string_agg(c.relname, ',' order by 1) from pg_class c
       where c.relnamespace = 'public'::regnamespace and c.relkind = 'r';`).split(',')
    expect(tablas.length).toBeGreaterThan(20)
    const abiertas: string[] = []
    for (const t of tablas) {
      const { error } = await anon.from(t).insert({})
      // Cualquier cosa que NO sea "permission denied" (un error de RLS o de restricción, o
      // ningún error) significa que anon pasó la barrera de privilegios.
      if (!/permission denied/i.test(error?.message ?? '')) abiertas.push(`${t}: ${error?.message ?? 'sin error'}`)
    }
    expect(abiertas, 'tablas donde un insert de anon NO dio "permission denied"').toEqual([])
  })

  test('contraste: anon conserva el SELECT (lo decide RLS): leer products sin sesión no da error y no ve nada', async () => {
    // La migración NO toca el SELECT. Si lo quitara, una lectura sin sesión daría "permission
    // denied"; con el SELECT y RLS, da cero filas aunque la tabla tenga filas. (app_versiones no sirve de contraste: su
    // lectura directa está cerrada para todos a propósito, ver aviso-version.spec.ts.)
    const anon = createClient(process.env.VITE_GVENTO_SUPABASE_URL!, process.env.VITE_GVENTO_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } })
    const { data, error } = await anon.from('products').select('id').limit(5)
    expect(error, error?.message).toBeNull()
    expect(data).toEqual([])
    expect(Number(psql(`select count(*) from public.products;`)), 'hay productos (lab-seed): el [] es RLS, no una tabla vacía').toBeGreaterThan(0)
  })
})
