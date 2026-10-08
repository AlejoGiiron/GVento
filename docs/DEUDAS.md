# G-Vento — DEUDAS e IDEAS

Dos cosas distintas que conviene no confundir:

- **Ideas de producto** — evaluadas y **conscientemente pospuestas**. NO son backlog, no
  están aprobadas y **no se empiezan a construir por encontrarlas escritas acá**.
- **Deudas vigentes** — cosas que YA rompen algo o que van a costar caro, con su punto de
  partida para retomarlas.

Se consulta **al planificar**, no antes de cada cambio.

---

## Entrada pendiente para la FASE C — skill `demo-en-vivo` (anotado 2026-08-26)

**NO es una idea de producto ni una deuda de código: es material que ya tenemos y que hay
que convertir en skill cuando se haga la Fase C.** Se anota acá porque la próxima demo se
va a armar dentro de meses y sin acordarse de nada de esto.

**Por qué skill propia y no dentro de `spec-e2e`:** `spec-e2e` dispara al escribir o
diagnosticar Playwright, y armar un seed de demo es trabajo de SQL. Cargarla ahí es
repetir el modo de fallo de los 5 slash commands: existen, son correctos, y no corren
porque nadie los invoca. Una demo además es **infrecuente y de alto riesgo** — el perfil
donde peor funciona la memoria y mejor funciona un disparo automático.

**La distinción que la funda:** un fixture de test necesita ser CORRECTO. Un escenario de
demo necesita ser correcto **y CREÍBLE**. El segundo eje no lo verifica ningún `select`.

Las tres reglas, todas medidas el 2026-08-26 armando Café Aroma:

1. **NADA CONSTANTE.** Un valor repetido delata los datos justo donde vas a señalar.
   Casos: la merma quedó en `−3` en las 50 filas de Ajustes (se cambió a variable por día
   y por producto, escalada a la producción); y el Top Productos salía plano con selección
   uniforme (se arregló con una bolsa ponderada por popularidad). Corolario: el patrón
   tiene que ser el del negocio — pico de mañana en una cafetería, no de noche como el bar.

2. **VERIFICAR LA PANTALLA, NO EL DATO.** "El dato existe" y "la pantalla lo muestra de
   forma usable" son cosas distintas. Los dos hallazgos salieron de abrir el componente y
   **ninguno era visible en el SQL**: `InventoryPage` → Movimientos NO filtra por producto
   y pagina de a 25 (el guión pedía mostrar una secuencia que la UI no permite aislar), y
   `AppLayout` → `NAV_GROUPS` deja Ventas y Mesas SIN permiso, o sea inocultables por
   cualquier combinación de roles.

3. **NO PROMETAS LO QUE LA APP NO CALCULA.** La merma se registra pero no se totaliza en
   ningún lado (ni Inventario ni Reportes → Stock). Preguntar "¿cuánto estás botando?" y
   mostrar solo una lista es abrir una puerta que no se puede cruzar.

Sumar también el **checklist de 10 minutos antes** (impresión, turno abierto de otra
corrida, banner de suscripción, residuo del lab, resolución real de la máquina) y el
**guión de 13 minutos**, ambos ya redactados y probados en esta sesión.

La evidencia larga va a la BITÁCORA; la skill se queda en forma corta y accionable, igual
que las 10 reglas de clase.

## Ideas de producto — NO son pendientes, NO construir

Esta sección NO es backlog. Nada de acá está aprobado ni pedido: son ideas
evaluadas y **conscientemente pospuestas**. No aparecen en "Deudas vigentes" a
propósito — una deuda es algo que YA rompe algo; esto no rompe nada hoy.
No empezar a construirlo por encontrarlo escrito acá.

### KPI de merma/descarte en Reportes → Stock (anotado 2026-08-25)

**Origen: preparando la demo de Café Aroma.** No salió de un pedido de cliente
ni de una idea de escritorio: salió de guionar la pantalla de Inventario y
chocarse con el hueco. Se anota con el origen porque eso es lo que le da peso
si algún día se retoma.

**El hueco, medido:** `InventoryPage` → Movimientos **registra** los ajustes
(tipo `adjustment`, con su motivo en `notes`) pero **no los totaliza en ningún
lado**. Ni ahí ni en el tab Stock de Reportes, que hoy tiene KPIs de unidades,
productos y categorías, top de productos y ranking por categoría — nada de
descarte. Filtrar por tipo "Ajustes" da la LISTA; el número no existe.

**Por qué importa en una cafetería** (y no en un bar, que es para quien se
diseñó el seed original): un negocio con panadería **hornea a demanda y descarta
lo que sobra todos los días**. "¿Cuánto estoy botando?" es una pregunta que el
dueño ya se hace, no una que haya que enseñarle.

🔴 **La señal a esperar, y qué significa:** si en la demo el dueño pregunta por
el TOTAL de merma, eso es demanda real observada, no una hipótesis. Ahí sí vale
construirlo. Hasta entonces, no.

**Por qué es chico:** el dato ya está en `stock_movements` (`type='adjustment'`,
con signo y con `notes`), acotado por sede y por rango de fechas igual que el
resto del tab. No hace falta migración ni columna nueva: es una agregación más
sobre una tabla que ya se consulta en esa pantalla.

⚠️ **Al construirlo hay que decidir una cosa que no es obvia:** un `adjustment`
NO es siempre una merma — la misma columna recibe los ajustes manuales de
inventario, que pueden ser POSITIVOS (un conteo que salió de más). Sumar todos
los `adjustment` y llamarlo "descarte" sería un número equivocado con nombre de
número correcto. O se suman solo los negativos, o se separa merma de ajuste con
un tipo propio.

**Mientras tanto, en la demo:** el framing es *"queda registrado, producto por
producto y día por día"*, NUNCA *"te digo cuánto"*. Prometer en vivo un número
que la app no calcula es peor que no prometerlo.

### Pedidos entre negocios (decidido 2026-08-07: NO se construye ahora)

**Caso:** un cliente en G-10 (coctelería, sin cocina) quiere comer; G-10 le pide
la comida a Salchimelo. **Hoy se resuelve por WhatsApp y funciona.**

**Por qué NO ahora** — el dolor hoy es CERO y la ambición es alta. Construir sin
dolor real significa diseñar contra un caso hipotético. Y es la funcionalidad
más riesgosa considerada hasta ahora: rompe el aislamiento entre organizaciones,
acopla dos clientes entre sí, y **no hay forma de cobrarla todavía**.

**Por qué es interesante a futuro:** es un efecto de red — cada cliente nuevo
vale más si puede conectarse con los que ya están. Difícil de copiar.

**Alternativas evaluadas, de menor a mayor acoplamiento:**
- **A. Nada (WhatsApp)** — línea base actual.
- **B. Producto "pedido externo"** en el negocio que pide; los sistemas nunca se
  hablan. Cero riesgo, pero no notifica al otro lado.
- **C. Notificación de una vía por Edge Function** — el pedido aparece en el otro
  negocio. Cruza el mínimo (ítems, nota, origen). SIN relajar RLS: canal
  explícito y auditado, no una política que deje ver otra organización.
  ← **la mejor si se retoma.**
- **D. Catálogo compartido** — más cómodo, más superficie de riesgo.
- **E. El otro negocio como proveedor** (reusando el módulo de compras existente).

🔴 **REGLA SI SE RETOMA: nunca por RLS relajada.** El aislamiento entre
organizaciones es la promesa central del multi-tenant y costó una sesión entera
endurecerlo (ver el bloque de seguridad RBAC). Cualquier cruce va por un canal
explícito, estrecho y auditado.

**Lo único que aplica MIENTRAS TANTO (gratis, sin construir nada):** al tocar
delivery, órdenes o catálogo, no tomar decisiones que hagan IMPOSIBLE un pedido
con origen externo. No construir — solo no bloquear.

## Pendientes de verificar / deuda conocida

### 🔴 Una mesa que tuvo ventas NO se puede borrar — y TablesPage deja intentarlo (confirmado 2026-09-30)

**Precondición de M2** (varios celulares en mesas). No se construye ahora.

**Evidencia** (`supabase/diag/borrar-mesa-simulacion.sql`, corrida por el usuario en el SQL
Editor de prod contra mesas de LAB, con rollback forzado): la mesa CON una orden `delivered`
falló con **23514 `chk_dine_in_has_table`**, con CONTEXT del `UPDATE … SET table_id = NULL`;
la mesa SIN órdenes dio `SIMULACION_OK filas=1`. Rollback verificado: la orden `49a7f922…`
conserva su `updated_at` original.

**Mecanismo:** `orders.table_id` es `ON DELETE SET NULL` y `chk_dine_in_has_table` exige mesa
en toda orden `dine_in`. Una mesa que vendió **una vez** queda imborrable para siempre.
`TablesPage` → `handleDelete` solo bloquea con órdenes `pending/preparing/ready`: deja
intentar el borrado de una mesa libre con historial y el cliente recibe el error crudo de
Postgres en un toast.

**Lo que NO es la salida** (decidido): cambiar la FK a `CASCADE` (borra historial de ventas)
ni relajar el check (deja órdenes de mesa sin mesa).

**Diseño propuesto — ARCHIVAR, no borrar** (va con M2):
- Columna `tables.archived_at timestamptz null` (null = activa). Migración nueva; ningún dato
  existente cambia.
- "Eliminar mesa" pasa a ser una RPC `archive_table(p_table_id)` SECURITY DEFINER con
  `for update` sobre la mesa (con varios celulares, dos pueden abrirla y archivarla a la vez):
  exige mesa `free` y sin órdenes activas; si la mesa **nunca** tuvo órdenes la borra de
  verdad, si tuvo la archiva, y **devuelve cuál de las dos hizo**.
- Toda lectura de mesas **para operar** (mapa, picker, `useTables`) filtra
  `archived_at is null`. Reportes e historial NO: la venta sigue mostrando su mesa.
- Si hay o se agrega unicidad por nombre, tiene que ser parcial (`where archived_at is null`)
  para poder crear "Mesa 3" de nuevo después de archivarla.
- Desarchivar desde Configuración (`archived_at = null`), con las archivadas en lista aparte.
- Antes de construir, barrido R3 por la TABLA (`from('tables')` en `src/`): cada lectura
  decide si filtra. Una que se olvide muestra mesas archivadas en la operación.

**Para reconfirmar el comportamiento actual** (lectura):
`select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.orders'::regclass and pg_get_constraintdef(oid) ilike '%table_id%';`

### 🔴 "Cerrar mesa sin consumo" son DOS escrituras de cliente no atómicas (anotado 2026-09-30)

**Precondición de M2.** No se arregló en el Paso C.

`TablesPage` → `handleCloseEmptyTable` hace `updateOrderStatus(order.id, 'cancelled')` y
**después** `updateTableStatus(table.id, 'free')`, dos requests separados. Si el segundo no
llega (red de celular, pestaña cerrada), la mesa queda **ocupada con su orden cancelada**.
Medido en LAB de la nube (2026-09-21): **14 mesas `Mesa E2E …` ocupadas cuya única orden está
`cancelled`** — exactamente esa forma. `mesas.spec` solo verificaba que el panel se cerrara.
Con varios celulares, además, dos pueden cerrar o abrir la misma mesa a la vez.

**La salida es una RPC** `close_empty_table(p_table_id)` SECURITY DEFINER que, en una
transacción y con `for update` sobre la mesa, verifique que la orden no tenga ítems, la
cancele y libere la mesa. No "reintentar el segundo request".

### 🔴 `register_sale_payment` acepta cobros SIN turno abierto — medido; el cambio va sin aviso a clientes (2026-09-30)

**✅ DESPLEGADO EL 2026-10-01** (lo reportó el usuario): release `main = 04273f3` a las ~11:45 y,
justo después, `cobro-turno.sql` en prod. La verificación del encabezado dio 3 filas `t t t t f`.
Pruebas en Café Aroma con el frontend nuevo: abono en efectivo sin turno → aviso amarillo y botón
deshabilitado; abono por transferencia sin turno → OK. Con el frontend viejo, antes de que Vercel
terminara, el efectivo sin turno dio el error genérico y no registró nada, como se había medido.
Reversa preparada (fuera de git): `cobro-revertir.sql`. *(Historia del arreglo, abajo.)*
`supabase/cobro-turno.sql` parte del texto de las funciones con el protocolo.
Cobro: turno obligatorio con cualquier método (FOR SHARE, primer lock) + orden FOR UPDATE.
Abonos (decidido 2026-09-30): **el EFECTIVO exige turno**; los otros métodos no. Motivo, medido
en prod con `supabase/diag/abonos-efectivo-fuera-de-turno.sql`: Salchimelo, 2 abonos en efectivo
por $48.000 el 31/08 (00:29 Bogotá) fuera de todo arqueo; G-10 76 abonos y 0 fuera; Café Aroma 0.
El abono simple ahora bloquea la orden (el hallazgo lateral de D). La UI de abono avisa ANTES de
confirmar y ofrece abrir el turno ahí (`AvisoEfectivoRequiereTurno`).
`tests/cobro-concurrente.spec.ts` (10) y `tests/abono-efectivo-turno.spec.ts` (3). El doble cobro
ahora se fuerza con una sesión retenida (`tests/helpers/db-local.ts`), ya no por azar de red:
el mutante sin `for update` da 2 pagos. Mutantes: v1 de cada RPC, sin-lock de cobro y de abono,
hook de la UI en identidad y `mensajeDeError` viejo → cada uno rojo en su test, por su razón.

