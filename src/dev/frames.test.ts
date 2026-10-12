import { describe, expect, it } from 'vitest'
import { createFrameRecorder, frameStats } from './frames'

describe('temps de frame', () => {
  it('p50, p95 (quantile type 7) et max', () => {
    // 1 à 100 ms : p50 = 50,5 ; p95 = 1 + 0,95 × 99 = 95,05 ; max = 100.
    const s = frameStats(Array.from({ length: 100 }, (_, i) => 100 - i))
    expect(s.n).toBe(100)
    expect(s.p50).toBeCloseTo(50.5, 10)
    expect(s.p95).toBeCloseTo(95.05, 10)
    expect(s.max).toBe(100)
  })

  it('une image lente se voit dans le max et le p95, pas dans la médiane', () => {
    const samples = [...Array.from({ length: 99 }, () => 16.7), 120]
    const s = frameStats(samples)
    expect(s.p50).toBeCloseTo(16.7, 10)
    expect(s.max).toBe(120)
  })

  it('aucun échantillon : null, pas zéro', () => {
    expect(frameStats([])).toEqual({ n: 0, p50: null, p95: null, max: null })
  })

  it('ignore les valeurs non finies', () => {
    expect(frameStats([Number.NaN, 10, Number.POSITIVE_INFINITY]).n).toBe(1)
  })

  it('l’enregistreur repart de zéro', () => {
    const r = createFrameRecorder()
    r.push(10)
    r.push(30)
    expect(r.stats().max).toBe(30)
    r.reset()
    expect(r.stats().n).toBe(0)
  })
})
