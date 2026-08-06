import { describe, it, expect } from 'vitest'
import { scrubEvent, scrubEstricto, scrubSobre } from './sentry'

/**
 * Estos tests SON la política de privacidad, no su documentación.
 *
 * G-Vento maneja PII de los clientes de nuestros clientes. Si alguien afloja el
 * redactor, acá se cae — y se entera antes de mandarle datos de un tercero a un
 * servicio externo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTOS TESTS SON ADVERSARIALES Y NO "DE COBERTURA"
 *
 * La versión anterior tenía 16 tests en verde y AUN ASÍ el filtro fugaba
 * `document` (cédula/NIT) y todo número bajo cualquier clave desconocida.
 * No fallaron porque probaban LO QUE EL FILTRO CUBRE, no lo que no cubre:
 * tomaban las claves de la lista y verificaban que sí se redactaban. Un test
 * así no puede descubrir una columna que nadie puso en la lista.
 *
 * La inversión: se parte del ESQUEMA REAL y se verifica que NADA de esas
 * columnas sale. Si mañana aparece una columna nueva y nadie la agrega acá, el
 * allowlist ya la redacta por default — el test es la segunda red, no la única.
 * ─────────────────────────────────────────────────────────────────────────
 */

const ev = (extra: Record<string, unknown>) =>
  JSON.stringify(scrubEvent({ extra }))
const est = (v: unknown) => scrubEstricto(v) as Record<string, unknown>
const str = (s: string) => scrubSobre(s) as string

// ═══════════════════════════════════════════════════════════════════════════
// TABLA DE COLUMNAS DEL ESQUEMA REAL
//
// 📌 REGLA (obligatoria): AGREGAR UNA COLUMNA AL ESQUEMA OBLIGA A AGREGARLA
//    ACÁ. Toda migración en `supabase/` que sume una columna con datos de una
//    persona, de un negocio o con un importe entra en esta tabla en la MISMA
//    sesión. No es burocracia: es el único lugar donde queda escrito qué se
//    consideró al diseñar el filtro. Si no la agregás, el allowlist igual la
//    redacta (ese es el punto de invertirlo) — pero perdés la verificación.
//
// `permitida: true` = decisión DELIBERADA de que ese dato puede salir del
// navegador. Son ids, enums, conteos y la diferencia de caja. Todo lo demás
// se verifica que NO sale.
// ═══════════════════════════════════════════════════════════════════════════
interface ColumnaEsquema {
  tabla: string
  columna: string
  ejemplo: unknown
  permitida?: true
}