**Lo que vio una pestaña vieja (medido en Docker con los modales anteriores):** abono en efectivo
sin turno → toast **"Error al registrar el abono"** (en lote: "Error al registrar el pago"), el
modal queda abierto, no se registra nada. Genérico porque el `onError` hacía
`err instanceof Error ? … : 'genérico'` y `PostgrestError` no es `instanceof Error`: la misma
clase estaba en 22 lugares de `src/` (Mesas mostraba "Error desconocido" al cobrar). Barrida con
`src/lib/errorMessage.ts`. Con el código nuevo se ve el mensaje del servidor.

**Antes (el registro del hallazgo):**

- **El defecto** (`tests/cobro-concurrente.spec.ts`, rama `diag/verificaciones-pre-m1`): con
  la sede sin turno la RPC acepta el cobro (20/20) y el pago no cae en ninguna ventana de
  turno, o sea en ningún arqueo.
- **¿Rompe a alguien exigir turno?** `supabase/diag/cobros-fuera-de-turno.sql` en prod dio
  **0 pagos fuera de turno en G-10, Salchimelo y Café Aroma** (60 días). La query se validó
  contra un **positivo conocido** en Docker (R10): un cobro real con la caja cerrada la llevó
  de 0 a 1 en LAB (monto y hora de Bogotá correctos) y volvió a 0 al limpiarlo.
  ⇒ el cambio (1) —lock de la orden + exigir turno— **sale sin aviso a clientes**.
- **Doble cobro:** el mecanismo es real (check-then-act sin lock bajo READ COMMITTED) pero
  dio 0/160 duplicados por red. Lo cierra el `for update` del mismo cambio; el spec NO lo
  caza y está marcado así.

### 🔴 Tablas que solo deberían escribirse por RPC y aceptan escritura DIRECTA — inventario (medido 2026-10-01)

**Decidido (2026-10-01):** el endurecimiento va **después de M1**, como cambio propio. Todavía no
está construido. **Excepción, ya hecha:** el DELETE (y el UPDATE desde un turno cerrado) de
`cash_movements` entró en la **fase 1 de D** (commit `3339978`).
**El inventario encontró el handler del 3.5 del plan:** `handleRemoveItem` en `TablesPage` borra
la línea de mesa con `removeOrderItem` (DELETE directo) **sin devolver el stock** que
`add_order_items_with_extras` descontó al agregarla. Es la misma deuda que el TODO de ese handler,
y la salida es la de la fila de `order_items`: una RPC que devuelva el stock.

**Una pestaña vieja tiene que seguir funcionando.** Por eso los caminos legítimos se midieron
contra **`origin/main`** (`95bcf61`, lo desplegado), no contra develop. Para re-medir:
`node scripts/escrituras-directas.mjs origin/main`, que busca cada `.from('<tabla>')` seguido de
`.insert/.update/.delete/.upsert`, más un control de que no haya `.from(<variable>)`. Lo
escriben en la base: `pg_proc.prosrc` con `insert into|update|delete from <tabla>`. Todos son
SECURITY DEFINER. Las policies y grants salen de `pg_policies` y
`information_schema.role_table_grants`.

| tabla | escritura legítima (base) | escritura directa que usa el frontend desplegado | policies de escritura hoy | propuesta |
|---|---|---|---|---|
| `payments` | `register_sale_payment` (I), `register_sale_void` (D) | **ninguna** (`createPayment` sin llamadores) | INSERT cajero/admin · DELETE admin | **quitar las 2 y revocar I/U/D.** Medido: el cajero insertó directo un pago en efectivo SIN turno (rollback). |
| `debt_payments` | `register_debt_payment(_batch)` (I) | **ninguna** | INSERT con `fiado.gestionar` | **quitar y revocar.** Es la forma de los $48.000 de Salchimelo. Antes: pasar el fixture de `anular-venta.spec` a la RPC. |
| `order_items` | `add_order_items_with_extras` (I, descuenta stock) | UPDATE `sent_to_kitchen` (Mesas) · DELETE de un ítem (Mesas, **sin devolver stock**: TODO conocido en `handleRemoveItem`) | INSERT · UPDATE · DELETE "staff" | **INSERT: quitar** (`addOrderItems` sin llamadores; hoy se puede dar de alta un ítem sin descontar stock). **UPDATE: solo la columna** (`grant update (sent_to_kitchen)`); hoy se puede cambiar `qty` o `unit_price` de un ítem ya descontado. **DELETE: dos fases**, primero una RPC que devuelva el stock (el TODO) y, cuando ya no haya pestañas viejas, revocar. |
| `order_item_extras` | `add_order_items_with_extras` (I) | **ninguna** | INSERT "staff" | **quitar.** |
| `cash_movements` | abonos (I) | INSERT (movimientos manuales, legítimo) | **ALL** por sede | 🔴 Medido: el cajero borraba un egreso de 5.000 de un turno CERRADO (el trigger era `BEFORE INSERT OR UPDATE`), y un UPDATE podía mover un movimiento fuera de un turno cerrado. **✅ Cerrado en la fase 1 de D** (`3339978`): el trigger cubre DELETE y mira el turno viejo. **Queda para después de M1:** quitar UPDATE y DELETE también en turnos abiertos (la app nunca los usa). |
| `purchase_invoices` / `_items` | `register_purchase` | **ninguna** | INSERT con permiso / ninguna | **quitar el INSERT de `purchase_invoices`** (una factura sin ítems ni stock). |
| `orders` | abonos y anulación (U) | INSERT (POS y Mesas) y 6 UPDATE (estado, total, descuento, número, fiado, domiciliario) | INSERT · UPDATE "staff" · DELETE admin | **no se puede cerrar todavía**: es el camino vivo del POS y de Mesas. **DELETE admin: quitar** (sin uso; cascada a `debt_payments`). El resto se achica con `register_pos_sale` (ver la entrada de abajo) y después con el cobro de mesa. |
| `products` | stock por `add_order_items_with_extras`, `adjust_stock`, `register_purchase`, anulación | `stock_qty` = 0/null al crear o al apagar el seguimiento (modal de producto) | INSERT · UPDATE · DELETE admin | dejar. `updateProductStock` no tiene llamadores, pero el modal escribe `stock_qty` y una restricción por columna lo rompería. |
| `stock_movements`, `store_sequences`, `purchase_invoice_items` | solo RPC | — | **ninguna** ✅ | ya está bien: es el modelo a copiar. |
| `cash_shifts` | `close_cash_shift` (U) | INSERT (abrir turno) | INSERT | UPDATE ya revocado en la fase 2 de D. |
| `restaurants.config` | `update_restaurant_config` (fusiona clave por clave; `restaurant-config-rpc.sql`, rama `feat/m1-pos-movil`, 2026-10-04) | **ninguna** desde ese frontend (`updateRestaurant` ya no acepta `config` por tipo). El frontend anterior escribe el objeto ENTERO y puede pisar claves | UPDATE "admin actualiza" (rol viejo `admin`) y "editar sede con permiso" (`sedes.gestionar`), sobre toda la fila | **después de M1:** restringir el UPDATE directo a las columnas que la app escribe (nombre, dirección, teléfono, logo, `uses_kitchen`) y dejar `config` solo por la RPC. **¿Ya se pisó algo en prod? CERRADO, 2026-10-04: sin señales.** `config-pisado-senales.sql` (raíz) en prod: el único QR de Nequi configurado (G-10) sale "ok" (el archivo y la config coinciden). Resultado reportado: "sin señales". Las claves que no dejan rastro (PIN, estaciones, motivos, métodos) no se pueden medir con esa consulta. Queda abierto solo el endurecimiento (restringir el UPDATE directo), no un daño a reparar. |

`anon` tiene grants I/U/D en todas (deuda aparte, más abajo); lo frena la RLS, no el grant.

### Mesas: H2 y H3 van DESPUÉS de M1, con M2 (decidido 2026-10-04)

Salió de `mesas-total-anomalias.sql` corrido en prod el 2026-10-04 (60 días, mesas cerradas):

| organización | mesas | cuadran | total 0 sin pagos | total 0 con pagos | total < líneas | total > líneas | pagos ≠ total |
|---|---|---|---|---|---|---|---|
| G-10 | 383 | 381 | 4 | 0 | 2 | 0 | 0 |
| Salchimelo | 1756 | 1748 | 48 | 2 | 5 | 1 | 2 |

Los "total 0 sin pagos" son **cortesías y gastos internos, a propósito** (lo confirmó el dueño). No
se tocan. Es la misma familia que *"Mesas abiertas de larga duración = FLUJO INTENCIONAL"* en
CLAUDE.md.

| caso | qué es | estado |
|---|---|---|
| Salchimelo #1878 | 6 tandas (20.000 + 5.000 + 4 × 4.000) y total = pagos = 24.000: el total escrito desde el cliente perdió tandas (**H1**) | lo cierra el paso 2 (`pos-sale-lotes.sql`: total desde las líneas, con la orden bloqueada) |
| Salchimelo #2401 (03/10) | pago 62.000 a las 23:21, delivered 23:33, descuento fijo 62.000, total 0: el cobro reintentado puso un descuento por el total (**H2**). Además, 4 movimientos de stock de COCA COLA para 2 líneas. **Medido en prod el 2026-10-04 con `mesas-2401-stock.sql` (raíz):** las 4 son **dos causas juntas**. (1) **H3:** dos Coca Colas agregadas a las 22:12 y a las 22:13 y después quitadas, **sin devolver el stock**. (2) **Reenvío:** una tanda a las 22:14:09 y su copia a las 22:14:38 (29,5 s), de la que se cobró una sola | **H2** y **H3** → M2. El **reenvío** lo cierra la clave por tanda del paso 2 |
| Salchimelo #1342 | dos tandas idénticas a 27 s, descuento fijo 34.000, sin pagos: cortesía con una **tanda duplicada** (reenvío), no H2 | la duplicación la cierra la clave por tanda del paso 2 |

**Qué va con M2:**
- **H2:** `close_table_sale`, el cobro de mesa en una transacción: descuento, pago, número, delivered y mesa libre. Reemplaza los pasos sueltos de `TablesPage`, donde el descuento se escribe ANTES del pago y un reintento a medias deja total 0 con la plata ya entrada.
- **H3 (el 3.5 del plan):** una RPC para quitar un ítem que devuelva el stock (movimiento `return`) y recalcule el total. `handleRemoveItem` hoy borra la línea directo (ver la fila de `order_items` arriba).

Para ver si siguen apareciendo, se re-corre el bloque 2 de `mesas-total-anomalias.sql`.

### 🔴 POS: si el cobro falla DESPUÉS de crear la orden, queda una orden huérfana con stock descontado (medido 2026-09-30)

`POSPage` crea la orden, agrega ítems (descuenta stock) y **después** llama a
`register_sale_payment`. Si el pago falla, la orden queda. **Medido en Docker:** checkout abierto
con turno, otra terminal cierra el turno y el cajero confirma. Toast: "Error al procesar el
cobro: No hay un turno de caja abierto…". Queda la orden en `pending` / `paid` / sin número /
1 ítem / 0 pagos. La ve Cocina, porque filtra `pending`.
- **No es nueva:** cualquier falla del pago la deja así (por ejemplo, Σ ≠ total). El cambio (1)
  le suma un disparador: cerrar el turno en otra terminal con un checkout abierto. Antes, ese
  mismo cobro se aceptaba fuera de todo arqueo, en silencio.
- Con UNA terminal por sede es raro. Con M1 (varios celulares) deja de serlo.
- **Salida:** que crear la orden y cobrar sea UNA transacción. Va con la extracción de
  `useSaleCheckout`, antes de M1, y no en (1).

**Diseño APROBADO (2026-10-01): `register_pos_sale(p_sale_id, p_order, p_items, p_payments)`.**
- Hace todo en UNA transacción, en este orden: permiso → turno (`for share`) → orden con
  `p_sale_id` (idempotente: `on conflict (id) do nothing`) → ítems por
  `add_order_items_with_extras` → pago por `register_sale_payment` → número por
  `next_order_number`, al final.
