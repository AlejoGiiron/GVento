# G-Vento — resumen general para arrancar una sesión

> **Fechado al 2026-09-04.** Todo lo que dice "hoy" es de esa fecha. Donde hay un número,
> va al lado el comando que lo reproduce: correr el comando, no confiar en el número.
> Este documento se lee UNA vez para ubicarse. Para trabajar, lo obligatorio sigue siendo
> `CLAUDE.md` (las 10 reglas de clase); para planificar, `docs/DEUDAS.md`.

---

## 1. Qué es G-Vento

**Un sistema POS para bares, restaurantes y cafeterías en Colombia**, vendido como
suscripción a negocios chicos. Un dueño abre turno de caja, vende en mostrador o por mesa,
manda comandas a cocina, despacha domicilios, controla inventario por recetas, lleva fiado
de clientes, compra a proveedores, cierra el turno con arqueo y mira reportes. Todo en
español de Colombia, precios en COP, fechas en `America/Bogota`.

**Es multi-tenant.** Una base de datos única sirve a varias **organizaciones** (cada una es
un cliente); cada organización tiene una o más **sedes** (`restaurants`) y **usuarios** con
roles y permisos. El aislamiento entre clientes es por Row Level Security de Postgres, y no
hay ninguna segunda barrera detrás.

**Stack real** (no el que describe la cabecera de `CLAUDE.md`, ver §8):

| capa | qué |
|---|---|
| Frontend | una sola app React 18 + TypeScript strict + Vite + Tailwind, en `src/` |
| Backend | Supabase en la nube: Postgres + Auth + Realtime + Storage |
| Lógica de servidor | SQL en `supabase/*.sql` (RPC `SECURITY DEFINER`, triggers, RLS) + 2 Edge Functions (`create-user`, `aplicar-estado`) |
| Estado / datos | Zustand · React Query · Zod |
| Observabilidad | Sentry con filtro de privacidad por allowlist (`src/lib/sentry.ts`) |
| Impresión | comandas y tickets desde el navegador (`src/lib/printer.ts`) |
| Deploy | Vercel desde `main` (`vercel.json` solo reescribe a `index.html`) |
| Tests | Vitest (unit) + Playwright (E2E) contra la organización LAB |

**Proyectos hermanos del mismo autor**, que aparecen en los docs:
- **G-Centro**: panel de suscripciones y cobranza. Repo y base aparte. Escribe una bandera
  de estado en `organizations` de G-Vento vía Edge Function firmada con HMAC; G-Vento solo
  la lee. Si G-Centro se cae, el POS sigue vendiendo.
- **G-Mura** y **G-Quota**: otros productos. Se citan por lecciones traídas de ahí y porque
  G-Mura suele ocupar los puertos locales por defecto.

---

## 2. Módulos que existen hoy

Una página por módulo en `src/pages/`, hooks de datos en `src/hooks/`, spec E2E en `tests/`.

| módulo | qué hace | spec |
|---|---|---|
| **Login** | Auth de Supabase; corta la sesión si el perfil está inactivo | `auth` |
| **POS** (mostrador) | carrito, categorías, extras por producto, descuento, vale, pago mixto (Efectivo / Tarjeta / Transferencia / Nequi-QR), venta en espera, venta a fiado, stock bajo, tipo de venta con reset | `pos`, `pago-mixto`, `vale-descuento`, `venta-espera`, `extras-pos`, `stock-bajo-pos`, `tipo-venta-reset`, `pos-categorias-layout` |
| **Mesas** | abrir mesa, agregar ítems con observación de cocina, enviar a cocina, pedir cuenta, cobrar, recibo | `mesas`, `recibo-mesa`, `observaciones-cocina` |
| **Cocina (KDS)** | pantalla de comandas por sede, en tiempo real | `cocina` |
| **Delivery** | kanban de 3 estados para despachar. **Sin dirección ni teléfono por decisión del cliente**: los pedidos llegan por WhatsApp | `delivery` |
| **Caja / turno** | apertura con base, movimientos, cierre con arqueo multi-método y cuadre | `caja`, `arqueo` |
| **Productos** | catálogo, categorías, imágenes en Storage, productos simples y compuestos (receta), extras reutilizables | `productos`, `extras`, `categorias-scroll` |
| **Inventario** | stock por sede, movimientos, mínimo, descuento por receta al vender, stock negativo permitido | `inventario` |
| **Compras / proveedores** | compras que alimentan inventario y no tocan caja | `compras` |
| **Fiado** | clientes con deuda, abonos, historial | `fiado` |
| **Historial de ventas** | ventas numeradas por sede, reimpresión, anulación con permiso | `ventas-historial`, `historiales`, `anular-venta`, `numeracion-fallo` |
| **Historial de turnos y gastos** | consulta de cierres anteriores y de movimientos | `historiales` |
| **Reportes** | Financiero (por canal y método) y Stock (unidades, top productos, por categoría) | `reportes` |
| **Configuración** | datos de la sede, usuarios (crear vía Edge Function, activar/desactivar), sedes, roles con matriz de permisos | `config`, `create-user`, `roles`, `rbac`, `rbac-escalada` |
| **Banner de suscripción** | aviso descartable en `expiring`, banner persistente en `grace`. **No bloquea nada** | `suscripcion-banner`, `suscripcion-estado` |

