# G-Vento — Plan para dejarlo completamente funcional

*Actualizado el 30 de septiembre de 2026 · `develop` publicado en `723124f` + merge local de `product-images` (`f0143ce`) · suite en Docker 238/238 en la rama de D*

> **Cómo leer las fechas de este documento:** todo estado tiene fecha. Para saber el estado de HOY, los comandos de verificación están en `docs/DEUDAS.md` y en el encabezado de cada `.sql`; este plan los resume, no los reemplaza.

---

## Qué significa "completamente funcional"

**Cerrar todo defecto y hueco conocido.** No agregar producto nuevo. Al terminar, G-Vento puede vivir en mantenimiento puro —solo se toca si algo se rompe— mientras G-Nexo recibe el tiempo.

**Excepción decidida el 21/09: el POS móvil web.** Nació de un dolor real (el evento de G-10 terminó vendiendo en papel) y tiene su propio carril más abajo. Comparte prerequisitos con este plan (cobro, cierre de turno), por eso se ordenan juntos.

Fuera de este plan, a propósito: DIAN, app nativa e ideas de producto (margen, merma, pedidos entre negocios).

**Unidad de medida: sesiones de trabajo.**

---

## Resumen del avance (30/09)

| Bloque | Estado |
|---|---|
| 0 — Limpiar el mapa | 🟢 4 de 6 cerrados; quedan dos de minutos (0.2, 0.3) |
| 1 — Cerrar lo que engaña | 🟡 1.3 hecho; 1.1 y 1.2 pendientes |
| 2 — Usuarios | 🔴 sin empezar |
| 3 — Dinero | 🟡 3.6 construido, se despliega esta semana; resto pendiente |
| 4 — Confianza | 🔴 sin empezar |
| 5 — Higiene | 🟡 5.10 cerrado, 5.6 desbloqueado |
| **Fuera del plan** | 🟢 mucho cerrado en el camino (ver sección propia) |
| **POS móvil** | 🟡 prerequisitos en curso; M1 todavía no empezó |

---

## Los bloques

### Bloque 0 — Limpiar el mapa

| # | Qué | Estado |
|---|---|---|
| ~~0.1~~ | ~~Commitear la sesión del 2/09~~ | ✅ Hecho (11/09). |
| 0.2 | **Los 3 hallazgos del pipeline** | ⚠️ Pendiente, no confirmado. Se cierra con **una línea** en `DEUDAS.md` que apunte al encabezado de `preparar-local.mjs`, no con otra copia (R1). |
| 0.3 | **Tres notas falsas en `RESUMEN-GENERAL.md`** (turnos simultáneos, suite E2E, `ventas.anular`) | ⚠️ Pendiente, no confirmado. El Paso A corrigió `CLAUDE.md` y `BITACORA`, no este archivo. |
| ~~0.4~~ | ~~Las dos verificaciones~~ | ✅ Hecho (11/09). |
| ~~0.5~~ | ~~Cabecera de `CLAUDE.md` + "Estado actual" de `BITACORA`~~ | ✅ **Hecho (21/09, `20efbc2`).** La cabecera describe lo que da `ls`; el POS móvil está declarado como ruta `/m`, no React Native. `BITACORA` remite a comandos en vez de una foto. Además se corrigió `.claude/commands/commit.md`, que era lo que volvía a crear la foto desactualizada. |
| ~~0.6~~ | ~~`CLAUDE.md` → R1, inventario #1~~ | ✅ **Hecho (21/09).** Tabla fuente / generado / regenerar / tripwire, con los comandos. `CLAUDE.md` y el hook ya no se contradicen. En la rama de D se sumó al inventario R1 la fórmula del arqueo (`shiftCalc.ts` + SQL). |

**Cierre:** cuando 0.2 y 0.3 estén hechos.

---

### Bloque 1 — Cerrar lo que engaña · 1 sesión

