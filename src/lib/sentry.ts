/* ═══════════════════════════════════════════════════════════════════════════
 * ⚠️  ESTE ARCHIVO ESTÁ DUPLICADO A PROPÓSITO
 *
 * Existe una copia casi idéntica en G-Centro:
 *     gcentro/src/lib/sentry.ts
 *
 * No es un descuido ni un candidato a extraer a un paquete compartido: los dos
 * repos son independientes y el monorepo se descartó con razón. La duplicación
 * se acepta, pero explícita.
 *
 * REGLA: todo cambio en este archivo obliga a revisar el otro EN LA MISMA
 * SESIÓN. No "después", no "en el próximo bloque". Si divergen, divergen en
 * silencio — y esto es código de privacidad: lo que se rompe acá no se nota
 * hasta que ya salieron datos de un tercero a un servicio externo.
 *
 * Lo que NO es igual entre las dos copias, y está bien que no lo sea:
 * las áreas de `SentryArea`, las claves de `CLAVE_SENSIBLE` y
 * `CLAVE_PERMITIDA`, y el correlativo `#N` (solo G-Vento tiene ventas
 * numeradas). El REDACTOR —`scrubString`, `scrubEstricto` y `scrubSobre`— sí
 * debe ser idéntico.
 *
 * ⚠️ DIVERGENCIA CONOCIDA Y ABIERTA (2026-08-05). G-Vento pasó el filtro de
 * DENY-LIST a ALLOWLIST por clave (ver el bloque de abajo). G-Centro sigue con
 * la deny-list y por lo tanto sigue fugando: PII numérica bajo cualquier clave
 * desconocida, y nombres propios en texto libre bajo una clave que no esté
 * enumerada. Se decidió a propósito arreglarlo en su propio hilo, no desde acá.
 * Esta nota existe para que la divergencia NO sea silenciosa —que es el único
 * modo de falla que esta regla intenta evitar.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * LOS MARCADORES USAN `\u0000` Y NUNCA ESPACIOS
 *
 * `scrubString` guarda UUID y fechas ISO detrás de un marcador para que la
 * pasada numérica no se los coma, y los restaura al final. Ese marcador va
 * delimitado por NUL, escrito SIEMPRE como el escape `\u0000`.
 *
 * Con espacios (` 0 `) el marcador choca con el texto real del mensaje:
 * un `0` suelto se restaura como un UUID y un índice sin valor emite
 * literalmente `undefined`. Ya pasó.
 *
 * Y como BYTE literal —no como escape— el archivo contiene NUL, git lo trata
 * como BINARIO, y los diffs de este módulo dejan de poder revisarse. Peor: el
 * byte es invisible al copiar el archivo entre repos, que es exactamente la
 * causa raíz de que esta función se rompiera al portarla. El escape es la
 * única forma correcta.
 * ═══════════════════════════════════════════════════════════════════════════ */
/**
 * Sentry — reporte de errores (v1: SOLO errores).
 *
 * NO se activa performance monitoring, session replay ni profiling: consumen
 * cuota y agregan ruido. Este módulo hace tres cosas:
 *   1. Inicializa Sentry solo en producción real (ver `sentryEnabled`).
 *   2. LIMPIA el payload de PII antes de enviarlo (ver `scrubEvent`).
 *   3. Expone helpers para el contexto multi-tenant y el reporte explícito.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * PRIVACIDAD — G-Vento maneja PII de los clientes de nuestros clientes
 * (nombres, teléfonos, deudas, consumos). Nada de eso puede salir del
 * navegador. La política está implementada, no solo documentada:
 *   · `sendDefaultPii: false` → sin IP del usuario ni cookies/headers.
 *   · Del usuario propio se envía SOLO su UUID, su rol y su organización.
 *     NUNCA su email ni su nombre (por eso no se usa `Sentry.setUser({ email })`).
 *   · `scrubEvent` recorre el evento entero redactando valores sensibles.
 *   · `beforeBreadcrumb` corta el query string de las peticiones a Supabase.
 * ─────────────────────────────────────────────────────────────────────────
 */
import * as Sentry from '@sentry/react'

/** Áreas funcionales — el tag que permite priorizar qué se rompe primero. */
export type SentryArea =
  | 'cobro'        // registrar el pago de una venta (POS y Mesas)
  | 'caja'         // abrir/cerrar turno, movimientos de caja
  | 'numeracion'   // asignación del número correlativo de venta
  | 'venta'        // crear la orden y sus ítems
  | 'mesas'        // abrir/cerrar mesa, enviar a cocina
  | 'fiado'        // cartera, abonos
  | 'inventario'   // ajustes de stock, recetas
  | 'compras'      // facturas de proveedor
  | 'productos'    // catálogo, extras
  | 'auth'         // sesión, perfil, permisos
  | 'config'       // configuración, usuarios, sedes, roles