**RBAC:** 23 permisos en `src/lib/permissions.ts` (`PERMISSION_GROUPS`) agrupados en POS,
Caja, Mesas, Cocina, Delivery, Productos, Compras, Fiado, Ventas, Reportes y Configuración.
Roles del sistema por organización: `owner` (comodín `*`), `admin`, `cajero`, `mozo`. El
seed de roles se **genera** desde el catálogo con `pnpm gen:rbac` y se vigila con
`pnpm gen:rbac:check`. `tests/roles.spec.ts` clava el tamaño del catálogo a propósito.

**Lo que NO existe** y conviene saber antes de prometerlo: facturación electrónica DIAN
(cero referencias en `src/` y `supabase/`), tienda pública, app móvil, "ronda" de mesa como
concepto, dirección de entrega en delivery, totalización de merma, reportes consolidados
multi-sede (el permiso existe, la pantalla no).

---

## 3. Datos y organizaciones

```sql
select name, (config->>'es_laboratorio')::bool as es_lab, created_at
  from public.organizations order by created_at;
```

| organización | qué es |
|---|---|
| **G-10** | cliente real, coctelería sin cocina. El primero, anterior al multi-tenant |
| **Salchimelo** | cliente real, con cocina |
| **Café Aroma** | cliente real, cafetería de mostrador sin mesas. Onboardeado el 2026-08-25 |
| **LAB** | laboratorio. 2 sedes, `owner.test` y `cajero.test`. Contra esto corre la suite E2E |
| **LabCentro** | laboratorio. Solo la fila de `organizations`, para que G-Centro pruebe un segundo contrato |

🔴 **Las cinco viven en la MISMA base de producción.** No hay un Supabase de pruebas: LAB es
una organización más, aislada por RLS y por sus credenciales. `E2E_SERVICE_ROLE_KEY`
saltea el RLS y por lo tanto es la key de todos los clientes.

**Comportamientos que parecen bugs y no lo son** (detalle en `CLAUDE.md`): mesas abiertas
por semanas son cuenta corriente interna de empleados y cortesías; delivery sin dirección.

**Infraestructura fuera del repo:** un Ubuntu con Supabase self-hosted que cada noche hace
`backup de prod → restore sobre staging → lab-seed`. El dump es lo sagrado, staging es
desechable. Storage (imágenes) **no** entra en ese ciclo.

---

## 4. Modelo de trabajo

**Quién.** Un desarrollador (Alejandro) trabajando con Claude Code en sesiones. El cliente
real da feedback directo (los ajustes del 2026-08-10 salieron de eso).

**Los tres documentos y cuándo se lee cada uno:**

| archivo | cuándo | contenido |
|---|---|---|
| `CLAUDE.md` | siempre, antes de trabajar | convenciones, comportamientos de negocio, las 5 organizaciones y **las 10 reglas de clase** |
| `docs/BITACORA.md` | cuando una regla parezca discutible o falte contexto | evidencia medida de cada regla, detalle de cada fase y sesión, infraestructura |
| `docs/DEUDAS.md` | al planificar | deudas vigentes con su señal de retome, ideas conscientemente pospuestas |

