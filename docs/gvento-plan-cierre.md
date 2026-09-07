# G-Vento — Plan para dejarlo completamente funcional

*4 de septiembre de 2026 · Estado base: `develop` en d848852, 13 commits sobre `main`*

---

## Qué significa "completamente funcional"

**Cerrar todo defecto y hueco conocido.** No agregar producto nuevo. Al terminar, G-Vento puede vivir en mantenimiento puro —solo se toca si algo se rompe— mientras G-Nexo recibe el tiempo.

Lo que queda **fuera** de este plan, a propósito: DIAN (decisión estratégica, define mercado), responsive/móvil (proyecto grande, diagnosticado y pausado), y las ideas de producto (margen, merma, pedidos entre negocios). Todo eso tiene su lugar en el plan SaaS, no acá.

**Unidad de medida: sesiones de trabajo**, no días. El tiempo en G-Vento ahora es variable.

---

## Los bloques, en orden

Ordenados por **qué duele más si se deja**, con dependencias respetadas. Los bloques 2 y 3 son independientes entre sí y se pueden invertir.

### Bloque 0 — Guardar lo suelto y limpiar el mapa · 1 sesión

**Antes que nada.** Hay trabajo sin commitear y el propio resumen del proyecto arrastra estado muerto — un plan construido sobre notas viejas es un plan equivocado.

| # | Qué | Detalle |
|---|---|---|
| 0.1 | **Commitear la sesión del 2/09** | Pipeline de capturas para la landing (`scripts/capturas/`, `landing-seed.sql`, `config.toml`, `.env.capturas`, `capturas-landing/`). **Sin el `.zip` de 1.3 MB.** |
| 0.2 | **Pasar sus 3 hallazgos a `DEUDAS.md`** | `cash-movements.sql` con `create type if not exists` (inválido, nunca corrió entero) · `organization-subscription.sql` revienta si se ejecuta completo · el orden de 39 migraciones de `preparar-local.mjs` es el **primero verificado por ejecución**. |
| 0.3 | **Corregir las notas desactualizadas del resumen** | Turnos simultáneos: **hecho** (`idx_one_open_shift_per_store`). Suite E2E: **corrida el 31/08, 202/202**. `ventas.anular`: en el catálogo desde el generador — §7.3 describe `main`, no `develop`. |
| 0.4 | **Verificar dos afirmaciones que contradicen lo hecho** | ¿`create-user` conserva algún `role === 'admin'` residual? (lo cambiamos a `has_permission`). ¿Los 4 specs "nunca corridos" (`extras`, `extras-pos`, `ventas-historial`, `inventario`) están excluidos de la config, o la nota es vieja? |
| 0.5 | **Cabecera de `CLAUDE.md`** | Describe un monorepo (`apps/`, `packages/`) que no existe. G-Nexo lo encontró; acá no se corrigió. Y el bloque "Estado actual" de `BITACORA.md` describe agosto. |

**Cierre:** árbol limpio, y ninguna nota del proyecto afirma algo que el código contradiga.

---

### Bloque 1 — Cerrar lo que engaña · 1 sesión

Tres cosas chicas que mienten o desorientan si se dejan.

| # | Qué | Por qué ahora |
|---|---|---|
| 1.1 | **Confirmar que el signup público está apagado** (Dashboard → Auth → Providers → Email) | Un clic. `handle_new_user` confía en la metadata del usuario para el enum `role`; con signup abierto es un vector. Quedó pendiente de confirmar hace semanas. |
| 1.2 | **Los 6 permisos concedibles que no gatean nada** — `pos.vender`, `caja.abrir`, `mesas.cobrar`, `productos.ver`, `reportes.stock`, `reportes.consolidado` | **Falla abierto:** un admin destilda "Cobrar mesa" creyendo que quitó la capacidad, y el cajero sigue cobrando. Decisión: cablearlos (poner el `can()` donde corresponde) o quitarlos del catálogo. Cablearlos es lo correcto; quitarlos es lo rápido. |
| 1.3 | **Promover `develop` → `main`** | Saca el generador de RBAC al frontend (hoy la BD tiene 23 permisos y la UI conoce 22). Frontend puro, sin coreografía. Y `main` vuelve a ser la verdad — G-Nexo copia de `develop`, conviene que coincidan. |

**Cierre:** signup confirmado, los 6 permisos con decisión aplicada, `main` = `develop`.

---

### Bloque 2 — Usuarios: el flujo roto · 3-4 sesiones

**El que más duele si llega un cliente nuevo.** Hoy onboardear es SQL a mano, y el procedimiento documentado **está roto desde el 31/07**: `handle_new_user` exige `restaurant_id` en la metadata, y para una org nueva no hay sede todavía. Deadlock.

