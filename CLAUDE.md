# G-Vento — contexto del proyecto

> **Los tres archivos, y cuándo se lee cada uno:**
>
> | archivo | cuándo | qué tiene |
> |---|---|---|
> | **`CLAUDE.md`** (este) | **antes de trabajar, siempre** | convenciones + las **10 reglas de clase** |
> | [`docs/BITACORA.md`](docs/BITACORA.md) | cuando una regla te parezca discutible, o necesites contexto | la evidencia medida de cada regla + el detalle de cada fase y sesión |
> | [`docs/DEUDAS.md`](docs/DEUDAS.md) | **al planificar** | deudas vigentes + ideas pospuestas (NO son backlog) |
>
> Se separaron el 2026-08-26 porque de 36 afirmaciones auditadas, **las 8 falsas eran todas
> de ESTADO** y ninguna de regla: el registro es la parte que se pudre, y estaba mezclado
> con lo que hay que leer siempre.


## Descripción
G-Vento es un sistema POS completo para restaurantes. Monorepo que incluye:
- Panel administrativo y POS (apps/pos) → React + TypeScript + Tailwind
- Tienda pública para clientes (apps/store) → Next.js 14 + App Router
- App móvil para mozos (apps/mobile) → React Native + Expo
- Tipos y utilidades compartidas (packages/shared)

## Stack tecnológico
- Frontend web: React 18, TypeScript (strict), Tailwind CSS, Vite
- Frontend tienda: Next.js 14 App Router, TypeScript, Tailwind
- Base de datos: Supabase (PostgreSQL + Auth + Realtime + Storage)
- Estado global: Zustand
- Fetching: React Query (@tanstack/react-query)
- Validación: Zod
- Íconos: lucide-react
- Fechas: date-fns
- Monorepo: pnpm workspaces

## Convenciones de código
- Componentes: PascalCase en archivos .tsx
- Hooks: camelCase con prefijo "use", en src/hooks/
- Tipos: PascalCase, sin prefijo I ni T
- Strings UI: en español (Colombia)
- Precios: siempre en COP con Intl.NumberFormat('es-CO')
- Fechas: siempre en zona horaria America/Bogota
- IDs: UUID v4 generados por Supabase

## Patrones establecidos
- Todos los componentes son funcionales con React hooks
- No usar any en TypeScript — usar unknown si es necesario
- Errores de Supabase siempre con react-hot-toast
- Mutaciones de BD siempre en hooks custom (useXMutations)
- Las queries de Supabase van en src/hooks/, no en componentes

## Comportamientos del negocio — NO son bugs, NO "arreglar"

Cosas que parecen anomalías al mirar los datos pero son decisiones del cliente.
**Leer esto ANTES de proponer un arreglo para algo que parezca un descuido.**

### Mesas abiertas de larga duración = FLUJO INTENCIONAL

G-10 y Salchimelo usan las mesas abiertas como **cuenta corriente interna**:
consumo de empleados y cortesías. Se acostumbraron a manejarlo así y les
funciona. La mesa de Camelo con $105.200 y 4 semanas abierta, o la de $130.000
de Salchimelo, **son eso** — no son mesas olvidadas.

- **NO implementar alertas** de mesas abiertas, ni reportes de antigüedad, ni
  forzar su cierre. El dueño lo tiene claro de memoria y no quiere el reporte.
- Un aviso nocturno sobre algo que el cajero hace **a propósito** es ruido puro,
  y entrena a ignorar avisos — que es justo lo contrario de lo que buscamos con
  la observabilidad (ver el filtrado de ruido en `src/lib/sentry.ts`).
- Cualquier cambio en este flujo **se habla con el cliente primero.**
- **Consecuencia conocida y ACEPTADA:** ese consumo descuenta inventario y no
  aparece ni como venta ni como gasto. Está asumido; no es un hallazgo nuevo.

Se anotó porque una sesión estuvo a punto de "descubrir" el problema y proponer
arreglarlo. Si volvés a encontrarlo mirando datos, ya está resuelto: es así a
propósito.

## Las organizaciones de la BD: cuáles son clientes y cuáles laboratorio

**Se lee antes de cualquier operación que trate a las organizaciones como cuentas
comerciales** — cobros, métricas, conteos de clientes activos, o un `update` que barra
`organizations`. Confundir un tenant de prueba con un cliente es un error caro en las dos
direcciones: facturarle a un laboratorio, o tocarle los datos a alguien que vende.

**Para reconfirmar la lista** (va primero el comando, que no caduca):

```sql
select name, (config->>'es_laboratorio')::bool as es_lab, created_at
  from public.organizations order by created_at;
```

**Al 2026-08-31 son CINCO:**