const COLUMNAS_DEL_ESQUEMA: ColumnaEsquema[] = [
  // ── restaurants / organizations (schema.sql, multi-tenant-rbac.sql)
  { tabla: 'restaurants', columna: 'name', ejemplo: 'Salchimelo Norte' },
  { tabla: 'restaurants', columna: 'address', ejemplo: 'Calle 45 #12-30' },
  { tabla: 'restaurants', columna: 'phone', ejemplo: '3001234567' },
  { tabla: 'restaurants', columna: 'logo_url', ejemplo: 'https://x.co/logo-juan-perez.png' },
  { tabla: 'restaurants', columna: 'slug', ejemplo: 'salchimelo-norte' },
  { tabla: 'restaurants', columna: 'kitchen_pin', ejemplo: 1234 },
  { tabla: 'restaurants', columna: 'nequi_qr_url', ejemplo: 'https://x.co/qr.png' },

  // ── profiles / roles (schema.sql, config-profile-active.sql)
  { tabla: 'profiles', columna: 'email', ejemplo: 'cajero@salchimelo.co' },
  { tabla: 'profiles', columna: 'full_name', ejemplo: 'Andres Camelo' },
  { tabla: 'profiles', columna: 'role', ejemplo: 'cashier' },
  { tabla: 'profiles', columna: 'is_active', ejemplo: false },
  { tabla: 'roles', columna: 'permissions', ejemplo: 'ventas.anular' },

  // ── categories / products (schema.sql, inventory-*.sql, compras-proveedores.sql)
  { tabla: 'categories', columna: 'description', ejemplo: 'Platos de la casa' },
  { tabla: 'categories', columna: 'color', ejemplo: '#6366f1' },
  { tabla: 'products', columna: 'description', ejemplo: 'Hamburguesa doble artesanal' },
  { tabla: 'products', columna: 'price', ejemplo: 12500 },
  { tabla: 'products', columna: 'cost_price', ejemplo: 8000 },
  { tabla: 'products', columna: 'image_url', ejemplo: 'https://x.co/fotos/juan-perez.jpg' },
  { tabla: 'products', columna: 'stock_tracking', ejemplo: true },
  { tabla: 'products', columna: 'qty', ejemplo: 12, permitida: true },
  { tabla: 'products', columna: 'stock_qty', ejemplo: -3, permitida: true },
  { tabla: 'products', columna: 'min_stock', ejemplo: 5, permitida: true },
  { tabla: 'products', columna: 'kind', ejemplo: 'composite', permitida: true },

  // ── tables (schema.sql, tables-waiting-bill.sql)
  { tabla: 'tables', columna: 'zone', ejemplo: 'Terraza' },
  { tabla: 'tables', columna: 'capacity', ejemplo: 4 },
  { tabla: 'tables', columna: 'status', ejemplo: 'waiting_bill', permitida: true },

  // ── orders (schema.sql + delivery/numbering/vale/void/fiado)
  { tabla: 'orders', columna: 'customer_name', ejemplo: 'Juan Perez' },
  { tabla: 'orders', columna: 'customer_phone', ejemplo: '3009876543' },
  { tabla: 'orders', columna: 'waiter_name', ejemplo: 'Andres' },
  { tabla: 'orders', columna: 'delivery_address', ejemplo: 'Carrera 7 #45-12 apto 302' },
  { tabla: 'orders', columna: 'notes', ejemplo: 'Sin cebolla, para Pedro' },
  { tabla: 'orders', columna: 'total', ejemplo: 150000 },
  { tabla: 'orders', columna: 'discount_amount', ejemplo: 10000 },
  { tabla: 'orders', columna: 'discount_reason', ejemplo: 'Ruletazo de Ana' },
  { tabla: 'orders', columna: 'cancel_reason', ejemplo: 'Cliente se arrepintio' },
  { tabla: 'orders', columna: 'estimated_delivery_minutes', ejemplo: 30 },
  { tabla: 'orders', columna: 'order_number', ejemplo: 1247, permitida: true },
  { tabla: 'orders', columna: 'payment_status', ejemplo: 'partial', permitida: true },
  { tabla: 'orders', columna: 'discount_kind', ejemplo: 'vale', permitida: true },
  { tabla: 'orders', columna: 'discount_type', ejemplo: 'fixed', permitida: true },
  { tabla: 'orders', columna: 'type', ejemplo: 'delivery', permitida: true },

  // ── order_items / order_item_extras / extras
  { tabla: 'order_items', columna: 'unit_price', ejemplo: 12500 },
  { tabla: 'order_items', columna: 'modifiers', ejemplo: 'para Pedro' },
  { tabla: 'order_items', columna: 'sent_to_kitchen', ejemplo: true },
  { tabla: 'order_item_extras', columna: 'unit_price', ejemplo: 2000 },
  { tabla: 'extras', columna: 'price', ejemplo: 2000 },

  // ── payments / debt_payments (schema.sql, fiado-clientes.sql)
  { tabla: 'payments', columna: 'amount', ejemplo: 45000 },
  { tabla: 'payments', columna: 'method', ejemplo: 'nequi', permitida: true },
  { tabla: 'debt_payments', columna: 'payment_method', ejemplo: 'transfer', permitida: true },

  // ── cash_shifts / cash_movements (caja-cierre-cuadre.sql, shift-reconciliation.sql)
  { tabla: 'cash_shifts', columna: 'opening_amount', ejemplo: 200000 },
  { tabla: 'cash_shifts', columna: 'closing_amount', ejemplo: 450000 },
  { tabla: 'cash_shifts', columna: 'expected_amount', ejemplo: 455000 },
  { tabla: 'cash_shifts', columna: 'expected', ejemplo: 455000 },
  { tabla: 'cash_shifts', columna: 'declared', ejemplo: 450000 },
  { tabla: 'cash_shifts', columna: 'expected_total', ejemplo: 455000 },
  { tabla: 'cash_shifts', columna: 'declared_total', ejemplo: 450000 },
  { tabla: 'cash_shifts', columna: 'close_comment', ejemplo: 'Faltaron 20.000, los puso Ana' },
  { tabla: 'cash_shifts', columna: 'difference', ejemplo: -5000, permitida: true },
  { tabla: 'cash_shifts', columna: 'sales_count', ejemplo: 37, permitida: true },
  { tabla: 'cash_movements', columna: 'amount', ejemplo: 30000 },
  { tabla: 'cash_movements', columna: 'reason', ejemplo: 'Adelanto a Carlos' },

  // ── customers / suppliers (fiado-clientes.sql, compras-proveedores.sql)
  // `document` es EL caso que motivó todo esto: texto libre con placeholder
  // "C.C. / NIT" donde un cajero escribe un nombre completo.
  { tabla: 'customers', columna: 'document', ejemplo: 'CC 79123456 Juan Perez' },
  { tabla: 'suppliers', columna: 'document', ejemplo: 900123456 },
  { tabla: 'suppliers', columna: 'contact_name', ejemplo: 'Maria Gomez' },

  // ── purchase_invoices / items (compras-proveedores.sql)
  { tabla: 'purchase_invoices', columna: 'invoice_number', ejemplo: 'FV-00123' },
  { tabla: 'purchase_invoices', columna: 'total', ejemplo: 340000 },
  { tabla: 'purchase_invoice_items', columna: 'unit_cost', ejemplo: 8000 },
  { tabla: 'purchase_invoice_items', columna: 'subtotal', ejemplo: 96000 },

  // ── couriers / stock_movements / store_sequences
  { tabla: 'couriers', columna: 'name', ejemplo: 'Wilson Mora' },
  { tabla: 'couriers', columna: 'phone', ejemplo: '3012223344' },
  { tabla: 'stock_movements', columna: 'notes', ejemplo: 'Ajuste hecho por Ana' },
  { tabla: 'stock_movements', columna: 'reference_id', ejemplo: '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d', permitida: true },
  { tabla: 'store_sequences', columna: 'last_order_number', ejemplo: 1247 },
]

