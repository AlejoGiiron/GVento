-- ============================================================
-- Fase 1 / Fix 3 — Responsable de mesa (texto libre)
--
-- Agrega una columna opcional waiter_name a orders para registrar
-- quién atiende la mesa. Texto libre (sin FK) según decisión de producto.
--
-- Migración nueva — NO editar migraciones ya aplicadas.
-- RLS: se hereda de las políticas existentes de orders; no requiere cambios.
-- ============================================================

alter table public.orders
  add column if not exists waiter_name text;

comment on column public.orders.waiter_name is
  'Nombre del responsable que atiende la mesa (texto libre, opcional).';
