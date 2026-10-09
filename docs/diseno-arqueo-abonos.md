# Arqueo: el esperado de cada método incluye los abonos de fiado (2026-10-09)

Paso propio. Rama `feat/arqueo-abonos` (sale de `b9f5797`). SQL: `supabase/arqueo-abonos.sql`.

## Por qué

`close_cash_shift` calculaba el esperado de tarjeta, transferencia y Nequi **solo con las ventas**
(`payments`). Un abono de fiado por esos métodos va a `debt_payments`: el cajero lo cuenta y lo
declara, y salía como **sobrante**. Resultado en producción que reportaste el 2026-10-09 (G-10, las 6 noches con más
diferencia, consulta por método): el 3/10 (+251.900 con 222.500 en abonos Nequi) y el 23/9 (+307.500 con
287.500) quedan casi explicados por abonos. El 18/9, el 4/9, el 19/9 y el 26/9 no tienen abonos:
eso es otra cosa (ventas sin registrar o un declarado de otra fuente) y este paso no lo toca.

El **efectivo** ya estaba bien en el diseño: un abono en efectivo crea su ingreso de caja
(`cash_movements`, que entra al esperado). Si en los turnos viejos falta algún ingreso, lo dice la
consulta de solo lectura de abonos en efectivo contra `cash_movements` (entregada el 2026-10-09).

## Lo que cambia

1. **`debt_payments.shift_id`**: el turno al que entra cada abono. Lo pone la función del abono con
   el turno **bloqueado**. Null = no había turno abierto. Los abonos de antes quedan en null: **los
   cierres históricos no se recalculan** (son una foto congelada; tampoco se reescriben).
2. **`register_debt_payment` y `register_debt_payments_batch`** toman el turno abierto `FOR SHARE`
   con **cualquier** método (antes, solo con efectivo) y guardan `shift_id`. Solo el efectivo sigue
   **exigiendo** turno.
3. **`close_cash_shift`**: esperado de tarjeta / transferencia / Nequi = ventas + abonos con
   `shift_id` = el turno. El snapshot agrega `abonos` por método. El efectivo no cambia.
4. **Pantalla de cierre** (`CloseShiftModal` + `esperadoMetodo` en `src/lib/shiftCalc.ts`): el mismo
   cálculo, y debajo del método "incluye abonos $X".

### Por qué un `shift_id` y no una ventana por hora

Con el protocolo de locks (D), un abono que llega durante un cierre **espera** el `FOR SHARE` y,
cuando el cierre termina, ya no hay turno abierto. Pero su `created_at` es la hora de inicio de su
transacción, que puede ser **anterior** al cierre. Con una ventana por hora, el recálculo lo contaría
en ese turno y el congelado no: el invariante se rompería. Con `shift_id`, el turno de cada abono lo
decide quien tiene el lock, y el congelado y el recalculado coinciden (lo prueba *"ABONO por Nequi vs
CIERRE"*).

## R1 — los lados que tienen que coincidir

| lado | dónde |
|---|---|
| el cierre que se congela | `close_cash_shift` en `supabase/arqueo-abonos.sql` |
| la pantalla de cierre | `esperadoMetodo` (`src/lib/shiftCalc.ts`) + `CloseShiftModal` + la consulta `shift_abonos` de `useCashShift` |
| el invariante de las pruebas | `invarianteMetodos` en `tests/helpers/db-local.ts` |
| el precheck de la fase 2 | `fase2-precheck.sql` (raíz): reconoce un cierre del servidor por los **2 decimales** de `expected_total`, `declared_total` y el efectivo. El cierre nuevo sigue en `numeric(12,2)`: lo vigila *"abono por Nequi con turno"* y el mutante A6. |

## Pruebas

`tests/arqueo-abonos.spec.ts` (6 casos): Nequi con turno entra al esperado; sin turno no entra a
ninguno; el efectivo entra una sola vez; el lote por transferencia; abono contra cierre (espera y
queda fuera; congelado = recalculado); la pantalla muestra lo mismo que congela el servidor.
`tests/arqueo.spec.ts` actualizado (el snapshot trae `abonos: 0`). Mutantes: 6 en el SQL y 2 en la
pantalla, todos muertos.