- **A:** el turno es obligatorio también para fiado y venta gratis.
- **B1:** el servidor recalcula el total y RECHAZA si no coincide:
  `Σ ítems + Σ extras − discount_amount` (cualquier descuento, no solo el vale). **Antes de
  construirlo:** `supabase/diag/pos-total-formula.sql` en prod, rama `diag/b1-total-pos`. Si
  algo no cuadra, hay una regla de precio que la fórmula no conoce.
- **C, todo lo que escribe hoy la secuencia de cobro** (develop, `handleConfirm` de
  `CheckoutModal`), y todo queda dentro de la RPC:
  - `orders` INSERT: tipo, estado, total, sede, autor, `discount_*` y, si es fiado,
    `payment_status`, `customer_id` y `customer_name`;
  - ítems, extras, stock y `stock_movements` (`add_order_items_with_extras`, con la nota de
    cada ítem);
  - `payments` (`register_sale_payment`);
  - `store_sequences` y `orders.order_number` (`assignOrderNumber`; desaparece
    `retryOrderNumber`).
  - **Afuera, a propósito:** el alta rápida de cliente (`CustomerFormModal`). Es previa a
    confirmar y no mueve plata.
  - **No existen:** el "uso del vale", datos de domicilio o notas de la orden en el checkout.
    Un vale es solo `discount_kind = 'vale'` más el monto en la orden: **no tiene identidad,
    así que nada impide reusarlo.** Ver la entrada de abajo.
- **D, despliegue:** la RPC es nueva, así que el SQL va **ANTES** del frontend que la llama.
  Las RPC actuales no cambian (Mesas las sigue usando) y una pestaña vieja sigue funcionando.

**CONSTRUIDO (2026-10-04, rama `feat/pos-sale-lotes`):** `supabase/pos-sale-lotes.sql` +
`useSaleCheckout` (POS) + `useAgregarTanda` (Mesas, clave por tanda y total desde las líneas,
que elimina H1). Para saber si está en una base, no leas esta nota: correlo:
`select to_regprocedure('public.register_pos_sale(uuid,jsonb,jsonb,jsonb)');` (null = no está).
Lo que hay que saber al operarlo:
- **El id de venta se conserva entre reintentos MIENTRAS el contenido sea el mismo** (ítems,
  descuento, tipo, cliente; el método de pago NO cuenta). Si el primer intento entró en
  efectivo y el cajero reintenta con tarjeta, recibe la venta en efectivo (`ya_existia`) y la
  pantalla lo avisa (`success-ya-existia`). Es a propósito: entre una venta con el método
  equivocado y una venta DUPLICADA, la duplicada es peor (arqueo y stock).
- **En el POS ya no existe "venta cobrada sin número"**: el número va en la misma transacción.
  El aviso y su reintento siguen en Mesas, y `tests/numeracion-fallo.spec.ts` ahora prueba ahí.
- **Reversa:** `pos-sale-lotes-revertir.sql` (raíz, fuera de git), con autoverificación por
  md5 contra el export de prod. **Primero el frontend, después el SQL.**

### 🔴 El navegador ejecuta DOS VECES escrituras que el usuario hizo una vez (reenvío de Chromium) — medido 2026-10-01/04

**El mecanismo (reproducido en Docker, `Chromium ─ proxy TCP ─ Supabase local`):** si una conexión
keep-alive **reutilizada** se corta después de que el servidor procesó un POST, Chromium reenvía
el POST solo, por una conexión nueva, y le entrega al código la respuesta del SEGUNDO envío.

| corte | POST que llegan | qué ve el código | en la base |
|---|---|---|---|
| inmediato, RST o cierre ordenado (FIN) | 2 | **HTTP 204, éxito** | **2 veces** |
| conexión colgada **19 s** y después RST o FIN | 2, **a 19 s** | **HTTP 204, éxito** | **2 veces, a 19 s** |
| en conexión NUEVA (no reutilizada) | 1 | **error** ("Failed to fetch") | **1 vez: guardado** |

Ni postgrest-js (solo reintenta GET, HEAD y OPTIONS) ni nuestro código reenvían: es la capa de
red del navegador, y la app no puede enterarse. Medido sobre HTTP/1.1 (lo que hay en local); prod
va por HTTPS y ahí no se midió el protocolo exacto.

**Evidencia en prod (60 días, hasta 2026-10-04):**
- **#2945 de G-10:** `add_order_items_with_extras` ejecutado dos veces, a **19,5 s**: Σ ítems 48.000
  contra total y pago de 24.000. **No se limpia** (decisión 2026-10-04, ver la entrada siguiente).
- **#2908 de G-10:** `createOrder` reenviado a 533 ms; la gemela 7784e3fa quedó huérfana, sin ítems.
- **Turno 95ecc259 de G-10 (23/09):** egreso manual de 45.000 duplicado a 1,997 s. El arqueo no se
  corrige. **No se agregó la nota** (decisión 2026-10-04, ver la entrada siguiente).
- **994601b1 de G-10 (09/08):** los ítems se guardaron, la app recibió un error y no cobró (el caso
  de "conexión nueva"); rehecha como #1332. **No se limpia** (decisión 2026-10-04, ver la entrada siguiente).
- **Salchimelo, mesa #1193 (23/08):** tanda "SALCHIDOBLEAA PERSONAL" duplicada a 35 ms; Σ ítems
  36.000 contra total y pagos de 12.000. **No se toca (decisión 2026-10-04).** En mesas el total lo
  suma el cliente una vez por tanda, así que se cobró bien; el reenvío infló el reporte de productos
  y, si tiene receta, descontó stock de más.
- Abonos gemelos: **ninguno**.

**Para detectarlo:** `supabase/diag/duplicados-reenvio-detector.sql`. POS: una orden con ítems de
más de un `created_at` (toda venta POS inserta sus ítems en una llamada), a cualquier distancia.
Mesas: la misma tanda repetida con hasta 60 s.

**Prevención, en este orden (decidido 2026-10-04):**
1. **`register_pos_sale`**: cubre el reenvío de `createOrder`, de los ítems y del pago. La segunda
   ejecución con el mismo `p_sale_id` devuelve la venta ya hecha, con éxito. El test cubre los
   cuatro modos de la tabla, más el reintento manual después del error en conexión nueva.
2. **Movimientos de caja manuales**: id generado por el cliente + insert que ignora duplicados.
   Es chico y va con `register_pos_sale`.
3. **Clave por tanda en Mesas** (`add_order_items_with_extras(..., p_lote)`): va con M2.
4. **Abonos**: sin casos en prod; queda acá. Si aparecen, clave por abono.

### ✅ DECIDIDO (2026-10-04): los datos históricos del reenvío y del cobro en dos pasos NO se limpian

**Si un diagnóstico encuentra alguno de estos casos, NO es un hallazgo nuevo:** están medidos,
explicados y la decisión es dejarlos como están. Lo que se arregla es el mecanismo (la entrada
anterior, "Prevención"), no los datos.

**Única excepción admitida:** cancelar huérfanas que se ven en **Cocina** (status `pending`,
`preparing` o `ready`), si molestan al operar. Cancelar no devuelve stock ni toca ítems.

**Los casos (prod, ventana de 60 días medida el 2026-10-01/04):**

| caso | qué es | estado al 2026-10-04 | qué afecta |
|---|---|---|---|
| **15 huérfanas sin ítems** de G-10 (POS) | cobro en dos pasos: la orden se creó, la carga de ítems no se guardó, la app no cobró; todas con reintento exitoso, todas de "valeria sanchez", 10 el 27/09 (8 entre 18:07 y 23:32) | `pending`, sin ítems, pagos, número ni stock | **se ven en Cocina** (candidatas a la excepción); no inflan ventas ni historial |
| **7784e3fa** (una de las 15) | `createOrder` reenviado por el navegador a 533 ms; la gemela es la #2908 | idem | idem |
| **#2945** de G-10 (`c1a79e70…`) | `add_order_items_with_extras` ejecutado dos veces, a 19,5 s; líneas `5656898f…` (original) y `6204a166…` (reenvío) | Σ ítems 48.000; total = pago = 24.000 | infla el reporte de productos en 2 Explosion 12onz / 24.000; ventas no |
| **994601b1** de G-10 (09/08, 43.000) | huérfana CON ítems: se guardaron, la app recibió un error y no cobró; rehecha como #1332 | `pending`, 3 ítems, 2 movimientos de stock, sin pago ni número | **se ve en Cocina** (candidata a la excepción); infla el reporte de productos |
| **turno 95ecc259** de G-10 (23/09 18:56) | egreso manual de 45.000 "cocteles came y sebas se desconto" duplicado a 1,997 s | arqueo cerrado, sin nota | el esperado congelado puede mostrar un sobrante aparente de 45.000 |
| **mesa #1193** de Salchimelo (23/08) | tanda "SALCHIDOBLEAA PERSONAL" duplicada a 35 ms | Σ ítems 36.000; total = pagos = 12.000 | se cobró bien; infla el reporte de productos y, si tiene receta, el stock |

Las 15, por si hay que identificarlas: `c7dc1724`, `fde49aa8`, `2c31c598`, `f02987cd`, `00d31d5a`,
`3b4e4c18`, `e02fefd1`, `7784e3fa`, `4f3ab8bc`, `a3fb0240`, `67b9027d`, `a0238998`, `d6f4f710`,
`8aaebb37`, `1e491b0e` (prefijos de UUID; G-10 = `12b53bae-a4f7-4076-80f9-8f9288bd0567`).

**Qué los reproduce (todo de solo lectura, en `supabase/diag/`):**

