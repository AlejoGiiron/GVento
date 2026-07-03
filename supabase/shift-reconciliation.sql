-- shift-reconciliation.sql
-- Arqueo multi-método: persiste el cuadre por método al cerrar (SNAPSHOT).
-- Aditivo y nullable → no rompe cierres existentes. NO edita migraciones aplicadas.
-- Ejecutar en: Supabase Dashboard > SQL Editor.

alter table public.cash_shifts
  add column if not exists close_reconciliation jsonb,
  add column if not exists close_comment        text;

comment on column public.cash_shifts.close_reconciliation is
  'Snapshot del arqueo por método al cerrar. Se CONGELA al cierre porque payments '
  'no tiene shift_id y su ventana es solo-temporal → recomputar el esperado de un '
  'turno cerrado sumaría pagos de turnos posteriores. Forma: '
  '{ "methods": { "cash":{"expected","declared","difference"}, "card":{…}, '
  '"transfer":{…}, "nequi":{…} }, "expected_total", "declared_total", '
  '"difference_total", "sales_count" }. cash.expected = apertura + ventas efectivo '
  '+ ingresos − egresos; los demás.expected = ventas de ese método. null en turnos '
  'cerrados antes de esta migración.';

comment on column public.cash_shifts.close_comment is
  'Comentario del cajero al cerrar (justificación de diferencias). null si vacío.';

-- ============================================================
-- VERIFICACIÓN (read-only) — las dos columnas quedaron agregadas.
-- ============================================================
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public' and table_name = 'cash_shifts'
   and column_name in ('close_reconciliation', 'close_comment');
