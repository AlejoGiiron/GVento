import { describe, it, expect } from 'vitest'
import { splitFifo, type FifoDebt } from './splitFifo'

// Tres deudas del mismo cliente, de más vieja a más nueva: 50k / 30k / 20k.
const d = (id: string, dia: string, saldo: number, num: number): FifoDebt => ({
  id, created_at: `2026-09-0${dia}T10:00:00Z`, saldo, order_number: num,
})
const VIEJA = d('a', '1', 50_000, 64)
const MEDIA = d('b', '2', 30_000, 65)
const NUEVA = d('c', '3', 20_000, 66)
const TODAS = [VIEJA, MEDIA, NUEVA]

describe('splitFifo — orden', () => {
  it('imputa de la MÁS VIEJA a la más nueva', () => {
    const { allocations } = splitFifo(TODAS, 65_000)
    expect(allocations.map((a) => a.id)).toEqual(['a', 'b'])
  })

  it('ignora el orden del arreglo de entrada — el orden lo impone la regla', () => {
    // El discriminador del contrato: si esta función respetara el orden recibido,
    // saldaría la NUEVA primero y la previsualización mostraría un reparto que la
    // RPC (que ordena por created_at) nunca va a producir.
    const desordenadas = [NUEVA, VIEJA, MEDIA]
    expect(splitFifo(desordenadas, 65_000).allocations.map((a) => a.id))
      .toEqual(splitFifo(TODAS, 65_000).allocations.map((a) => a.id))
  })

  it('desempata por id cuando dos ventas tienen el mismo created_at', () => {
    const x = { ...VIEJA, id: 'z' }
    const y = { ...VIEJA, id: 'a' }
    expect(splitFifo([x, y], 10_000).allocations[0].id).toBe('a')
  })

  it('no muta el arreglo recibido', () => {
    const entrada = [NUEVA, VIEJA, MEDIA]
    const copia = [...entrada]
    splitFifo(entrada, 65_000)
    expect(entrada).toEqual(copia)
  })
})

describe('splitFifo — reparto', () => {
  it('parcial: salda la vieja y deja la segunda abonada', () => {
    const { allocations } = splitFifo(TODAS, 65_000)
    expect(allocations).toEqual([
      { id: 'a', order_number: 64, applied: 50_000, saldoRestante: 0, saldada: true },
      { id: 'b', order_number: 65, applied: 15_000, saldoRestante: 15_000, saldada: false },
    ])
  })

  it('la venta que no se alcanza a tocar NO aparece en el reparto', () => {
    // Contraste del caso anterior: si apareciera con applied 0, la UI mostraría
    // "#66: $0 abonado", que no es lo que va a pasar.
    expect(splitFifo(TODAS, 65_000).allocations.map((a) => a.id)).not.toContain('c')
  })

  it('exacto sobre una: la salda y no toca las demás', () => {
    const { allocations, sobrante } = splitFifo(TODAS, 50_000)
    expect(allocations).toHaveLength(1)
    expect(allocations[0]).toMatchObject({ id: 'a', saldada: true, saldoRestante: 0 })
    expect(sobrante).toBe(0)
  })

  it('el total exacto salda TODAS', () => {
    const { allocations, sobrante, excede } = splitFifo(TODAS, 100_000)
    expect(allocations).toHaveLength(3)
    expect(allocations.every((a) => a.saldada)).toBe(true)
    expect(sobrante).toBe(0)
    expect(excede).toBe(false)
  })

  it('un monto menor al saldo de la primera la deja parcial', () => {
    const { allocations } = splitFifo(TODAS, 20_000)
    expect(allocations).toEqual([
      { id: 'a', order_number: 64, applied: 20_000, saldoRestante: 30_000, saldada: false },
    ])
  })

  it('la suma de lo imputado es el monto (no se pierde ni se inventa plata)', () => {
    for (const monto of [1, 20_000, 50_000, 65_000, 99_999, 100_000]) {
      const { allocations } = splitFifo(TODAS, monto)
      expect(allocations.reduce((s, a) => s + a.applied, 0)).toBe(monto)
    }
  })
})

describe('splitFifo — bordes', () => {
  it('sobrepago: marca excede y deja sobrante, sin inventar una imputación', () => {
    const r = splitFifo(TODAS, 120_000)
    expect(r.excede).toBe(true)
    expect(r.sobrante).toBe(20_000)
    expect(r.allocations.every((a) => a.saldada)).toBe(true)
  })

  it('el monto igual al saldo total NO es sobrepago', () => {
    // El contraste del anterior: sin este caso, un `>=` en vez de `>` pasaría.
    expect(splitFifo(TODAS, 100_000).excede).toBe(false)
  })

  it('monto 0 o negativo: reparto vacío y NO marca excede (formulario en blanco)', () => {
    for (const monto of [0, -1, NaN]) {
      const r = splitFifo(TODAS, monto)
      expect(r.allocations).toEqual([])
      expect(r.excede).toBe(false)
    }
  })

  it('sin deudas seleccionadas: saldo 0 y cualquier monto positivo excede', () => {
    const r = splitFifo([], 1_000)
    expect(r.saldoSeleccionado).toBe(0)
    expect(r.excede).toBe(true)
    expect(r.allocations).toEqual([])
  })

  it('saltea una deuda con saldo 0 en vez de emitir una imputación vacía', () => {
    // La de saldo 0 va PRIMERA en el orden FIFO y queda monto por repartir
    // después de ella. Si no fuera así el bucle ni la visitaría, y el caso
    // pasaría sin ejercer la rama que dice probar — lo detectó un mutante que
    // cambió `applied <= 0` por `applied < 0` y sobrevivió.
    const cero: FifoDebt = { id: 'z', created_at: '2026-09-01T08:00:00Z', saldo: 0, order_number: 63 }
    const r = splitFifo([cero, VIEJA], 10_000)
    expect(r.allocations.map((a) => a.id)).toEqual(['a'])
    expect(r.allocations.every((a) => a.applied > 0)).toBe(true)
  })
})