| organización | qué es | origen |
|---|---|---|
| **G-10** | 🟢 cliente real | producción, anterior a la migración multi-tenant |
| **Salchimelo** | 🟢 cliente real | producción |
| **Café Aroma** | 🟢 cliente real | `onboard-org-paso1.sql` → `paso3.sql` (+ `demo-seed-cafeteria.sql`) |
| **LAB** | 🔬 laboratorio | `lab-seed.sql` — 2 sedes, `owner.test` y `cajero.test`; contra esto corre la suite E2E |
| **LabCentro** | 🔬 laboratorio | `labcentro-org.sql` — **solo la fila de `organizations`**, sin sede, sin roles, sin usuarios |

**LabCentro existe por una restricción de G-Centro**, no de G-Vento: su esquema tiene un
unique `(producto_id, organizacion_externa_id)` que impide vincular dos contratos al mismo
tenant, y LAB ya estaba vinculado. *(Esto último es lo que reportó G-Centro; **vive en su
repo y su BD, así que no se puede verificar desde acá** — se escribe como lo que es, un
dicho de terceros, no como hecho comprobado.)* Sirve para probar el lado de ESCRITURA (crear contrato,
vincular, escribir la bandera con `aplicar-estado`, que usa service role). **No sirve para
ver el banner:** sin sede ni usuarios nadie puede iniciar sesión ahí. Para efecto visible,
LAB.

🔴 **G-Vento NO tiene ningún concepto de "organización de prueba".** No hay columna
`is_test`, ni vistas de cobranza, ni consultas que crucen organizaciones — cada una está
acotada por RLS a la propia. El `config->>'es_laboratorio'` de LabCentro es **documentación
dentro de la fila**: ningún código lo lee. La exclusión real de cobranza vive del lado de
G-Centro (`es_prueba = true`). Si algún día G-Vento gana una vista multi-organización, ese
marcador es el que hay que respetar — y LAB, que es anterior, **no lo tiene**.

⚠️ **Que una organización no aparezca en una query no significa que no exista.** LabCentro
no salió en el pre-flight de `seed_system_roles` porque la query arrancaba de `roles` y
LabCentro no tenía ninguno. Al enumerar organizaciones, arrancá de `organizations`.

## 🔴 REGLAS DE CLASE — leer ANTES de trabajar (esto es lo único obligatorio)

Diez reglas. Son la **forma corta**: accionables solas, sin abrir la evidencia. Cada una
dice su **modo de fallo**, porque los once errores repetidos de este proyecto no vinieron de
desconocer la regla sino de **no reconocer la situación**. Y cada una nombra su **clase** con
las palabras que uno grepearía (`allowlist`, `fail-open`, `por-id`, `validar-vs-forzar`,
`contrato compartido`), porque el paso 2 del pre-flight es justamente grepear la clase.

La evidencia medida de cada una vive en [`docs/BITACORA.md`](docs/BITACORA.md), enlazada al
pie de cada regla. **La regla no la necesita; la evidencia está para cuando alguien quiera
discutirla.**

> **🔴 POR QUÉ UN RECORDATORIO NO ALCANZA — y el hook sí.** Un recordatorio que se puede
> **leer sin contestar se salta en silencio**; uno que **exige respuesta deja la omisión
> visible**. Esa es la diferencia real entre este bloque y el hook `PreToolUse`, y no es de
> contenido: los dos dicen lo mismo. Es de **distancia entre la carga y la decisión**.
> Medido el 2026-08-26: CLAUDE.md estaba cargado y decía "allowlist, nunca deny-list", y el
> guard deny-list igual se escribió — 200 líneas después de empezar la tarea, sin volver a
> mirar. Una skill habría tenido el mismo destino: **se carga al empezar la tarea, no cuando
> tomás la decisión.** Corolario para diseñar mecanismos: para lo que NO PUEDE FALLAR, hook
> (se evalúa en cada llamada a herramienta y pide un acto visible); para el procedimiento de
> una tarea infrecuente, skill; para la clase de decisión, estas reglas.

> **Por qué existe este bloque.** Auditoría del 2026-08-26: de 36 afirmaciones verificables
> del documento, 28 eran correctas y **las 8 falsas eran TODAS de estado**, ninguna de regla.
> Y en 20 días hubo **11 errores cuya lección ya estaba escrita en el repo**. El problema
> nunca fue lo que sabemos: **no fallamos en saber, fallamos en convocar.** Por eso las
> reglas se leen antes de trabajar y el registro solo cuando hace falta contexto.

---

### R0 · PRE-FLIGHT — antes de escribir SQL o cualquier guard

Las mismas cuatro preguntas que inyecta el hook `PreToolUse`. Están **también acá a
propósito**: un hook no puede garantizar su propia existencia (si alguien lo borra, o se
clona el repo sin él, vuelve el silencio). Redundancia deliberada, igual que conservar la
deny-list al invertir el filtro a allowlist.