Se separaron porque en una auditoría las afirmaciones falsas eran **todas de estado**, nunca
de regla: el estado se pudre, y se aísla de lo que hay que leer siempre.

**Las 10 reglas de clase, en una línea cada una** (la forma larga está en `CLAUDE.md`):

- **R0** Pre-flight antes de SQL o guards: clase, precedente, modo de fallo, objetivo por UUID.
- **R1** Un valor que vive en N archivos sin sincronización: tocar todos en la misma pasada o
  poner fuente única. Hay inventario de contratos vivos.
- **R2** Allowlist, nunca deny-list. Fail-closed. Objetivos destructivos por UUID, no por nombre.
- **R3** Un bug es una clase: grepear la forma en todo el repo y arreglar las hermanas en el mismo commit.
- **R4** Verificar contra la cosa real (la BD, el checkout), no contra un proxy (`tsc`, el archivo recién escrito).
- **R5** Migración aplicada = inmutable. Todo cambio va en archivo nuevo.
- **R6** Funciones que validan datos son `SECURITY DEFINER`; triggers de invariante validan, no fuerzan.
- **R7** Fronteras de día en `America/Bogota`, nunca sobre el timestamp UTC crudo.
- **R8** Ante un test rojo, leer `test-results/` antes de re-correr (Playwright lo borra).
- **R9** El exit code de una tubería o de una tarea en segundo plano miente; escribirlo al archivo y grepearlo.
- **R10** Suite verde no prueba nada: auditar por mutación, y saber que el mutante no ve lo que la fixture no reproduce.

**Mecanismos que las sostienen:** un hook `PreToolUse` (`.claude/hooks/sql-checklist.mjs`)
que inyecta el pre-flight cada vez que se toca SQL en `supabase/` o el catálogo de
permisos, y 5 slash commands (`commit`, `componente`, `nueva-tabla`, `nuevo-modulo`,
`revisar`).

**Convenciones de código y de notas:**
- Hooks custom para toda query y mutación (`useX`, `useXMutations`). Nada de Supabase en componentes.
- Sin `any`. Errores con `react-hot-toast`. `data-testid` donde el texto sea ambiguo.
- Toda afirmación de estado va fechada, y mejor con el comando que la reproduce. Se cita el
  símbolo, no el número de línea. Un `.sql` no declara si ya se aplicó: da la query que lo
  responde y su modo de fallo al re-aplicar.
- Una nota que declara una protección nombra el mecanismo **y su límite**.

**Git.** `develop` es la rama de trabajo; `main` es producción y se despliega en Vercel. Nunca
commit directo a `main`. Conventional Commits, un commit por funcionalidad. Sin
`Co-Authored-By`. Antes de mergear a `develop`, `pnpm test:e2e` al 100%.

**Testing.** Toda funcionalidad nueva lleva su spec E2E antes de considerarse completa. Los
specs corren en serie (`workers: 1`) contra LAB, con doble health check en `global-setup.ts`
(la app en el puerto 5180 es G-Vento; las credenciales son de LAB). `retries: 0`.

**Migraciones.** Se aplican **a mano** desde el SQL Editor del Dashboard. No hay ledger:
nada en el sistema sabe qué corrió. `database.types.ts` se edita **a mano** porque el CLI
devuelve 403 de management. Los dos son deudas estructurales conocidas.

---

## 5. Cómo llegó hasta acá (hitos, para leer la bitácora con mapa)

| cuándo | qué |
|---|---|
| abr 2026 | fases 02 a 09: login, POS, turno, mesas, cocina, delivery, reportes, configuración |
| jun 2026 | Fase 0 (tipos y build), multi-tenant + RBAC, delivery v2, venta en espera, extras, ventas numeradas, inventario por recetas, compras, permiso comodín, suite E2E |
| jul 2026 | pago mixto, arqueo multi-método, vale descuento; **bloque de seguridad RBAC** (escalada de privilegios cerrada, invariante de organización) |
| ago 2026 | Fase 1 y 2 de suscripción con G-Centro; ajustes del cliente; bug de producción del POS; onboarding de Café Aroma; auditoría de notas falsas y separación de docs; generador de seed RBAC; 13 casos de error repetido documentados |
| 2 sep 2026 | pipeline de capturas para la landing comercial sobre un Supabase local en Docker (sin commitear) |