const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined

/**
 * Sentry se activa SOLO si:
 *   · el build es de producción (`import.meta.env.PROD`) → nunca en `pnpm dev`;
 *   · hay DSN configurado;
 *   · el navegador no está automatizado → nunca en los E2E de Playwright.
 *
 * ⚠️ OJO con CI: NO se puede apagar Sentry con `process.env.CI` en tiempo de
 * build, porque **Vercel setea CI=1 en sus builds de producción** — eso lo
 * dejaría desactivado justamente donde lo necesitamos. La suite E2E ya queda
 * cubierta dos veces: Playwright levanta el *dev server* (PROD = false) y,
 * si algún día corriera contra un build, `navigator.webdriver` la ataja.
 */
export const sentryEnabled =
  import.meta.env.PROD &&
  !!DSN &&
  !(typeof navigator !== 'undefined' && navigator.webdriver)

// ── Redacción de PII ──────────────────────────────────────────────────────

/**
 * ═══ EL FILTRO ES UN ALLOWLIST POR CLAVE ═══
 *
 * Hasta 2026-08-05 esto era una DENY-LIST: pasaba todo lo que no estuviera
 * enumerado. Una deny-list sobre CONTENIDO no puede funcionar, y no es cuestión
 * de completar la lista. Tres agujeros MEDIDOS contra el código real:
 *
 *   1. `document: 900123456`  →  salía INTACTO.
 *      El corte por tipo (`if (typeof value === 'number') return value`) ocurría
 *      ANTES de mirar la clave, así que toda la maquinaria numérica vivía dentro
 *      de `scrubString` y solo era alcanzable por valores que YA eran strings.
 *      Un number nunca tocaba una regex. `numeric(12,2)` vuelve de PostgREST
 *      como number de JS ⇒ TODA columna monetaria del esquema estaba fugando.
 *
 *   2. `document: 'CC 79123456 Juan Perez'` → `'CC [monto] Juan Perez'`.
 *      El nombre sobrevive porque NO EXISTE detector de nombres propios y no
 *      puede existir. Cualquier filtro sobre contenido necesita RECONOCER la
 *      PII; un nombre es irreconocible por regex. Solo una regla sobre la
 *      POSICIÓN (qué clave) lo ataja. Este es el argumento decisivo.
 *
 *   3. Una columna nueva en el esquema fugaba CALLADA hasta que alguien la
 *      agregara a mano a la lista.
 *
 * Invertido, el modo de falla se invierte con él: lo que no está declarado sale
 * como `[Filtrado:…]`. Se pierde diagnóstico, nunca datos de un tercero.
 *
 * ── Las cuatro decisiones que lo hacen vivible ──
 *
 * a) ALLOWLIST POR CLAVE, EVALUADO EN LA HOJA, CON RECURSIÓN SIEMPRE. Un objeto
 *    bajo clave desconocida NO se colapsa: se baja y se decide hoja por hoja.
 *    Así se conserva la FORMA del árbol, que es media respuesta en triage.
 *
 * b) REDACCIÓN TIPADA (`[Filtrado:number]`, `[Filtrado:string(24)]`). Perdés el
 *    valor, conservás la forma: "¿vino null o 0?", "¿el array volvió vacío?",
 *    "¿llegó string donde esperábamos number?" se responden sin un byte de PII.
 *    Sin esto el allowlist es inusable y alguien lo va a aflojar a los 3 meses.
 *
 * c) `CLAVE_SENSIBLE` SE QUEDA, EVALUADA PRIMERO (allowlist ∧ ¬denylist). Queda
 *    redundante, y es a propósito: ataja el día que alguien agregue una clave al
 *    allowlist sin pensarla. Un chequeo fail-closed redundante no cuesta nada.
 *
 * d) NO HAY CORTE POR TIPO. Los numbers se deciden por su clave como todo lo
 *    demás. Mientras existiera ese `return`, cualquier allowlist era decorativo.
 *
 * ── El residuo irreducible, dicho de frente ──
 *
 * El allowlist confía en NUESTROS nombres de clave. Un `count: 79123456` pasa
 * el chequeo de forma (es un entero) aunque sea una cédula mal puesta. Eso no
 * lo cierra ningún filtro: lo cierra que estas claves sean POCAS y NUESTRAS.
 * Si agregás una, preguntate qué es lo peor que puede caer ahí.
 */

/**
 * Claves cuyo VALOR se redacta siempre, sin mirar el contenido ni el tipo.
 * Cubre los campos PII del dominio (cliente, mozo, dirección) y todo el texto
 * libre: `notes`, `reason`, `comment` los escribe el cajero y puede meter ahí
 * cualquier cosa ("Juan el del taller, 3001234567").
 *
 * Se evalúa ANTES que el allowlist. Consecuencia deliberada: `customer_id` y
 * `customerId` caen acá (contienen `customer`) y se redactan aunque sean UUID.
 * Es fail-closed a propósito — un UUID de cliente es un puntero directo a la
 * ficha de una persona. Si algún día hace falta, se mira contra la BD.
 */
