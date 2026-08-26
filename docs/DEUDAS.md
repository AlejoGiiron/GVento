# G-Vento — DEUDAS e IDEAS

Dos cosas distintas que conviene no confundir:

- **Ideas de producto** — evaluadas y **conscientemente pospuestas**. NO son backlog, no
  están aprobadas y **no se empiezan a construir por encontrarlas escritas acá**.
- **Deudas vigentes** — cosas que YA rompen algo o que van a costar caro, con su punto de
  partida para retomarlas.

Se consulta **al planificar**, no antes de cada cambio.

---

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
- **Edge Function `create-user` valida enum `role === 'admin'`**: cambiar a
  `has_permission(...)` cuando se elimine el enum `profiles.role`.
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
  un conteo de clientes activos.** Los clientes reales son G-10 y Salchimelo.
  Los UUID de las tres organizaciones se obtienen con la query del encabezado de
  `supabase/organization-subscription.sql` (no se hardcodean acá: se leen de la BD).
- **✅ Laboratorio listo.** Existe la organización **LAB** (Supabase separado de
  producción) con **2 sedes**, los usuarios **owner.test** (rol owner) y
  **cajero.test** (rol cajero) con sus profiles, y productos de prueba. La suite
  E2E corre contra LAB de forma determinista. **NUNCA correr E2E contra producción**
  (org G-10): los health checks lo impiden.
- **Credenciales en `.env.test`** (gitignored): `E2E_OWNER_EMAIL/PASSWORD` y
  `E2E_CASHIER_EMAIL/PASSWORD`. El backend (`VITE_GVENTO_*`) apunta al Supabase del
  lab. Ver `.env.test.example`.
- **Doble health check en `tests/global-setup.ts`** (defensa en profundidad):
  (1) la app servida en el puerto dedicado **5180** es G-Vento (no otra app);
  (2) **las credenciales pertenecen a la org LAB** — hace login real, consulta
  `organizations` (RLS solo deja ver la propia) y ABORTA la suite si no es LAB.
  Esto evita correr tests (que mutan estado) contra datos reales.
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