const PROHIBIDAS = COLUMNAS_DEL_ESQUEMA.filter((c) => !c.permitida)
const PERMITIDAS = COLUMNAS_DEL_ESQUEMA.filter((c) => c.permitida)

describe('esquema real — NINGUNA columna sensible sale, en ninguna posición', () => {
  it.each(PROHIBIDAS)(
    '$columna (tabla $tabla) no sale como clave de primer nivel de `extra`',
    ({ columna, ejemplo }) => {
      expect(ev({ [columna]: ejemplo })).not.toContain(String(ejemplo))
    },
  )

  it.each(PROHIBIDAS)(
    '$columna (tabla $tabla) no sale anidada a 3 niveles',
    ({ columna, ejemplo }) => {
      expect(ev({ fila: { datos: { [columna]: ejemplo } } })).not.toContain(String(ejemplo))
    },
  )

  it.each(PROHIBIDAS)(
    '$columna (tabla $tabla) no sale dentro de un array (los elementos no tienen clave)',
    ({ columna, ejemplo }) => {
      expect(ev({ filas: [{ [columna]: ejemplo }] })).not.toContain(String(ejemplo))
    },
  )

  it.each(PROHIBIDAS.filter((c) => typeof c.ejemplo === 'number'))(
    '$columna (tabla $tabla) tampoco sale si viene como STRING (PostgREST puede mandar numeric como texto)',
    ({ columna, ejemplo }) => {
      expect(ev({ [columna]: String(ejemplo) })).not.toContain(String(ejemplo))
    },
  )

  it('una columna INVENTADA (que nadie agregó a ninguna lista) tampoco sale', () => {
    // Este es el test que la deny-list no podía pasar: el modo de falla por
    // default. Cubre la columna que se agregue mañana y nadie declare acá.
    expect(ev({ columna_del_futuro: 'Juan Perez' })).not.toContain('Juan Perez')
    expect(ev({ columna_del_futuro: 79123456 })).not.toContain('79123456')
    expect(ev({ nested: { otra_mas: 900123456 } })).not.toContain('900123456')
  })
})

