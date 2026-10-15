import { describe, expect, it } from 'vitest'
import { avisoProducto, sePuedePublicar,
  etiquetaTramo, franjasLegibles, horaLegible, horarioAgrupado, leerPesos, mostrarPesos, mostrarWhatsapp,
  normalizarSlug, normalizarWhatsapp, problemaHorario, problemaTramos, RE_WHATSAPP, slugValido, textoEstado,
} from './portal'
import { CASOS_SLUG, CASOS_WHATSAPP } from './portalCasos'

describe('link del portal', () => {
  it('normaliza lo que se escribe: minúsculas, sin tildes ni eñes, espacios a guiones', () => {
    expect(normalizarSlug('Salchimelo Norte')).toBe('salchimelo-norte')
    expect(normalizarSlug('  Café Aroma  ')).toBe('cafe-aroma-')
    expect(normalizarSlug('Piñata & Co.')).toBe('pinata-co-')
    expect(normalizarSlug('--G10--')).toBe('g10-')
  })
  it('el formato es el mismo del CHECK: los casos compartidos con el servidor (CASOS_SLUG)', () => {
    // El otro lado (portal_slug_disponible) los corre tests/portal-config.spec.ts, test "link".
    expect(CASOS_SLUG.map((c) => `${c.slug}: ${slugValido(c.slug)}`)).toEqual(CASOS_SLUG.map((c) => `${c.slug}: ${c.valido}`))
    // Solo del navegador: sin normalizar, una mayúscula no pasa (la pantalla normaliza antes).
    expect(slugValido('Abc')).toBe(false)
  })
})

describe('horario', () => {
  it('muestra las horas como la pantalla 4', () => {
    expect(horaLegible('17:00')).toBe('5:00 p. m.')
    expect(horaLegible('00:00')).toBe('12:00 a. m.')
    expect(horaLegible('12:30')).toBe('12:30 p. m.')
    expect(franjasLegibles([])).toBe('Cerrado')
  })
  it('agrupa días seguidos con el mismo horario', () => {
    const h = { '3': [['17:00', '23:30']], '4': [['17:00', '23:30']], '5': [['17:00', '23:30']],
                '6': [['16:00', '00:00']], '7': [['16:00', '00:00']] } as const
    expect(horarioAgrupado(h as never)).toEqual([
      { dias: 'Lunes y martes', horas: 'Cerrado' },
      { dias: 'Miércoles a viernes', horas: '5:00 p. m. – 11:30 p. m.' },
      { dias: 'Sábado y domingo', horas: '4:00 p. m. – 12:00 a. m.' },
    ])
  })
  it('avisa lo que el servidor rechazaría (y nada más)', () => {
    expect(problemaHorario({ '1': [['17:00', '23:00']], '6': [['16:00', '01:00']] })).toBeNull()
    expect(problemaHorario({ '2': [['17:00', '17:00']] })).toMatch(/Martes/)
    expect(problemaHorario({ '1': [['5pm', '23:00']] })).toMatch(/HH:MM/)
    expect(problemaHorario({ '1': [['1:00', '2:00'], ['3:00', '4:00'], ['5:00', '6:00'], ['7:00', '8:00']] } as never)).toMatch(/3 franjas/)
  })
})

describe('envío por distancia', () => {
  const ok = [{ hasta_km: 2, valor: 3000 }, { hasta_km: 4, valor: 4000 }, { hasta_km: null, valor: 6000 }]
  it('acepta los tramos de la pantalla 4 y los rotula igual', () => {
    expect(problemaTramos(ok)).toBeNull()
    expect(ok.map((_, i) => etiquetaTramo(ok, i))).toEqual(['Hasta 2 km', '2 a 4 km', 'Más de 4 km, dentro de la zona'])
  })
  it('rechaza km que no crecen, un último tramo con límite o valores fuera de rango', () => {
    expect(problemaTramos([{ hasta_km: 4, valor: 1 }, { hasta_km: 2, valor: 1 }, { hasta_km: null, valor: 1 }])).toMatch(/menor a mayor/)
    expect(problemaTramos([{ hasta_km: 2, valor: 1 }, { hasta_km: 5, valor: 1 }])).toMatch(/último tramo/)
    expect(problemaTramos([{ hasta_km: null, valor: -1 }])).toMatch(/valor/)
    expect(problemaTramos([])).toMatch(/1 a 10/)
  })
})