| query | qué devuelve de la lista |
|---|---|
| `pos-total-formula.sql` | por organización: ventas POS que no cuadran (la #2945) y `sin_items` (las 15) |
| `b1-detalle.sql` | el detalle de la que no cuadra y de cada sin ítems, con dónde aparece y su reintento |
| `duplicados-reenvio-detector.sql` | POS con ítems de más de una llamada (#2945) y tandas de mesa repetidas (#1193) |
| `duplicados-reenvio.sql` | bloque 3: órdenes gemelas (7784e3fa / #2908); 5: movimientos gemelos (turno 95ecc259); 7: huérfanas con ítems (994601b1) |

🔴 **Todas usan una ventana de 60 días** (`params.desde`). Estos casos van saliendo de la ventana:
la #1193 deja de aparecer hacia el 22/10 y la 994601b1 ya está cerca del borde. **Para
reconocerlos después, la tabla de arriba es la referencia, no el resultado del detector;** y para
volver a verlos con la query, ampliar `desde`.

**Los scripts para aplicar la excepción ya existen, fuera de git** (en la raíz del repo de
Alejandro, probados en Docker con los UUID de prod el 2026-10-04):
- huérfanas: `limpieza-00-respaldo.sql` → `limpieza-01-huerfanas.sql` → `limpieza-03-verificar.sql`, con reversa;
- fantasma: `limpieza-04-fantasma-respaldo.sql` → `limpieza-04-fantasma.sql`, con reversa.

`limpieza-02-2945.sql` y `turno-95ecc259-nota.sql` también existen, pero **quedan fuera de la
decisión**: tocan datos que no se ven en Cocina.

### "Regalado en vales" cuenta órdenes anuladas y huérfanas (anotado 2026-10-04)

`getVouchersTotal` (Reportes) suma `discount_amount` de toda orden con `discount_kind = 'vale'`
sin mirar el estado ni los pagos. Una venta anulada con vale, o una huérfana con vale, sigue
sumando. El vale del cierre (`close_cash_shift`) sí exige pago. No se arregló: se anota porque
las limpiezas de huérfanas no la sacan de ese número.

### UX del cierre: un abono de fiado en efectivo aparece como "Ingresos manuales" (anotado 2026-10-01)

La cuenta está bien: el abono en efectivo crea un `cash_movement` de tipo `in` ("Abono de
<cliente>"), y el arqueo lo suma como cualquier ingreso. Pero el modal de cierre lo rotula
**"Ingresos manuales"**, y el dueño va a preguntar qué ingreso manual hizo. Visto en Café Aroma
en la prueba del 2026-10-01.

**Propuesta, sin construir:** una línea aparte, **"Abonos de fiado"**, separada de "Ingresos
manuales".
- **Cómo distinguirlos:** por el vínculo `debt_payments.cash_movement_id`, que es la definición
  de "este ingreso es un abono". **NO por el texto** "Abono de…" del `reason` (R2: el texto es
  una descripción, no una identidad).
- **Lados a tocar en la misma pasada (R1):**
  - `close_cash_shift`, que hoy devuelve un solo `movements_in`: sumar `abonos_fiado`;
  - `CloseShiftModal` (vista previa);
  - `ShiftDetailModal` (historial);
  - `printer.ts`, que en el ticket imprime "Ingresos";
  - `MovementsModal`.
- **La fórmula del arqueo NO cambia** (contrato R1 #6): ingresos totales = manuales + abonos. Es
  solo presentación, así que el invariante de `cierre-turno-servidor.spec.ts` no se toca. Sí
  hay que agregar un test que separe las dos líneas.

### Precio del POS: ¿se valida `unit_price` contra `products.price`? — NO por ahora (B2, 2026-10-01)

`register_pos_sale` va a validar el TOTAL contra las líneas (B1), pero el `unit_price` de cada
línea lo sigue mandando el cliente sin control. Antes de decidir si se compara contra
`products.price`, hay dos preguntas abiertas:
1. **¿El POS permite editar un precio a mano?** Si lo permite, comparar contra `products.price`
   rechazaría ventas legítimas. *Lo que dice el código (develop, 2026-10-01):* `cartStore` no
   tiene ninguna acción que cambie un precio (solo cantidad, nota, extras, descuento y órdenes
   en espera); `unit_price` sale de `item.product.price`. Falta confirmar con el cliente si lo
   necesitan.
2. **¿Qué pasa con un carrito abierto si el dueño cambia un precio?** El carrito guarda una
   foto del producto al agregarlo, y las órdenes EN ESPERA (`holdCurrentOrder`) la conservan
   todo lo que duren. Con la validación, esa venta se rechazaría al cobrar; sin ella, se cobra
   el precio viejo.

### Un vale de descuento no tiene identidad: nada impide reusarlo (anotado 2026-10-01)

El "vale" (ruletazo) es `orders.discount_kind = 'vale'` + `discount_amount` + `discount_reason`.
No hay tabla ni código de vale, ni nada que lo marque usado: el cajero lo aplica a mano.
Salió del punto C del diseño de `register_pos_sale`, que pedía marcar el vale como usado en
la misma transacción; eso no se puede hacer porque no hay qué marcar. Si hace falta, es una
decisión de producto (vales con código y un solo uso), no un arreglo técnico. **Se habla con el
cliente antes.**

**Quién puede aplicar un descuento o un vale (código al 2026-10-01, develop `806d8a0`):**
- **POS:** solo con `pos.descuento`. La sección de descuento está dentro de
  `{can('pos.descuento') && (` en `POSPage.tsx` (bloque comentado "Discount — requiere permiso
  pos.descuento"). Lo tienen owner (`*`), admin y cajero; el mozo no (`SYSTEM_ROLES` en
  `src/lib/permissions.ts`).
- **Mesas:** **sin permiso.** El checkout de mesa muestra la sección "Descuento / vale — aplica
  antes del pago…" de `TablesPage.tsx` sin ningún `can(...)`, y la aplica con `applyOrderDiscount`
  (UPDATE directo a `orders`). Cualquiera que llegue a cobrar una mesa puede descontar.
- **Base:** **nada lo controla.** Ninguna función ni policy consulta `pos.descuento`
  (`select proname from pg_proc where prosrc ilike '%pos.descuento%'` devuelve solo
  `seed_system_roles`, que lo CONCEDE). Las policies "orders: staff crea" y "orders: staff
  actualiza" aceptan `discount_*` de cualquier miembro del staff.
  ⇒ `pos.descuento` es un control **solo de pantalla y solo en el POS**: misma clase que
  "concedible pero inerte" (más abajo), con la diferencia de que acá sí gatea algo, pero en un
  único lugar. La salida es la misma que para el total (B1 de `register_pos_sale`): validarlo en
  el servidor. Para Mesas, con el cobro de mesa en una RPC (`close_table_sale`).

### 🔴 Re-aplicar una migración vieja revierte en silencio las funciones que redefinió una posterior (medido 2026-09-30)

Re-aplicar en prod una migración que define una función ya redefinida por otra posterior
devuelve esa función a su versión vieja. Da `exit 0`, sin ningún aviso. Medido con
`close-cash-shift.sql` sobre `cobro-turno.sql`: deja `exige_turno=false` en los dos abonos.
Pasa porque no hay ledger: nada en la base sabe qué versión es la vigente.

**Cerrado SOLO para `close-cash-shift.sql`:** su paso 0 aborta si los abonos ya tienen el
marcador de cobro-turno (`tests/guard-reaplicar.spec.ts`, con mutante). Se pudo hacer porque
ese archivo todavía no estaba aplicado en prod. **A los ya aplicados no se les agrega guard (R5).**

**Inventario (2026-09-30, sobre el ORDEN de `preparar-local`):** función → archivo que gana →
archivos que la REVIERTEN si se re-aplican.

| función | gana | revierten |
|---|---|---|
| `get_my_restaurant_id`, `get_my_role` | `profiles-is-active-enforced.sql` | `schema.sql` |
| `get_my_organization_id`, `has_permission` | `profiles-is-active-enforced.sql` | `multi-tenant-rbac.sql` |
| `handle_new_user` | `profiles-organization-invariant.sql` | `schema.sql` |
| `enforce_profile_organization` | `fix-enforce-profile-organization-definer.sql` | `profiles-organization-invariant.sql` |
| `add_order_items_with_extras` | `pos-sale-lotes.sql` (3 argumentos, con `p_lote`; borra la de 2) | `order-items-stock-recipes.sql`, `order-extras-rpc.sql` — **no la revierten: AGREGAN la de 2 argumentos al lado.** Medido en Docker el 2026-10-04: con las dos vivas, la llamada de 2 argumentos (frontend anterior al paso 2) falla con `PGRST203`; la de 3 y `register_pos_sale` siguen andando. Se arregla re-aplicando `pos-sale-lotes.sql`. |
| `register_purchase` | `compra-no-toca-caja.sql` | `compras-proveedores.sql` |
| `register_sale_payment` | `cobro-turno.sql` | `register-sale-payment.sql` |
| `register_sale_void` | `close-cash-shift.sql` | `register-sale-void.sql` |
| `register_debt_payment` | `cobro-turno.sql` | `fiado-clientes.sql` (y `close-cash-shift.sql`, con guard) |
| `register_debt_payments_batch` | `cobro-turno.sql` | `fiado-abono-lote.sql` (y `close-cash-shift.sql`, con guard) |

Las 5 primeras filas son de **seguridad**: re-aplicar `schema.sql` o `multi-tenant-rbac.sql`
desactiva el bloqueo de usuarios inactivos (`profiles-is-active-enforced.sql`).
Para regenerar la tabla: el guard GANA de `scripts/capturas/preparar-local.mjs` ya calcula
quién define qué; los perdedores son los archivos de cada entrada que no son el ganador.
**Salida de fondo:** el ledger `schema_migrations` (CLAUDE.md → *"El estado de aplicación…"*).
Hasta entonces: **antes de re-aplicar un archivo en prod, buscarlo en esta tabla.**

### ✅ La base local es un PROXY de producción — deriva 0 alcanzada el 2026-09-30 (5.6 se reabre)

**Medición final (2026-09-30):** export de prod con la query extendida (`docs/deriva-.csv`, no
versionado) contra la base local preparada desde cero en `fix/flakes-lab` → **deriva 0**
(`pnpm deriva:comparar`, exit 0), con **1 diferencia aceptada**: `issue_pg_graphql_access`,
event trigger de la plataforma (dueño `supabase_admin`) que solo difiere en los tags
(`CREATE FUNCTION` en prod, `CREATE EXTENSION` en el CLI 2.90); el hash de prod se recalculó
desde su definición y coincide. Declarada en `scripts/deriva-aceptadas.json` con los dos
valores exactos: si cualquiera cambia, vuelve a contar. Con esto **5.6 deja de estar
suspendido**: ORDEN construye la base que tiene prod en todo lo que mide la deriva.
Origen de `rls_auto_enable`: el export dice que el dueño de `ensure_rls` en prod es
`postgres` (los 6 de la plataforma son `supabase_admin`) ⇒ lo creó alguien como postgres.

*(Lo que sigue es el registro de cómo se llegó.)*


`preparar-local.mjs` estaba "verificado por ejecución contra una base en blanco" (140a0f2) y
**construía una base distinta de producción sin un solo error**: `add_order_items_with_extras`
quedaba en la versión VIEJA (sin descuento por receta), porque `order-extras-rpc.sql` se
aplicaba después de `order-items-stock-recipes.sql` y plpgsql no valida al crear. Corregido el
orden y agregado el guard `GANA` (todo objeto redefinido en más de un `.sql` —función, vista,
trigger o policy— declara qué archivo gana; si no, aborta). El guard es una alarma estática:
**la verificación real es la deriva contra prod.**

⇒ **5.6 ("ORDEN es una lista de siembra lista para `schema_migrations`") queda SUSPENDIDO**
hasta que la deriva dé 0. Una lista que construye otra base no es un ledger.

**El comando que lo reabre:**
```bash
# 1) SQL Editor de PROD: supabase/diag/deriva-esquema.sql → Export → CSV → deriva-prod.csv
# 2) acá, con Docker arriba y la base recién preparada:
pnpm e2e:preparar && pnpm deriva:comparar deriva-prod.csv     # exit 0 = deriva 0
```
Toda diferencia es una deuda de uno de dos tipos: el `.sql` del repo no es lo que se aplicó
en prod, o prod tiene algo aplicado a mano que el repo no tiene.

**Primera medición (2026-09-30), prod vs local recién preparada — 14 diferencias, deriva ≠ 0:**
- ✅ Misma versión mayor (17.6 los dos). ✅ `add_order_items_with_extras` en prod es la versión
  NUEVA (usa receta y crea `stock_movements`): el hallazgo que motivó todo esto NO afectaba a prod.
- **Prod tiene algo aplicado a mano que el repo no tiene** (deuda del repo):
  · Storage: 5 policies — `product-images: subir/actualizar/borrar con permiso` y
    `restaurant-logos: admin sube / lectura pública`. El bucket `restaurant-logos` lo usa la app
    (logo y QR de Nequi en `supabase-helpers`) y **no existe en ningún `.sql`**.
  · `rls_auto_enable()` con EXECUTE a anon/authenticated: sin rastro en el repo. Probablemente
    la crea el Dashboard (auto-habilitar RLS en tablas nuevas) — **no verificado**; lo responde
    `supabase/diag/deriva-detalle.sql` (definición + event triggers que la usan).
- **El repo tiene algo que prod ya no:** las 3 policies `product-images: … autenticado` de
  `storage-product-images.sql` — prod las reemplazó por las "con permiso".
- **La base local es MÁS permisiva que prod** (causa: el RESET de `preparar-local` da privilegios
  por defecto sobre funciones a anon; `security-definer-revoke.sql` solo revoca a PUBLIC): anon
  ejecuta `get_my_role` y `get_my_restaurant_id`, y authenticated ejecuta `handle_new_user`; en
  prod no. Dirección fail-open del proxy: un test podría pasar en local y fallar en prod.
- **Qué NO invalida:** ningún spec sube archivos a Storage ni llama esas funciones como anon, así
  que el verde de la suite (219/219) no depende de estas diferencias. Pero la deriva tiene que dar 0
  antes del merge igual: es la condición, no una opinión sobre cuánto importa cada fila.
- **Siguiente paso:** con la salida de `deriva-detalle.sql`, una migración que lleve el repo a prod
  (policies de Storage + bucket + revokes explícitos a anon), agregada a ORDEN, y re-medir.

**Segunda medición (2026-09-30), después de `supabase/reconciliar-con-prod.sql`** (en ORDEN, base
preparada desde cero): **deriva 0** en las categorías originales contra el export de prod.
La migración es no-op en prod (crear si falta / revocar / borrar nombres exactos que prod no
tiene) y se aplicó dos veces en local: la 2ª no cambió nada.

**Categorías que la deriva NO medía y ahora sí** (R3 — lo que no se mide no aparece):
triggers de TODAS las tablas de `auth` (el alta de usuarios vive ahí; `on_auth_user_created`
ya estaba cubierto solo porque llama a una función de `public`), **event triggers** con su
dueño, **buckets** de Storage (son datos, pero deciden qué acepta una subida) y los
**privilegios por defecto** de `public`. Contra `deriva-detalle.csv`: 25 objetos, **1
diferencia**, que no es nuestra: `issue_pg_graphql_access` (dueño `supabase_admin`, de la
plataforma) se dispara con `CREATE FUNCTION` en prod y con `CREATE EXTENSION` en el CLI 2.90.
Para cerrarla hace falta el export de prod con la query extendida: con sus hashes reales se
declara en `scripts/deriva-aceptadas.json` (valores EXACTOS de los dos lados; si cambian,
vuelve a contar) — o se prueba si actualizar el CLI la iguala.

**Hallazgos de prod que la reconciliación COPIÓ tal cual y NO arregló** (decisión aparte):
- 🔴 **Cambiar el logo o el QR de Nequi por segunda vez falla en prod.** `uploadRestaurantLogo`
  y `uploadNequiQR` suben con `upsert: true` a una ruta fija (`<sede>/logo.<ext>`); reemplazar
  un objeto exige policy de UPDATE, y `restaurant-logos` en prod solo tiene INSERT ("admin sube")
  y SELECT. **Medido en Docker con la base igual a prod:** 1ª subida OK, 2ª →
  `new row violates row-level security policy`. El usuario ve "Error al subir el logo", sin
  causa. Solo funciona si cambia la extensión (y el archivo viejo queda huérfano). Además el
  gate es el enum `get_my_role() = 'admin'`, no `has_permission` (misma deuda que el resto).
  Salida propuesta: policy de UPDATE (y DELETE) para `restaurant-logos` con
  `has_permission('config.acceder')`, en una migración que SÍ se aplica en prod.

**Actualización 2026-09-30 — `restaurant-logos`: además de no poder reemplazar, había un HUECO
ENTRE CLIENTES.** La policy de INSERT de prod ("admin sube") no mira la carpeta. Medido en
Docker con la base igual a prod y una segunda organización local (LAB-OTRA): un admin de OTRA
org subió `<sede LAB>/nequi-qr.png`, y después el owner de LAB no pudo subir su QR a esa ruta.
Arreglo en `supabase/restaurant-logos-policies.sql` (rama `fix/restaurant-logos`): un solo
alcance para subir/reemplazar/borrar = carpeta de la sede activa + `config.acceder` (el permiso
de la ruta `/config`). **Se aplica en prod**; antes, correr `supabase/diag/logos-plantados.sql`
(¿alguien ya plantó archivos? ¿quién pierde el permiso de subir?).

**🔴 `product-images` tenía el MISMO hueco entre clientes, más grave (medido 2026-09-30, R3).**
Las 3 policies de escritura de prod ("… con permiso") piden solo bucket + `productos.editar`,
sin carpeta. En Docker con la base igual a prod, un usuario de LAB-OTRA subió a la carpeta de
LAB, REEMPLAZÓ la foto de un producto ajeno y la BORRÓ. La foto se muestra desde
`products.image_url`: reemplazar el archivo cambia la foto que el otro negocio ve en su POS.
Arreglo: `supabase/product-images-policies.sql` (rama `fix/product-images-carpeta`), mismo
alcance que logos (carpeta = sede activa + `productos.editar`). Antes de aplicarlo en prod:
`supabase/diag/storage-escrituras-cruzadas.sql` (cubre los dos buckets; detecta plantados y
reemplazos porque `storage.objects.owner` pasa a ser el último que escribió — medido).
**Corrida en prod el 2026-09-30, después de aplicar logos: 0 filas** ⇒ el hueco no se usó.
El QR de Nequi, en cambio, se lee de `config.nequi_qr_url` (guardada solo tras una subida
propia exitosa) y solo lo muestra la vista previa de Configuración: un archivo plantado no
podía volverse "su QR de pago".

**`product-images` — respuesta sobre el límite (sin aplicar nada):** el cliente NO comprime ni
redimensiona. `ImageUpload.tsx` → `validate` rechaza lo que no sea jpeg/png/webp y lo que pase
de 2 MB, y `uploadProductImage` sube el archivo tal cual. Una HEIC (`image/heic`) la rechaza el
cliente por tipo. Un límite de servidor IGUAL al del cliente no rechazaría nada que el cliente
hoy acepte: solo cerraría el acceso directo a la API, que hoy acepta 3 MB (medido en Docker).
El problema real está del lado del cliente: una foto de celular suele pasar de 2 MB y la app la
rechaza en vez de achicarla. **El arreglo va primero en el cliente** (redimensionar/comprimir
antes de subir, y convertir HEIC si el navegador la entrega), sobre todo para M1. Qué hay subido
de verdad en prod: `supabase/diag/product-images-tamanos.sql`.
- `product-images` en prod **no tiene límite de tamaño ni de tipo** (el repo ponía 2 MB y
  jpeg/png/webp; prod no los tiene). Cualquiera con `productos.editar` puede subir un archivo
  de cualquier tamaño y tipo a un bucket público. Decidir si se agregan.
- `rls_auto_enable()` + event trigger `ensure_rls` (toda tabla nueva de `public` nace con RLS):
  **origen sin verificar.** Evidencia: 0 commits en el repo, no la trae un stack recién creado
  por el CLI 2.90, y su dueño en prod es `postgres` (grantor de su ACL) — o sea que se creó como
  postgres (SQL Editor / Dashboard), no la plataforma. La fila `event_trigger_dueno` del export
  extendido dice el dueño del trigger. Se copió al repo porque es una protección fail-closed que
  prod tiene: una base local sin ella aprobaría tablas que en prod nacen con RLS.

### Residuo de LAB en la NUBE — baja a limpieza opcional (2026-09-30)

Desde el 2026-09-30 la suite corre **solo contra Docker**, así que el residuo de LAB en la nube
(188 mesas al 2026-09-21, 14 ocupadas con orden cancelada, 20 ventas cobradas sin número)
**dejó de crecer**. El barrido pasa de "precondición de la suite verde" a limpieza opcional.
Si se hace: por UUID de LAB (`f4fa692d-6cf3-43fb-a17f-18b8b163c918`), contando antes y **sin
intentar borrar mesas con ventas** (no se puede, ver arriba): archivarlas cuando exista el
archivado. B1 sigue importando por otra razón: le pasa hoy a un cliente desde TablesPage.

Las **20 "cobradas sin número"** de LAB NO son el `DEFAULT 'paid'`: la columna de
`numeracion-duplicados.sql` exige una fila en `payments`. Salen de `numeracion-fallo.spec.ts`,
que por diseño deja **una** venta cobrada sin número por corrida (reproducido en Docker: de 0 a
1, producto `E2E NumFailProd …`). Para confirmarlo en la nube (lectura):
```sql
select o.created_at, o.total,
       (select count(*) from payments p where p.order_id = o.id) as pagos,
       (select string_agg(pr.name, ',') from order_items oi
          join products pr on pr.id = oi.product_id where oi.order_id = o.id) as productos
  from orders o join restaurants r on r.id = o.restaurant_id
 where r.organization_id = 'f4fa692d-6cf3-43fb-a17f-18b8b163c918'
   and o.order_number is null and o.payment_status = 'paid'
   and exists (select 1 from payments p where p.order_id = o.id)
 order by o.created_at;
-- esperado: ~20 filas, pagos >= 1, productos 'E2E NumFailProd …'
```

### Ausencias y ceros que la UI muestra mientras carga — lo que quedó para el Paso D (2026-09-30)

El barrido R3 del Paso C (106 aserciones de ausencia, 23 sin garantía de carga) corrigió las
23, en el test o en el producto. Quedan de la misma clase, en `useCashShift`, que reescribe el
Paso D (`close_cash_shift`):
- `salesSummary` / `vouchersTotal` valen `null`/`0` mientras cargan: `ShiftBanner` pinta "$0"
  de ventas del turno y `CloseShiftModal` calcula el esperado con ventas incompletas. Specs que
  leen esos valores apoyados solo en `networkidle`: `pago-mixto` (`readShiftSales`) y `fiado`
  (`readKpis`, sobre los KPIs de `FiadoPage`, que tampoco consultan `isLoading`).
- Limpiezas que deciden con `count()`, que no reintenta (si la lista no cargó, el paso se
  saltea en silencio): `fiado.spec` (clientes), `fiado-lote.spec`, `cocina.spec`.

### ✅ Flakes de `pago-mixto:247` y `vale-descuento` REPORTE — causa encontrada y arreglada en el PRODUCTO (2026-09-30)

- **`pago-mixto:247`** no era el volumen de mesas: `useProductsWithExtras` devolvía un set VACÍO
  mientras cargaba (`?? new Set()`), y un click sobre un producto con extras lo agregaba SIN
  abrir el modal. Reproducido demorando `product_extras` 1,5 s. Arreglo fail-closed (gate de
  carga, y modal si el set no se conoce); `tests/extras-carga.spec.ts`, auditado por mutación:
  los casos LENTO y ERROR mueren contra el código viejo.
- **`vale-descuento` REPORTE:** `useReports` dejaba la query de vales fuera de `isLoading` y la
  tarjeta pintaba $0 mientras cargaba. El test ahora FUERZA la ventana (2 s de demora) y con el
  hook viejo da `Received: 0`.
- El residuo de mesas era real pero de otra causa: limpiezas al final de un `describe.serial` y
  sin aserción. Ahora mesa fija por spec + `afterAll` con aserción (`tests/helpers/lab.ts`).

### 🔴 Suite: el proceso de WebKit (`m-iphone`) a veces no termina al cerrarse → exit 1 con todo verde (medido 2026-10-04)

**Síntoma:** al final de la corrida, `Error: worker-N process did not exit within 300000ms after
stop, force-killed it` y `PLAYWRIGHT_EXIT=1`, con **todos los tests pasados** ("329 passed"). Tarda
5 minutos más. Lo emite Playwright 1.60 desde el PR microsoft/playwright#40637: antes un proceso
así quedaba colgado sin avisar (issue #39753, "Playwright randomly not exiting").

**Medido (Windows, Playwright 1.60.0, WebKit 2287):**
- **2 de 9** corridas del proyecto `m-iphone` completo, más 1 en la suite completa. Siempre al
  detener el proceso de WebKit, después del último test.
- **0 de 8** con `DEBUG=pw:browser*`: el registro cambia los tiempos y lo esconde.
- **0 de 8** corriendo por mitades (`--grep reintento` y el resto). No se pudo atribuir a un test.
- **`m-android` (Chromium), con el mismo spec, nunca.**

`PWTEST_CHILD_PROCESS_TIMEOUT=60000` lo hace fallar en 1 minuto en vez de 5, pero no lo arregla.

**Decidido (2026-10-04): (a) primero, (b) solo si sigue, (c) NO.** Un exit 1 es rojo, aunque
diga "N passed".
- **(a) HECHO:** Playwright fijo en **1.63.0** (`package.json` sin `^`; WebKit 2359, Chromium 1243).
  **Medido: 0 de 10** corridas de `m-iphone` con cuelgue (`PLAYWRIGHT_EXIT=0` leído en el archivo
  de cada una, 17 pasados en las 10). Con la 1.60 eran ~1 de cada 4. Diez limpias no prueban que
  no vuelva (con 1 de 4, la chance de 10 limpias por azar es ~6%), pero alcanzan para no
  construir (b) todavía.
- **(b), SI VUELVE A APARECER:** `m-iphone` en un paso aparte que cuenta como verde **SOLO** si
  0 tests fallaron, 0 sin correr, **y** el único error fuera de los tests es el cierre colgado,
  identificado por su mensaje **exacto** (`worker-N process did not exit within Nms after stop,
  force-killed it`). Cualquier otra cosa es rojo. Se documenta en CLAUDE.md (R9) y en
  `tests/README.md` al construirlo, no antes.

### `anon` tiene privilegios de escritura en TODAS las tablas de `public` (default de Supabase) — medido, NO barrido (2026-09-30)

**No se barre ahora, a propósito:** revocar en bloque puede romper lecturas públicas (tienda,
menú, logos por URL) que nadie inventarió. D revoca solo `UPDATE` sobre `cash_shifts`.

**Lo que hay** (medido en la base local, que tiene deriva 0 con prod):
- `anon` tiene INSERT / UPDATE / DELETE en **las 29 tablas** de `public` (privilegios por
  defecto del esquema: `postgres / r → anon=arwdDxtm`).
- **Qué lo contiene hoy:** RLS está activado en las 29 (0 tablas sin RLS) y **una sola** policy
  alcanza a `anon`: `cash_movements: acceso por restaurante` (`FOR ALL`, `TO public`). Su
  condición usa `get_my_restaurant_id()`, que `anon` ya **no puede ejecutar**
  (`reconciliar-con-prod.sql`) ⇒ para anon falla cerrado. Pero eso es una protección
  **accidental**: depende de que esa función siga sin grant a anon.
- **Qué NO lo contiene:** una tabla nueva en `public` nace con esos privilegios; si alguien
  olvida RLS (el event trigger `ensure_rls` lo habilita solo, pero es de origen dudoso y se puede
  apagar) o escribe una policy `TO public` sin pensar en anon, queda escribible sin login.

**Salida propuesta, cuando haya margen:** inventariar primero qué lee `anon` de verdad (la app
sin sesión: login, tienda, KDS por PIN, URLs públicas de Storage), después `alter default
privileges … revoke insert, update, delete … from anon` + revoke explícito en las 29, y la
policy de `cash_movements` pasarla a `TO authenticated`. Con test de que la app sin sesión sigue
funcionando.

**El comando que lo mide (no caduca):**
```sql
select table_name, string_agg(privilege_type, ',' order by privilege_type) as privilegios
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee = 'anon'
 group by table_name order by 1;
-- y las policies que alcanzan a anon:
select tablename, policyname, cmd, roles from pg_policies
 where schemaname = 'public' and ('anon' = any(roles) or 'public' = any(roles));
```

### 🔴 Registrar un movimiento y cerrar turno EN SEGUIDA puede persistir un esperado sin ese movimiento (hallado 2026-09-07)

**✅ FASE 1 DESPLEGADA EL 2026-10-01** (lo reportó el usuario): `close-cash-shift.sql` de `3339978`
a las 10:40, con las 4 verificaciones OK; frontend que cierra por `close_cash_shift` a las ~11:45.
Cierre de prueba en Café Aroma con el frontend nuevo: congelado = recalculado (63.500).
**FASE 2 (`close-cash-shift-revoke.sql`): queda para el 2026-10-02**, después de correr
`fase2-precheck.sql` (fuera de git), que distingue por qué camino cerró cada turno.
*(Historia del arreglo, abajo.)*
`supabase/close-cash-shift.sql`: cierre en el servidor (`close_cash_shift`), UPDATE revocado a
authenticated y anon sobre `cash_shifts` (una pestaña vieja recibe 42501: toast "Error al cerrar
el turno", el turno sigue abierto — medido), trigger que rechaza movimientos en turnos cerrados, y
el PROTOCOLO DE LOCKS en los dos abonos y la anulación. `tests/cierre-turno-servidor.spec.ts`:
el escenario medido + una carrera forzada por escritor + todos a la vez ×10 sin 40P01; mutantes
verificados (escritores sin FOR SHARE → rojo; cliente viejo → congela 100.000 en vez de 89.423).
**Falta:** el cobro (`register_sale_payment`) todavía no toma el turno → cambio (1).
→ Hecho en rama `feat/cobro-turno` (2026-09-30); ver la entrada de `register_sale_payment` arriba.

**Hallazgo lateral (2026-09-30, leyendo el código para D):** `register_debt_payment` (abono de UNA
venta) lee el saldo SIN bloquear la orden: dos abonos simultáneos a la misma venta pueden pasarse
del saldo. El lote SÍ bloquea las órdenes (su paso 3 dice exactamente esto). Misma clase (R3); con
varios celulares cobrando fiados se vuelve probable. No se tocó en D (no es del turno).
→ Arreglado con el cambio (1) en `feat/cobro-turno`: test de dos abonos simultáneos que juntos
se pasan del saldo (5000 + 5000 sobre 8000) → el segundo espera y se rechaza; mutante sin el
lock → abonado 10000.

**✅ MEDIDO el 2026-09-21** (contra LAB en la nube, antes de pasar las pruebas a Docker; esperado leído del PATCH a `cash_shifts`): con red local y sin pausa, 3/3 correcto; con el GET de `cash_movements` demorado 2 s y sin pausa, **3/3 CARRERA** (se persistió la apertura sin el egreso); a ritmo humano con la misma demora, 3/3 correcto; y con **dos dispositivos** (B registra un egreso con el modal de cierre de A abierto) **siempre carrera**: `cash_movements` no tiene realtime ni polling, así que el modal de A nunca se entera. Con varios celulares es el caso normal, no el raro. Salida: el Paso D (`close_cash_shift`, esperado calculado en el servidor).

**NO se arregló en esta sesión.** Se anota porque es plata mal declarada en un snapshot que
después nadie recalcula — el arqueo se congela al cerrar, a propósito, así que un esperado
equivocado queda equivocado para siempre.

**Cómo apareció, que importa porque no se buscaba:** montando la captura de la modal de detalle,
el script registró un egreso de 12.000 y cerró el turno de inmediato. El resultado quedó así:

| dato | valor | de dónde sale |
|---|---|---|
| esperado persistido | 141.000 | snapshot del cierre — **no incluye el egreso** |
| egreso del turno | 12.000 | `cash_movements`, leído por `shift_id` |
| esperado correcto | 129.000 | 141.000 − 12.000 |

Con una espera de ~1,5 s entre el movimiento y el cierre, el mismo script da 129.000. **O sea
que es una carrera, no un error de fórmula.**

**Mecanismo (hipótesis con la evidencia que hay, NO verificada leyendo la ejecución):**
`CloseShiftModal` calcula `movementsOut` desde `movements`, que viene de `useCashShift` →
React Query con clave `['cash_movements', shift.id]`. `addMovementMutation.onSuccess` llama a
`invalidateMovements()`, pero invalidar **agenda** un refetch, no lo espera. Si el cajero cierra
el modal de movimientos y toca "Cerrar turno" antes de que ese refetch vuelva, el cálculo usa la
lista vieja.

**Por qué no lo cazó la suite:** `historiales.spec.ts` afirma `EXPECTED = OPENING − EGRESO` y
pasa. Entre el egreso y el cierre hace varias interacciones de Playwright, cada una con su
espera, y eso alcanza para que el refetch llegue. **La suite no reproduce la ventana**; es otra
vez la misma forma —el caso existe, pero la ruta no lo alcanza— y acá apareció por accidente al
scriptear una captura sin esperas.

⚠️ **Lo que NO se sabe todavía, y hay que medir antes de tocar nada:** si un cajero real puede
ganarle a ese refetch. En una máquina con red local rápida quizá nunca ocurra; con la nube y una
conexión mala, es plausible. **La verificación no es leer el código: es reproducirlo con la red
degradada** (throttling en devtools, o un `page.route` que demore la respuesta de
`cash_movements`).

**Para reproducirlo hoy** (va primero el comando):

```
abrir turno con apertura conocida → registrar un egreso → cerrar turno SIN esperar
→ comparar cash_shifts.expected_amount contra (apertura − egreso)
```

**Salida de fondo, si se confirma:** que el cierre no dependa de una lista cacheada en el
cliente. Las dos formas conocidas son (a) `await refetch()` antes de habilitar "Confirmar
cierre", o (b) que el esperado lo calcule el servidor al cerrar, leyendo `cash_movements` por
`shift_id` — que es lo que hace el detalle del historial y por eso ahí el número sí está bien.
La segunda es la que elimina la clase entera, no solo esta ventana.

---

### 🔴 "No hay concepto de organización de prueba" es una suposición tácita esperando a fallar (anotado 2026-08-31)

**NO se construye ahora.** Se anota porque es exactamente la clase que este proyecto cazó once
veces: una condición que hoy es verdad por accidente —no hay consultas que crucen
organizaciones— y que deja de serlo en silencio el día que alguien escriba la primera.

**El hecho:** G-Vento no tiene columna `is_test`, ni vistas de cobranza, ni ninguna consulta
de la app que cruce organizaciones. Cada una está acotada por RLS a la propia. El
`config->>'es_laboratorio'` de LabCentro es documentación dentro de la fila que **ningún
código lee**, y LAB —anterior— ni siquiera lo tiene.

**Por qué es deuda y no una simple ausencia:** cualquier consulta futura que cruce
organizaciones —un reporte consolidado, una métrica de negocio, una vista de cobranza— va a
contar **LAB y LabCentro como clientes** salvo que quien la escriba se acuerde de excluirlas.
El default es incluir. Es fail-OPEN: el número sale plausible y alto, y nadie lo audita
porque no hay con qué compararlo.

**¿Hay HOY alguna consulta que cruce organizaciones?** Sí, tres, y las tres son **manuales de
operador**, ninguna de la app:

1. `organization-subscription.sql` → duplicados por nombre (pre-flight del unique). Cuenta las 5.
2. `organization-subscription.sql` → la lista de UUID para G-Centro con `count(sedes)`. **Ya
   lleva un aviso manual sobre LAB**, escrito cuando LAB era el único laboratorio: **no
   menciona LabCentro**. Es justamente una allowlist de excepciones enumerada a mano, que se
   quedó corta en cuanto apareció la segunda instancia.
3. `organization-subscription.sql` → `select subscription_status, count(*) group by`. **Esta es
   la peligrosa:** hoy devuelve `active | 5`, y de esos 5 **solo 3 son clientes**. Quien tome
   ese número como "organizaciones activas" se equivoca en un 66%.

**En la app: NINGUNA.** Y hay una señal de que va a haber: el permiso `reportes.consolidado`
("ver reportes consolidados multi-sede") existe en el catálogo desde la migración
multi-tenant, pero **no gatea nada** — es uno de los 6 de *"concedible pero inerte"*. O sea
que el permiso ya anticipa una funcionalidad que todavía no existe, y cuando se construya va
a caer justo en esta trampa.

**Las salidas, cuando se retome:**
- Lo barato y suficiente: `organizations.es_laboratorio boolean not null default false`, poblada
  desde el `config` que ya tiene LabCentro, y **una vista `organizaciones_facturables`** que la
  excluya. Que la consulta correcta sea la más corta de escribir; si hay que acordarse de
  agregar un `where`, alguien no se va a acordar.
- Lo que NO alcanza: seguir enumerando los nombres de laboratorio en un comentario. Ya falló
  una vez —el aviso sobre LAB no cubrió a LabCentro— y es la misma deny-list de R2.

**Señal para retomarlo:** la primera consulta de la app que cruce organizaciones, o el día que
se implemente `reportes.consolidado`. Lo que llegue antes.


### `.gitattributes` con `* text=auto eol=lf` (anotado 2026-08-31)

**Commit propio, no de polizón.** Se anota con su razón porque el síntoma ya apareció una vez
y va a volver.

**El problema:** el repo tiene `core.autocrlf=true` y **ningún `.gitattributes`**, así que
git materializa los archivos con CRLF en Windows mientras las herramientas los escriben con
LF. **Cualquier artefacto generado que se compare byte a byte contra su fuente va a fallar
espurio en un checkout limpio.** Ya pasó con `supabase/seed-system-roles.sql`: el
`gen:rbac:check` daba verde en la rama donde se había generado y rojo en develop tras el
fast-forward, con el mismo árbol.

**Por qué importa más de lo que parece:** un check que falla sin motivo se desactiva a la
semana. El mecanismo que existe para que el catálogo de permisos no vuelva a divergir se
habría apagado solo, y el defecto que costó tres sesiones habría vuelto sin que nadie lo note.

**El parche que ya está puesto** es local a ese generador: normaliza CRLF→LF antes de
comparar. Resuelve el caso, **no la clase** — el próximo artefacto generado empieza de cero.

**La salida de fondo:** `* text=auto eol=lf` en `.gitattributes` (o al menos
`*.sql text eol=lf` + `*.mjs text eol=lf`). Cierra el problema para todos los archivos de una
vez. **Por qué no se hizo junto con el fix:** renormaliza los finales de línea de TODO el
repo, así que el diff son miles de líneas sobre decenas de archivos y taparía cualquier
cambio real que viajara en el mismo commit. Va solo, con `git add --renormalize .` y nada
más adentro.

**Señal para retomarlo:** el próximo generador o snapshot que se compare byte a byte. O
simplemente una tarde tranquila — es barato y no tiene riesgo funcional.

### ✅ Barrido de AFIRMACIONES DE PROTECCIÓN — hecho el 2026-08-31, resultado abajo

Disparado por el caso #13. Se grepearon `CLAUDE.md` y `docs/DEUDAS.md` por
`impide|impiden|evita|garantiza|protege|aisla|separado|nunca puede|imposible|bloquea`, y se
verificó cada coincidencia contra el código. Se anota el RESULTADO para que nadie lo repita:

| afirmación | veredicto |
|---|---|
| DEUDAS · "LAB en Supabase separado de producción" | ❌ **falsa** → corregida |
| DEUDAS · "`VITE_GVENTO_*` apunta al Supabase del lab" | ❌ **falsa** → corregida |
| DEUDAS · "los health checks impiden correr contra producción" | ⚠️ **parcial** → precisada |
| DEUDAS · "esto evita correr tests contra datos reales" | ⚠️ **parcial** → precisada |
| CLAUDE.md · "un hook no puede garantizar su propia existencia" | ✅ cierta (y es una *limitación* declarada, no una protección) |
| CLAUDE.md · "`ventas.anular` falla cerrado" | ✅ cierta |
| DEUDAS · "nunca por RLS relajada" (pedidos entre negocios) | ✅ es una REGLA futura, no una afirmación de estado |
| `playwright.config.ts` · "`reuseExistingServer:false` + `strictPort` ⇒ nunca se conecta a otra app" | ✅ cierta — configurado así, y el health check #1 lo respalda |
| `tests/README.md` · "vive en el **mismo** Supabase que la app" | ✅ cierta |
| `.env.test.example` · "la BD es UNA sola" | ✅ cierta |
| CLAUDE.md · unique `(producto_id, organizacion_externa_id)` de G-Centro | ⏳ **no verificable desde este repo** (otro repo, otra BD) → marcada como dicho de terceros |

**Regla que deja el barrido, y es el criterio para escribir la próxima:** una afirmación de
protección tiene que nombrar **el mecanismo** y **su límite**. "Está aislado" no es
verificable; "aislado por RLS + credenciales de LAB, y el check mira la organización, no la
base" sí. Lo que no es verificable envejece hacia la mentira, y una garantía falsa **apaga la
vigilancia** en vez de solo desviarla.

⏳ **Lo que este barrido NO cubrió:** los encabezados de `supabase/*.sql` (entrada de abajo)
y los docblocks de `src/`. Mismo modo de fallo, otro alcance.

### Auditar los 40+ encabezados restantes de `supabase/` (anotado 2026-08-31)

**Queda para la siguiente pasada, con el hallazgo YA caracterizado** — se anota para no
volver a pagar el diagnóstico.

**Lo que ya está hecho:** se barrieron los 48 `.sql` buscando *declaraciones de estado de
aplicación* y se corrigieron las 3 que había (`owner-wildcard-permission`,
`compras-proveedores`, `fiado-clientes`). Esa subclase está cerrada. Reconfirmar con:

```bash
grep -rniE "no aplicada|ya aplicada|sin aplicar|pendiente de aplicar" supabase/*.sql
```

**Lo que NO se auditó, y es el trabajo pendiente:** el resto del CONTENIDO de esos
encabezados. Cada `.sql` tiene entre 5 y 60 líneas de comentario describiendo qué hace, qué
requiere y qué decidió — y **ninguna de esas afirmaciones se verificó contra el código
actual**. Son ~40 archivos. Los tres tipos de afirmación, en orden de riesgo:

1. **Referencias `archivo:línea`** — por la convención del proyecto solo son válidas si
   apuntan a migraciones aplicadas (que no se editan). Las que apuntan a código vivo ya
   están podridas: `onboard-org-paso1.sql` citaba `register-sale-void.sql:78` y
   `SalesHistoryPage.tsx:109`.
2. **Precondiciones entre migraciones** (*"requiere aplicada antes: X"*) — verificables
   contra el repo, sin BD.
3. **Descripciones de comportamiento** (*"no crea cash_movement"*, *"el retorno pierde
   shift_open"*) — las más caras de verificar y las que más dirigen a quien lee.

**Ya hay un caso confirmado de tipo 3 en el repo:** el comentario-catálogo de
`multi-tenant-rbac.sql` lista **19 permisos** cuando el catálogo vivo tiene 23. No se corrige
porque la migración está aplicada y es inmutable (R5) — es registro histórico. Pero alguien
que la lea buscando "el catálogo" se lleva una lista incompleta, y ese es precisamente el
modo de fallo de *"una nota que dirige mal cuesta más que una ausente"*.

**Por qué no se hizo ahora:** son ~40 archivos y el criterio de verificación cambia por
archivo. Es una pasada propia, no un arrastre de otra tarea.


### 🔴 "Concedible pero inerte" — 6 permisos que la UI ofrece y que no gatean nada (hallado 2026-08-31)

**Decisión: NO se arregla ahora.** Se anota porque *concedible pero inerte* es una **clase**
de defecto que va a volver cada vez que se agregue un permiso, y porque su modo de fallo es
el opuesto —y peor— que el de `ventas.anular`.

**Los 6, medidos:** `pos.vender`, `caja.abrir`, `mesas.cobrar`, `productos.ver`,
`reportes.stock`, `reportes.consolidado`. Están en `PERMISSION_GROUPS` —o sea, la matriz de
Roles les dibuja su checkbox— y **no aparecen en un solo `can()` ni `has_permission()` del
repo**: solo en seeds y en comentarios de catálogo. Para reconfirmar la lista:

```bash
for k in pos.vender caja.abrir mesas.cobrar productos.ver reportes.stock reportes.consolidado; do
  echo "$k -> $(grep -rl "'$k'" src/ | grep -v permissions.ts | wc -l) usos reales"
done
```

**Por qué es peor que `ventas.anular`.** Ese falla **cerrado**: el permiso se enforcea y no se
puede conceder, así que alguien se queda sin poder hacer algo y **se queja** — el defecto se
reporta solo. Este falla **abierto y en silencio**: un admin destilda "Cobrar mesa" del rol
cajero, la UI se lo acepta, **y el cajero sigue cobrando**. No hay error, no hay test rojo, y
el único que podría notarlo es justamente el que se quedó creyendo que ya lo había resuelto.
La pantalla de Roles miente sobre lo que hace.

**Las dos salidas, y por qué ninguna es gratis:**

- **Escribirles el `can()` / `has_permission()` que falta.** Correcto en el papel, pero
  `mesas.cobrar` y `caja.abrir` empezarían a gatear **en vivo, sobre clientes actuales**, con
  roles que hoy no los tienen sembrados de forma consistente (ver la divergencia 16/20/18/23
  del inventario de R1). Es un cambio de comportamiento disfrazado de arreglo, y el que se
  queda afuera es un cajero en pleno turno.
- **Sacarlos del catálogo.** Es lo barato y probablemente lo correcto —un permiso que no
  gatea es una promesa falsa— pero cambia lo que el cliente ve en la pantalla de Roles. Va en
  **commit propio y avisado**, nunca de arrastre con el generador de `seed_system_roles`.

**La regla que deja, que es lo que hay que retener:** un permiso nuevo **no está terminado
cuando se agrega al catálogo; está terminado cuando existe el gate que lo consume**. El
catálogo es la promesa; el `can()` es la cosa real. Es R4 —verificar contra la cosa, no
contra el proxy— aplicada al RBAC: que la clave figure en `PERMISSION_GROUPS` es exactamente
el tipo de proxy que dice OK sin que nada funcione.

### 🔴 A (permisos de cobro): `profiles.role` y `profiles.role_id` pueden divergir (anotado 2026-10-07)

**La clase.** Dos columnas deciden cosas distintas del mismo usuario y nada en el servidor las
ata: `role` (el enum viejo) decide quién entra a `/m` y quién cobra (`get_my_role()` en
`register_pos_sale` / `register_sale_payment`, `ROLES_QUE_COBRAN` en `src/lib/posMovil.ts`);
`role_id` decide los permisos (`has_permission`: fiado, descuento, anular…). Si divergen, alguien
**entra a `/m` sin fiado** (el servidor le rechaza la venta fiada) o **tiene fiado y no puede
cobrar**. No hay error en ningún lado: es fallo silencioso.

**Lo que ya cierra B (`feat/m1-fiado`):** la app escribe los dos en la misma llamada con
`rolLegacyDeRol` (`src/lib/rolLegacy.ts`) — al crear (`create-user`) y al cambiar el rol en la
lista de usuarios (antes este camino escribía solo `role_id`). Además, en B: la fila de la lista
muestra lo que devolvió la base apenas se guarda (antes mostraba el rol anterior hasta la recarga
y un segundo cambio se perdía sin aviso), y un rol personalizado da `'waiter'` — falla cerrado —
en vez de `'cashier'` (se cambió el 2026-10-08 con 0 perfiles activos con rol personalizado en
prod). Lo vigila `tests/usuarios-cambio-rol.spec.ts`.

**Lo que queda abierto, para A:**
- **La Edge Function `create-user` no compara `role` con `role_id`.** Recibe los dos del
  navegador y acepta cualquier par. Requiere `usuarios.gestionar`, así que el que puede
  desalinearlos es un admin llamándola directo, no un cajero.
- **Un usuario creado desde el Dashboard de Supabase nace sin `role_id`.** `handle_new_user`
  toma `role` de la metadata (`'waiter'` si no viene) y no asigna rol RBAC: el usuario no tiene
  ningún permiso de los nuevos, aunque su `role` diga `cashier`.
- **Cualquier escritor futuro de `profiles`** (un seed, un script, una RPC) que toque una sola
  de las dos columnas. Es la forma de R1: el sincronizador es quien se acuerde.

**✅ DECIDIDO (2026-10-08): SIN trigger. En A, `/m` y el cobro pasan a PERMISOS y
`profiles.role` deja de decidir.**
- Se descartó un trigger de `profiles` que derive `role` de `role_id`: **R6 — un trigger de
  invariante VALIDA, no fuerza.** Derivar reescribe en silencio lo que mandó el llamante.
- Tampoco se vigila la pareja: se **elimina la razón de vigilarla**. Quién entra a `/m` y quién
  cobra pasa a `has_permission('pos.vender')` (POS y `/m`) / `has_permission('mesas.cobrar')`
  (Mesas), en el servidor (`register_pos_sale`, `register_sale_payment`) y en el cliente
  (`ROLES_QUE_COBRAN` / `puedeCobrar` en `src/lib/posMovil.ts`). Con eso los dos caminos de
  arriba dejan de importar para cobrar, y la traducción por NOMBRE de rol (`rolLegacyDeRol`,
  que hoy es una allowlist de los 4 roles de sistema) queda sin consumidores que decidan.
- Hasta A, la coherencia la sostienen solo los dos caminos de la app; la consulta de abajo
  detecta lo que entre por otro lado.

**Para detectar casos hoy** (solo lectura, por organización — fijar el UUID):

```sql
select p.full_name, p.email, p.is_active, p.role::text as rol_viejo, r.name as rol_rbac,
       (r.id is not null and r.organization_id = s.organization_id
        and p.role::text = case when r.name in ('owner','admin') then 'admin'
                                when r.name = 'mozo' then 'waiter' else 'cashier' end) as coherente
  from public.profiles p
  join public.restaurants s on s.id = p.restaurant_id
  left join public.roles r on r.id = p.role_id
 where s.organization_id = '<uuid de la organización>'
 order by coherente, p.is_active desc, p.full_name;
```


- **Regenerar `database.types.ts` con `supabase gen types`** cuando se resuelva el acceso
  de management del CLI. Hoy la entrada de `register_sale_payment` (Functions) está agregada
  **a mano** pero VERIFICADA idéntica a lo que genera el CLI (mismo shape que
  `register_purchase`/`register_debt_payment`, posición alfabética correcta, `Views<>`
  preservado, tsc 0). El `supabase gen types --linked` falla con 403: la cuenta del CLI no
  tiene privilegios de management sobre el proyecto (es permiso de cuenta, no la password).
  Al resolverlo, correr `supabase gen types typescript --linked --schema public > src/types/database.types.ts`
  y confirmar diff nulo.
- **RPC de cierre de turno con recompute server-side del esperado (endurecimiento):** hoy el
  cierre es un UPDATE cliente que confía en el esperado calculado en el navegador desde
  `salesSummary` (paridad con F1) y lo congela en `close_reconciliation`. Endurecimiento
  futuro: mover el cierre a una RPC SECURITY DEFINER que **recompute el esperado por método
  desde `payments` en la ventana `[opened_at, closed_at]`** (server-authoritative), evitando
  confiar en el cliente. Requiere acotar la ventana con cota superior (hoy `getShiftPayments`
  no la tiene; ver el bug de ventana temporal que motivó el snapshot). Junto a la deuda de
  pasar los gates de enum a `has_permission`.
- **SELECT de `profiles` es por sede activa** (RLS `restaurant_id = get_my_restaurant_id()`):
  las listas org-wide (asignar usuarios a sedes, conteo de usuarios por rol) solo ven
  usuarios de la sede activa. Con 1 sede coincide con toda la org; al haber multi-sede
  real hay que ampliar ese SELECT a nivel organización.
- **Edge Function `create-user`: el GATE ya es por permiso** (corregido 2026-10-08; esta nota
  decía que validaba `role === 'admin'`, y era falso al menos desde `bbf75ff`, 2026-07-31). Hoy
  exige `has_permission('usuarios.gestionar')` con el cliente del llamante, y `is_active`. Lo que
  sí sigue dependiendo del enum: **recibe `role` del navegador** y lo pasa en la metadata a
  `handle_new_user` — es uno de los caminos de la entrada *"A (permisos de cobro): `profiles.role`
  y `profiles.role_id` pueden divergir"*. Para reconfirmar:
  `grep -n "has_permission\|includes(role)" supabase/functions/create-user/index.ts`.
- **Política vieja `"restaurants: admin actualiza"` (por enum `get_my_role()`)**: debe
  quitarse al eliminar el enum `role` (queda redundante con `"restaurants: editar sede
  con permiso"`).
- **Verificación en navegador pendiente:**
  - Gating RBAC con cuenta `cajero` (Andrés) vs `owner` — sidebar, rutas y botones
    (descuento, anular, cerrar turno, configurar mesas, delivery, secciones Sedes/Roles).
    Con `owner` se ve todo.
  - Delivery v2: kanban de 3 columnas, scroll independiente por columna, indicador de
    urgencia (≥30 min), botones de llamar/mapa.
  - Venta en espera: pausar/retomar múltiples ventas, diálogo de 3 opciones al retomar
    con carrito activo, descartar con confirmación.
- **`pos.anular` aplicado a "Vaciar carrito"** en el POS (no hay botón "anular venta"
  dedicado). Revisar si el target es el correcto al construir la anulación de ventas.
- **Devolver stock al borrar ítem de mesa (inventario):** al borrar un `order_item` ya
  agregado (ver el TODO en `handleDeleteItem`, `TablesPage.tsx` — citado por SÍMBOLO: el número
  de línea ya se movió una vez), NO se devuelve el stock que descontó al
  agregarse → el inventario queda subestimado. Pendiente (pasada aparte): función SQL de
  reverso `return_stock_for_order_item(p_id)` SECURITY DEFINER que emita
  `stock_movements('return', +qty)` por producto (simple), insumos (composite vía
  product_components) y los insumos de extras vinculados ANTES de borrar la línea,
  reflejando la lógica de deducción. Caso borde: receta cambiada entre venta y borrado.
  Solo aplica a ítems no enviados a cocina (los únicos borrables hoy).
- **Disponibilidad derivada de productos compuestos en POS — OMITIDA por ahora:** el
  indicador de stock del POS solo aplica a productos `simple` con tracking. Los compuestos
  no muestran disponibilidad (exigiría cargar recetas en el POS y calcular el mínimo por
  insumo). Pendiente si se requiere.
- **BUG DE RAÍZ pendiente (observado, no exclusivo de G-Vento):** la caja debe ser POR SEDE
  y hay que **validar que no exista un turno abierto antes de abrir otro** (evitar dos
  turnos simultáneos). Revisar el flujo de apertura de caja con esta regla.
- ⚠️ **`order_items.modifiers` (jsonb) está MUERTA — no la uses "porque está ahí".**
  Existe en el esquema (`schema.sql:153`, `not null default '[]'`) y aparece en la lista
  de columnas de `ORDER_WITH_RELATIONS` (`supabase-helpers.ts`), pero **cero CONSUMOS**: ningún
  componente la lee ni la setea. (Sí viaja en ese SELECT — por eso "cero lecturas" sería
  falso; lo que no existe es código que use el valor.) Se creó
  pensando en modificadores estructurados y **ese rol lo ocupó `extras`**, que sí tiene
  tablas propias (`extras`, `product_extras`, `order_item_extras`), precio con snapshot y
  descuento de inventario por insumo vinculado.
  **La columna correcta para una observación de cocina es `order_items.notes` (text)**,
  que está cableada de punta a punta: captura (POS y picker de Mesas), persistencia,
  **comanda impresa** (`printer.ts`, indentada bajo su línea), recibo de venta, KDS (con
  `⚠`), panel de mesa y tarjeta de delivery.
  Meter texto libre en `modifiers` sería peor que en `notes`: jsonb sin forma ni
  validación, y el filtro de PII lo colapsa a `[Filtrado:array(n)]` en Sentry (los arrays
  bajo clave desconocida no se recorren — ver el bloque del allowlist), así que además
  perderías el diagnóstico. Se anota porque es exactamente el tipo de columna que alguien
  "descubre" a los seis meses y cree que hay que empezar a usar.
- **Delivery: NO hay captura de dirección ni teléfono, y es una DECISIÓN del cliente
  (2026-08-10), no una deuda.** Los domicilios se reciben por WhatsApp y se cargan al POS
  solo como venta; esta pantalla es para **despachar** (mover el pedido por los 3 estados).
  Que la tarjeta diga "Cliente sin nombre" y sin dirección es el estado ESPERADO.
  - `delivery_address` y `customer_phone`: **cero escrituras** en toda la app (verificado).
  - `customer_name` se escribe **solo en la venta a fiado** (`POSPage` → `handleConfirm`,
    y `setOrderFiado` en `supabase-helpers`). Una venta de delivery de contado lo deja NULL.
  - Los botones "Llamar" y "Mapa" **YA NO EXISTEN**: se eliminaron en `5e8d864`
    ("inalcanzables por diseño"), porque dependían de esas dos columnas. No los busques.
  Lo único abierto de esta pantalla es **cosmético**: el chip "N activos" de la barra
  superior, que se solapa con "N nuevos" (`activeCount = nuevos + en camino`, así que con 0 en
  camino los dos números coinciden por casualidad) y además repite el contador que cada columna
  ya muestra en su badge.

### Testing — laboratorio (LAB) MONTADO

🔴 **LAB es una ORGANIZACIÓN más dentro de la BD compartida, y NO es un cliente que
  pague.** Es el laboratorio. Importa para todo lo que trate a las organizaciones como
  cuentas comerciales —empezando por el estado de suscripción que escribe G-Centro—:
  LAB existe justamente para que G-Centro pueda probar el circuito completo sin tocar
  clientes reales, así que **nunca debe entrar a un cobro, a una métrica de negocio ni a
  un conteo de clientes activos.**
  🔄 **Actualizado 2026-08-31: ahora son CINCO organizaciones, no tres.** Clientes reales:
  **G-10, Salchimelo y Café Aroma**. Laboratorio: **LAB** y **LabCentro** — esta última creada
  con `labcentro-org.sql` para que G-Centro pueda vincular un segundo contrato; solo tiene la
  fila de `organizations`, sin sede ni usuarios, así que nadie puede iniciar sesión ahí.
  La tabla con el origen de cada una está en `CLAUDE.md` → *"Las organizaciones de la BD"*.
  Los UUID se obtienen con la query del encabezado de
  `supabase/organization-subscription.sql` (no se hardcodean acá: se leen de la BD).
- 🔴 **CORREGIDO EL 2026-08-31 — acá había TRES afirmaciones falsas sobre el aislamiento
  del laboratorio, y las tres tranquilizaban.** Decía "(Supabase separado de producción)",
  "el backend (`VITE_GVENTO_*`) apunta al Supabase del lab" y "los health checks lo
  impiden". **Ninguna de las tres era cierta como estaba escrita.** Lo notable: el repo ya
  contenía la verdad en tres lugares —`tests/README.md` ("vive en el **mismo** Supabase que
  la app"), `.env.test.example` ("⚠️ La BD es UNA sola") y `create-user.spec.ts` ("la BD es
  UNA sola; el service role de este proyecto es también el de G-10 y Salchimelo")— y el único
  archivo que decía lo contrario era **este**, el de planificación, o sea el que se lee al
  decidir. Ver la clase en `CLAUDE.md` → *"una nota que declara una protección inexistente"*.

- **✅ Laboratorio listo.** Existe la organización **LAB** con **2 sedes**, los usuarios
  **owner.test** (rol owner) y **cajero.test** (rol cajero) con sus profiles, y productos de
  prueba. La suite E2E corre contra LAB de forma determinista.

- 🔴 **CUÁL ES EL AISLAMIENTO REAL.** LAB vive en el **MISMO proyecto Supabase que
  producción** — la misma base que G-10, Salchimelo, Café Aroma y LabCentro. **No hay
  separación de base de datos.** El aislamiento es **por ORGANIZACIÓN**, y descansa en dos
  cosas:
  1. **RLS**, que acota cada consulta a la organización del usuario autenticado.
  2. **Las credenciales de `.env.test`**, que son de usuarios de LAB.

  Corolario que hay que tener presente: **una falla de RLS no es un bug de aislamiento del
  lab, es una fuga entre clientes.** No hay una segunda barrera detrás.

- **Credenciales en `.env.test`** (gitignored): `E2E_OWNER_EMAIL/PASSWORD`,
  `E2E_CASHIER_EMAIL/PASSWORD`, `E2E_WAITER_*`. **`.env.test` NO define
  `VITE_GVENTO_SUPABASE_URL`** — el dev server que levanta Playwright lee `.env`, o sea el
  backend de PRODUCCIÓN. Verificable: `grep VITE_GVENTO .env.test` no devuelve nada.
  Ver `.env.test.example`.

- ⚠️ **`E2E_SERVICE_ROLE_KEY` BYPASSEA EL RLS**, que es la barrera principal. Con la BD
  compartida, esa key es la de TODAS las organizaciones, no "la del lab" (ya está advertido
  en `.env.test.example` y en `create-user.spec.ts`). Hoy la usan **dos** specs, las dos
  acotadas por id: `create-user.spec` (borra el usuario de prueba que ella misma creó) y
  `suscripcion-estado.spec` (un `update ... .eq('id', orgId)` de LAB para probar el CHECK).
  Reconfirmar con `grep -rn SERVICE_ROLE tests/`. Un spec nuevo que la use sin `.eq()`
  acotado escribe sobre datos de clientes reales sin que nada lo frene.
- **Doble health check en `tests/global-setup.ts`** (defensa en profundidad):
  (1) la app servida en el puerto dedicado **5180** es G-Vento (no otra app);
  (2) **las credenciales pertenecen a la org LAB** — hace login real, consulta
  `organizations` (RLS solo deja ver la propia) y ABORTA la suite si no es LAB.
  ⚠️ **Qué impide y qué NO.** Impide que la suite mute los datos de **otra organización**:
  si `.env.test` tuviera credenciales de G-10, el check aborta. **NO impide** correr contra
  la base de datos de producción — no la mira, y de hecho SIEMPRE se corre contra ella
  (`.env.test` no define la URL). Y no cubre lo que pase por `E2E_SERVICE_ROLE_KEY`, que
  saltea el RLS. Es una protección real y acotada; escribirla como "impide correr contra
  producción" es lo que la volvía una garantía falsa.
- **`retries: 0` por defecto** (lab determinista; un fallo es un fallo limpio que se
  investiga). Override puntual con `E2E_RETRIES=N`.
- **Suites pendientes de correr en el lab:** `tests/extras.spec.ts`,
  `tests/extras-pos.spec.ts` (incl. sobreventa con stock negativo),
  `tests/ventas-historial.spec.ts`, `tests/inventario.spec.ts`. Compilan
  (`playwright test --list`; eran 71 al 2026-06-24 y **202 al 2026-08-26** — correr el
  comando, no leer el número). `rbac.spec.ts` ya se corre verde contra el lab.
- **Los flujos de caja y mesas mutan estado** — los specs limpian tras de sí, pero
  pueden acumular residuos entre corridas (p. ej. mesas ocupadas). `closeShiftIfOpen`
  cierra la caja del lab. Ver tests/README.md.
- 🔴 **EL LAB NO ES DETERMINISTA ENTRE CORRIDAS, y el modo de fallo es que un spec
  tumbe a OTRO.** No alcanza con que cada spec limpie: alcanza con que UNO no limpie.
  **Evidencia medida (2026-08-19), no teórica:** la limpieza de
  `numeracion-fallo.spec.ts` no limpiaba nada y no fallaba —fallaba en silencio—, así
  que cada corrida dejaba viva una categoría `E2E NumFail ...`. Con **5 acumuladas**, el
  strip de categorías del POS empujó el carrito fuera de pantalla y **tumbó 3 tests
  ajenos** (`pos.spec.ts:12`, `venta-espera.spec.ts:21` y `:37`), que fallaban por
  residuo que no era de ellos. Se perdió una tarde diagnosticando el spec equivocado.
  Consecuencias prácticas:
  - **Ante un rojo en un spec que no tocaste, sospechá del ESTADO antes que del código.**
    El discriminador barato: `git stash -u` y correr el mismo spec sobre el árbol limpio.
    Si falla igual, no es tu cambio.
  - Una limpieza **sin aserción es indistinguible de una que no corre**. Toda limpieza
    termina verificando que lo que borró ya no está.
  - Ojo con las confirmaciones: en esta app "Desactivar" un producto abre un **modal
    propio con botón "Sí, desactivar"**, NO un `window.confirm` nativo. Un
    `page.on('dialog')` esperando el nativo no dispara nunca y el paso se salta en
    silencio — eso es exactamente lo que pasó acá. Y la app **rechaza desactivar una
    categoría con productos activos**, así que el orden es: productos primero, categoría
    después.
  - Cuando el lab se ensucia igual, barrer el residuo es legítimo: son datos de prueba.
    Verificar con `select name, is_active from categories where name like 'E2E %'`.
- ⚠️ **HAY UN SOLO LAB, ASÍ QUE LAS CORRIDAS DE DISTINTAS RAMAS SE HEREDAN ENTRE SÍ.**
  Correr la suite sobre `main` (p. ej. para validar un cherry-pick antes de promover) deja
  LAB en el estado que produjo **el código de main**, y la siguiente corrida de `develop`
  arranca desde ahí. Los specs no lo notan mientras cada uno limpie lo suyo —por eso
  importa el punto anterior—, pero es la primera hipótesis a revisar si aparece un rojo
  raro justo después de haber probado otra rama. **No es problema hoy; está escrito para
  que no se diagnostique el código cuando la causa es de qué rama vino el estado.**
  Aplica igual a `git stash` + correr: lo que quede en LAB no se revierte con el árbol.