const CLAVE_SENSIBLE =
  /(nombre|name|phone|telefono|tel|email|correo|address|direccion|customer|cliente|waiter|mozo|note|nota|reason|motivo|comment|coment|password|token|apikey|authorization)/i

/**
 * Ramas ESTRUCTURALES del SDK que no se tocan. Son diagnóstico puro y
 * redactarlas rompería el stack trace, la symbolication o el agrupamiento de
 * Sentry — y un evento que Sentry no puede procesar es PEOR que uno opaco.
 *
 * ⚠️ `stacktrace` es la ÚNICA excepción de SUBÁRBOL COMPLETO que queda, y es
 * deliberada: la forma que emite el SDK es profunda y variable (frames, vars,
 * debug_meta), así que enumerar sus claves internas se desincronizaría con la
 * próxima versión del SDK. Se acepta porque el SDK de JS NO captura variables
 * locales — ahí no hay datos del usuario— y porque `filename` lleva hashes de
 * chunk que el redactor numérico destrozaría, dejando el source map inservible.
 * Cualquier OTRA rama que alguien quiera exceptuar entera: no. Se allowlistean
 * sus claves internas. `tags` y `user` estaban acá con el argumento "los
 * construimos nosotros y ya están curados" — que es exactamente la suposición
 * que falló con `document`. Hoy pasan por su propio allowlist interno.
 */
const CLAVE_INTOCABLE = new Set([
  'stacktrace', 'frames', 'filename', 'abs_path', 'function', 'module',
  'lineno', 'colno', 'in_app', 'event_id', 'timestamp', 'release', 'dist',
  'environment', 'platform', 'sdk', 'level', 'logger', 'fingerprint',
  'mechanism', 'transaction', 'type',
  // Estructura de breadcrumbs: sin esto un breadcrumb de fetch pierde el
  // código HTTP y la categoría, que es justo lo que lo hace útil.
  'category', 'status_code',
])

/** PII conocida por la clave: sabemos QUÉ es y por eso no decimos ni la forma. */
const REDACTADO = '[Filtrado]'

/**
 * Formas admitidas por el allowlist. El chequeo de forma es fail-closed: una
 * clave permitida con un valor de forma inesperada se redacta igual.
 *
 * Es la parte que ya existía y era CORRECTA en el diseño viejo (el allowlist
 * numérico validaba `typeof v === 'number'`), solo que era INERTE: los numbers
 * ya pasaban bajo cualquier clave, así que la validación no decidía nada.
 */
type Forma = 'uuid' | 'entero' | 'decimal' | 'booleano' | 'codigo' | 'etiqueta'

/** UUID anclado y SIN flag `g`: `RE_UUID` es global y `.test()` sobre un regex
 *  global es stateful (`lastIndex`) — reusarlo acá daría falsos negativos. */
const RE_UUID_EXACTO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Slug de diagnóstico: sin espacios, corto. `23505`, `fetchProfile`, `POS`. */
const RE_CODIGO = /^[A-Za-z0-9_.:/-]{1,48}$/

const FORMA_VALIDA: Record<Forma, (v: unknown) => boolean> = {
  uuid: (v) => typeof v === 'string' && RE_UUID_EXACTO.test(v),
  entero: (v) => typeof v === 'number' && Number.isInteger(v),
  decimal: (v) => typeof v === 'number' && Number.isFinite(v),
  booleano: (v) => typeof v === 'boolean',
  // El rechazo de `@` no es cosmético: sin él, `cajero@salchimelo.co` pasa
  // como "código" bajo cualquier clave del allowlist de slugs.
  codigo: (v) => typeof v === 'string' && RE_CODIGO.test(v) && !v.includes('@'),
  // Nombres de negocio (organización/sede/rol). El corte por dígitos largos
  // evita que un teléfono entre disfrazado de nombre de sede.
  etiqueta: (v) => typeof v === 'string' && v.length <= 64 && !/\d{4,}/.test(v),
}

/**
 * ALLOWLIST. Claves cuyo valor viaja si además cumple la forma declarada.
 *
 * 📌 REGLA: esto NO se amplía "por si acaso". Cada clave acá es una decisión de
 * que ese dato puede salir del navegador hacia un servicio externo. Antes de
 * agregar una, preguntate qué es lo peor que puede caer ahí — y acordate de que
 * `document` parecía inofensivo hasta que un cajero escribió un nombre adentro.
 */
