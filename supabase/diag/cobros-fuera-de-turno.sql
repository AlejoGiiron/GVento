-- supabase/diag/cobros-fuera-de-turno.sql
-- ============================================================================
-- DIAGNÓSTICO de SOLO LECTURA (no es migración). Pregunta: ¿los clientes cobran
-- con la caja SIN turno abierto?
--
-- Por qué importa: el cambio (1) de register_sale_payment va a EXIGIR turno
-- abierto. Si G-10 o Salchimelo hoy venden sin turno, ese cambio les rompe la
-- operación el día del deploy ⇒ va con aviso y no directo.
--
-- Definición de "dentro de un turno": existe un cash_shift de la MISMA sede con
--   opened_at <= p.created_at  y  (closed_at is null  o  p.created_at <= closed_at).
-- Es la misma ventana con la que la app asigna pagos al turno (getShiftPayments:
-- `created_at >= opened_at`, sede), con la cota superior del cierre.
--
-- QUÉ ESCRIBE: nada (solo select). RE-EJECUTAR: inofensivo.
-- ALCANCE: todas las organizaciones, arrancando de `organizations` (caso #12).
-- Días en America/Bogota (R7), no en UTC.
-- ============================================================================

with pagos as (
  select p.id, p.amount, p.created_at, p.restaurant_id, r.organization_id,
         exists (
           select 1 from public.cash_shifts s
            where s.restaurant_id = p.restaurant_id
              and s.opened_at <= p.created_at
              and (s.closed_at is null or p.created_at <= s.closed_at)
         ) as en_turno
    from public.payments p
    join public.restaurants r on r.id = p.restaurant_id
   where p.created_at >= now() - interval '60 days'
)
select org.name                                                     as organizacion,
       count(pg.id)                                                 as pagos_60d,
       count(pg.id) filter (where not pg.en_turno)                  as pagos_fuera_de_turno,
       coalesce(sum(pg.amount) filter (where not pg.en_turno), 0)   as monto_fuera_de_turno,
       count(distinct (pg.created_at at time zone 'America/Bogota')::date)
             filter (where not pg.en_turno)                         as dias_con_cobro_sin_turno,
       max(pg.created_at at time zone 'America/Bogota')
             filter (where not pg.en_turno)                         as ultimo_cobro_sin_turno_bogota
  from public.organizations org
  left join pagos pg on pg.organization_id = org.id
 group by org.id, org.name, org.created_at
 order by org.created_at;

-- CÓMO LEERLO:
--   · Tienen que salir las CINCO organizaciones. Si falta una, la query está mal.
--   · G-10 / Salchimelo / Café Aroma con pagos_fuera_de_turno = 0
--       ⇒ exigir turno no les cambia nada: el cambio (1) puede ir directo.
--   · Alguna con pagos_fuera_de_turno > 0
--       ⇒ HOY venden sin turno, al menos a veces. Exigirlo les bloquea el cobro:
--         se habla con el cliente ANTES (CLAUDE.md: los flujos del cliente se
--         hablan primero). Mirar dias_con_cobro_sin_turno: 1-2 días sueltos es
--         un olvido; muchos días es un hábito.
--   · LAB con pagos_fuera_de_turno > 0 es esperable (specs como anular-venta
--     crean ventas por API) y no decide nada.
--
-- Detalle por día para UNA organización (reemplazar el UUID; solo lectura):
-- select (p.created_at at time zone 'America/Bogota')::date as dia_bogota,
--        count(*) as pagos, sum(p.amount) as monto
--   from public.payments p
--   join public.restaurants r on r.id = p.restaurant_id
--  where r.organization_id = '<uuid de la organización>'
--    and p.created_at >= now() - interval '60 days'
--    and not exists (
--      select 1 from public.cash_shifts s
--       where s.restaurant_id = p.restaurant_id
--         and s.opened_at <= p.created_at
--         and (s.closed_at is null or p.created_at <= s.closed_at))
--  group by 1 order by 1;
