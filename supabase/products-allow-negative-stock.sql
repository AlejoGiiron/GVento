-- ============================================================
-- G-Vento — Permitir stock negativo en products
--
-- Por qué:
--   El stock de insumos es una ESTIMACIÓN, no una verdad de caja. En un bar
--   se vende aunque el sistema diga 0 (mermas, cortesías, recuentos imperfectos,
--   recargas a media noche). Bloquear la venta por "stock insuficiente" frena
--   ventas reales en plena operación — inaceptable.
--
--   Antes, la RPC de venta hacía greatest(0, stock - n): nunca bloqueaba, pero
--   OCULTABA la sobreventa (se quedaba pegado en 0). Permitir negativos hace que
--   el déficit sea la SEÑAL VISIBLE: "vas N por debajo, repón / recuenta".
--
-- Qué hace:
--   Quita el check (stock_qty >= 0) de products. Se localiza el constraint por
--   su definición (no por nombre fijo) para ser robusto ante el nombre autogenerado.
--
-- Ejecutar en: Supabase Dashboard > SQL Editor. Migración NUEVA.
-- ============================================================

begin;

do $$
declare
  v_constraint text;
begin
  -- Constraint CHECK de products cuya definición referencia stock_qty
  -- (el inline `check (stock_qty >= 0)` se llama, por defecto,
  --  'products_stock_qty_check', pero lo resolvemos dinámicamente).
  select conname into v_constraint
  from pg_constraint
  where conrelid = 'public.products'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%stock_qty%';

  if v_constraint is not null then
    execute format('alter table public.products drop constraint %I', v_constraint);
  end if;
end $$;

comment on column public.products.stock_qty is
  'Nulo cuando stock_tracking = false. Puede ser NEGATIVO: el negativo señala '
  'sobreventa del insumo (estimación, no verdad de caja) — indica cuánto reponer.';

commit;
