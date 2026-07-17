-- ============================================================
-- G-Vento — Anulación de ventas (Fase 1 BD): rastro + permiso + candados
--
-- Prepara el terreno para anular ventas del TURNO ACTUAL (la RPC
-- register_sale_void llega en la Fase 2). Esta migración es ADITIVA PURA
-- (nada destructivo): agrega columnas nullable, un permiso nuevo y dos
-- índices. No edita ninguna migración ya aplicada.
--
-- Contenido:
--   1. orders + cancelled_at / cancelled_by / cancel_reason (rastro de anulación)
--   2. índice parcial idx_orders_cancelled (para excluir anuladas en Cartera/arqueo)
--   3. permiso ventas.anular → seed idempotente en admin (owner por "*", cajero NO)
--   4. índice único idx_one_open_shift_per_store (un turno abierto por sede)
--
-- ------------------------------------------------------------
-- CATÁLOGO DE PERMISOS — permiso NUEVO (extiende el de multi-tenant-rbac.sql):
--   ventas.anular          anular una venta YA REGISTRADA (del turno actual)
--
-- Distinción con el permiso existente pos.anular (NO se toca):
--   • pos.anular     → vaciar/abandonar la venta EN CURSO (carrito en memoria,
--                      nada persistido). Lo tienen owner/admin/cajero. Sigue
--                      gateando "Vaciar carrito" en el POS, sin cambios.
--   • ventas.anular  → anular una venta ya PERSISTIDA (revierte stock, la saca
--                      del cuadre, deja rastro). Solo owner (por "*") y admin.
--                      El cajero NO lo tiene: el caso de uso es el admin
--                      corrigiendo el error del cajero en caliente.
--
-- IMPORTANTE — índice único de turno (punto 4): requiere que NINGUNA sede tenga
-- 2+ turnos abiertos antes de aplicar. Verificado 0 duplicados en G-10,
-- Salchimelo y LAB. Si existiera un duplicado, el create unique index falla con
-- "duplicate key" → cerrar el turno sobrante primero.
--
-- Ejecutar en: Supabase Dashboard > SQL Editor. Migración NUEVA (archivo nuevo).
-- Tras aplicar: agregar cancelled_at/cancelled_by/cancel_reason a mano en
-- database.types.ts (deuda CLI de regeneración de tipos).
-- ============================================================

-- Toda la migración es atómica: si cualquier statement falla, ROLLBACK completo
-- (aprendizaje: tsc no prueba SQL; se valida contra la BD con datos reales).
begin;

-- ------------------------------------------------------------
-- 1. orders — rastro de anulación (aditivo, todo nullable).
--    La venta NO se borra: se marca. cancelled_at is not null = anulada.
--    cancelled_by: quién anuló. ON DELETE SET NULL (como closed_by de
--    cash_shifts / created_by de stock_movements): borrar un profile no debe
--    bloquearse por haber anulado una venta; el rastro textual queda igual.
-- ------------------------------------------------------------
alter table public.orders
  add column if not exists cancelled_at  timestamptz,
  add column if not exists cancelled_by  uuid references public.profiles on delete set null,
  add column if not exists cancel_reason text;

comment on column public.orders.cancelled_at is
  'Marca de anulación: fecha/hora en que se anuló la venta. null = venta vigente. '
  'La venta NUNCA se borra (se marca). La anulación solo aplica al turno actual '
  '(ver RPC register_sale_void).';
comment on column public.orders.cancelled_by is
  'Profile que anuló la venta (permiso ventas.anular). null si el usuario se borró.';
comment on column public.orders.cancel_reason is
  'Motivo de la anulación (obligatorio en la UI al anular).';

-- ------------------------------------------------------------
-- 2. Índice parcial de anuladas.
--    Barato (solo indexa las pocas anuladas). Apoya las exclusiones de la
--    Fase 3 (getDebts / getShiftSalesCount / getShiftVouchersTotal filtran
--    cancelled_at is null) sin penalizar las queries del caso vigente.
-- ------------------------------------------------------------
create index if not exists idx_orders_cancelled
  on public.orders (restaurant_id)
  where cancelled_at is not null;

-- ------------------------------------------------------------
-- 3. Permiso ventas.anular — seed idempotente en admin.
--    El owner lo hereda por el comodín "*" (no se incluye: sería redundante).
--    El cajero NO lo recibe (a diferencia de pos.anular). Roles custom: la UI
--    de Roles decide; nunca reciben "*".
--    Sin filtro de organización → aplica a TODAS las orgs (G-10, Salchimelo,
--    LAB) en una pasada. El guard `not (permissions ? 'ventas.anular')` evita
--    duplicar si se re-ejecuta.
-- ------------------------------------------------------------
update public.roles
   set permissions = permissions || '["ventas.anular"]'::jsonb
 where name = 'admin'
   and not (permissions ? 'ventas.anular');

-- ------------------------------------------------------------
-- 4. Índice único: un solo turno abierto por sede.
--    Cierra de raíz el bug de dos turnos simultáneos (getOpenShift usa
--    maybeSingle() y lanzaría si hubiera dos). Parcial sobre los abiertos
--    (closed_at is null): no limita el histórico de turnos cerrados.
-- ------------------------------------------------------------
create unique index if not exists idx_one_open_shift_per_store
  on public.cash_shifts (restaurant_id)
  where closed_at is null;

commit;