const CLAVE_PERMITIDA: Record<string, Forma> = {
  // ── Identificadores: señalan QUÉ fila mirar, sin decir nada de nadie.
  // Es la pieza que hace barato todo el resto: con el UUID vas a la BD, que es
  // lo que manda la regla del proyecto ("NO ASUMIR, CONFIRMAR CONTRA LA BD").
  id: 'uuid', orderId: 'uuid', order_id: 'uuid',
  restaurantId: 'uuid', restaurant_id: 'uuid',
  shiftId: 'uuid', shift_id: 'uuid',
  productId: 'uuid', product_id: 'uuid',
  invoiceId: 'uuid', invoice_id: 'uuid',
  userId: 'uuid', user_id: 'uuid',
  organizationId: 'uuid', organization_id: 'uuid',
  roleId: 'uuid', role_id: 'uuid',
  referenceId: 'uuid', reference_id: 'uuid',

  // ── Correlativos y conteos. No identifican a nadie.
  order_number: 'entero', orderNumber: 'entero',
  numero: 'entero', numeroPerdido: 'entero', numeroReservado: 'entero',
  intentos: 'entero', cantidadItems: 'entero', cantidad: 'entero',
  qty: 'entero', count: 'entero', sales_count: 'entero',
  page: 'entero', pageSize: 'entero',
  stock: 'entero', stock_qty: 'entero', min_stock: 'entero',

  // ── Arqueo: SOLO la diferencia, nunca los absolutos.
  // Una diferencia de caja dice "faltan 5.000" sin revelar cuánto vendió el
  // local. Los absolutos (expected/declared/total) se miran contra la BD con
  // el shift_id, que sí viaja.
  difference: 'decimal', difference_total: 'decimal', diferencia: 'decimal',

  // ── Banderas de flujo. Dicen por qué rama pasó el cobro.
  esFiado: 'booleano', esVale: 'booleano', pagoDividido: 'booleano',
  conDescuento: 'booleano', shift_open: 'booleano',
  cash_movement_created: 'booleano', ok: 'booleano', success: 'booleano',

  // ── Códigos, enums y etapas: el corazón del diagnóstico.
  // `code` es lo MÁS útil de un PostgrestError y la deny-list lo destruía:
  // `'23505'` son 5 dígitos y `RE_NUM_LARGO` lo convertía en `[monto]`.
  code: 'codigo', statusCode: 'codigo', status: 'codigo', httpStatus: 'codigo',
  errno: 'codigo', constraint: 'codigo', severity: 'codigo',
  area: 'codigo', paso: 'codigo', origen: 'codigo', tipoDeDato: 'codigo',
  method: 'codigo', payment_method: 'codigo', payment_status: 'codigo',
  discount_type: 'codigo', discount_kind: 'codigo', kind: 'codigo',
  // `type` es enum en TRES tablas (orders.order_type, cash_movements.movement_type,
  // stock_movements.type). En el sobre ya era intocable; acá se declara explícito.
  type: 'codigo',
  mutationKey: 'codigo', queryKey: 'codigo', rpc: 'codigo', tabla: 'codigo',
}

/**
 * Claves cuyo valor es PROSA de diagnóstico (mensajes de error), no un campo
 * del dominio. No se pueden allowlistear por forma —son texto libre— así que
 * pasan por `scrubString`, que es la herramienta correcta donde no hay clave
 * de la cual agarrarse.
 *
 * Es una concesión consciente y ACOTADA: `scrubString` no detecta nombres
 * propios. El riesgo se acepta acá y solo acá porque sin el mensaje del error
 * no queda diagnóstico ninguno. Ojo que `notes`, `reason` y `comment` NO están:
 * esos también son prosa, pero los escribe el cajero — caen en CLAVE_SENSIBLE.
 */
const CLAVE_PROSA = new Set(['message', 'mensaje', 'details', 'detalle', 'hint', 'stack'])

/** Allowlist interno de `tags`. Es todo lo que setea `setSentryUserContext`. */
const TAG_PERMITIDO: Record<string, Forma> = {
  organizacion: 'etiqueta', sede: 'etiqueta', rol: 'etiqueta', area: 'codigo',
}

/** Allowlist interno de `user`. SOLO el UUID: nunca email ni nombre. */
const USER_PERMITIDO: Record<string, Forma> = { id: 'uuid' }

/**
 * Contextos que arma el SDK. Pasan por el modo SOBRE (no por el allowlist):
 * son metadatos del navegador, no datos nuestros, y allowlistearlos rompería
 * el agrupamiento sin cerrar ninguna fuga. Cualquier contexto que NO esté acá
 * lo puso alguien de este lado ⇒ va por el allowlist estricto.
 */
const CONTEXTO_SDK = new Set([
  'browser', 'os', 'device', 'runtime', 'culture', 'app', 'trace', 'response',
])