| # | Qué | Estado |
|---|---|---|
| 2.1 | **Onboarding desde el panel** — Edge Function `crear-organizacion` con el orden invertido: org + sede + roles → cuenta Auth con metadata → profile | Diseño hecho. `onboard-org-paso1/paso3.sql` existen. Resolver por UUID, no por nombre. Idempotencia por `idempotency_key` con unique. **Nunca adjuntar owner a org preexistente.** Secreto HMAC dedicado (emite credenciales, no es como `aplicar-estado`). |
| 2.2 | **Pantalla de establecer / recuperar contraseña** | **No existe ninguna.** Ni `updateUser`, ni `resetPasswordForEmail`, ni manejo de `PASSWORD_RECOVERY`. La única ruta pública es `/login`. Es la misma pantalla para ambos casos. |
| 2.3 | **Invitación de usuarios por correo** | Hoy el owner recibe la contraseña de vos. Con 2.2 hecha, la invitación manda a esa pantalla. |
| 2.4 | **Baneo en `auth.users` al desactivar** | Hoy un desactivado con sesión viva ve la app en blanco (P2 le quita los datos) pero el JWT sigue válido. Requiere Edge Function con service role. Pospuesto por diseño; se cierra acá. |

**Dependencia:** 2.2 antes de 2.3. 2.1 y 2.4 independientes.

**Cierre:** un cliente nuevo se crea desde G-Centro sin tocar SQL, recibe una invitación, elige su contraseña, y si se desactiva a alguien, no puede volver a entrar.

---

### Bloque 3 — Dinero: lo que el negocio necesita · 3-4 sesiones

Cosas que **ya hicieron falta** con clientes reales y se resolvieron a mano.

| # | Qué | Estado |
|---|---|---|
| 3.1 | **Baja de cartera** (fiado incobrable) | Se hizo a mano para la #187 marcándola `cancelled`, con el costo de que desapareció del reporte de Stock. Merece su propio concepto: cerrar la deuda con motivo y rastro, sin tocar stock ni caja. **Chico.** |
| 3.2 | **Devoluciones** | La RPC de anulación la promete en su mensaje de error y no existe. Alcance: venta real que se deshace después — el efecto va al turno de **hoy**, stock vuelve si el producto volvió. **Medio.** |
| 3.3 | **Abonos de fiado invisibles en el tab Financiero** | $1.131.200 cobrados que el reporte no ve, porque las vistas suman `payments` y los abonos viven en `debt_payments`. **Requiere decisión previa** (ver abajo). |
| 3.4 | **`payment_status DEFAULT 'paid'`** | Una orden nunca cobrada nace "pagada" y se vuelve invisible como deuda. Es lo que escondió las mesas abiertas. Rediseño de columna NOT NULL con datos vivos — **medio, con cuidado.** |
| 3.5 | **Borrar un ítem de mesa no devuelve stock** | Nuevo, del resumen. El inventario queda subestimado cada vez que un mozo quita algo de una mesa. Misma familia que la reversión por espejo de la anulación — probablemente reusa esa lógica. **Chico-medio.** |

**🔴 Decisión previa para 3.3, que solo vos podés tomar:** ¿qué mide el tab Financiero? Opción A — lo *cobrado* (agregar los abonos como línea propia, sin tocar las vistas de hora/mesero). Opción B — lo *vendido* (devengo: el fiado cuenta el día de la venta, los dos tabs por fin coinciden). Opción C — ambos. Mi inclinación era B, porque el arqueo ya responde la pregunta de caja. Pero es decisión de negocio.

**Cierre:** una deuda incobrable se da de baja desde Cartera; una devolución se registra sin tocar el turno viejo; el reporte financiero cuadra con lo que el dueño ve en caja.

---

### Bloque 4 — Confianza: Sentry y skills · 2-3 sesiones

| # | Qué | Estado |
|---|---|---|
| 4.1 | **Filtro de PII de Sentry** | Pausado con diagnóstico completo. Orden: **2b** (objetos no planos → `[Filtrado:Date]`, `Error` preserva `name`+`message`) → **2a** (`RE_CODIGO` rechaza 6+ dígitos, arrays en tags se redactan) → **3** (los 75 tests con aserciones vacuas, clase D primero: 58 que miden el colapso y no la columna) → **1** (reescribir el encabezado de `sentry.ts`). Antes de 2b: auditar si la app interpola PII en `throw new Error` propios. |
| 4.2 | **Fase C — las 5 skills** | `sql-riesgoso` · `defecto-de-clase` · `spec-e2e` · `rbac-permisos` · `demo-en-vivo`. Descriptions aprobadas. Convertir `nueva-tabla` y `componente` de command a skill. Regla: citan las reglas por número, **no las repiten**. |

