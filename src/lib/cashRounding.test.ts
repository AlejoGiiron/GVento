import { describe, it, expect } from 'vitest'
import { cashQuickAmounts } from './cashRounding'

/** Helper: solo los montos de los round-ups (excluye el chip "Exacto"). */
const roundUps = (total: number) =>
  cashQuickAmounts(total)
    .filter((c) => !c.exact)
    .map((c) => c.amount)

/** Helper: el chip exacto. */
const exact = (total: number) => cashQuickAmounts(total).find((c) => c.exact)

describe('cashQuickAmounts', () => {
  it('el primer chip es "Exacto" = total', () => {
    const chips = cashQuickAmounts(62_000)
    expect(chips[0]).toEqual({ amount: 62_000, exact: true })
    // Solo un chip exacto.
    expect(chips.filter((c) => c.exact)).toHaveLength(1)
  })

  it('total no redondo: 62.000 → 65k, 70k, 80k, 100k', () => {
    expect(exact(62_000)).toEqual({ amount: 62_000, exact: true })
    expect(roundUps(62_000)).toEqual([65_000, 70_000, 80_000, 100_000])
  })

  it('total ya redondo: 50.000 → exacto + 55k, 60k, 100k (round-ups > total)', () => {
    expect(exact(50_000)).toEqual({ amount: 50_000, exact: true })
    // 5k→55k, 10k→60k, 20k→60k, 50k→100k → dedup → 55k, 60k, 100k.
    expect(roundUps(50_000)).toEqual([55_000, 60_000, 100_000])
  })

  it('total pequeño: 8.000 → exacto + 10k, 20k, 50k', () => {
    expect(exact(8_000)).toEqual({ amount: 8_000, exact: true })
    // 5k→10k, 10k→10k, 20k→20k, 50k→50k → dedup → 10k, 20k, 50k.
    expect(roundUps(8_000)).toEqual([10_000, 20_000, 50_000])
  })

  it('deduplica round-ups que coinciden', () => {
    // 8.000: el próximo 5k y el próximo 10k son ambos 10.000 → un solo chip.
    const ups = roundUps(8_000)
    expect(new Set(ups).size).toBe(ups.length)
    expect(ups).toContain(10_000)
    expect(ups.filter((a) => a === 10_000)).toHaveLength(1)
  })

  it('round-ups ascendentes y todos estrictamente mayores que el total', () => {
    const ups = roundUps(73_500)
    expect(ups).toEqual([...ups].sort((a, b) => a - b))
    expect(ups.every((a) => a > 73_500)).toBe(true)
  })

  it('acota a un máximo de 4 round-ups (Exacto + 4 = 5 chips)', () => {
    expect(cashQuickAmounts(62_000).length).toBeLessThanOrEqual(5)
    expect(roundUps(62_000).length).toBeLessThanOrEqual(4)
  })

  it('total <= 0: solo el chip exacto, sin round-ups', () => {
    expect(cashQuickAmounts(0)).toEqual([{ amount: 0, exact: true }])
  })
})