---

## 6. Estado al 2026-09-04

**Ramas.** `develop` va 13 commits adelante de `main` (`git rev-list --count main..develop`).
`main` está en el release del banner de suscripción (Fase 2). Todo lo de `develop` desde
entonces es docs, el generador de RBAC, el onboarding de Café Aroma y fixes de seeds; no hay
funcionalidad de producto nueva sin promover.

**Sin commitear** (`git status --short`): la sesión del 2 de septiembre entera.
- `scripts/capturas/` (preparar Supabase local, spec que fotografía, config que pisa el entorno).
- `supabase/landing-seed.sql`, semilla de vitrina "Bar La Ronda" dentro de LAB, con guard por UUID.
- `supabase/config.toml` y `supabase/.gitignore` de `supabase init`, puertos 5433x.
- `.env.capturas`, declarado versionable porque solo tiene claves de demo del CLI.
- `capturas-landing/` con 5 PNG y un README, más un `.zip` de 1.3 MB que no debería entrar.
- Dos scripts en `package.json`: `capturas:preparar` y `capturas`.

**Métricas** (últimas medidas; reproducir con el comando):

| qué | dato | comando |
|---|---|---|
| specs E2E | 35 archivos, ~200 tests (2026-08-26) | `npx playwright test --list` |
| unit | 285/285 (2026-08-18) | `pnpm test:unit` |
| tsc | 0 errores (2026-08-18) | `pnpm tsc --noEmit` |
| eslint | 6 errores preexistentes (2026-08-12) | `pnpm lint` |
| suite E2E full | **no se corre completa desde 2026-08-12** | `pnpm test:e2e` |

**Hallazgos de la última sesión que solo viven en `capturas-landing/README.md`:**
1. `supabase/cash-movements.sql` usa `create type if not exists`, que ningún Postgres acepta.
   Ese archivo, tal como está, nunca corrió entero; en producción el enum existe porque se
   aplicó de otra forma.
2. `supabase/organization-subscription.sql` termina con una verificación manual sin comentar
   que revienta si se ejecuta el archivo completo.
3. El array `ORDEN` de `scripts/capturas/preparar-local.mjs` es el **primer orden de las 39
   migraciones verificado por ejecución** sobre una base vacía.

---

## 7. Qué falta para que G-Vento sea comercializable

Separado por lo que le impide venderse a un cliente que no conocemos, no por lo que
molesta al desarrollador. Lo que ya está decidido que NO se construye queda fuera
(pedidos entre negocios, KPI de merma).

### 7.1 Onboarding y operación de clientes — hoy es artesanal
- **Alta de organización por SQL a mano**: `onboard-org-paso1.sql` + crear usuario en el
  Dashboard + `paso3.sql`. No hay pantalla ni script de un paso. Cada cliente nuevo cuesta
  una sesión y expone a errores de la clase "seed que diverge" (R1).
- **Migraciones sin ledger y aplicadas a mano.** Con 3 clientes se sostiene; con 20 no.
  Salida anotada: tabla `schema_migrations` o pasar a `supabase migration`. El orden
  verificado de `preparar-local.mjs` es el punto de partida.
- **Tipos escritos a mano** por el 403 del CLI. Resolver el permiso de management y
  regenerar `database.types.ts`.
- **Storage fuera del backup nocturno**: las imágenes de producto de un cliente se pierden
  si se pierde el proyecto.
- **Caja por sede y turnos simultáneos**: falta validar que no se abra un segundo turno
  con uno abierto. Marcado como bug de raíz.

### 7.2 Cobro y suscripción — a medias
- **Solo aviso.** Fase 2 muestra banner en `expiring` y `grace`; `restricted` y `suspended`
  no hacen nada. Decisión deliberada hasta ver si el aviso suave alcanza. Para vender a
  escala hay que decidir qué pasa con un moroso.
- **No hay concepto de organización de prueba.** Cualquier conteo o vista de cobranza
  contará LAB y LabCentro como clientes. Salida barata: columna `es_laboratorio` y vista
  `organizaciones_facturables`. Señal de retome: la primera consulta que cruce organizaciones.
