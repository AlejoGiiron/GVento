-- supabase/close-cash-shift-revoke.sql
-- ============================================================================
-- FASE 2 del cierre en el servidor. QUÉ HACE: cierra el camino viejo — quita
-- el UPDATE directo sobre cash_shifts a authenticated y anon. Desde acá, el
-- único modo de cerrar un turno es close_cash_shift (supabase/close-cash-shift.sql).
--
-- POR QUÉ: si el UPDATE directo sigue abierto, una pestaña con el JS viejo (o
-- cualquiera con la anon key y un login) cierra con el esperado del NAVEGADOR,
-- y la RPC no protege nada. Fuera del cierre la app no actualiza nada en
-- cash_shifts: openShift es un INSERT y closeShift era el único UPDATE (grep de
-- from('cash_shifts') en src/). La allowlist de UPDATE queda VACÍA.
--
-- 🔴 PRECONDICIONES (en este orden, si no, los clientes no pueden cerrar turno):
--   1. close-cash-shift.sql (fase 1) aplicada.
--   2. El frontend que cierra por close_cash_shift, DESPLEGADO.
--   3. Los clientes recargaron la página (o se esperó a que lo hagan). Una
--      pestaña que siga con el JS viejo, después de esto, ve "Error al cerrar
--      el turno" y el turno queda ABIERTO (medido en Docker 2026-09-30): no
--      congela nada mal, falla cerrado; recargando se arregla.
--
-- RE-APLICAR: idempotente (revoke sobre algo ya revocado y drop if exists son
-- no-op). En una transacción.
--
-- NO DEDUZCAS EL ESTADO DE ESTE COMENTARIO — correlo:
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_name = 'cash_shifts' and grantee in ('anon','authenticated')
--      and privilege_type = 'UPDATE';                    -- aplicada ⇒ 0 filas
-- ============================================================================

begin;

revoke update on public.cash_shifts from anon, authenticated;

-- La policy de UPDATE queda sin uso (nadie tiene el privilegio). Se borra para
-- que un re-grant accidental no la reactive con el enum get_my_role().
drop policy if exists "cash_shifts: cajero/admin cierra turno" on public.cash_shifts;

commit;