describe('superficie declarada segura — lo que SÍ sale, a propósito', () => {
  // El complemento del test anterior: deja por escrito la superficie completa
  // de datos que aceptamos mandar a un servicio externo. Si alguien amplía el
  // allowlist sin pensarlo, esta lista crece y se ve en el diff.
  it.each(PERMITIDAS)('$columna (tabla $tabla) viaja (decisión deliberada)', ({ columna, ejemplo }) => {
    expect(est({ [columna]: ejemplo })[columna]).toEqual(ejemplo)
  })

  it('el allowlist es FAIL-CLOSED por forma: la clave sola no alcanza', () => {
    // Una clave permitida con un valor de forma inesperada se redacta igual.
    // Es lo que impide que `order_number: 'Juan Perez 3001234567'` pase por ser
    // "de confianza".
    expect(est({ order_number: 'Juan Perez 3001234567' }).order_number)
      .toBe('[Filtrado:string(21)]')
    expect(est({ id: 'no-es-un-uuid' }).id).toBe('[Filtrado:string(13)]')
    expect(est({ qty: 'muchos' }).qty).toBe('[Filtrado:string(6)]')
    expect(est({ difference: 'cuadra' }).difference).toBe('[Filtrado:string(6)]')
  })

  it('la denylist gana sobre el allowlist (allowlist ∧ ¬denylist)', () => {
    // Aunque el valor tenga la forma correcta y la clave esté en el allowlist.
    expect(est({ customer_phone: 3001234567 }).customer_phone).toBe('[Filtrado]')
    // `customer_id` cae por contener `customer`: fail-closed deliberado, un
    // UUID de cliente es un puntero directo a la ficha de una persona.
    expect(est({ customer_id: '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d' }).customer_id)
      .toBe('[Filtrado]')
  })
})

