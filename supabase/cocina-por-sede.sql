-- ============================================================
-- G-Vento — Control de cocina por sede y por producto
--
-- Modelo de dos niveles para decidir qué va a cocina:
--   1) restaurants.uses_kitchen  → la SEDE usa cocina o no
--      (coctelería sin cocina = false; restaurante con comida = true)
--   2) products.routes_to_kitchen → dentro de una sede CON cocina, si el
--      PRODUCTO va a cocina (las bebidas/postres pueden desmarcarse)
--
-- Regla efectiva: un ítem va a cocina (se marca sent_to_kitchen y entra a
-- la comanda + KDS) si y solo si:
--     sede.uses_kitchen AND producto.routes_to_kitchen AND el humano lo envió
--
-- Ambas columnas son ADITIVAS y not null default true → NO cambian el
-- comportamiento de ninguna sede ni producto existente: todo sigue yendo a
-- cocina hasta que se apague explícitamente.
--
-- Ejecutar en: Supabase Dashboard > SQL Editor. Migración NUEVA.
-- ============================================================

begin;

-- a) Nivel SEDE ---------------------------------------------------------------
alter table public.restaurants
  add column if not exists uses_kitchen boolean not null default true;

comment on column public.restaurants.uses_kitchen is
  'La sede usa cocina (KDS + comanda) o no. Default true: todas las sedes '
  'existentes mantienen cocina hasta apagarla. Una sede con uses_kitchen=false '
  'no envia nada a cocina y la UI oculta el flujo de comanda/KDS.';

-- b) Nivel PRODUCTO -----------------------------------------------------------
alter table public.products
  add column if not exists routes_to_kitchen boolean not null default true;

comment on column public.products.routes_to_kitchen is
  'Dentro de una sede con cocina, si el producto se envia a cocina. Default '
  'true: la mayoria de productos van a cocina; se desmarca lo que no (ej. '
  'bebidas embotelladas). Ignorado si la sede tiene uses_kitchen=false.';

commit;

-- ============================================================
-- (manual, post-migración) Apagar cocina en la sede de coctelería (G10).
-- NO se incluye en la migración a propósito: se corre conscientemente
-- eligiendo la sede correcta por id/nombre tras revisar restaurants.
--
--   update public.restaurants
--      set uses_kitchen = false
--    where id = '<uuid-de-la-sede-G10>';
-- ============================================================