1. **CLASE** — ¿qué tipo de decisión es? (`allowlist/denylist` · `fail-open/closed` ·
   `validar/forzar` · `por-id/por-nombre` · `contrato compartido`). Nombrala en una frase.
2. **PRECEDENTE** — grep de esa clase en este documento y en `supabase/`.
3. **MODO DE FALLO** — si me equivoco, ¿qué pasa? Si es *borra datos ajenos* o
   *falla callado* ⇒ el diseño tiene que ser fail-closed.
4. **OBJETIVO** — ¿fijado por UUID, no resuelto por nombre? ¿Allowlist, no denylist?

Si hay `DELETE`/`UPDATE`/`DROP`: además `begin`/`commit`, y **contar las filas ANTES de
tocarlas**.

---

### R1 · CONTRATO COMPARTIDO EN N LADOS

**Va primera porque es la única cuyo modo de fallo está ocurriendo AHORA, no en pasado.**

Cuando un valor vive en más de un archivo sin nada que los sincronice, **el mecanismo de
sincronización sos vos, y no existe**. Al tocar uno: enumerá los lados, tocalos todos en la
misma pasada, o poné una fuente única.

**Modo de fallo:** un lado se congela mientras los otros avanzan, y **nadie se entera hasta
que un flujo se cae**. No hay error, no hay test rojo: hay una pantalla vacía meses después.

**📋 INVENTARIO DE LOS CONTRATOS VIVOS HOY.** Esta lista es la parte útil de la regla — se
consulta antes de tocar cualquiera de ellos. *Al 2026-08-26; para reconfirmarla,
`grep -rln '<un valor del contrato>' src/ supabase/ tests/`.*

1. **Catálogo de permisos RBAC — 7 lados.** Fuente nominal: `src/lib/permissions.ts`
   (`PERMISSION_GROUPS`, 22 claves). Copias: `supabase/multi-tenant-rbac.sql`,
   `supabase/lab-seed.sql`, `supabase/onboard-org.sql`, `supabase/onboard-org-paso1.sql`,
   `supabase/onboard-org-paso3.sql` (comentado) — y **`tests/roles.spec.ts`**, que clava el
   tamaño del catálogo con `expect(ALL_PERMISSION_KEYS.length).toBe(22)`. Ese séptimo lado
   no es una copia más: es **el único mecanismo del repo que hoy vigila el contrato**, y por
   eso se pone rojo a propósito cuando el catálogo crece. **No ajustar el número sin mirar
   qué cambió** — ese rojo es el tripwire funcionando, no un test desactualizado.
   🔴 **Ya falló:** `ventas.historial` y `ventas.anular` se sembraron con un `update … where
   name='admin'` de UNA pasada sobre las orgs existentes; `onboard-org.sql` nunca se
   actualizó ⇒ **toda organización creada con él nacía sin Historial de ventas ni anulación**,
   más `sedes.gestionar`, `roles.gestionar` y `reportes.consolidado`, que nunca tuvieron
   migración. Corregido en `onboard-org-paso1.sql` (admin con 23 permisos).
   🔴 **Y SIGUE fallando: las 4 copias del seed divergen en 7 permisos** (medido 2026-08-31).
   `admin` vale **16 / 20 / 18 / 23** según el archivo (`multi-tenant-rbac` / `lab-seed` /
   `onboard-org` / `paso1`), y `cajero` **8 / 10 / 9 / 10**. Difieren en `compras.gestionar`,
   `fiado.gestionar`, `ventas.historial`, `ventas.anular`, `reportes.consolidado`,
   `sedes.gestionar` y `roles.gestionar`. **`mozo` es el único idéntico en las 4** — es el
   único que nunca se tocó, que es exactamente la forma del defecto: lo que se agregó se
   sembró en el archivo que estaba abierto ese día. Para reconfirmarlo:
   `grep -A12 "'admin', true" supabase/lab-seed.sql supabase/onboard-org.sql supabase/onboard-org-paso1.sql`
   ⚠️ **DOS residuos abiertos, en direcciones OPUESTAS** — el inventario listaba solo el primero:
   - **`ventas.anular` se enforcea pero NO está en `PERMISSION_GROUPS`** ⇒ no se puede conceder
     desde la UI de Roles, solo por SQL o por el comodín. Falla **cerrado**: alguien no puede
     hacer algo, y se queja.
   - **6 permisos son concedibles y no gatean nada.** Falla **abierto** y en silencio, que es
     peor. Entrada propia en [`docs/DEUDAS.md`](docs/DEUDAS.md) → *"concedible pero inerte"*.
   → **Salida de fondo decidida (2026-08-31), pendiente de construir:** generar
   `seed_system_roles(p_org)` desde `PERMISSION_GROUPS` + una constante `SYSTEM_ROLES` nueva,
   y que los seeds la **llamen** en vez de inlinear listas. Eso lleva 7 lados a 2 (fuente +
   artefacto generado). Generar bloques y pegarlos en cada seed sería cosmético: una copia
   generada se edita a mano igual de fácil que una escrita a mano.