describe('el agujero estructural que cerró el allowlist', () => {
  // Los tres comportamientos MEDIDOS que motivaron la inversión del filtro.
  // Quedan como test de regresión: si alguien reintroduce un corte por tipo,
  // el primero se cae.
  it('un NUMBER bajo clave desconocida ya no pasa intacto', () => {
    // ANTES: `document: 900123456` → 900123456. La redacción numérica vivía
    // dentro de `scrubString` y solo alcanzaba a valores que ya eran strings.
    expect(est({ document: 900123456 }).document).toBe('[Filtrado:number]')
  })

  it('un NOMBRE PROPIO en texto libre ya no pasa', () => {
    // ANTES: 'CC 79123456 Juan Perez' → 'CC [monto] Juan Perez'. Ninguna regex
    // reconoce un nombre propio: por eso el filtro tiene que ser por CLAVE.
    expect(est({ document: 'CC 79123456 Juan Perez' }).document)
      .toBe('[Filtrado:string(22)]')
  })

  it('la PII bajo `supplier` ya no se escapa (bajo `customer` nunca se escapó)', () => {
    const out = est({ supplier: { document: 900123456, name: 'Distri SAS' } })
    expect(JSON.stringify(out)).not.toContain('900123456')
    expect(JSON.stringify(out)).not.toContain('Distri SAS')
  })

  it('la excepción numérica ya NO es inerte — el test que faltaba', () => {
    // Reemplaza al test viejo ("conserva identificadores numéricos"), que
    // pasaba por la razón equivocada: verificaba que un number bajo una clave
    // de la lista pasara, cuando TODOS los numbers pasaban bajo TODA clave.
    // Habría pasado idéntico con la lista vacía. La prueba real es el CONTRASTE.
    expect(est({ order_number: 1247 }).order_number).toBe(1247)
    expect(est({ clave_inventada: 1247 }).clave_inventada).toBe('[Filtrado:number]')
  })

  it('los valores SIN clave (arrays) ya no salen sueltos', () => {
    // ANTES: ['Juan Perez'] → ['Juan Perez']. Un array bajo clave desconocida
    // se colapsa: sus elementos no tienen clave que allowlistear.
    expect(est({ lista: ['Juan Perez', 'Maria Gomez'] }).lista).toBe('[Filtrado:array(2)]')
    expect(est({ lista: [79123456] }).lista).toBe('[Filtrado:array(1)]')
    // Bajo clave PERMITIDA sí se recorre, heredando la forma del padre.
    expect(est({ qty: [1, 2, 3] }).qty).toEqual([1, 2, 3])
    expect(est({ qty: [1, 'Juan Perez'] }).qty).toEqual([1, '[Filtrado:string(10)]'])
  })

  it('los jsonb del esquema quedan cubiertos hoja por hoja', () => {
    // close_reconciliation: pasa la DIFERENCIA, no los absolutos.
    const out = est({
      close_reconciliation: {
        methods: { cash: { expected: 455000, declared: 450000, difference: -5000 } },
        expected_total: 455000, declared_total: 450000, sales_count: 37,
      },
    })
    const cr = out.close_reconciliation as Record<string, never>
    const cash = (cr.methods as Record<string, Record<string, unknown>>).cash
    expect(cash.difference).toBe(-5000)
    expect(cash.expected).toBe('[Filtrado:number]')
    expect(cash.declared).toBe('[Filtrado:number]')
    expect(cr.expected_total).toBe('[Filtrado:number]')
    expect(cr.sales_count).toBe(37)
    // config: el PIN de cocina es una credencial, no un monto.
    expect(JSON.stringify(est({ config: { kitchen_pin: 1234 } }))).not.toContain('1234')
  })
})

describe('redacción tipada — lo que la hace vivible', () => {
  it('conserva la FORMA sin el contenido', () => {
    const out = est({ a: 'Juan Perez', b: 42, c: true, d: { x: 1, y: 2 }, e: [1, 2, 3] })
    expect(out.a).toBe('[Filtrado:string(10)]')
    expect(out.b).toBe('[Filtrado:number]')
    expect(out.c).toBe('[Filtrado:boolean]')
    // Los objetos NO se colapsan: se recorren, así se conserva el árbol.
    expect(out.d).toEqual({ x: '[Filtrado:number]', y: '[Filtrado:number]' })
    expect(out.e).toBe('[Filtrado:array(3)]')
  })

  it('distingue "vino null" de "vino algo que redactamos"', () => {
    // Es la pregunta más frecuente en triage y no cuesta nada responderla:
    // null y undefined no dicen nada de nadie.
    const out = est({ a: null, b: undefined, c: 0, d: '' })
    expect(out.a).toBeNull()
    expect(out.b).toBeUndefined()
    expect(out.c).toBe('[Filtrado:number]')
    expect(out.d).toBe('[Filtrado:string(0)]')
  })

  it('la PII conocida por la clave NO revela ni la forma', () => {
    // `[Filtrado]` a secas: si sabemos que es un teléfono, ni la longitud sale.
    expect(est({ customer_phone: '3001234567' }).customer_phone).toBe('[Filtrado]')
  })
})