**Cierre:** Sentry no fuga ni miente en el diagnóstico; el conocimiento del proyecto se carga solo.

---

### Bloque 5 — Higiene · 1-2 sesiones, se intercala

No bloquea nada. Se hace cuando hay un rato, o entre bloques.

| # | Qué |
|---|---|
| 5.1 | **Auditoría de ~40 encabezados `.sql`** — clase del caso #11. Convención: describen qué hacen y sus precondiciones, nunca si ya corrieron. La BD es la fuente. |
| 5.2 | **`.gitattributes` con `* text=auto eol=lf`** — cierra la clase del CRLF. Diff grande, commit propio. |
| 5.3 | **Los 6 errores de eslint preexistentes** — `KitchenPage.tsx:460`, `anular-venta.spec`, `arqueo.spec`, `create-user.spec`. CLAUDE.md los tiene anotados. |
| 5.4 | **Storage (imágenes de producto) fuera del ciclo de backup** — decidir si entran (rclone al S3 de Supabase) o queda como pérdida acotada documentada. |
| 5.5 | **Concepto de organización de prueba** — el resumen propone hacerlo **preventivo** (columna `es_laboratorio` + vista `organizaciones_facturables`) en vez de esperar la primera consulta cruzada. Con 5 orgs y G-Centro haciendo conteos, tiene sentido adelantarlo. |
| 5.6 | **Ledger de migraciones** — hoy nada en el sistema sabe qué corrió. Con 3 clientes se sostiene; con 20 no. El orden verificado de `preparar-local.mjs` es el punto de partida para una tabla `schema_migrations` o pasar a `supabase migration`. |
| 5.7 | **Multi-sede real** — los `SELECT` de `profiles` van por sede activa; con más de una sede las listas de usuarios quedan incompletas. Hoy ningún cliente tiene más de una sede, así que es latente. |
| 5.8 | **Disponibilidad de compuestos en el POS** — no se muestra si un coctel se puede preparar con el stock actual. |
| 5.9 | **Landing y manual** — ajustar el texto de la landing a lo que la UI tiene de verdad (sin CUFE, sin "datáfono", sin "rondas"); y no hay manual de usuario ni material de capacitación para el cajero. |

---

## Lo externo

**La demo de Café Aroma** — lista, esperando sesión con el dueño. No es un bloque, es una fecha. Cinco minutos antes: una venta real de prueba, que descarta el caché de esquema de PostgREST.

---

## Cómo saber que está completo

**Cuando los bloques 1 a 4 estén cerrados**, G-Vento puede quedar en mantenimiento puro. El 5 se intercala y no define el cierre.

Estimación total: ver sección revisada al final. Con tiempo dividido con G-Nexo, eso es algunas semanas.

Y una regla para el camino, sacada de esta sesión: **cada bloque cierra con la suite completa en verde, leyendo `PLAYWRIGHT_EXIT` del archivo.** No con la notificación, que mintió cuatro de cuatro veces.

---

## Decisiones que te esperan

Antes de arrancar cada bloque, esto se define. Las tres últimas vienen del lente comercial del resumen: **no son defectos, pero condicionan qué se promete.**

1. **Bloque 1.2** — ¿cablear los 6 permisos o quitarlos del catálogo?
2. **Bloque 3.3** — ¿qué mide el tab Financiero: cobrado, vendido, o ambos?
3. **Bloque 3.2** — alcance de devoluciones: ¿siempre vuelve stock, o se pregunta?
4. **Bloque 5.4** — ¿las imágenes entran al backup?
5. **DIAN** — ¿dentro, integrada con proveedor, o **fuera del alcance y dicho explícitamente en la landing**? No se construye en este plan, pero la decisión cambia qué se promete a un cliente nuevo.
6. **`restricted` / `suspended`** — hoy no hacen nada (decisión deliberada hasta ver si el aviso suave alcanza). Para vender a escala hay que definir qué pasa con un moroso, y coordinarlo con G-Centro.
7. **Los dos lentes** — el resumen ordena por *qué impide venderle a un cliente que no conocemos*; este plan por *qué duele si se deja*. Son preguntas distintas y las dos valen. Si aparece un prospecto nuevo de G-Vento, el lente comercial gana y DIAN sube.

Todo lo demás ya está decidido y documentado.

---

## Estimación revisada

Con el Bloque 0 y los agregados: **12-15 sesiones.** El Bloque 0 es corto pero va primero — sin él, el resto se construye sobre notas que mienten.