2. **Enum `subscription_status` — 4 lados, DOS REPOS.** El `CHECK` en
   `supabase/organization-subscription.sql`, la constante `ESTADOS` de
   `supabase/functions/aplicar-estado/index.ts`, el `ESTADOS` de
   `tests/suscripcion-estado.spec.ts`, y `resolveNotice` en
   `src/hooks/useSubscriptionStatus.ts`. **No existe ningún mecanismo que garantice el
   aviso** — es coordinación entre dos repos con dueños distintos. El aviso a G-Centro va
   ANTES del deploy, no después.

3. **`src/types/database.types.ts` escrito A MANO vs la BD real.** El CLI da 403 de
   management, así que varias entradas se agregaron a mano (`register_sale_payment`,
   `register_sale_void`, columnas de vale/arqueo/suscripción). Los tipos pueden divergir del
   esquema **sin que `tsc` lo note** — es exactamente el proxy que R4 prohíbe confundir con
   la cosa real.

4. **Tabla de columnas de `src/lib/sentry.test.ts` vs el esquema real — 74 entradas.**
   Agregar una columna al esquema obliga a agregarla ahí, en la misma sesión. Si no, el
   allowlist igual la redacta (ese es el punto de invertir el filtro) pero **se pierde la
   verificación**.

→ **Evidencia:** [`docs/BITACORA.md`](docs/BITACORA.md) → *"FASE 1 — estado de suscripción"*
(el aviso a G-Centro) · el hallazgo del onboarding está en el inventario de arriba.

---

### R2 · ALLOWLIST vs DENY-LIST · FAIL-CLOSED

Lo permitido se declara **positivamente**; lo prohibido nunca se enumera. Un objetivo
destructivo se fija por **UUID**, no se resuelve por nombre.

**Modo de fallo:** una deny-list **deja pasar en silencio** todo lo que nadie se acordó de
escribir, y lo que no está en la lista no existe hasta que estalla. La allowlist falla
cerrándose, que se nota. Corolario: **un `catch` que convierte un error en `''` es
fail-open** — el error tiene que salir ruidoso.

**LA FORMULACIÓN CORTA, que sirve para reconocer la situación:** el código enumeraba **LO QUE
EXISTE** en vez de **LO QUE LA OPERACIÓN TOCA**. Describir el universo por sus instancias
conocidas en lugar de por su definición. Cuatro instancias medidas, todas la misma forma:

| dónde | enumeraba | omitía |
|---|---|---|
| filtro de Sentry | claves prohibidas | toda clave nueva |
| hook `sql-checklist` | `Write|Edit` | `Bash` (heredoc, `sed -i`, `python -`) |
| guard de seed | dos nombres de org | las demás |
| pre-flight de `seed_system_roles` (#12) | `from roles join organizations` | **LabCentro, que no tenía roles** |

🔴 **"Que esta vez no hubiera daño es SUERTE, no diseño."** El #12 no rompió nada porque
LabCentro no tenía permisos que perder. Con una organización que sí los tuviera, el
pre-flight habría dicho `se_pierde: []` en todas las filas y el `on conflict do update` los
habría borrado igual. El modo de fallo no depende de que esta vez saliera bien. Y fue
**fail-OPEN**: un resultado limpio y creíble, con una organización de menos.

→ **Evidencia:** [`docs/BITACORA.md`](docs/BITACORA.md) → *"Filtros de privacidad: ALLOWLIST
por clave, nunca deny-list"* · en código: el guard de `supabase/demo-seed-cafeteria.sql` y el
bloque 0 del `--preflight` en `scripts/gen-rbac-sql.mjs`.

---

### R3 · DEFECTO DE CLASE vs INSTANCIA

Al arreglar un bug, nombrá **la clase** (no el síntoma), grepeá esa forma en todo el repo, y
arreglá las hermanas **en el mismo commit** aunque estén en verde.

**Modo de fallo:** la instancia huérfana estalla meses después y **nadie la asocia con este
arreglo**, así que se paga el diagnóstico entero de nuevo.

→ **Evidencia:** [`docs/BITACORA.md`](docs/BITACORA.md) → *"Un defecto de CLASE se barre en
toda la suite, no solo donde estalló"* — locator de `anular-venta`, las 15 copias del patrón
inerte, y el caso #11 (el hook mudo).

---

### R4 · VERIFICAR CONTRA LA COSA REAL, NO CONTRA UN PROXY

Ante un número raro, mirá el dato (`select`, `information_schema`), no la intuición.
**`tsc` no prueba el SQL** — triggers, RLS y vistas solo se verifican ejecutando con datos
reales. Y antes de copiar un patrón de referencia, `command -v` sus dependencias.

**Modo de fallo:** el proxy dice OK y concluís que funciona. **"Es el patrón canónico" no es
evidencia de que funcione acá:** `jq` no está instalado en esta máquina y el hook habría
nacido mudo si se copiaba el ejemplo oficial.

**COROLARIO PARA ARTEFACTOS GENERADOS (2026-08-31):** verificar contra el archivo que
**acabás de escribir** NO es verificar contra el que **git materializa**. Con
`core.autocrlf=true` y sin `.gitattributes` son literalmente archivos distintos: el tuyo
sale con LF y el del checkout viene con CRLF. Medido: `gen:rbac:check` pasaba en la rama
donde se había generado el `.sql` y **fallaba en develop tras el fast-forward, con el mismo
árbol**. El archivo recién escrito es un PROXY del archivo real; el archivo real es el que
sale del checkout. **Un check de artefacto generado se valida después de un
`git checkout`/`stash`, no en la sesión que lo creó.**

→ **Evidencia:** más abajo en este archivo, *"Aprendizajes de proyectos hermanos (G-Quota)"* ·
y [`docs/BITACORA.md`](docs/BITACORA.md) → *"Trampas de TERMINAL"*.

---

### R5 · MIGRACIÓN APLICADA = INMUTABLE

Todo cambio de esquema va en un archivo **nuevo**. Jamás se edita una migración ya ejecutada.

**Modo de fallo:** el archivo y la BD divergen **en silencio**; el repo describe un esquema
que no existe y el próximo que lo lea razona sobre ficción.

→ **Evidencia:** más abajo en este archivo, *"Aprendizajes de proyectos hermanos (G-Quota)"*.

---

### R6 · UN INVARIANTE DE DATOS NO PUEDE DEPENDER DE QUIÉN MIRA

Una función que **valida datos** debe ser `SECURITY DEFINER`. Sin eso su `select` pasa por
RLS y evalúa **datos filtrados por el observador** — y la organización de una sede es la
misma la mire quien la mire. Corolario: un trigger de invariante **VALIDA, no fuerza**;
forzar reescribe en silencio y el resultado pasa a depender del orden de disparo.

**Modo de fallo:** rechaza operaciones válidas con un mensaje que **apunta al lugar
equivocado**. Fue fail-closed por suerte, no por diseño.

→ **Evidencia:** `supabase/fix-enforce-profile-organization-definer.sql` ·
[`docs/BITACORA.md`](docs/BITACORA.md) → grepear `enforce_profile_organization`.

---

### R7 · LÍMITES DE DÍA SOBRE TIMESTAMPS UTC

`created_at` vuelve en **UTC**. Toda frontera de día, semana o mes se calcula en
`America/Bogota`, nunca sobre el timestamp crudo. Aplica a reportes, arqueo, turnos y seeds.

**Modo de fallo:** **no revienta.** Da un número plausible y equivocado, y el cliente lo
detecta antes que vos. Es el perfil exacto de fallo silencioso que este proyecto paga caro.

→ **Evidencia:** [`docs/BITACORA.md`](docs/BITACORA.md) → *"Detalle Vale descuento / ruletazo"*
(grepear `getVouchersTotal`).

---

### R8 · ARTEFACTOS ANTES DE RE-CORRER

Ante un test rojo: leer `test-results/**/error-context.md` (el **valor recibido**), después
el trace, y recién ahí re-correr.

**Modo de fallo:** Playwright **borra `test-results/` al arrancar**. Re-correr destruye la
única evidencia — y un flake, por definición, no se reproduce a pedido.

→ **Evidencia:** [`docs/BITACORA.md`](docs/BITACORA.md) → *"ANTE UN FALLO: LEER LOS ARTEFACTOS
ANTES DE RE-CORRER"*, que incluye el flake abierto de `vale-descuento`.

---

### R9 · EL EXIT CODE QUE TE MUESTRAN NO ES EL QUE PENSÁS

Nunca leas el resultado de una suite desde una **tubería** (`| tail` devuelve el exit de
`tail`) ni desde la **notificación de tarea en segundo plano** (reporta el exit del *shell*).
Escribí el código **dentro** del archivo de salida y grepealo.

**Modo de fallo:** verde falso anunciado como verdadero. Medido: la notificación dijo
*"exit code 0"* **4 de 4 veces, con dos suites rojas**.

**SEGUNDA TRAMPA, de la misma familia: `cmd1 || cmd2` NO ES REINTENTABLE si `cmd1` ya
escribió.** Medido el 2026-08-31: un `python script.py || py script.py` —puesto como fallback
inofensivo entre dos nombres del mismo intérprete— falló en su ÚLTIMO paso después de haber
completado el primero, así que el fallback **re-ejecutó el script entero** y duplicó un bloque
en este mismo archivo. El `||` de shell no distingue "no arrancó" de "arrancó y falló a la
mitad". Regla: un fallback con `||` solo va sobre comandos **idempotentes o de solo lectura**;
si el script escribe, se elige el intérprete primero (o se hace idempotente) y se deja que
falle ruidoso.

→ **Evidencia:** [`docs/BITACORA.md`](docs/BITACORA.md) → *"Trampas de TERMINAL — el síntoma no
señala la causa"*.

---

### R10 · UNA SUITE VERDE NO PRUEBA NADA — AUDITAR POR MUTACIÓN

Si una suite pasa entera a la primera, sospechá. Mutá el sujeto a identidad y corré: **los
que sobreviven no lo están probando**. Buscá aparte la clase que el mutante no ve:
aserciones que serían verdaderas para cualquier entrada. El discriminador es el
**contraste** —positivo y negativo en la misma aserción—. Los tests que verifican *ausencia
de redacción de más* no pueden fallar contra un no-op: son legítimos y van MARCADOS.

**Modo de fallo:** el test pasa **por la razón equivocada** y da confianza sin cobertura.
Medido: de 246 tests, **25 sobrevivieron al mutante y 58 más eran invisibles para él**.

🔴 **EL LÍMITE DE ESTA TÉCNICA, medido el 2026-08-31 — conviene saberlo ANTES de confiar en
un "los 4 mutantes murieron".** **Un mutante no encuentra lo que la fixture no reproduce.**
La auditoría por mutación detecta **tests vacuos** —los que pasarían con el sujeto convertido
en identidad—, pero **no detecta casos que la fixture nunca representa**: para el mutante,
esos casos simplemente no existen. Caso: los 4 mutantes de `gen:rbac:check` murieron
correctamente, y aun así el check estaba roto para el escenario real (archivo con CRLF salido
de un checkout), porque **los 4 corrieron sobre el mismo archivo recién generado, con LF**.
La mutación validó la lógica de comparación sobre la única entrada que la fixture conocía.
**Corolario:** "todos los mutantes murieron" prueba que los tests miran al sujeto, **no** que
las entradas cubran el mundo. Son dos preguntas distintas y la mutación solo contesta la
primera; la segunda se contesta enumerando de dónde salen los datos reales.

→ **Evidencia:** [`docs/BITACORA.md`](docs/BITACORA.md) → *"Auditar una suite por MUTACIÓN, no
leyéndola"*.

---

## Aprendizajes de proyectos hermanos (G-Quota)

Reglas duras traídas de G-Quota — aplican a todo el trabajo en este repo:

- **NO ASUMIR, CONFIRMAR CONTRA LA BD:** ante un número raro o un comportamiento
  inesperado, mirar el dato real (un `select` directo, `information_schema`), no
  teorizar. La hipótesis se valida contra la base, no contra la intuición.
- **TIPOS GENERADOS, NO A MANO:** regenerar `database.types.ts` con
  `supabase gen types typescript` después de cada migración. Los 129 errores de
  tipos de la Fase 0 vinieron justamente de tipos escritos a mano y
  desincronizados con la BD (vistas sin `Relationships`).
- **MIGRACIONES NUEVAS, NUNCA EDITAR LAS APLICADAS:** todo cambio de esquema va
  en un archivo nuevo dentro de `supabase/`. Jamás modificar una migración que ya
  se aplicó.
- **`tsc` NO PRUEBA EL SQL:** triggers, RLS y vistas solo se verifican ejecutando
  con datos reales contra la BD. El compilador de TypeScript no sabe nada del SQL.
- **VERIFICAR CADA CASO CON DATOS LIMPIOS:** no encadenar pruebas sobre la misma
  orden/mesa; cada escenario se prueba desde un estado limpio para no arrastrar
  efectos de la prueba anterior.
- **`git status` ANTES DE COMMITEAR:** revisar siempre qué se va a incluir; evitar
  `git add -A` a ciegas.
- **SECURITY DEFINER → `revoke execute from public`:** Postgres concede `EXECUTE`
  a `PUBLIC` por defecto en toda función nueva. En funciones `SECURITY DEFINER`
  hay que revocar ese permiso explícitamente y concederlo solo a los roles que lo
  necesiten (`authenticated`, `service_role`, etc.).

## Variables de entorno requeridas
VITE_GVENTO_SUPABASE_URL=
VITE_GVENTO_SUPABASE_ANON_KEY=
Ver .env.example para la lista completa.

## Cómo se escribe una nota — en este documento Y en los `.sql` (convención)

Salió de auditar las 36 afirmaciones verificables del documento contra el código
(2026-08-26). **Las 28 correctas eran reglas y mecanismos. Las 8 falsas eran TODAS
afirmaciones de ESTADO** — qué rama tiene qué, cuántos tests hay, qué código existe hoy.
Ninguna regla resultó falsa. El estado es lo que se pudre, así que se escribe distinto.

- **CITAR EL SÍMBOLO, NO EL NÚMERO DE LÍNEA.** `handleDeleteItem` en `TablesPage.tsx`
  sobrevive a un refactor; `TablesPage.tsx:1036` no — ese TODO ya se movió a la 1383 solo.
  De las 8 referencias `archivo:línea` auditadas, las 7 que acertaron son de **migraciones
  ya aplicadas**, que por regla del proyecto no se editan nunca. **Ahí sí vale el número**;
  en código vivo, no.
- **TODA AFIRMACIÓN DE ESTADO VA FECHADA.** "182 tests" se lee como presente y miente a
  las dos semanas. "182 tests (2026-08-12)" es una referencia histórica honesta.
- **MEJOR QUE FECHAR: DECIR CÓMO CONSULTARLO.** Un dato caduca; una instrucción para
  reproducirlo, no. `git rev-list --count develop..main` vale más que cualquier frase sobre
  qué rama va adelante — y de hecho ese bloque decía lo contrario de la realidad durante
  semanas. Cuando existan las dos, va primero el comando y después el dato fechado.
- **UNA NOTA QUE DIRIGE MAL CUESTA MÁS QUE UNA AUSENTE.** Las dos peores del documento no
  eran omisiones: describían código eliminado y una relación de ramas invertida. Si no
  podés verificar una afirmación, no la escribas como hecho.
- 🔴 **Y LA PEOR DE TODAS: UNA NOTA QUE DECLARA UNA PROTECCIÓN INEXISTENTE.** Es una
  subclase de la anterior y es más grave, porque **no dirige mal: TRANQUILIZA mal.** Una nota
  que apunta al lugar equivocado te hace perder una tarde; una que dice *"esto está aislado"*
  o *"el check lo impide"* hace que **dejes de mirar**, y el costo aparece recién cuando algo
  se rompe del otro lado de la barrera que no existía.
  **Medido el 2026-08-31 (caso #13):** `docs/DEUDAS.md` afirmaba que LAB estaba en un
  "Supabase separado de producción", que `VITE_GVENTO_*` apuntaba "al Supabase del lab", y
  que "los health checks impiden correr E2E contra producción". Las tres falsas: LAB es una
  organización dentro de la MISMA base que los clientes, `.env.test` ni siquiera define esa
  variable, y el health check verifica la **organización de las credenciales**, no la base.
  🔴 **El detalle que define la clase:** el repo YA contenía la verdad en tres archivos
  (`tests/README.md`, `.env.test.example`, `create-user.spec.ts`, todos con "la BD es UNA
  sola"). El ÚNICO que decía lo contrario era el documento de PLANIFICACIÓN — o sea el que se
  lee para decidir, no el que se lee al codear. **Una garantía falsa en el documento de
  planificación le gana a tres advertencias correctas enterradas en el código.**
  **Al escribir una nota de protección, entonces:** decí qué impide **y qué NO**, y nombrá el
  mecanismo concreto (aquí: *"RLS + credenciales de LAB; el check mira la organización, no la
  base"*). Una protección sin mecanismo nombrado no es verificable, y lo que no es
  verificable envejece hacia la mentira.

### El estado de aplicación de una migración NO se declara (2026-08-31)

**LA CLASE, en una frase: un `.sql` que declara su estado de aplicación es un dato que
caduca, y vive FUERA DEL ALCANCE de la auditoría de este documento.** Esa segunda mitad es
la que importa — no es que las notas de los `.sql` sean peores, es que **nadie las estaba
mirando**. La auditoría del 2026-08-26 revisó `CLAUDE.md`, encontró 8 afirmaciones de estado
falsas y concluyó que el problema estaba acotado al documento. **Miró el documento y no los
`.sql`**, así que las que vivían ahí sobrevivieron intactas a la limpieza.

Al barrer la clase (R3) el 2026-08-31 aparecieron **3 encabezados que declaraban "NO aplicada
todavía", y las 3 eran falsas**: `owner-wildcard-permission.sql` (mintió >2 meses),
`compras-proveedores.sql` y `fiado-clientes.sql`. Ninguna era ambigua: las tres estaban
aplicadas y corriendo en producción. **Dos de las tres se podían refutar sin tocar la BD** —
`compra-no-toca-caja.sql` dice en su propio encabezado *"no edita compras-proveedores.sql ya
aplicada"*, o sea que el repo se contradecía a sí mismo y nadie lo había leído junto.

🔴 **Corolario sobre el alcance de cualquier auditoría futura:** una auditoría que encuentra
N defectos en el lugar donde miró no probó nada sobre los lugares donde no miró. Antes de
declarar cerrada una clase, enumerá dónde MÁS puede vivir. Acá el costo fue bajo porque
re-aplicar era inofensivo; con una migración destructiva, un "NO aplicada" falso es
exactamente cómo se borran datos ajenos.

**La raíz no es descuido: es que no hay ledger.** Las migraciones se aplican a mano desde el
SQL Editor del Dashboard, así que **nada en el sistema sabe qué se corrió**. Un comentario es
el único registro, y un comentario no se actualiza al aplicar — se actualiza cuando alguien
se acuerda, que es nunca. Es el mismo error de forma que documentar qué rama va adelante en
vez de escribir `git rev-list --count develop..main`.

**LA CONVENCIÓN: un `.sql` describe QUÉ hace y sus PRECONDICIONES, nunca si ya corrió.**
La BD es la fuente de esa verdad; el archivo no puede serlo, porque no se entera. Un
encabezado bien escrito responde: qué cambia, qué necesita aplicado antes, qué pasa si se
re-aplica — y para "¿ya corrió?" entrega la query, no la respuesta.

**En detalle:**

- 🔴 **NO escribir "aplicada" ni "NO aplicada todavía".** Es un dato sobre el mundo, y el
  archivo no tiene forma de enterarse cuando el mundo cambia.
- ✅ **En su lugar, la QUERY que lo responde.** No caduca, porque es una instrucción:
  `select 1 from pg_proc where proname = '<la función>';` o el `information_schema` que
  corresponda. Va bajo el rótulo **`NO DEDUZCAS EL ESTADO DE ESTE COMENTARIO — correlo:`**,
  redactado como orden para que no se lea como decoración.
- ✅ **Declarar en cambio el MODO DE FALLO AL RE-APLICAR**, que sí es atemporal porque es una
  propiedad del SQL, no del mundo. Tres categorías: *idempotente* (`create or replace` +
  upsert), *falla y hace rollback* (`create table` sin `if not exists` dentro de
  `begin/commit`), o *destructivo*. **Este es el campo que de verdad importaba** y que ninguno
  de los 3 encabezados tenía: acá re-aplicar era inofensivo, pero en una migración destructiva
  un "NO aplicada" falso es exactamente cómo se borran datos ajenos.
- 📌 **Si querés dejar constancia de que se aplicó**, fechala y decí contra qué se verificó
  ("verificado el 2026-08-31: 4 orgs con comodín"), nunca en presente pelado. Una afirmación
  fechada es historia honesta; una en presente es una bomba de tiempo.

**Salida de fondo, cuando haya margen:** una tabla `schema_migrations` (o pasar a
`supabase migration`) convierte esto en un dato consultable de verdad y hace innecesaria toda
la convención. Hasta entonces, la query de verificación es el sustituto barato.

## Git
- Rama activa de desarrollo: develop
- Nunca hacer commit directo a main
- Commits en formato Conventional Commits
- Un commit por funcionalidad o fix completo

## Design System
Valores exactos de color, tipografía, espaciado y patrones de layout en:
**`src/design-system.md`** — leer antes de construir cualquier pantalla nueva.

Resumen rápido:
- Acento: `#10b981` (emerald) / oscuro `#059669`
- Sidebar: `#0f172a` bg, `#1e293b` bordes, `#cbd5e1` texto nav
- Texto: primario `#0f172a`, secundario `#64748b`, muted `#94a3b8`
- Fuentes: Inter UI · monospace para precios/números
- Layout POS: `flex h-full overflow-hidden`, split 60/40
- Layout Login: `flex h-full`, split 40/60 (brand oscuro / form blanco)
- Botón CTA: `#10b981`, border-radius 10px, shadow `rgba(16,185,129,.35)`

## Política de testing (obligatoria)
- Todo módulo o funcionalidad nueva **DEBE** incluir su spec E2E en `tests/` antes de
  considerarse completo.
- El prompt de cada feature nuevo termina con: "crea/actualiza el spec de Playwright que
  cubra esta funcionalidad".
- Antes de cada merge a `develop`: `pnpm test:e2e` debe pasar al 100%.
- Selectores robustos con `data-testid` donde el texto sea ambiguo.
- Tests deterministas e idempotentes (aprendizaje: verificar con datos limpios).
- Los tests corren en serie (`workers: 1`) por compartir backend.

