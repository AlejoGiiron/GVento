import { describe, it, expect, vi, afterEach } from 'vitest'
import { leerPosMovil, POS_MOVIL_DEFAULT, esRutaMovil, puedeCobrar, debeIrAMovil, traerTodo, diaBogota } from './posMovil'

const COCTEL = '3f1c2a9e-0b7d-4c55-9a21-6c0f8d2e4b17'

describe('leerPosMovil', () => {
  it('sin config → valores por defecto', () => {
    expect(leerPosMovil(undefined)).toEqual(POS_MOVIL_DEFAULT)
    expect(leerPosMovil('basura')).toEqual(POS_MOVIL_DEFAULT)
  })
  it('campo por campo: lo malo toma el default SIN tirar lo bueno', () => {
    expect(leerPosMovil({ fijados: [COCTEL], mas_vendidos: { cantidad: 'diez', dias: 7 } }))
      .toEqual({ fijados: [COCTEL], mas_vendidos: { cantidad: 8, dias: 7 } })
  })
  it('fijados: descarta lo que no es UUID (no se resuelve por nombre) y los repetidos, conserva el orden', () => {
    const otro = '00000000-0000-4000-8000-000000000001'
    expect(leerPosMovil({ fijados: ['Lab Coctel', COCTEL, 7, otro, COCTEL] }).fijados).toEqual([COCTEL, otro])
  })
  it('límites: cantidad 0..24, días 1..90, enteros', () => {
    expect(leerPosMovil({ mas_vendidos: { cantidad: 25, dias: 0 } }).mas_vendidos).toEqual(POS_MOVIL_DEFAULT.mas_vendidos)
    expect(leerPosMovil({ mas_vendidos: { cantidad: 2.5, dias: 91 } }).mas_vendidos).toEqual(POS_MOVIL_DEFAULT.mas_vendidos)
    expect(leerPosMovil({ mas_vendidos: { cantidad: 0, dias: 90 } }).mas_vendidos).toEqual({ cantidad: 0, dias: 90 })
  })
})

describe('esRutaMovil', () => {
  it('/m y sus subrutas sí; /mesas NO (empieza con "/m")', () => {
    expect(esRutaMovil('/m')).toBe(true)
    expect(esRutaMovil('/m/ventas')).toBe(true)
    expect(esRutaMovil('/mesas')).toBe(false)
    expect(esRutaMovil('/ventas')).toBe(false)
  })
})

describe('puedeCobrar (mismo criterio que register_pos_sale)', () => {
  it('admin y cashier sí; waiter y sin rol no', () => {
    expect(puedeCobrar('admin')).toBe(true)
    expect(puedeCobrar('cashier')).toBe(true)
    expect(puedeCobrar('waiter')).toBe(false)
    expect(puedeCobrar(null)).toBe(false)
  })
})

describe('debeIrAMovil', () => {
  afterEach(() => vi.unstubAllGlobals())
  const equipo = (tactil: boolean, ancho: number, alto: number, completa = false) => {
    const store = new Map<string, string>(completa ? [['gvento.versionCompleta', '1']] : [])
    vi.stubGlobal('window', { matchMedia: () => ({ matches: tactil }), screen: { width: ancho, height: alto } })
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => store.get(k) ?? null })
  }

  it('celular + cajero + fuera de /m → sí', () => {
    equipo(true, 390, 844)
    expect(debeIrAMovil('cashier', '/ventas')).toBe(true)
  })
  it('celular ACOSTADO (lado corto < 600) → sí', () => {
    equipo(true, 844, 390)
    expect(debeIrAMovil('cashier', '/ventas')).toBe(true)
  })
  it('tablet (lado corto ≥ 600) → no', () => {
    equipo(true, 820, 1180)
    expect(debeIrAMovil('cashier', '/ventas')).toBe(false)
  })
  it('pantalla chica SIN táctil (ventana angosta de escritorio) → no', () => {
    equipo(false, 390, 844)
    expect(debeIrAMovil('cashier', '/ventas')).toBe(false)
  })
  it('mozo → no; ya en /m → no; /mesas → sí (no es /m)', () => {
    equipo(true, 390, 844)
    expect(debeIrAMovil('waiter', '/mesas')).toBe(false)
    expect(debeIrAMovil('cashier', '/m/ventas')).toBe(false)
    expect(debeIrAMovil('cashier', '/mesas')).toBe(true)
  })
  it('pidió "Versión completa" en esta pestaña → no', () => {
    equipo(true, 390, 844, true)
    expect(debeIrAMovil('cashier', '/ventas')).toBe(false)
  })
})

describe('traerTodo (PostgREST corta en 1000 filas sin avisar)', () => {
  const fuente = (n: number) => {
    const pedidos: [number, number][] = []
    const pagina = async (desde: number, hasta: number) => {
      pedidos.push([desde, hasta])
      return { data: Array.from({ length: Math.max(0, Math.min(n, hasta + 1) - desde) }, (_, i) => desde + i), error: null }
    }
    return { pagina, pedidos }
  }
  it('2500 filas → las trae TODAS en 3 páginas', async () => {
    const f = fuente(2500)
    const todo = await traerTodo(f.pagina)
    expect(todo).toHaveLength(2500)
    expect(todo[2499]).toBe(2499)
    expect(f.pedidos).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
  })
  it('justo 1000 → pide una página más (vacía) y corta', async () => {
    const f = fuente(1000)
    expect(await traerTodo(f.pagina)).toHaveLength(1000)
    expect(f.pedidos).toHaveLength(2)
  })
  it('un error se propaga (no se convierte en "sin filas")', async () => {
    await expect(traerTodo(async () => ({ data: null, error: new Error('red') }))).rejects.toThrow('red')
  })
})

describe('diaBogota (R7: el día es el de Bogotá, no el de UTC)', () => {
  it('a las 22:00 de Bogotá (03:00 UTC del día siguiente) sigue siendo el mismo día', () => {
    const ahora = new Date('2026-10-05T03:00:00Z')   // 2026-10-04 22:00 en Bogotá
    expect(diaBogota(0, ahora)).toBe('2026-10-04')
    expect(diaBogota(-29, ahora)).toBe('2026-09-05')
  })
})