const RE_EMAIL = /[\w.+-]+@[\w-]+\.[\w.]{2,}/g
/** Detalle de Postgres en violación de constraint: `Key (phone)=(3001234567)`. */
const RE_PG_KEY = /Key\s*\(([^)]*)\)\s*=\s*\(([^)]*)\)/gi
/** Montos con separador de miles: `$ 45.000`, `1,250,000`. */
const RE_MONTO_FMT = /\$?\s?\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?/g
/** Enteros de 4+ dígitos: montos en COP sin formato y teléfonos. */
const RE_NUM_LARGO = /\b\d{4,}\b/g

const RE_UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
const RE_ISO = /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/g

/**
 * EXCEPCIÓN 1 — número de venta con almohadilla (`#1234`).
 *
 * La redacción numérica es deny-by-default a propósito: es la postura correcta
 * para un filtro de privacidad (se auditan las excepciones, no la cobertura).
 * Pero los correlativos arrancan en 1 POR SEDE y cruzan los 4 dígitos en pocos
 * meses — sin esta excepción, "no se pudo anular la orden #1234" llega como
 * "#[monto]" y no sirve para diagnosticar nada.
 *
 * `#` es la convención del propio proyecto para el correlativo (PrintTicket y
 * la pantalla de éxito muestran "Venta #N"). Un monto en COP NUNCA se escribe
 * con `#`, así que la excepción no abre ninguna fuga: lo que preserva es, por
 * construcción, un número de orden — y un correlativo no identifica a nadie.
 */
const RE_NUM_ORDEN = /#\d+/g

/**
 * Teléfono móvil colombiano (10 dígitos empezando en 3). Se redacta SIEMPRE,
 * incluso si viniera precedido de `#`: es PII, no un identificador interno.
 * Se aplica ANTES de preservar `#N`, así que gana sobre la excepción.
 */
const RE_MOVIL_CO = /\b3\d{9}\b/g

/**
 * Centinela de los marcadores internos de `scrubString`.
 *
 * Escrito como escape `\u0000` y NO como byte NUL literal: el literal es
 * invisible en el editor y se corrompe en silencio al copiar el archivo — que
 * es exactamente como se rompio este modulo al portarlo a G-Centro.
 */
const CENTINELA = '\u0000'
/** Marcador completo: NUL + `g` + indice + NUL. Ver por que la `g` en `guardar`. */
// eslint-disable-next-line no-control-regex -- NUL deliberado: es el centinela
const RE_MARCADOR = /\u0000g(\d+)\u0000/g
/** Todo NUL que venga en la ENTRADA se barre antes de crear marcadores. */
// eslint-disable-next-line no-control-regex -- NUL deliberado: es el centinela
const RE_NUL = /\u0000/g

/**
 * Redacta PII dentro de un string conservando lo que sirve para depurar.
 *
 * Los UUID y las fechas ISO se enmascaran ANTES de la pasada numérica y se
 * restauran después: sin eso, `2026-08-05` saldría como `[monto]-08-05` y los
 * IDs de orden —diagnóstico clave y no identificatorios de nadie— se perderían.
 */
function scrubString(input: string): string {
  if (!input) return input

  const guardados: string[] = []
  // La `g` delante del indice NO es decorativa: protege al marcador de
  // RE_NUM_LARGO. `\b\d{4,}\b` exige un limite de palabra antes del primer
  // digito y entre `g` y `1` no lo hay. Sin ella, del marcador 1000 en
  // adelante el indice salia redactado como `[monto]`, la restauracion no
  // encontraba el marcador y el valor guardado se perdia.
  const guardar = (m: string) => {
    guardados.push(m)
    return `${CENTINELA}g${guardados.length - 1}${CENTINELA}`
  }

  // El movil colombiano se redacta ANTES de preservar `#N`: si alguien escribe
  // "#3001234567" gana la redaccion, no la excepcion del numero de orden.
  // Se barre cualquier NUL de la ENTRADA antes de crear marcadores: sin esto,
  // un NUL en el texto de origen puede falsificar un marcador y extraer un
  // valor guardado que no le corresponde.
  let s = input.replace(RE_NUL, '')

  s = s.replace(RE_MOVIL_CO, REDACTADO)

  // Lo que sobrevive a la pasada numerica: UUID, fechas ISO y correlativos `#N`.
  s = s.replace(RE_UUID, guardar).replace(RE_ISO, guardar).replace(RE_NUM_ORDEN, guardar)

  s = s
    .replace(RE_EMAIL, REDACTADO)
    // El nombre de la columna se conserva (dice QUÉ constraint falló); el valor no.
    .replace(RE_PG_KEY, (_m, col: string) => `Key (${col})=(${REDACTADO})`)
    .replace(RE_MONTO_FMT, '[monto]')
    .replace(RE_NUM_LARGO, '[monto]')

  // FAIL-CLOSED: si un marcador quedara sin su valor (solo posible por un bug
  // aca adentro), sale REDACTADO — nunca `undefined` ni el texto crudo.
  return s.replace(RE_MARCADOR, (_m, i: string) => guardados[Number(i)] ?? REDACTADO)
}