| # | Qué | Estado |
|---|---|---|
| 1.1 | **Confirmar que el registro público está apagado** (Dashboard → Auth → Providers → Email) | ⚠️ Pendiente. Un clic tuyo; no se ve desde el repo. |
| 1.2 | **Los 6 permisos que no gatean nada** — `pos.vender`, `caja.abrir`, `mesas.cobrar`, `productos.ver`, `reportes.stock`, `reportes.consolidado` | ⚠️ Pendiente. **Ahora se conecta con el POS móvil:** si los meseros cobran desde el celular, `register_sale_payment` pasa de `get_my_role()` a `has_permission`, y eso cablea `mesas.cobrar` / `pos.vender`. |
| ~~1.3~~ | ~~Promover `develop` → `main`~~ | ✅ Hecho (07/09). |

---

### Bloque 2 — Usuarios: el flujo roto · 3-4 sesiones · sin empezar

| # | Qué |
|---|---|
| 2.1 | **Onboarding desde el panel**: Edge Function `crear-organizacion` (org + sede + roles → cuenta Auth → profile). Por UUID, idempotente, secreto HMAC propio, nunca adjuntar owner a una org preexistente. |
| 2.2 | **Pantalla de establecer / recuperar contraseña.** No existe ninguna. |
| 2.3 | **Invitación por correo** (después de 2.2). |
| 2.4 | **Bloqueo en `auth.users` al desactivar.** |

**Cierre:** un cliente nuevo se crea desde G-Centro sin SQL, elige su contraseña, y un desactivado no vuelve a entrar.

---

### Bloque 3 — Dinero · 3 sesiones restantes

| # | Qué | Estado |
|---|---|---|
| 3.1 | **Baja de cartera** (fiado incobrable) | Pendiente. Chico. |
| 3.2 | **Devoluciones** | Pendiente. La anulación ya rechaza ventas de turnos cerrados con "para corregirla se necesita una devolución", así que la promesa sigue en pie. Medio. |
| 3.3 | **Abonos invisibles en el tab Financiero** | Pendiente. **Bloqueado por tu decisión** (ver abajo). |
| 3.4 | **`payment_status DEFAULT 'paid'`** | Pendiente. Medio, con cuidado. |
| 3.5 | **Borrar un ítem de mesa no devuelve stock** | 🔴 **Ubicado (01/10)** por el inventario de escrituras directas: `handleRemoveItem` en `TablesPage` borra la línea con `removeOrderItem` (DELETE directo en `order_items`) y ajusta el total, **sin devolver el stock** que `add_order_items_with_extras` descontó al agregarla. El TODO está en el propio handler. Salida: una RPC que devuelva el stock antes de borrar (DEUDAS → fila de `order_items`). Va con el endurecimiento, después de M1. |
| 3.6 | **Carrera en el cierre de turno** | 🟡 **Construido (`feat/close-cash-shift`, `97b328e`, 238/238). Se despliega en fases esta semana.** Ver detalle abajo. |

#### 3.6 en detalle (D)

**Qué hace:**
- **`close_cash_shift`:** el servidor calcula y congela el esperado, las ventas y los vales.
- **Un solo protocolo de locks para los cinco caminos que cambian las cifras de un turno:** el primer lock siempre es la fila del turno. Los cinco son el trigger de movimientos, los dos abonos, la anulación y, con el cambio (1), el cobro.
- **Se revoca el `UPDATE` directo** sobre `cash_shifts` para `authenticated` y `anon`.

**Cómo se probó:**
- El escenario medido el 21/09, más una carrera forzada por cada escritor.
- Los cinco caminos a la vez, 10 veces, sin deadlock.
- Mutantes: el cliente viejo congela 100.000 en vez de 89.423, el bug exacto.

**Por qué en dos fases:** si se aplicara de una sola vez, habría un rato en el que nadie podría cerrar turno.

**Calendario:**

