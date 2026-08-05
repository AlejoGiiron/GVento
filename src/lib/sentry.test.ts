import { describe, it, expect } from 'vitest'
import { scrubValue } from './sentry'

/**
 * Estos tests SON la política de privacidad, no su documentación.
 *
 * G-Vento maneja PII de los clientes de nuestros clientes. Si alguien afloja el
 * redactor, acá se cae — y se entera antes de mandarle datos de un tercero a un
 * servicio externo.
 */

const scrub = (v: unknown) => scrubValue(v) as Record<string, unknown>
const scrubStr = (s: string) => scrubValue(s) as string

describe('scrubValue — lo que NUNCA debe salir', () => {
  it('redacta el valor de claves con PII del dominio', () => {
    const out = scrub({
      customer_name: 'Juan Pérez',
      customer_phone: '3001234567',
      delivery_address: 'Calle 45 #12-30',
      waiter_name: 'Andrés',
      full_name: 'María Gómez',
      email: 'cliente@correo.com',
    })
    for (const v of Object.values(out)) expect(v).toBe('[Filtrado]')
  })

  it('redacta el TEXTO LIBRE que escribe el cajero', () => {
    // `notes`, `reason` y `comment` son campos abiertos: ahí termina cualquier
    // cosa, incluido "Juan el del taller, 3001234567".
    const out = scrub({
      notes: 'Sin cebolla — llamar al 3009876543',
      reason: 'Adelanto a Carlos',
      close_comment: 'Faltaron 20.000, los puso Ana',
    })
    expect(out.notes).toBe('[Filtrado]')
    expect(out.reason).toBe('[Filtrado]')
    expect(out.close_comment).toBe('[Filtrado]')
  })

  it('redacta montos y teléfonos sueltos dentro de un mensaje', () => {
    expect(scrubStr('La suma de los pagos (45000) no coincide con el total (50000)'))
      .toBe('La suma de los pagos ([monto]) no coincide con el total ([monto])')
    expect(scrubStr('Saldo pendiente: $ 1.250.000')).toBe('Saldo pendiente: [monto]')
    // El móvil colombiano se etiqueta como PII, no como monto: es más preciso
    // y deja claro en Sentry que ahí había un teléfono.
    expect(scrubStr('Contacto 3001234567')).toBe('Contacto [Filtrado]')
  })

  it('redacta el VALOR del detalle de Postgres, conservando la columna', () => {
    // Una violación de constraint echa el valor ofensor en el mensaje: es la
    // fuga de PII menos obvia de todas.
    expect(
      scrubStr('duplicate key value violates unique constraint. Key (phone)=(3001234567) already exists.'),
    ).toBe('duplicate key value violates unique constraint. Key (phone)=([Filtrado]) already exists.')
  })

  it('redacta emails en cualquier posición', () => {
    expect(scrubStr('login falló para cajero@salchimelo.co')).toBe('login falló para [Filtrado]')
  })

  it('las excepciones de legibilidad NO abren una fuga', () => {
    // Un móvil colombiano disfrazado de número de orden se redacta igual: la
    // regla del móvil corre ANTES de preservar `#N`.
    expect(scrubStr('cliente #3001234567')).toBe('cliente #[Filtrado]')
    // El allowlist es FAIL-CLOSED: bajo una clave de confianza solo pasa un
    // number. Un string ahí se redacta entero — el redactor de texto no sabe
    // detectar nombres propios sueltos, así que no se lo deja "a medias".
    expect(scrub({ order_number: 'Juan Pérez 3001234567' }).order_number)
      .toBe('[Filtrado]')
    // Y una clave sensible gana sobre el allowlist aunque el valor sea número.
    expect(scrub({ customer_phone: 3001234567 }).customer_phone).toBe('[Filtrado]')
  })

  it('redacta PII anidada en profundidad', () => {
    const out = scrub({ extra: { orden: { items: [{ notes: 'para Pedro' }] } } })
    const extra = out.extra as { orden: { items: { notes: string }[] } }
    expect(extra.orden.items[0].notes).toBe('[Filtrado]')
  })
})

describe('scrubValue — lo que SÍ debe llegar (o el error no sirve)', () => {
  it('conserva los UUID: identifican la orden sin identificar a nadie', () => {
    const id = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
    expect(scrubStr(`falló el UPDATE de la orden ${id}`)).toBe(
      `falló el UPDATE de la orden ${id}`,
    )
  })

  it('conserva las fechas ISO sin convertirlas en [monto]', () => {
    // El año son 4 dígitos: sin la protección explícita, `2026-08-05` salía
    // como `[monto]-08-05` y se perdía la ventana temporal del turno.
    expect(scrubStr('turno abierto en 2026-08-05T14:30:00.000Z')).toBe(
      'turno abierto en 2026-08-05T14:30:00.000Z',
    )
  })

  it('conserva el contexto multi-tenant que hace útil el error', () => {
    const out = scrub({
      tags: { organizacion: 'Salchimelo', sede: 'Sede Norte', rol: 'cajero', area: 'cobro' },
    })
    expect(out.tags).toEqual({
      organizacion: 'Salchimelo', sede: 'Sede Norte', rol: 'cajero', area: 'cobro',
    })
  })

  it('conserva el stack trace intacto', () => {
    // `filename` lleva hashes de chunk con dígitos largos: si el redactor
    // numérico los tocara, Sentry no podría mapear el source map.
    const stacktrace = {
      frames: [{ filename: 'https://app.co/assets/index-4f2a9c1e.js', lineno: 1234, function: 'handleConfirm' }],
    }
    const out = scrub({ stacktrace })
    expect(out.stacktrace).toEqual(stacktrace)
  })

  it('conserva el tipo de error y el mensaje de negocio legible', () => {
    const out = scrub({ type: 'PostgrestError', mensaje: 'turno ya cerrado' })
    expect(out.type).toBe('PostgrestError')
    expect(out.mensaje).toBe('turno ya cerrado')
  })

  it('conserva el correlativo de venta escrito con # (excepción 1)', () => {
    // Los correlativos arrancan en 1 POR SEDE y cruzan los 4 dígitos en pocos
    // meses: sin esta excepción el diagnóstico decía "la orden #[monto]".
    expect(scrubStr('no se pudo anular la orden #1234')).toBe(
      'no se pudo anular la orden #1234',
    )
    expect(scrubStr('Venta #98765 cobrada sin número')).toBe(
      'Venta #98765 cobrada sin número',
    )
  })

  it('conserva identificadores numéricos estructurados (excepción 2)', () => {
    const out = scrub({ numeroPerdido: 1234, qty: 1500, cantidadItems: 12, count: 9999 })
    expect(out).toEqual({ numeroPerdido: 1234, qty: 1500, cantidadItems: 12, count: 9999 })
  })

  it('no rompe con null, undefined ni booleanos', () => {
    const out = scrub({ a: null, b: undefined, c: true, d: 42 })
    expect(out).toEqual({ a: null, b: undefined, c: true, d: 42 })
  })

  it('corta la recursión en estructuras cíclicas sin colgarse', () => {
    const ciclo: Record<string, unknown> = { nivel: 1 }
    ciclo.self = ciclo
    expect(() => scrubValue(ciclo)).not.toThrow()
  })
})