/**
 * Marcador TIPADO: dice la FORMA de lo que se redactó, nunca su contenido.
 *
 * Es lo que hace vivible el allowlist. `[Filtrado:string(0)]` vs
 * `[Filtrado:number]` vs `null` responde la mayoría de las preguntas de triage
 * —¿vino vacío? ¿vino null o 0? ¿llegó string donde esperábamos number?— sin
 * mover un byte de PII. Un `[Filtrado]` pelado convierte cada incidente en una
 * adivinanza, y de ahí a que alguien afloje el filtro hay un paso.
 */
function marcador(v: unknown): string {
  if (typeof v === 'string') return `[Filtrado:string(${v.length})]`
  if (typeof v === 'number') return '[Filtrado:number]'
  if (typeof v === 'boolean') return '[Filtrado:boolean]'
  if (Array.isArray(v)) return `[Filtrado:array(${v.length})]`
  if (typeof v === 'object' && v !== null) {
    return `[Filtrado:object{${Object.keys(v).length}}]`
  }
  return REDACTADO
}

/** Aplica una forma del allowlist: pasa el valor o lo redacta tipado. */
function porForma(v: unknown, forma: Forma): unknown {
  // `null`/`undefined` pasan: no hay nada que redactar, y "el campo vino null"
  // es diagnóstico —`orderId: null` es una causa, `[Filtrado]` sería mentira.
  if (v == null) return v
  // Los arrays HEREDAN la decisión de su clave: `mutationKey: ['orders','create']`
  // se valida elemento por elemento contra la forma del padre.
  if (Array.isArray(v)) return v.map((el) => porForma(el, forma))
  return FORMA_VALIDA[forma](v) ? v : marcador(v)
}

/** Rama de PROSA: `scrubString` sobre el texto; `null` intacto; el resto, tipado. */
function porProsa(v: unknown): unknown {
  if (v == null) return v
  return typeof v === 'string' ? scrubString(v) : marcador(v)
}

/**
 * MODO ESTRICTO — allowlist por clave. Se aplica a `extra` y a los `contexts`
 * que seteamos nosotros: las ramas que llevan datos NUESTROS, donde controlamos
 * los nombres de clave y por eso el allowlist no cuesta nada.
 *
 * Orden de decisión (el primero que aplica gana):
 *   1. `CLAVE_SENSIBLE`  → `[Filtrado]`         (denylist primero, fail-closed)
 *   2. `CLAVE_PROSA`     → `scrubString`        (mensajes de error)
 *   3. `CLAVE_PERMITIDA` → valor si cumple forma, si no marcador tipado
 *   4. objeto            → RECURSIÓN (nunca se colapsa: conserva la forma)
 *   5. array             → `[Filtrado:array(n)]` — ver abajo
 *   6. cualquier otra    → marcador tipado
 *
 * ⚠️ Los ARRAYS bajo clave DESCONOCIDA se colapsan en vez de recursar, y no es
 * una inconsistencia: los elementos de un array NO TIENEN CLAVE, así que el
 * allowlist no tiene de dónde agarrarse y recursar dejaría salir cada string
 * suelto. Medido en el diseño viejo: `['Juan Perez']` salía intacto, igual que
 * `order_items.modifiers`, que es jsonb libre. Bajo clave PERMITIDA sí se
 * recorre, heredando la forma del padre (ver `porForma`).
 *
 * `null`/`undefined` pasan: no dicen nada de nadie, y distinguir "vino null" de
 * "vino algo que redactamos" es justamente el diagnóstico que queremos conservar.
 */
export function scrubEstricto(value: unknown, depth = 0): unknown {
  if (depth > 8) return REDACTADO
  if (value == null) return value
  if (Array.isArray(value)) return marcador(value)
  if (typeof value !== 'object') return marcador(value)

  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (CLAVE_SENSIBLE.test(k)) out[k] = REDACTADO
    else if (CLAVE_PROSA.has(k)) out[k] = porProsa(v)
    else if (k in CLAVE_PERMITIDA) out[k] = porForma(v, CLAVE_PERMITIDA[k])
    else if (v == null) out[k] = v
    else if (!Array.isArray(v) && typeof v === 'object') out[k] = scrubEstricto(v, depth + 1)
    else out[k] = marcador(v)
  }
  return out
}

/** Filtra un mapa plano (tags, user) contra su allowlist interno. */
function porMapa(value: unknown, permitido: Record<string, Forma>): unknown {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return value
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = k in permitido ? porForma(v, permitido[k]) : marcador(v)
  }
  return out
}