- **El enum de estados vive en 4 lados y 2 repos** sin mecanismo de aviso. Coordinación
  manual con G-Centro antes de cada cambio.

### 7.3 Producto — huecos que un cliente nuevo va a pedir
- **Facturación electrónica DIAN.** No existe ni una línea. Para muchos negocios en Colombia
  es obligatoria; hay que decidir si G-Vento la hace, la integra con un proveedor
  tecnológico, o la excluye explícitamente del alcance y lo dice en la landing.
- **Multi-sede real.** Los `SELECT` de `profiles` van por sede activa; con más de una sede
  las listas de usuarios quedan incompletas. `reportes.consolidado` es un permiso sin pantalla.
- **6 permisos concedibles pero inertes** (`pos.vender`, `caja.abrir`, `mesas.cobrar`,
  `productos.ver`, `reportes.stock`, `reportes.consolidado`): la matriz de Roles los ofrece
  y nada los aplica. La pantalla miente. Decisión pendiente entre gatearlos o sacarlos.
- **`ventas.anular` no está en el catálogo** aunque se enforcea: solo se concede por SQL.
- **Borrar un ítem de mesa no devuelve stock.** Inventario subestimado.
- **Cierre de turno confía en el esperado calculado en el navegador.** Endurecer con RPC
  que recompute server-side.
- **Disponibilidad de productos compuestos en el POS** no se muestra.
- Restos del enum `profiles.role` viejo: `create-user` valida `role === 'admin'` y una
  policy antigua de `restaurants` sigue viva.

### 7.4 Calidad y confianza en la suite
- **La suite E2E completa no se corre desde el 2026-08-12.** Antes de cualquier release hay
  que correrla y leer el exit code desde archivo (R9).
- 4 suites nunca corridas contra LAB: `extras`, `extras-pos`, `ventas-historial`, `inventario`.
- Flake abierto en `vale-descuento`.
- 6 errores de eslint preexistentes.
- `.gitattributes` con `eol=lf` pendiente, en commit propio con `git add --renormalize .`.
- Filtro de PII de Sentry: diagnóstico completo y pausado desde el 2026-08-10.
- Auditoría de los ~40 encabezados de `supabase/*.sql` que nadie verificó contra el código.

### 7.5 Comercial y documentación
- **Landing comercial**: las 5 capturas están generadas y verificadas contra números
  sembrados. Pendiente commitear el pipeline y ajustar el texto de la landing a lo que la UI
  tiene de verdad (no hay CUFE, no hay "datáfono", no hay "rondas").
- **Skill `demo-en-vivo`** para la Fase C: el material existe (guión de 13 minutos,
  checklist previo, tres reglas de seed creíble) y hay que convertirlo en skill.
- Sin manual de usuario ni material de capacitación para el cajero.

### 7.6 Orden sugerido
1. Commitear la sesión del 2 de septiembre y pasar sus 3 hallazgos a `DEUDAS.md`.
2. Correr la suite E2E completa y dejar `develop` promovible.
3. Decidir facturación electrónica: dentro, integrada o fuera del alcance. Cambia la landing.
4. Ledger de migraciones a partir del orden verificado.
5. `es_laboratorio` + vista facturable, antes de la primera consulta cruzada.
6. Definir `restricted`/`suspended` con G-Centro.
7. Resolver los 6 permisos inertes en commit propio y avisado.
8. Onboarding en un solo paso.

---

## 8. Advertencias sobre los propios documentos

- **La cabecera de `CLAUDE.md` describe un monorepo que no existe.** Dice `apps/pos`,
  `apps/store` (Next.js), `apps/mobile` (Expo) y `packages/shared`. Verificado el
  2026-09-04: no hay carpeta `apps/` ni `packages/`; el repo es una sola app Vite en `src/`.
  Es una afirmación de estado, exactamente la clase que la auditoría del 2026-08-26 cazó, y
  sobrevivió porque nadie la contrastó con `ls`. Corregirla o fecharla.
- `BITACORA.md` tiene el bloque "Estado actual del proyecto" que pide actualizarse al inicio
  de cada sesión y hoy describe agosto.
- Si un número de este documento no coincide con el comando de al lado, gana el comando.
