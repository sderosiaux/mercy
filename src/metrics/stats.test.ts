import { describe, expect, it } from 'vitest'
import { distribution, median, quantile, ratio } from './stats'

describe('stats', () => {
  it('quantile de type 7 (interpolation linéaire entre rangs)', () => {
    const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    expect(quantile(s, 0.1)).toBeCloseTo(1.9, 12)
    expect(quantile(s, 0.5)).toBeCloseTo(5.5, 12)
    expect(quantile(s, 0.9)).toBeCloseTo(9.1, 12)
    expect(quantile([7], 0.9)).toBe(7)
    expect(quantile([], 0.5)).toBeNull()
  })
  it('distribution : n, min, p10, médiane, p90, max, quel que soit l’ordre d’entrée', () => {
    expect(distribution([4, 1, 3, 2])).toEqual({ n: 4, min: 1, p10: 1.3, median: 2.5, p90: 3.7, max: 4 })
    expect(distribution([])).toEqual({ n: 0, min: null, p10: null, median: null, p90: null, max: null })
  })
  it('médiane et rapport', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(ratio(1, 4)).toBe(0.25)
    expect(ratio(1, 0)).toBeNull()
  })
})
