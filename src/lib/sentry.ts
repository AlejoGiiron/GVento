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
 * `IDENTIFICADOR_NUMERICO`, y el correlativo `#N` (solo G-Vento tiene ventas
 * numeradas). El REDACTOR —`scrubString` y `scrubValue`— sí debe ser idéntico.
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
 * Claves cuyo VALOR se redacta siempre, sin mirar el contenido.
 * Cubre los campos PII del dominio (cliente, mozo, dirección) y todo el texto
 * libre: `notes`, `reason`, `comment` los escribe el cajero y puede meter ahí
 * cualquier cosa ("Juan el del taller, 3001234567").
 */
const CLAVE_SENSIBLE =
  /(nombre|name|phone|telefono|tel|email|correo|address|direccion|customer|cliente|waiter|mozo|note|nota|reason|motivo|comment|coment|password|token|apikey|authorization)/i

/**
 * Ramas del evento que NO se tocan: son diagnóstico puro, sin PII, y
 * redactarlas rompería el stack trace o el ordenamiento de Sentry.
 * `stacktrace` incluye `filename` con hashes de chunk (números largos) que
 * el redactor numérico destrozaría — y el SDK de JS no captura variables
 * locales, así que ahí no hay datos del usuario.
 */
const CLAVE_INTOCABLE = new Set([
  'stacktrace', 'frames', 'filename', 'abs_path', 'function', 'module',
  'lineno', 'colno', 'in_app', 'event_id', 'timestamp', 'release', 'dist',
  'environment', 'platform', 'sdk', 'level', 'logger', 'fingerprint',
  'mechanism', 'transaction', 'type',
  // `tags` y `user` los construimos nosotros y ya están curados (ver
  // setSentryUserContext): redactarlos borraría el contexto multi-tenant.
  'tags', 'user',
])

const REDACTADO = '[Filtrado]'

/**
 * EXCEPCION 2 - identificadores numericos estructurados.
 *
 * Claves cuyo valor NUMERICO pasa sin redactar. Resuelve el otro lado del
 * problema: los mensajes se leen redactados, pero el dato que necesitas para
 * diagnosticar viaja intacto en `extra`.
 *
 * Deliberadamente NO cubre strings: si alguien mete texto libre bajo
 * `order_number`, se redacta igual. Solo se confia en la FORMA (number), no en
 * la intencion de quien escribio la clave. Un correlativo, una cantidad de
 * stock o un contador de items no identifican a ninguna persona.
 */
const IDENTIFICADOR_NUMERICO = new Set([
  'order_number', 'orderNumber', 'numeroPerdido', 'numero',
  'qty', 'cantidad', 'cantidadItems', 'stock', 'stock_qty', 'min_stock',
  'page', 'pageSize', 'count', 'status', 'statusCode',
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
 * Recorre el evento redactando en profundidad. Corta a 8 niveles por seguridad.
 * Exportada para que `sentry.test.ts` pueda verificar la política de privacidad
 * con casos reales — es la clase de cosa que no alcanza con documentar.
 */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return REDACTADO
  if (typeof value === 'string') return scrubString(value)
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) {
    return value
  }
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (CLAVE_INTOCABLE.has(k)) out[k] = v
      // La clave sensible gana SIEMPRE sobre el allowlist numerico: si una
      // clave estuviera en ambos conjuntos, se redacta (fail-closed).
      else if (CLAVE_SENSIBLE.test(k)) out[k] = REDACTADO
      // Allowlist FAIL-CLOSED: pasa solo si la forma es la esperada (number).
      // Si bajo `order_number` llega un string, se redacta ENTERO en vez de
      // mandarlo al redactor de texto: un valor con forma inesperada bajo una
      // clave de confianza es exactamente el caso que no queremos dejar pasar
      // "a medias" (el redactor de strings no detecta nombres propios sueltos).
      else if (IDENTIFICADOR_NUMERICO.has(k)) {
        out[k] = typeof v === 'number' ? v : REDACTADO
      }
      else out[k] = scrubValue(v, depth + 1)
    }
    return out
  }
  return REDACTADO
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
      return scrubValue(event) as typeof event
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
