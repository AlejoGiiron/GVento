-- ============================================================
-- G-Vento — Numeración secuencial de ventas (por sede)
--
-- Da a cada venta COMPLETADA un número correlativo legible (#1, #2, …)
-- independiente por sede. Inspirado en cómo lo maneja G-Mura.
--
-- Decisiones:
--   • orders.order_number es NULLABLE: solo las ventas cobradas reciben
--     número (se asigna desde el cliente tras el pago exitoso). Las órdenes
--     pending/cancelled quedan con order_number = NULL.
--   • El contador vive en store_sequences (una fila por sede). Numeración
--     INDEPENDIENTE por sede: cada sede arranca en 1.
--   • next_order_number() incrementa atómicamente (INSERT ... ON CONFLICT
--     ... RETURNING) para que dos cajeros simultáneos nunca obtengan el
--     mismo número.
--
-- ¿Por qué SECURITY DEFINER en next_order_number?
--   El UPDATE/INSERT sobre store_sequences se hace con privilegios de la
--   función, no del cajero (store_sequences tiene RLS y no expone escritura
--   directa). La función valida que p_restaurant_id sea la sede activa del
--   llamante (get_my_restaurant_id()) antes de tocar nada.
--   (Aprendizaje Fase 0: revocar EXECUTE a public/anon, conceder a authenticated.)
--
-- Nota: como la BD se limpió, todas las sedes arrancan en 0 → la primera
-- venta real de cada sede será #1.
--
-- Ejecutar en: Supabase Dashboard > SQL Editor. Migración NUEVA.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. Columna del número en orders
-- ------------------------------------------------------------
alter table public.orders
  add column if not exists order_number integer;

comment on column public.orders.order_number is
  'Número correlativo legible de la venta, por sede. NULL hasta el cobro '
  'exitoso (se asigna con next_order_number). Solo ventas completadas.';

-- Listado del historial: por sede, número descendente.
create index if not exists idx_orders_restaurant_order_number
  on public.orders (restaurant_id, order_number desc);

-- ------------------------------------------------------------
-- 2. Contador por sede
-- ------------------------------------------------------------
create table if not exists public.store_sequences (
  restaurant_id     uuid    primary key
                            references public.restaurants (id) on delete cascade,
  last_order_number integer not null default 0
);

comment on table public.store_sequences is
  'Contador de numeración de ventas por sede. last_order_number es el último '
  'número entregado; lo incrementa next_order_number() de forma atómica.';

-- Sembrar una fila por cada sede existente (arranca en 0).
insert into public.store_sequences (restaurant_id, last_order_number)
select id, 0 from public.restaurants
on conflict (restaurant_id) do nothing;

-- RLS: lectura del propio contador; la escritura SOLO ocurre vía la función
-- SECURITY DEFINER (que salta RLS). No se crean políticas de escritura.
alter table public.store_sequences enable row level security;

drop policy if exists "store_sequences: ver de mi sede" on public.store_sequences;
create policy "store_sequences: ver de mi sede"
  on public.store_sequences for select to authenticated
  using (restaurant_id = get_my_restaurant_id());

-- ------------------------------------------------------------
-- 3. next_order_number(p_restaurant_id) → integer
--    Incremento atómico del contador de la sede. Crea la fila si no existe.
-- ------------------------------------------------------------
create or replace function public.next_order_number(p_restaurant_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
begin
  -- Solo la sede activa del llamante.
  if p_restaurant_id is null or p_restaurant_id <> get_my_restaurant_id() then
    raise exception 'No autorizado para numerar ventas de esta sede';
  end if;

  -- Incremento atómico: si no hay fila para la sede, la crea con 1.
  insert into public.store_sequences (restaurant_id, last_order_number)
  values (p_restaurant_id, 1)
  on conflict (restaurant_id) do update
    set last_order_number = public.store_sequences.last_order_number + 1
  returning last_order_number into v_next;

  return v_next;
end;
$$;

revoke execute on function public.next_order_number(uuid) from public;
revoke execute on function public.next_order_number(uuid) from anon;
grant  execute on function public.next_order_number(uuid) to authenticated;

-- ------------------------------------------------------------
-- 4. Permiso RBAC nuevo: ventas.historial
--    Acceso a la página de Historial de Ventas (consulta + reimpresión).
--    Se concede a owner, admin y cajero (el cajero reimprime tickets del día).
--    El mozo NO lo recibe.
-- ------------------------------------------------------------
update public.roles
   set permissions = permissions || '["ventas.historial"]'::jsonb
 where name in ('owner', 'admin', 'cajero')
   and not (permissions ? 'ventas.historial');

commit;
