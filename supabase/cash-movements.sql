-- cash_movements: movimientos manuales de caja ligados a un turno
-- Ejecutar en: Supabase Dashboard > SQL Editor

-- Tipo enumerado para la dirección del movimiento
create type if not exists public.movement_type as enum ('in', 'out');

create table if not exists public.cash_movements (
  id            uuid         primary key default gen_random_uuid(),
  shift_id      uuid         not null references public.cash_shifts(id) on delete cascade,
  restaurant_id uuid         not null references public.restaurants(id),
  type          public.movement_type not null,
  amount        integer      not null check (amount > 0),
  reason        text         not null,
  created_by    uuid         not null references public.profiles(id),
  created_at    timestamptz  not null default now()
);

comment on table public.cash_movements is
  'Movimientos manuales de caja (ingresos y egresos) ligados a un turno.';

alter table public.cash_movements enable row level security;

create policy "cash_movements: acceso por restaurante"
  on public.cash_movements
  for all
  using (
    restaurant_id in (
      select restaurant_id from public.profiles where id = auth.uid()
    )
  )
  with check (
    restaurant_id in (
      select restaurant_id from public.profiles where id = auth.uid()
    )
  );