| cuándo | qué | quién |
|---|---|---|
| 1/10, temprano | Release de `develop` → `main` (lo de hoy + product-images, **sin D**) y mensaje a clientes | Alejandro |
| 1/10, antes de que abra G-10 | Fase 1: `close-cash-shift.sql` **del commit `3339978`** (rama `feat/close-cash-shift`: guard contra el re-apply, y el trigger de `cash_movements` cubre DELETE y el turno viejo; suite 240/240 el 30/09) + consultas de verificación | Alejandro |
| 2/10, temprano | Si la fase 1 anduvo un día sin problemas: merge de D + (1), suite, release, mensaje de "recarguen la página"; **justo después del release, `cobro-turno.sql`** | Claude Code merge, Alejandro release y SQL |
| 3/10 | Fase 2: `close-cash-shift-revoke.sql` + verificación (0 filas de UPDATE) | Alejandro |
| después del release | Prueba real en Café Aroma: abrir turno, venta en efectivo, gasto, cerrar | Alejandro |

**Si una pestaña vieja intenta cerrar después de la fase 2:** "Error al cerrar el turno", el turno sigue abierto y no se congela nada equivocado. Se arregla recargando.

---

### Bloque 4 — Confianza · 2-3 sesiones · sin empezar

| # | Qué |
|---|---|
| 4.1 | **Filtro de datos personales en Sentry:** 2b → 2a → los 75 tests con aserciones vacías → encabezado de `sentry.ts`. |
| 4.2 | **Las 5 skills:** `sql-riesgoso`, `defecto-de-clase`, `spec-e2e`, `rbac-permisos`, `demo-en-vivo`. |

---

### Bloque 5 — Higiene · se intercala

| # | Qué | Estado |
|---|---|---|
| 5.1 | Auditoría de encabezados `.sql` | Pendiente. Esta semana se vio dos veces un `.sql` que decía "verificado" antes de verificarlo; Claude Code lo corrigió las dos. La clase sigue viva. |
| 5.2 | `.gitattributes` con `eol=lf` | Pendiente. El aviso de CRLF sigue saliendo en cada commit. |
| 5.3 | Los 6 errores de eslint preexistentes | Pendiente. |
| 5.4 | Imágenes fuera del backup | Pendiente. **Bloqueado por tu decisión.** |
| 5.5 | Concepto de organización de prueba (`es_laboratorio`) | Pendiente. |
| 5.6 | **Ledger de migraciones** | 🔴 **PRIORIDAD SUBIDA (01/10):** es la protección MECÁNICA de la clase "re-aplicar un archivo viejo revierte en silencio". Hay 12 funciones expuestas, 5 de seguridad (DEUDAS → *"Re-aplicar una migración vieja revierte en silencio"*). Hasta tenerlo, la regla es de proceso (CLAUDE.md, R5: en prod nunca se re-aplica un archivo). 🟢 **Desbloqueado (30/09).** El orden de migraciones de `preparar-local` arma una base **igual a producción**, medido con la herramienta de deriva y no solo "corrió sin error". Antes no lo era: aplicaba una versión vieja de `add_order_items_with_extras` y la base local vendía sin descontar stock. Listo para sembrar `schema_migrations`. |
| 5.7 | Multi-sede real | Pendiente (latente). |
| 5.8 | Disponibilidad de compuestos en el POS | Pendiente. |
| 5.9 | Landing y manual | Pendiente. |
| ~~5.10~~ | ~~Los dos flakes~~ | ✅ **Hecho (30/09).** No eran residuo de LAB: eran **errores de producto que fallaban en silencio**. `pago-mixto` agregaba un producto con extras sin abrir el modal mientras cargaba. `vale-descuento` mostraba $0 mientras cargaba. Arreglados en el producto, con tests que fallan contra el código viejo. |

---

## Hecho fuera del plan (21/09 – 30/09)

Lo que apareció en el camino y se cerró. Va acá para que no se pierda.

