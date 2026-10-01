import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { psql, psqlResultado } from './helpers/db-local'

// ============================================================================
// Re-aplicar supabase/close-cash-shift.sql DESPUÉS de supabase/cobro-turno.sql
// tiene que ABORTAR sin cambiar nada (guard del paso 0 de close-cash-shift.sql).
//
// Sin el guard, el re-apply devolvía register_debt_payment y
// register_debt_payments_batch a la versión sin turno obligatorio para el
// efectivo, con exit 0: revertía el cambio (1) en silencio (medido 2026-09-30).
//
// La base local tiene los dos aplicados en ese orden (ORDEN de preparar-local),
// así que es exactamente el escenario del re-apply accidental en prod.
// ============================================================================

// Huella de lo que el archivo podría tocar: funciones (texto + ACL), triggers y
// policies. Si el guard deja pasar algo, cambia.
const FOTO = `
select md5(string_agg(proname || ':' || md5(prosrc) || ':' || coalesce(proacl::text, ''), ',' order by proname, oid))
  from pg_proc where pronamespace = 'public'::regnamespace
union all
select md5(string_agg(tgname || ':' || tgenabled::text, ',' order by tgname)) from pg_trigger where not tgisinternal
union all
select md5(string_agg(tablename || ':' || policyname || ':' || coalesce(qual, '') || coalesce(with_check, ''), ',' order by tablename, policyname))
  from pg_policies;`

const exigeTurno = () => psql(`select string_agg((prosrc ilike '%No hay un turno de caja abierto%')::text, ',' order by proname)
  from pg_proc where pronamespace = 'public'::regnamespace
   and proname in ('register_debt_payment', 'register_debt_payments_batch');`)

test('re-aplicar close-cash-shift.sql sobre cobro-turno.sql → aborta con mensaje claro y no cambia nada', () => {
  // Precondición: las dos funciones están en la versión de cobro-turno. Sin
  // esto el test pasaría por la razón equivocada (no habría nada que proteger).
  expect(exigeTurno(), 'precondición: cobro-turno.sql aplicado').toBe('true,true')
  const antes = psql(FOTO)

  const r = psqlResultado(readFileSync('supabase/close-cash-shift.sql', 'utf-8'))

  expect(r.status, 'el re-apply NO abortó').not.toBe(0)
  expect(r.stderr).toMatch(/close-cash-shift\.sql NO se aplicó \(no cambió nada\)/)
  expect(r.stderr).toMatch(/register_debt_payment, register_debt_payments_batch/)
  expect(psql(FOTO), 'el re-apply cambió funciones, triggers o policies').toBe(antes)
  expect(exigeTurno(), 'el re-apply revirtió el cambio (1)').toBe('true,true')
})
