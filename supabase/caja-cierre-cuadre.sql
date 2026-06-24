-- caja-cierre-cuadre.sql
-- Persiste el cuadre calculado al cerrar turno (antes se recalculaba y se perdía).
-- Ejecutar en: Supabase Dashboard > SQL Editor

alter table public.cash_shifts
  add column if not exists expected_amount numeric(12, 2),
  add column if not exists difference      numeric(12, 2);

comment on column public.cash_shifts.expected_amount is
  'Efectivo esperado al cierre = apertura + ventas efectivo + ingresos − egresos. Puede ser negativo (sobregiro).';
comment on column public.cash_shifts.difference is
  'Diferencia declarado − esperado al cierre. Negativo = faltante, positivo = sobrante.';