| Qué | Por qué importa |
|---|---|
| **La suite corre en Docker** (`pnpm e2e:preparar` + `pnpm test:e2e`) y **aborta si la URL no es local** (allowlist de hosts) | Ningún test puede volver a escribir en la base de los clientes con la llave de servicio. |
| **`.env.test` sin ninguna clave de la nube.** Se revisó el historial: nunca estuvo en git. | La service role, las contraseñas de LAB y el HMAC real ya no viven en disco. |
| **Herramienta de deriva** (`deriva-esquema.sql` + `pnpm deriva:comparar`): **0 diferencias** con prod | Una suite verde en Docker ahora significa lo mismo que en producción. Cubre funciones, policies, triggers (también de `auth`), event triggers, constraints, índices, columnas, grants, buckets y privilegios por defecto. |
| **Reconciliación repo ← prod** (`reconciliar-con-prod.sql`) | Producción tenía cosas aplicadas a mano que el repo no tenía: policies de Storage, el bucket `restaurant-logos`, `rls_auto_enable` y revokes a `anon`. No se aplica en prod; allá no cambia nada. |
| 🔴 **Hueco entre negocios en `restaurant-logos`** — aplicado en prod | Cualquier admin podía subir a la carpeta de otro negocio. No se encontró ningún archivo plantado. De paso se arregló que **no se podía cambiar el logo ni el QR de Nequi una segunda vez**. |
| 🔴 **Hueco entre negocios en `product-images`** — aplicado en prod | Un usuario de otra organización podía **reemplazar o borrar las fotos de producto** de otro negocio. 0 escrituras cruzadas encontradas. Ahora hay un test que sube, reemplaza y quita la foto **por la pantalla real** (antes ninguno lo hacía). |
| **23 tests que comprobaban la ausencia de algo antes de que la pantalla cargara** | Revisadas 106 aserciones de ausencia. 6 pantallas no distinguían "cargando" de "vacío": cierre de turno, historial de gastos, roles, sedes, movimientos y reportes. Por ejemplo, el cierre afirmaba "no hay domicilios pendientes" sin haberlos consultado. Corregidas en el producto. |
| **Service worker con allowlist** | Antes decidía qué cachear según si la URL contenía "supabase". En prod no cambia nada hoy, pero el POS móvil va a tener el suyo. |
| **La suite sin tests salteados** | Los 15 skips eran del contrato con G-Centro por falta del secreto. Ahora hay un secreto solo local y corren todos. |

---

## Deudas nuevas (descubiertas 21/09 – 30/09)

| Qué | Cuándo se hace |
|---|---|
| **Cambio (1) en `register_sale_payment`**: turno obligatorio con `for share`, lock de la orden. Exigir turno también en **abonos en efectivo**, avisándolo en el modal **antes** de recibir la plata. Abono de una sola venta con lock de la orden (dos abonos simultáneos pueden pasarse del saldo). | ✅ **Construido, se despliega el 2/10** (rama `feat/cobro-turno`; `cobro-turno.sql` justo después del release). Prerequisito de M1. |
| **Número de orden único** (`order-number-unique.sql`) junto con el arreglo de `next_order_number`. Sin ese arreglo, "Reintentar" no corrige nunca una venta sin número. | Después de D. No es urgente: 0 duplicados en toda la historia. |
| **Una mesa que tuvo ventas no se puede borrar nunca** (confirmado en prod). La pantalla deja intentarlo. Salida: archivar (`archived_at`), no cascade ni relajar el check. | Con M2. |
| **"Cerrar mesa sin consumo"**: dos escrituras no atómicas desde el cliente. Salida: RPC. | Precondición de M2. |
| **`anon` tiene escritura en las 29 tablas de `public`** (default de Supabase). Hoy lo contiene la RLS. | Bloque 5. Revocarlo en general puede romper lecturas públicas: medir antes. |
| **Comprimir y redimensionar fotos en el cliente.** Hoy la app rechaza fotos de más de 2 MB, que es lo normal en un celular. HEIC sin probar en iPhone. | Antes de M1. |
| **Límite de tamaño en el bucket `product-images`** (prod no tiene ninguno) | Después de la compresión en el cliente. |
| **Cómo forzar la actualización del service worker** en los celulares | Antes del release de M1. |
| **$48.000 de abonos en efectivo de Salchimelo fuera de todo arqueo** (31/08, 00:29) | Revisar en el historial de turnos si el turno siguiente tuvo un sobrante de ese monto. |

---

## POS móvil web — carril propio

**Qué es:** el POS desde el navegador del celular (`/m`, agregable a la pantalla de inicio), para bartenders y meseros. Barra, mesas y domicilios. Sin app nativa.

