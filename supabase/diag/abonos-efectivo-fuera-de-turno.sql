-- supabase/diag/abonos-efectivo-fuera-de-turno.sql
-- ============================================================================
-- DIAGNÓSTICO de SOLO LECTURA. Pregunta: ¿los clientes reciben abonos de fiado
-- EN EFECTIVO con la caja SIN turno abierto?
--
-- Por qué importa: register_debt_payment / register_debt_payments_batch crean
-- el ingreso de caja ('in', cash_movements) SOLO si hay turno abierto. Sin
-- turno, el abono se registra igual en debt_payments pero la plata NO entra a
-- ningún arqueo: el efectivo existe físicamente y el sistema no lo cuenta. Con
-- este número se decide si el cambio (1) también exige turno para abonos.
--
-- Dos formas de medirlo, independientes (si difieren, eso ya es un hallazgo):
--   · fuera_de_ventana: el abono no cae dentro de NINGÚN turno de su sede
--     (misma definición que cobros-fuera-de-turno.sql).
--   · sin_movimiento:   el abono en efectivo no tiene cash_movement_id, o sea que
--     la función no creó el ingreso de caja.
--
-- QUÉ ESCRIBE: nada. RE-EJECUTAR: inofensivo. Arranca de organizations (caso
-- #12) y los días van en America/Bogota (R7).
-- ============================================================================

with abonos as (
  select dp.id, dp.amount, dp.created_at, dp.cash_movement_id, r.organization_id,
         exists (
           select 1 from public.cash_shifts s
            where s.restaurant_id = dp.restaurant_id
              and s.opened_at <= dp.created_at
              and (s.closed_at is null or dp.created_at <= s.closed_at)
         ) as en_turno
    from public.debt_payments dp
    join public.restaurants r on r.id = dp.restaurant_id
   where dp.payment_method = 'cash'
     and dp.created_at >= now() - interval '60 days'
)
select org.name                                                          as organizacion,
       count(a.id)                                                       as abonos_efectivo_60d,
       count(a.id) filter (where not a.en_turno)                         as fuera_de_ventana,
       count(a.id) filter (where a.cash_movement_id is null)             as sin_movimiento,
       coalesce(sum(a.amount) filter (where a.cash_movement_id is null), 0) as monto_sin_movimiento,
       count(distinct (a.created_at at time zone 'America/Bogota')::date)
             filter (where a.cash_movement_id is null)                  as dias_con_abono_sin_caja,
       max(a.created_at at time zone 'America/Bogota')
             filter (where a.cash_movement_id is null)                  as ultimo_sin_caja_bogota
  from public.organizations org
  left join abonos a on a.organization_id = org.id
 group by org.id, org.name, org.created_at
 order by org.created_at;

-- CÓMO LEERLO:
--   · Tienen que salir TODAS las organizaciones (si falta una, la query está mal).
--   · G-10 / Salchimelo / Café Aroma con sin_movimiento = 0 ⇒ nadie recibe
--     abonos en efectivo sin turno: exigir turno para abonos no cambia nada.
--   · sin_movimiento > 0 ⇒ hay efectivo de abonos que NINGÚN arqueo contó.
--     monto_sin_movimiento es cuánto; dias_con_abono_sin_caja distingue un
--     olvido de un hábito. Exigir turno les cambiaría la operación: se habla
--     con el cliente antes.
--   · fuera_de_ventana ≠ sin_movimiento ⇒ un abono tiene ingreso de caja pero
--     cae fuera de la ventana (o al revés): es la carrera abono/cierre que
--     arregla D. Anotarlo.
--   · LAB puede dar > 0 (specs): no decide nada.
