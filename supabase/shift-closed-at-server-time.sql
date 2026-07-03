-- ============================================================
-- shift-closed-at-server-time.sql
-- cash_shifts.closed_at debe venir del RELOJ DEL SERVIDOR, igual que opened_at.
--
-- SÍNTOMA: cerrar un turno puede violar la constraint chk_shift_closed_after_opened
--   (closed_at > opened_at) con code 23514, dejando el cierre fallido.
--
-- CAUSA RAÍZ: el cliente enviaba closed_at = hora del NAVEGADOR
--   (useCashShift: closed_at: new Date().toISOString()), mientras opened_at lo
--   pone el servidor (DEFAULT now()). Si el reloj del cliente va DETRÁS del reloj
--   de la BD y el turno se abre y cierra en pocos segundos, closed_at (cliente)
--   queda ANTES de opened_at (servidor) → viola la constraint.
--
-- FIX: un trigger BEFORE UPDATE fija closed_at := now() en la transición de
--   cierre (closed_at pasa de null a no-null). Es el equivalente en UPDATE del
--   DEFAULT now() que ya usa opened_at en INSERT → ambos usan el MISMO reloj.
--
-- NOTA: NO se relaja la constraint (protege la integridad: un turno no puede
--   cerrar antes de abrir). El fix hace closed_at confiable, no cambia la regla.
--
-- ALCANCE: solo la transición de cierre. El UPDATE de cierre trae también
--   closing_amount/expected_amount/difference/closed_by en la MISMA sentencia; el
--   trigger SOLO reasigna closed_at y deja el resto (el cuadre) intacto. El único
--   UPDATE a cash_shifts es el cierre; cualquier otro update que no toque
--   closed_at deja old.closed_at = new.closed_at → el trigger es no-op.
--
-- No es SECURITY DEFINER (solo fija un valor de columna en el contexto del
--   statement que dispara) → no requiere revoke/grant.
--
-- Ejecutar en: Supabase Dashboard > SQL Editor. Migración NUEVA, no edita
--   migraciones aplicadas.
-- ============================================================

create or replace function public.set_shift_closed_at()
returns trigger
language plpgsql
as $$
begin
  -- Solo al CERRAR (closed_at: null → no-null): forzar el reloj del servidor.
  if new.closed_at is not null and old.closed_at is null then
    new.closed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_shift_closed_at on public.cash_shifts;

create trigger trg_shift_closed_at
  before update on public.cash_shifts
  for each row
  execute function public.set_shift_closed_at();

-- ============================================================
-- VERIFICACIÓN (read-only) — el trigger quedó registrado en cash_shifts.
-- ============================================================
select tgname, tgenabled
  from pg_trigger
 where tgrelid = 'public.cash_shifts'::regclass
   and not tgisinternal;