describe('ruteo del evento — allowlist acotado, envelope intacto', () => {
  it('`extra` va por el allowlist estricto', () => {
    const out = scrubEvent({ extra: { document: 900123456, orderId: 'x' } }) as Record<string, Record<string, unknown>>
    expect(out.extra.document).toBe('[Filtrado:number]')
  })

  it('`tags` pasa por su allowlist INTERNO, no como subárbol opaco', () => {
    // ANTES estaba en CLAVE_INTOCABLE con el argumento "lo construimos nosotros
    // y ya está curado" — la misma suposición que falló con `document`.
    const out = scrubEvent({
      tags: { organizacion: 'Salchimelo', sede: 'Sede Norte', rol: 'cajero', area: 'cobro' },
    }) as Record<string, Record<string, unknown>>
    expect(out.tags).toEqual({
      organizacion: 'Salchimelo', sede: 'Sede Norte', rol: 'cajero', area: 'cobro',
    })
    // Un tag que nadie declaró no viaja, por más inocente que parezca.
    const sucio = scrubEvent({ tags: { cliente: 'Juan Perez', tel: '3001234567' } }) as Record<string, Record<string, unknown>>
    expect(JSON.stringify(sucio)).not.toContain('Juan Perez')
    expect(JSON.stringify(sucio)).not.toContain('3001234567')
  })

  it('`user` manda SOLO el UUID: nunca email ni nombre', () => {
    const out = scrubEvent({
      user: { id: '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d', email: 'a@b.co', full_name: 'Andres Camelo' },
    }) as Record<string, Record<string, unknown>>
    expect(out.user.id).toBe('3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d')
    expect(JSON.stringify(out)).not.toContain('Andres Camelo')
    expect(JSON.stringify(out)).not.toContain('a@b.co')
  })

  it('un `user` ANIDADO en extra tampoco se escapa', () => {
    // El agujero medido: `user` era intocable en CUALQUIER nivel del árbol.
    const out = est({ user: { email: 'cajero@salchimelo.co', full_name: 'Andres Camelo' } })
    expect(JSON.stringify(out)).not.toContain('Andres Camelo')
    expect(JSON.stringify(out)).not.toContain('cajero@salchimelo.co')
  })

  it('el stack trace pasa INTACTO — única excepción de subárbol', () => {
    // Si el redactor numérico tocara `filename`, Sentry no podría mapear el
    // source map y el evento deja de servir para cualquier cosa.
    const stacktrace = {
      frames: [{ filename: 'https://app.co/assets/index-4f2a9c1e.js', lineno: 1234, function: 'handleConfirm' }],
    }
    const out = scrubEvent({ exception: { values: [{ type: 'TypeError', stacktrace }] } }) as Record<string, never>
    expect(JSON.stringify(out)).toContain('index-4f2a9c1e.js')
    expect(JSON.stringify(out)).toContain('1234')
  })

  it('el envelope conserva lo que Sentry necesita para agrupar', () => {
    const out = scrubEvent({
      event_id: 'abc123', level: 'error', platform: 'javascript',
      release: '1.4.0', environment: 'production',
      exception: { values: [{ type: 'PostgrestError', value: 'turno ya cerrado' }] },
    }) as Record<string, unknown>
    expect(out.event_id).toBe('abc123')
    expect(out.release).toBe('1.4.0')
    expect(JSON.stringify(out)).toContain('PostgrestError')
    expect(JSON.stringify(out)).toContain('turno ya cerrado')
  })

  it('un breadcrumb de fetch conserva ruta y código HTTP', () => {
    const out = scrubEvent({
      breadcrumbs: [{
        category: 'fetch', level: 'error', type: 'http',
        data: { url: 'https://xyz.supabase.co/rest/v1/orders', status_code: 409 },
      }],
    })
    expect(JSON.stringify(out)).toContain('/rest/v1/orders')
    expect(JSON.stringify(out)).toContain('409')
  })
})