/**
 * MODO SOBRE — para el envelope del SDK, que NO escribimos nosotros:
 * `message`, `exception.values[].value`, `breadcrumbs`, `sdk`, `contexts`.
 *
 * Acá el allowlist no se aplica a propósito: son cientos de claves que define
 * el SDK y que cambian entre versiones. Allowlistearlas redactaría los
 * metadatos que Sentry necesita para AGRUPAR y para symbolicar — y un evento
 * que Sentry no puede procesar es peor que uno opaco. Se conserva la deny-list
 * + `scrubString`, que es la herramienta correcta donde no hay claves nuestras.
 *
 * Lo que sí cambió respecto del diseño viejo: NO hay corte por tipo. Un number
 * bajo clave desconocida ya no sale intacto, sale `[Filtrado:number]`.
 *
 * ⚠️ RESIDUO CONOCIDO, y es la única suposición viva del diseño: acá un STRING
 * bajo clave desconocida pasa por `scrubString` y nada más — o sea que un
 * nombre propio saldría. Se acepta porque los datos de la app NO viajan por
 * esta rama: entran por `extra` (modo estricto), y `beforeBreadcrumb` ya borra
 * `body` e `input` de las peticiones a PostgREST antes de que lleguen. Si algún
 * día alguien mete una fila de la BD en un breadcrumb o en un contexto del SDK,
 * esta suposición se cae. Antes de hacerlo: ruteá esa rama a `scrubEstricto`.
 */
export function scrubSobre(value: unknown, depth = 0): unknown {
  if (depth > 8) return REDACTADO
  if (value == null) return value
  if (typeof value === 'string') return scrubString(value)
  if (typeof value !== 'object') return marcador(value)
  if (Array.isArray(value)) return value.map((v) => scrubSobre(v, depth + 1))

  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (CLAVE_INTOCABLE.has(k)) out[k] = v
    else if (CLAVE_SENSIBLE.test(k)) out[k] = REDACTADO
    else if (CLAVE_PROSA.has(k)) out[k] = porProsa(v)
    else if (k in CLAVE_PERMITIDA) out[k] = porForma(v, CLAVE_PERMITIDA[k])
    else out[k] = scrubSobre(v, depth + 1)
  }
  return out
}

/** `contexts`: lo del SDK va por el sobre; lo que pusimos nosotros, estricto. */
function scrubContexts(value: unknown): unknown {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return value
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = CONTEXTO_SDK.has(k) ? scrubSobre(v, 1) : scrubEstricto(v, 1)
  }
  return out
}

/**
 * Punto de entrada del filtro: rutea cada rama del evento a su modo.
 *
 * Exportada para que `sentry.test.ts` pueda verificar la política de privacidad
 * con el ESQUEMA REAL — es la clase de cosa que no alcanza con documentar.
 */
export function scrubEvent(event: unknown): unknown {
  if (event == null || typeof event !== 'object' || Array.isArray(event)) {
    return scrubSobre(event)
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(event as Record<string, unknown>)) {
    if (k === 'extra') out[k] = scrubEstricto(v, 1)
    else if (k === 'tags') out[k] = porMapa(v, TAG_PERMITIDO)
    else if (k === 'user') out[k] = porMapa(v, USER_PERMITIDO)
    else if (k === 'contexts') out[k] = scrubContexts(v)
    else out[k] = scrubSobre(v, 1)
  }
  return out
}

// ── Filtros de ruido ──────────────────────────────────────────────────────

/**
 * Errores que NO son bugs. Un POS en un bar pierde internet seguido; si eso
 * genera 200 eventos por noche, los errores reales se pierden en el ruido.
 */
const RUIDO = [
  // Red caída / petición abortada — el caso del bar sin internet.
  /Failed to fetch/i,
  /NetworkError when attempting to fetch/i,
  /Network request failed/i,
  /Load failed/i,
  /The Internet connection appears to be offline/i,
  /AbortError/i,
  /TypeError: cancelled/i,
  // Ruido conocido del navegador, sin impacto para el usuario.
  /ResizeObserver loop/i,
  /Non-Error promise rejection captured with value: undefined/i,
  // Extensiones y contenido inyectado.
  /^chrome-extension:/i,
  /^moz-extension:/i,
  /Extension context invalidated/i,
]

/** Stacks originados fuera de nuestro bundle: extensiones del navegador. */
const URLS_IGNORADAS = [
  /chrome-extension:\/\//i,
  /moz-extension:\/\//i,
  /safari-(web-)?extension:\/\//i,
  /^chrome:\/\//i,
]

// ── Init ──────────────────────────────────────────────────────────────────

