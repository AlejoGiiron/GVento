-- orders-discount-vale.sql
-- Persiste el descuento por venta (monto real, no derivado) + marca de "vale"
-- (ruletazo). Aditivo y nullable/con default → no rompe órdenes existentes.
-- Resuelve de paso la deuda del descuento derivado (hoy SalesHistoryPage lo
-- estima como subtotal−total). Ejecutar en: Supabase Dashboard > SQL Editor.

alter table public.orders
  add column if not exists discount_amount numeric(12,2) not null default 0
    check (discount_amount >= 0),
  add column if not exists discount_type   text
    check (discount_type in ('pct','fixed')),
  add column if not exists discount_kind   text not null default 'normal'
    check (discount_kind in ('normal','vale')),
  add column if not exists discount_reason text;

-- Un vale (ruletazo) es SIEMPRE monto fijo. Idempotente (drop + add).
alter table public.orders drop constraint if exists chk_vale_is_fixed;
alter table public.orders add constraint chk_vale_is_fixed
  check (discount_kind <> 'vale' or discount_type = 'fixed');

-- Índice parcial para "vales del turno/mes" por sede.
create index if not exists idx_orders_vale
  on public.orders (restaurant_id, created_at)
  where discount_kind = 'vale';

comment on column public.orders.discount_amount is
  'Descuento aplicado en COP (monto monetario, ya reflejado en orders.total). 0 = sin '
  'descuento. Persiste el descuento REAL (antes se derivaba subtotal−total).';
comment on column public.orders.discount_type is
  'Cómo se ingresó: pct | fixed. null si no hubo descuento. Los vales son siempre fixed.';
comment on column public.orders.discount_kind is
  'normal | vale. vale = ruletazo, contabilizable aparte ("cuánto se regaló al mes").';
comment on column public.orders.discount_reason is
  'Nota opcional del descuento/vale.';

-- ============================================================
-- VERIFICACIÓN (read-only) — las 4 columnas quedaron agregadas.
-- ============================================================
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name = 'orders'
   and column_name in ('discount_amount', 'discount_type', 'discount_kind', 'discount_reason')
 order by column_name;