describe('scrubString — el redactor de PROSA (donde no hay clave que mirar)', () => {
  it('redacta montos y teléfonos sueltos dentro de un mensaje', () => {
    expect(str('La suma de los pagos (45000) no coincide con el total (50000)'))
      .toBe('La suma de los pagos ([monto]) no coincide con el total ([monto])')
    expect(str('Saldo pendiente: $ 1.250.000')).toBe('Saldo pendiente: [monto]')
    expect(str('Contacto 3001234567')).toBe('Contacto [Filtrado]')
  })

  it('redacta el VALOR del detalle de Postgres, conservando la columna', () => {
    // Una violación de constraint echa el valor ofensor en el mensaje: es la
    // fuga de PII menos obvia de todas.
    expect(str('duplicate key value violates unique constraint. Key (phone)=(3001234567) already exists.'))
      .toBe('duplicate key value violates unique constraint. Key (phone)=([Filtrado]) already exists.')
  })

  it('redacta emails en cualquier posición', () => {
    expect(str('login falló para cajero@salchimelo.co')).toBe('login falló para [Filtrado]')
  })

  it('un móvil disfrazado de número de orden se redacta igual', () => {
    expect(str('cliente #3001234567')).toBe('cliente #[Filtrado]')
  })

  it('conserva UUID, fechas ISO y el correlativo #N', () => {
    const id = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
    expect(str(`falló el UPDATE de la orden ${id}`)).toBe(`falló el UPDATE de la orden ${id}`)
    expect(str('turno abierto en 2026-08-05T14:30:00.000Z')).toBe('turno abierto en 2026-08-05T14:30:00.000Z')
    expect(str('no se pudo anular la orden #1234')).toBe('no se pudo anular la orden #1234')
  })

  it('las claves de PROSA del allowlist llegan legibles', () => {
    const out = est({
      error: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "idx_orders_number"',
        details: 'Key (restaurant_id, order_number)=(a1b2, 1247) already exists.',
        hint: null,
      },
    })
    const err = out.error as Record<string, unknown>
    // `code` es lo MÁS útil de un PostgrestError y la deny-list lo destruía:
    // '23505' son 5 dígitos y RE_NUM_LARGO lo convertía en '[monto]'.
    expect(err.code).toBe('23505')
    expect(err.message).toContain('idx_orders_number')
    expect(err.details).toContain('Key (restaurant_id, order_number)=([Filtrado])')
    expect(err.hint).toBeNull()
  })
})