describe('WhatsApp del local', () => {
  it('normaliza a 57 + 10 dígitos lo que se escribe o el teléfono de la sede, y lo muestra', () => {
    expect(['300 123 4567', '+57 300 123 4567', '(601) 234-5678', '573001234567'].map(normalizarWhatsapp))
      .toEqual(['573001234567', '573001234567', '576012345678', '573001234567'])
    // El teléfono de prueba de LAB (0000000001) no es un número de Colombia: no se sugiere.
    expect(['', null, '123', '1 300 123 4567', '583001234567', '0000000001'].map(normalizarWhatsapp))
      .toEqual([null, null, null, null, null, null])
    expect(mostrarWhatsapp('573001234567')).toBe('300 123 4567')
    expect(mostrarWhatsapp(null)).toBe('')
  })
  it('el formato es el mismo del CHECK: los casos compartidos con el servidor (CASOS_WHATSAPP)', () => {
    expect(CASOS_WHATSAPP.map((c) => `${c.numero}: ${RE_WHATSAPP.test(c.numero)}`))
      .toEqual(CASOS_WHATSAPP.map((c) => `${c.numero}: ${c.valido}`))
  })
})

describe('pesos', () => {
  it('lee solo dígitos y muestra con puntos de miles', () => {
    expect(leerPesos('$ 15.000')).toBe(15000)
    expect(leerPesos('')).toBeNull()
    expect(mostrarPesos(15000)).toBe('15.000')
    expect(mostrarPesos(null)).toBe('')
  })
})

describe('estado', () => {
  it('un texto por motivo; el estado lo decide el servidor', () => {
    expect(textoEstado({ recibe: true, motivo: null, faltantes: [] }).titulo).toBe('Recibiendo pedidos')
    expect(textoEstado({ recibe: false, motivo: 'incompleto', faltantes: ['el horario', 'la zona de cobertura'] }).detalle)
      .toBe('Falta: el horario; la zona de cobertura.')
    expect(textoEstado({ recibe: false, motivo: 'pausado', faltantes: [] }).tono).toBe('pausa')
  })
})

describe('productos del portal: la pantalla decide con el motivo de la regla del servidor (allowlist)', () => {
  it('se puede marcar solo con null, sin_publicar, agotado, o sin_precio resuelto por el precio escrito', () => {
    const casos: [string | null, number | null][] = [[null, null], ['sin_publicar', null], ['agotado', null],
      ['sin_precio', null], ['sin_precio', 5000], ['categoria_inactiva', 5000], ['inactivo', null], ['motivo_nuevo', 5000]]
    expect(casos.map(([m, pr]) => `${m}/${pr}: ${sePuedePublicar(m, pr)}`)).toEqual([
      'null/null: true', 'sin_publicar/null: true', 'agotado/null: true', 'sin_precio/null: false',
      'sin_precio/5000: true', 'categoria_inactiva/5000: false', 'inactivo/null: false', 'motivo_nuevo/5000: false'])
  })
  it('cada motivo tiene su aviso; uno desconocido, el genérico (nunca el código crudo)', () => {
    expect(avisoProducto('categoria_inactiva', null, true)).toMatch(/Despublícalo/)
    expect(avisoProducto('categoria_inactiva', null, false)).not.toMatch(/Despublícalo/)
    expect([avisoProducto('sin_precio', null, false), avisoProducto('sin_precio', 5000, false)]).toEqual(['No se publica: no tiene precio', ''])
    expect(avisoProducto('motivo_nuevo', null, false)).toBe('No se puede publicar en el portal')
    expect([avisoProducto(null, null, true), avisoProducto('sin_publicar', null, false)]).toEqual(['', ''])
    // Sin publicar pero agotado hoy: también avisa (la regla pone sin_publicar antes que agotado).
    expect([avisoProducto('sin_publicar', null, false, true), avisoProducto(null, null, true, true)])
      .toEqual(['Agotado hoy · no se puede pedir', 'Agotado hoy · no se puede pedir'])
  })
})