export function initSentry(): void {
  if (!sentryEnabled) return

  Sentry.init({
    dsn: DSN,
    environment: (import.meta.env.VITE_SENTRY_ENVIRONMENT as string) ?? 'production',
    release: import.meta.env.VITE_SENTRY_RELEASE as string | undefined,

    // v1 = SOLO errores. Sin performance, sin replay, sin profiling.
    //
    // En el SDK v10 `browserTracingIntegration`, `replayIntegration` y
    // `profilerIntegration` NO vienen por defecto: hay que agregarlas a mano.
    // No se agregan, y no alcanza con eso solo — `tracesSampleRate: 0` deja
    // explícito que ninguna transacción se muestrea aunque alguien agregue la
    // integración de tracing más adelante sin leer esto.
    tracesSampleRate: 0,

    // NUNCA true: adjuntaría la IP del usuario, cookies y headers.
    sendDefaultPii: false,

    ignoreErrors: RUIDO,
    denyUrls: URLS_IGNORADAS,

    beforeBreadcrumb(breadcrumb) {
      // Las peticiones a PostgREST llevan los filtros en el query string y los
      // datos en el cuerpo. Se conserva el PATH (dice qué tabla/RPC falló) y se
      // descarta todo lo demás.
      if (breadcrumb.category === 'fetch' || breadcrumb.category === 'xhr') {
        const url = breadcrumb.data?.url
        if (typeof url === 'string') {
          // El endpoint de auth mueve tokens y credenciales: se descarta entero.
          if (url.includes('/auth/v1/')) return null
          try {
            const u = new URL(url, window.location.origin)
            breadcrumb.data = { ...breadcrumb.data, url: `${u.origin}${u.pathname}` }
          } catch {
            breadcrumb.data = { ...breadcrumb.data, url: REDACTADO }
          }
        }
        // El cuerpo de la petición nunca viaja.
        if (breadcrumb.data) {
          delete breadcrumb.data.body
          delete breadcrumb.data.input
        }
      }
      return breadcrumb
    },

    beforeSend(event) {
      // Sin conexión no hay bug que reportar: es el bar sin internet.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return null
      }
      return scrubEvent(event) as typeof event
    },
  })
}

// ── Contexto multi-tenant ─────────────────────────────────────────────────

export interface SentryUserContext {
  /** UUID de auth. Es lo ÚNICO que identifica al usuario en Sentry. */
  userId: string
  /** Nombre de la organización (G-10 / Salchimelo / LAB), no el UUID. */
  organizacion: string | null
  /** Nombre de la sede activa, no el UUID. */
  sede: string | null
  /** Nombre del rol (owner / admin / cajero / mozo). */
  rol: string | null
}

/**
 * Setea el contexto que convierte "algo falló" en "el cajero de Salchimelo no
 * puede cobrar". Se llama cuando el AuthContext termina de cargar el perfil.
 *
 * Del usuario va SOLO el id. Su email y su nombre NO se envían nunca — están
 * en la BD si hace falta cruzarlos.
 */
export function setSentryUserContext(ctx: SentryUserContext): void {
  if (!sentryEnabled) return
  Sentry.setUser({ id: ctx.userId })
  Sentry.setTag('organizacion', ctx.organizacion ?? 'desconocida')
  Sentry.setTag('sede', ctx.sede ?? 'desconocida')
  Sentry.setTag('rol', ctx.rol ?? 'sin-rol')
}

/** Limpia el contexto al cerrar sesión (un POS lo comparten varios cajeros). */
export function clearSentryUserContext(): void {
  if (!sentryEnabled) return
  Sentry.setUser(null)
  Sentry.setTag('organizacion', undefined)
  Sentry.setTag('sede', undefined)
  Sentry.setTag('rol', undefined)
}

// ── Reporte explícito ─────────────────────────────────────────────────────

/**
 * Reporta un error que la app YA manejó (mostró un toast, degradó, siguió).
 * Se usa donde el usuario ve una explicación pero nosotros perderíamos la causa.
 *
 * `area` es el tag para priorizar; `contexto` admite datos EXTRA que igual
 * pasan por el redactor de `beforeSend`, así que no hace falta pre-limpiarlos
 * — pero tampoco hay que mandar PII a propósito.
 */
export function captureError(
  error: unknown,
  area: SentryArea,
  contexto?: Record<string, unknown>,
): void {
  if (!sentryEnabled) return
  Sentry.captureException(error, {
    tags: { area },
    extra: contexto,
  })
}

/**
 * Reporta una condición anómala que no lanzó excepción — el caso de
 * `assignOrderNumber`, que devuelve null y deja la venta sin número.
 */
export function captureIssue(
  mensaje: string,
  area: SentryArea,
  contexto?: Record<string, unknown>,
): void {
  if (!sentryEnabled) return
  Sentry.captureMessage(mensaje, {
    level: 'error',
    tags: { area },
    extra: contexto,
  })
}