describe('error REAL de G-Vento — el evento completo', () => {
  it('el correlativo perdido llega diagnosticable y sin PII', () => {
    // supabase-helpers.ts:496 — `captureIssue('Venta cobrada sin número: falló
    // el UPDATE del correlativo', 'numeracion', {...})`.
    const out = scrubEvent({
      message: 'Venta cobrada sin número: falló el UPDATE del correlativo',
      tags: { area: 'numeracion', organizacion: 'Salchimelo', sede: 'Sede Norte', rol: 'cajero' },
      extra: {
        orderId: '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
        restaurantId: 'a1b2c3d4-1111-4222-8333-444455556666',
        numeroPerdido: 1247,
        intentos: 3,
        error: { code: '23505', message: 'duplicate key value violates unique constraint', details: null, hint: null },
      },
    }) as Record<string, Record<string, unknown>>

    // Todo lo que hace accionable el error sobrevive…
    expect(out.extra.orderId).toBe('3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d')
    expect(out.extra.restaurantId).toBe('a1b2c3d4-1111-4222-8333-444455556666')
    expect(out.extra.numeroPerdido).toBe(1247)
    expect(out.extra.intentos).toBe(3)
    expect((out.extra.error as Record<string, unknown>).code).toBe('23505')
    expect(out.tags.sede).toBe('Sede Norte')
    expect(out.message).toBe('Venta cobrada sin número: falló el UPDATE del correlativo')
  })

  it('un cobro fallido con la fila cruda adjunta no filtra al cliente', () => {
    const out = scrubEvent({
      extra: {
        origen: 'Mesa', esFiado: false, pagoDividido: true, conDescuento: true, esVale: false,
        orden: {
          id: '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
          customer_name: 'Juan Perez', customer_phone: '3001234567',
          total: 150000, discount_amount: 10000, order_number: 1247,
          notes: 'sin cebolla', payment_status: 'paid',
        },
        cliente: { name: 'Juan Perez', document: 79123456, phone: '3001234567' },
      },
    })
    const json = JSON.stringify(out)
    // Nada del cliente, ni su importe.
    expect(json).not.toContain('Juan Perez')
    expect(json).not.toContain('3001234567')
    expect(json).not.toContain('79123456')
    expect(json).not.toContain('150000')
    // Pero sí la rama del flujo y la orden a mirar en la BD.
    expect(json).toContain('3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d')
    expect(json).toContain('Mesa')
    expect(json).toContain('1247')
    expect(json).toContain('paid')
  })
})

/**
 * Los marcadores internos que `scrubString` usa para salvar UUID, fechas ISO y
 * correlativos de la pasada numérica van delimitados por NUL.
 *
 * Estos tests fijan esa decisión. Con delimitadores más "legibles" —espacios,
 * por ejemplo— el marcador choca con el texto real del mensaje y lo corrompe:
 * un `0` suelto se restaura como un UUID, y un índice sin valor emite
 * literalmente `undefined`. Se descubrió al portar este módulo a G-Centro,
 * donde el NUL se perdió al copiar el archivo y el bug apareció entero.
 */
describe('integridad de los marcadores internos de scrubString', () => {
  const UUID = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
  const NUL = String.fromCharCode(0)

  it('no confunde un dígito suelto del mensaje con un marcador', () => {
    expect(str(`reintento 0 de 3 para la orden ${UUID}`)).toBe(
      `reintento 0 de 3 para la orden ${UUID}`,
    )
  })

  it('nunca emite `undefined` por un índice que no existe', () => {
    expect(str('código 7 rechazado')).toBe('código 7 rechazado')
  })

  it('un NUL en la entrada no puede falsificar un marcador', () => {
    expect(str(`${NUL}0${NUL} dato ${UUID}`)).toBe(`0 dato ${UUID}`)
  })

  it('soporta más de mil marcadores en un mismo string', () => {
    // El índice cruza los 4 dígitos y queda al alcance de RE_NUM_LARGO
    // (`\b\d{4,}\b`), que lo convertiría en `[monto]` y rompería la
    // restauración. Improbable en la práctica, pero es exactamente el tipo de
    // borde que nadie vuelve a mirar.
    const entrada = Array.from({ length: 1001 }, () => UUID).join(' ')
    expect(str(entrada)).toBe(entrada)
  })
})

describe('robustez', () => {
  it('corta la recursión en estructuras cíclicas sin colgarse', () => {
    const ciclo: Record<string, unknown> = { nivel: 1 }
    ciclo.self = ciclo
    expect(() => scrubEstricto(ciclo)).not.toThrow()
    expect(() => scrubSobre(ciclo)).not.toThrow()
    expect(() => scrubEvent({ extra: ciclo })).not.toThrow()
  })

  it('no rompe con entradas que no son objetos', () => {
    expect(() => scrubEvent(null)).not.toThrow()
    expect(() => scrubEvent('texto suelto')).not.toThrow()
    expect(scrubEstricto(undefined)).toBeUndefined()
  })
})