| Fase | Qué | Estado |
|---|---|---|
| Prerequisitos | Cambio (1) en el cobro · **query de B1 en prod** (`supabase/diag/pos-total-formula.sql`) · **`register_pos_sale` + `useSaleCheckout`**: la venta del POS en UNA transacción, idempotente, con la orden, los ítems, el pago y el número. Ya no es "sin cambio de comportamiento". **Despliegue: el SQL ANTES del frontend que la llama** (RPC nueva; las actuales no cambian) · compresión de fotos en el cliente | (1) ✅ construido, se despliega el 2/10 · `register_pos_sale`: diseño aprobado (01/10) |
| **M1 — Barra** | Ruta `/m` con `MobileShell` · manifest e íconos propios (192, 512, maskable, apple-touch 180) · `viewport-fit=cover` · más vendidos (automáticos desde `product_performance` + fijados en `restaurants.config`) · **sin "Cerrar turno" en `/m` hasta que D esté en prod** | No empezado |
| Demo | Café Aroma. Hacer una venta real 5 minutos antes; no cerrar turno en vivo | Después de M1 |
| **M2 — Mesas** | Necesita: la decisión sobre si los meseros cobran, archivar mesas, cerrar mesa sin consumo como RPC | Bloqueado por decisión |
| **M3 — Domicilios** | — | Después de M2 |

**Uso real en un evento de G-10 con varios celulares:** solo con D en producción.

---

## Decisiones que te esperan

1. **¿Los meseros cobran desde el celular?** Bloquea M2 y define 1.2. Recomendación: sí, con permiso asignado por persona y ligado al turno de la sede.
2. **¿Qué celulares usan en G-10, Android o iPhone?** Y los íconos para la pantalla de inicio. En iPhone hay que probar en un celular real la instalación, la pantalla siempre encendida y HEIC.
3. **Bloque 3.3:** ¿qué mide el tab Financiero, lo cobrado, lo vendido o ambos?
4. **Bloque 3.2:** devoluciones, ¿el stock vuelve siempre o se pregunta?
5. **Bloque 5.4:** ¿las imágenes entran al backup?
6. **DIAN** y **`restricted` / `suspended`:** sin cambios desde el 11/09.

## Tareas tuyas sin decisión de por medio

- 🔴 **Rotar el secreto HMAC de `aplicar-estado` con G-Centro.** El que usaban los tests quedó expuesto en el chat. Nuevo secreto con `openssl rand -hex 32` → Supabase Secrets → G-Centro por canal privado → confirmar 200.
- **1.1:** el clic del registro público.
- **El calendario de D** (tabla del 3.6).

---

## Estimación · revisada el 30/09

- **Plan de cierre (Bloques 1-4):** 9-11 sesiones. El Bloque 0 y el 3.6 casi salen de la cuenta; el Bloque 2 sigue siendo el más grande.
- **POS móvil hasta la demo:** 2-3 sesiones después de (1).

**Orden sugerido (actualizado 01/10):** semana de despliegue (1/10 a 3/10) → query de B1 → `register_pos_sale` + `useSaleCheckout` → compresión de fotos → **M1 y demo** → endurecimiento de escrituras directas (DEUDAS; el DELETE de `cash_movements` ya entró en la fase 1 de D) → Bloque 2 → Bloque 1 → Bloque 3 → M2 → Bloque 4. El Bloque 0 se intercala, porque le quedan minutos.

**Regla que sigue en pie:** cada bloque cierra con la suite completa en verde, **en Docker**, leyendo `PLAYWRIGHT_EXIT` del archivo. Y ahora también **con la deriva en 0**: un verde contra una base que no es la de producción vale menos.

---

## Lo que esta actualización NO verificó

- **0.2 y 0.3:** marcados pendientes porque ninguna sesión reportó haberlos hecho. Puede que alguno esté hecho.
- **"Una policy antigua de `restaurants` sigue viva":** la deriva compara repo contra prod, no responde si esa policy existe. Se verifica con `select policyname, qual from pg_policies where tablename = 'restaurants';`.
- **3.5:** ubicado el 01/10 (ver la fila del 3.5).
- **Si el HMAC se rotó:** se infiere que no por el prefijo, pero solo tú lo puedes confirmar.
