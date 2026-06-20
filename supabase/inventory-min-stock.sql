-- ============================================================
-- G-Vento — Inventario por recetas (Parte 2 UI): umbral de stock mínimo
--
-- Agrega products.min_stock: umbral de alerta de "stock bajo". Solo tiene
-- sentido para productos simple con stock_tracking=true (los insumos). Default
-- 0 → sin alerta de mínimo hasta que se configure por producto.
--
-- Columna ADITIVA, nullable-safe (not null default 0): no rompe inserts
-- existentes ni la RPC de venta.
--
-- Ejecutar en: Supabase Dashboard > SQL Editor. Migración NUEVA.
-- ============================================================

begin;

alter table public.products
  add column if not exists min_stock integer not null default 0;

comment on column public.products.min_stock is
  'Umbral de alerta de stock bajo. Aplica a productos simple con stock_tracking. '
  'Default 0: sin alerta de minimo hasta configurarlo.';

commit;
