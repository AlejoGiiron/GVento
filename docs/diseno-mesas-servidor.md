# Mesas en el servidor — R0 y diseño (para revisión, 2026-10-08)

> Rama `feat/mesas-servidor`, desde `feat/a-permisos` (`5b9a226`). **Solo diseño y pre-flight:
> no hay SQL de migración ni frontend todavía.** Se construye después de la revisión.
> El esquema de "Pasos 9 en adelante" de `docs/plan-despliegue-m1.md` es el anterior a este
> diseño: se reemplaza por la sección 7 de acá cuando lo apruebes.

## R0

| | |
|---|---|
| **Clase** | Varias, y conviene nombrarlas por separado. (1) **Escritura en N pasos desde el cliente** → una función en una transacción (H2: el cobro de mesa son 5 escrituras sueltas). (2) **Fail-open por política**: `order_items` DELETE y `orders` UPDATE solo piden "de la sede" (H3 y el fiado en mesa). (3) **Contrato de N lados**: el tipo de movimiento de stock vive en el CHECK de la base, en `StockMovementType` (`supabase-helpers.ts`) y en las etiquetas de `InventoryPage`. (4) **Idempotencia** (clave por operación, como `p_sale_id` y `p_lote`). |
| **Precedente** | `register_pos_sale` (paso 2: idempotente por id, turno → orden, B1 que valida y no corrige); `cobro-turno.sql` (protocolo de locks); `register_sale_void` (camino inverso de stock); la fase 2 de D (cerrar la escritura directa DESPUÉS de que el frontend nuevo esté en todos los equipos); DEUDAS → *"Fiado en MESA"*, *"Una mesa que tuvo ventas NO se puede borrar"*, *"Mesas: H2 y H3"*. |
| **Modo de fallo** | Cobro: plata que entra y una mesa que queda abierta, o total 0 con plata adentro (H2, medido: #2401). Stock: una cerveza servida que se quita y vuelve al inventario, sin rastro (H3). Las dos son **silenciosas**: por eso todo va en el servidor y fail-closed, y cada baja queda registrada. |
| **Objetivo** | Por id (orden, ítem, mesa), nunca por nombre. Los permisos con `has_permission`, lista cerrada. Los datos viejos se toman como **ya enviados** (fail-closed: quitarlos exige `pos.anular`). |

🔴 **Lo que este paquete NO hace** (CLAUDE.md → *"Mesas abiertas de larga duración = FLUJO
INTENCIONAL"*): no agrega alertas ni reportes de antigüedad de mesas, ni fuerza cierres. La
consulta 1 del pre-flight lista las mesas abiertas **solo** para saber qué datos toca la migración.

## 1. `close_table_sale` — el cobro de mesa en una transacción (cierra H2)

```
close_table_sale(p_order_id uuid, p_close_id uuid, p_total_esperado numeric,
                 p_payments jsonb default '[]', p_descuento jsonb default null,
                 p_fiado jsonb default null) returns jsonb
```
- `p_descuento`: `{ "amount": n, "kind": "normal"|"vale", "reason": "…" }` (monto fijo, como hoy).
- `p_fiado`: `{ "customer_id": uuid, "customer_name": "…" }`. Con fiado, `p_payments` vacío.

**Orden de los pasos** (calcado de `register_pos_sale`):
0. **Idempotencia, antes que todo:** si ya hay una orden con `close_id = p_close_id` → devuelve
   esa venta con `ya_existia = true` y su **método real** (`_venta_pos_respuesta`, la misma de
   `pos-sale-metodo-real.sql`). Si la orden ya está cerrada con OTRO `close_id` (la cobró otro
   equipo) → también devuelve la existente con `ya_existia`: la pantalla dice "ya quedó
   registrada como …" y no cobra dos veces.
1. **Permisos:** `mesas.cobrar` (lo de A); descuento > 0 → `pos.descuento`; fiado →
   `fiado.gestionar` **en el servidor** (cierra el hueco de DEUDAS → *"Fiado en MESA"*).
2. **Protocolo de locks** (`close-cash-shift.sql`): turno **FOR SHARE** (obligatorio, también
   para fiado y cortesía) → orden **FOR UPDATE** → mesa **FOR UPDATE**.
3. **Validaciones:** `dine_in`, de la sede, viva (`pending|preparing|ready`), sin pagos, con al
   menos un ítem (sin ítems → `cerrar_mesa_sin_consumo`). **B1:** total de las líneas (ítems +
   extras) − descuento = `p_total_esperado`; si no, rechaza y dice qué no coincide (valida, no
   corrige: R6).
4. **Escrituras, todas en la transacción:** descuento y total; fiado (`payment_status
   'pending'`, cliente) **o** pagos (por `register_sale_payment`, que ya valida Σ = total y el
   permiso por tipo); `cobrada_por = auth.uid()`, `cobrada_at = now()` (**quién cobró**: lo
   pone el servidor, no el cliente); número (`next_order_number`, al final, sin huecos);
   `status 'delivered'`; mesa `'free'`; `close_id`.
5. **Devuelve** `_venta_pos_respuesta(orden, false)`: número, total, métodos reales, fiado, cliente.

**Columnas nuevas en `orders`:** `close_id uuid unique` (nullable), `cobrada_por uuid →
profiles`, `cobrada_at timestamptz`. (El POS ya registra quién vende en `created_by`; en una
mesa, `created_by` es quien la ABRIÓ, por eso hace falta `cobrada_por`.)

**Pruebas:** los 4 modos de reenvío del proxy (`rst`, `fin`, `colgada`, `nueva`) → una sola
venta; concurrencia contra `close_cash_shift` (como `cobro-concurrente.spec.ts`, con
`sesionRetenida`); dos equipos cobrando la misma mesa; mutantes.

## 2. "Enviado" = la tanda quedó confirmada, pase o no por cocina

Hoy una tanda se guarda en la base con **"Agregar a la mesa"** (`add_order_items_with_extras`
con `p_lote`): ahí ya descuenta stock. `sent_to_kitchen` solo se marca en los productos que van
a cocina, con el botón "Cocina (n)". **La decisión que necesito: cuál es el momento de "confirmar
la tanda".**

| | (A) Confirmar = "Agregar a la mesa" | (B) Confirmar = un botón **"Enviar"** aparte |
|---|---|---|
| Qué marca "enviado" | nada nuevo: todo ítem en la base ya está enviado | `order_items.enviado_at` + `enviado_por`; "Enviar" marca TODO lo pendiente (vaya o no a cocina) y manda a cocina lo de cocina (reemplaza "Cocina (n)") |
| "Quitar antes de enviarse" | solo en el carrito del selector, antes de "Agregar" (sin servidor, sin stock) | ítems guardados y sin enviar: `mesas.gestionar` y devuelve stock |
| El hueco de la cerveza servida | cerrado por definición | hay que cerrarlo: **auto-envío** al pedir la cuenta y al cobrar; si el mozo no pulsa "Enviar", la cerveza sigue quitable con devolución |
| Costo para el mozo | un error al agregar se corrige con un cajero (`pos.anular` + motivo) | puede corregir solo mientras no envíe |
| Esquema | sin columna nueva | columna + backfill |

**Recomiendo (A)** por ser la lectura literal de tu definición y porque cierra H3 sin depender de
que alguien pulse un botón. Si eliges (B), las órdenes viejas: **todo ítem existente queda
enviado** (`enviado_at = created_at`), también los de las mesas abiertas largas (cuenta corriente
interna): quitar cualquiera de ellos exige `pos.anular` (fail-closed). Solo lo agregado después
del despliegue nace pendiente.

`sent_to_kitchen` se queda como está en los dos casos: es el ruteo a cocina (KDS), no "enviado".

## 3. Quitar un ítem (cierra H3, en este mismo cambio)

```
quitar_item_mesa(p_item_id uuid, p_baja_id uuid, p_motivo text default null,
                 p_preparado boolean default true) returns jsonb
```
- **Idempotente** por `p_baja_id`: si la baja ya existe, la devuelve.
- **Locks:** la orden **FOR UPDATE** (no toca plata ni turno: una orden viva no tiene pagos, así
  que no entra en el protocolo del turno). Ítem de una orden `dine_in` viva de la sede, sin pagos.
- **No enviado** (solo existe en la opción B): `mesas.gestionar`; devuelve stock (`return`, +).
- **Enviado:** `pos.anular`; **motivo obligatorio** (no vacío); `p_preparado` (por defecto **Sí**):
  - **Sí** → **merma, sin devolver stock**: por cada producto afectado, un `return` (+q) y una
    `merma` (−q). El stock no cambia (ya se había descontado al agregar) pero el movimiento
    deja de contar como venta y queda como merma.
  - **No** → devuelve stock (`return`, +q), por el **camino inverso de la anulación**.
- **Siempre:** una fila en `order_item_bajas` (abajo), se borra la línea con sus extras y se
  **recalcula el total desde las líneas** (como `add_order_items_with_extras`).
- **Un solo camino inverso (R3):** la devolución de stock de `register_sale_void` (producto
  simple, componentes de la receta y productos vinculados a los extras) se saca a una función
  `_stock_inverso_item(p_item, p_tipo, p_nota, p_actor)` que usan las dos. `register_sale_void`
  se redefine en un archivo NUEVO (R5) con precondición de md5, y la cubren los efectos de stock
  de `anular-venta.spec.ts` (simple, compuesto por receta, extra vinculado, sin tracking, fiado).
- **Caso borde ya anotado en el código** (`handleRemoveItem`): si la receta cambió entre que se
  agregó y se quita, se devuelve según la receta ACTUAL (como hace hoy la anulación). Se anota.

**`order_item_bajas`** (nueva; RLS de lectura por sede, sin escritura directa: solo la función):
`id` (= `p_baja_id`), `restaurant_id`, `order_id`, `table_id`, `product_id`, `producto`
(nombre, copia), `qty`, `unit_price`, `extras` (jsonb, copia), `monto`, `enviado`, `preparado`,
`motivo`, `created_by`, `created_at`.

## 4. Merma

- **Migración del CHECK** (archivo nuevo): `stock_movements_type_check` pasa a
  `('sale','adjustment','return','purchase','merma')`. La consulta 3 del pre-flight confirma
  antes que no hay otros valores. Signo: `merma` es negativa, como `sale` (en la base, `sale` va
  de −1 a −2 y `return` de 1 a 2).
- **Contrato de 3 lados (R1), en la misma pasada:** el CHECK, `StockMovementType` en
  `src/lib/supabase-helpers.ts` y las etiquetas y filtros de `InventoryPage` ("Merma").
- **Dónde se ve:** en **Historial**, una sección propia **"Ítems quitados de mesas"** junto a la
  sección "Anuladas" (que hoy aparece solo con un filtro de método activo), desde `order_item_bajas`: fecha y hora (Bogotá), mesa, producto, cantidad, monto, quién, motivo,
  y "merma" (preparado) o "devuelto al inventario". Y en **Inventario → Movimientos**, con el
  filtro "Merma". (El KPI de merma en Reportes sigue siendo una idea de DEUDAS: no se construye.)

## 5. H2, cerrar mesa sin consumo y archivar mesas

- **H2** lo cierra `close_table_sale`: descuento, pago, número, entregada y mesa libre en una
  transacción, idempotente. Ya no existe el "descuento escrito antes del pago" ni el reintento a
  medias.
- **`cerrar_mesa_sin_consumo(p_order_id)`**: `mesas.gestionar`; orden FOR UPDATE; sin ítems y sin
  pagos; `cancelled` con quién y motivo "Mesa cerrada sin consumo"; mesa FOR UPDATE → `free`.
  Idempotente (ya cancelada → OK). Reemplaza las 2 escrituras sueltas de
  `handleCloseEmptyTable`.
- **Archivar mesas:** `tables.archived_at` + `archived_by`. **`eliminar_mesa(p_table_id)`**: sin
  órdenes vivas; si la mesa tuvo órdenes → se **archiva** (no se puede borrar: DEUDAS); si nunca
  tuvo → se borra. **Permiso a decidir:** hoy borra solo el admin (rol viejo); propongo
  `config.acceder` (dueño y admin), no `mesas.gestionar` (lo tiene el mozo). Las pantallas de
  operación filtran las archivadas (`getTables`, el realtime de `useTables`, abrir mesa); los
  reportes y el historial no (siguen mostrando el nombre de la mesa).

## 6. Pre-flight de solo lectura para producción

`supabase/diag/mesas-preflight.sql` — cada consulta por separado:
1. **Mesas abiertas ahora** (todas las organizaciones): mesa, estado, orden viva, desde cuándo
   (Bogotá), total, descuento, ítems, ítems de cocina sin enviar, ítems que no van a cocina,
   pagos. Sirve para el backfill de (B) y para detectar inconsistencias (en Docker encontró una
   mesa `occupied` sin orden viva).
2. **Órdenes de mesa sin pagos, últimos 60 días**: resumen por organización, estado, estado de
   pago y total 0 / > 0; y la **2b**, el detalle de las cerradas de contado con total > 0 y sin
   pagos (el hueco de H2).
3. **`stock_movements.type`**: valores, cantidades, mínimos y máximos de `qty`, y el CHECK vigente.

Corrida en Docker tal como está escrita (2026-10-08).

## 7. Compatibilidad, orden de release y estimación

Todo SQL es **aditivo y compatible** con el frontend en producción (el de A): las funciones
nuevas no las llama nadie hasta el frontend nuevo; las columnas nuevas son nullable; el CHECK
solo agrega un valor. La escritura directa vieja (DELETE de `order_items`, UPDATE de las columnas
de cobro de `orders`) se cierra **después**, cuando ningún equipo use el frontend viejo (como la
fase 2 de D, mirando `app_versiones`).

| paso | qué | depende de |
|---|---|---|
| 9 | **SQL de Mesas:** CHECK con `merma`; columnas de `orders` y `tables`; `order_item_bajas`; `_stock_inverso_item` (+ `register_sale_void` redefinida); `close_table_sale`, `quitar_item_mesa`, `cerrar_mesa_sin_consumo`, `eliminar_mesa`. Con su pre-flight, su consulta de antes y después, y su reversa. | Paso 8 estable (`close_table_sale` exige `mesas.cobrar`, que llega a los roles en el Paso 7) |
| 10 | **Frontend de Mesas:** cobrar con `close_table_sale`; quitar ítem (motivo y "¿Se alcanzó a preparar?"); cerrar sin consumo; archivar; la sección "Ítems quitados de mesas" en Historial; "Merma" en Inventario. (Con (B): el botón "Enviar".) | 9 |
| 11 | **Fase 2:** sin DELETE directo en `order_items`; las columnas de cobro de `orders` fuera del UPDATE directo (allowlist de columnas); borrado de mesas solo por la función. | 10 en todos los equipos (`app_versiones`) |

**Estimación: 3 sesiones, con margen para una cuarta.**
- **Sesión 1:** el SQL del 9 completo, probado en Docker: funciones, idempotencia con los 4 modos
  del proxy, concurrencia contra el cierre de turno, `register_sale_void` sin regresión, mutantes.
- **Sesión 2:** el frontend del 10, con sus E2E en escritorio (la pantalla y el servidor dicen
  lo mismo, como en A) y mutantes.
- **Sesión 3:** el SQL del 11, el plan (Pasos 9–11 con md5 y consultas) y lo que salga de la
  revisión. La cuarta, si (B) se elige o si la refactorización de `register_sale_void` trae algo.

## 8. Para decidir en la revisión

1. **"Enviado": (A) o (B).** Recomiendo (A).
2. **Permiso para archivar o eliminar mesas:** `config.acceder` (recomendado) o `mesas.gestionar`.
3. **Cobro por otro equipo** (la mesa ya cerrada con otro `close_id`): devolver la venta
   existente con `ya_existia` (recomendado) o rechazar con "la mesa ya se cobró".
4. **Refactorizar `register_sale_void`** para que use `_stock_inverso_item` en el mismo paso 9
   (recomendado, R3) o dejarla como está y duplicar la lógica en `quitar_item_mesa`.
