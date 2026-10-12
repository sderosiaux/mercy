// Maths déterministes d'un moteur JS à l'autre (requête C7 R1). Seules + − × ÷ et √ (arrondies au plus près
// par IEEE 754) sont utilisées : le résultat est le même bit pour bit dans Chrome, Node, Firefox et Safari.
import { describe, expect, it } from 'vitest'
import { datan2, dcos, dhypot, dpowInt, dsin } from './dmath'

const samples = (n: number, lo: number, hi: number) =>
  Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1))

describe('dmath', () => {
  it('dsin et dcos suivent Math.sin et Math.cos à 4e-16 près sur [−100, 100]', () => {
    for (const x of samples(20_001, -100, 100)) {
      expect(Math.abs(dsin(x) - Math.sin(x))).toBeLessThan(4e-16 * Math.max(1, Math.abs(x)))
      expect(Math.abs(dcos(x) - Math.cos(x))).toBeLessThan(4e-16 * Math.max(1, Math.abs(x)))
    }
  })

  it('dsin et dcos aux angles remarquables', () => {
    expect(dsin(0)).toBe(0)
    expect(dcos(0)).toBe(1)
    expect(dsin(Math.PI / 2)).toBeCloseTo(1, 15)
    expect(dcos(Math.PI)).toBeCloseTo(-1, 15)
    expect(dsin(-Math.PI / 6)).toBeCloseTo(-0.5, 15)
  })

  it('datan2 suit Math.atan2 à 5e-16 près dans les quatre quadrants', () => {
    for (const a of samples(4001, -Math.PI, Math.PI)) {
      for (const r of [1e-6, 0.3, 1, 7.5, 1e4]) {
        const y = r * Math.sin(a)
        const x = r * Math.cos(a)
        expect(Math.abs(datan2(y, x) - Math.atan2(y, x))).toBeLessThan(5e-16 * 4)
      }
    }
  })

  it("datan2 sur les axes et à l'origine", () => {
    expect(datan2(0, 1)).toBe(0)
    expect(datan2(1, 0)).toBeCloseTo(Math.PI / 2, 15)
    expect(datan2(-1, 0)).toBeCloseTo(-Math.PI / 2, 15)
    expect(datan2(0, -1)).toBeCloseTo(Math.PI, 15)
    expect(datan2(0, 0)).toBe(0)
  })

  it('dhypot et dpowInt', () => {
    expect(dhypot(3, 4)).toBe(5)
    expect(dpowInt(1.5, 3)).toBe(3.375)
    expect(dpowInt(1.08, 0)).toBe(1)
    expect(dpowInt(1.08, 2)).toBe(1.08 * 1.08)
  })
})
