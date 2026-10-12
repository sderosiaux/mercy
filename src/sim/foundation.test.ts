import { describe, expect, it } from 'vitest'
import { hashValue } from './hash'
import { nextFloat, seedRng } from './rng'
import { TUNING, ticks } from './tuning'
import { angleDiff, angleOf, dist, inCone, vec } from './vec'

describe('rng', () => {
  it('donne la même séquence pour la même graine', () => {
    const draw = (seed: number) => {
      let s = seedRng(seed)
      const out: number[] = []
      for (let i = 0; i < 1000; i++) {
        const [v, next] = nextFloat(s)
        out.push(v)
        s = next
      }
      return out
    }
    expect(draw(42)).toEqual(draw(42))
    expect(draw(42)).not.toEqual(draw(43))
  })

  it("ne modifie jamais l'état d'origine", () => {
    const s = seedRng(7)
    const copy = [...s]
    nextFloat(s)
    expect([...s]).toEqual(copy)
  })

  it('tire dans [0, 1)', () => {
    let s = seedRng(1)
    for (let i = 0; i < 10_000; i++) {
      const [v, next] = nextFloat(s)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
      s = next
    }
  })
})

describe('hash', () => {
  it('est stable pour deux valeurs construites pareil', () => {
    const a = { tick: 3, list: [{ x: 1, z: 2 }], name: 'a' }
    const b = { name: 'a', list: [{ z: 2, x: 1 }], tick: 3 }
    expect(hashValue(a)).toBe(hashValue(b))
  })

  it('change pour un écart de 1e-9', () => {
    expect(hashValue({ x: 1 })).not.toBe(hashValue({ x: 1 + 1e-9 }))
  })

  it('ignore les fonctions', () => {
    expect(hashValue({ x: 1, f: () => 2 })).toBe(hashValue({ x: 1, f: () => 3 }))
  })
})

describe('tuning', () => {
  it('convertit les durées du spec en ticks entiers à 60 Hz', () => {
    expect(ticks(0.35)).toBe(21)
    expect(ticks(0.55)).toBe(33)
    expect(ticks(6)).toBe(360)
    expect(ticks(2.5)).toBe(150)
  })

  it('porte les valeurs du spec', () => {
    expect(TUNING.relevementOrdinaire).toBe(360)
    expect(TUNING.relevementResistant).toBe(480)
    expect(TUNING.criDelai).toBe(30)
    expect(TUNING.weapons.couperet.period).toBe(21)
    expect(TUNING.weapons.masse.period).toBe(33)
  })
})

describe('vec', () => {
  it('mesure distances et angles', () => {
    expect(dist(vec(0, 0), vec(3, 4))).toBe(5)
    expect(angleOf(vec(0, 0), vec(0, 1))).toBeCloseTo(Math.PI / 2)
    expect(angleDiff(0.1, 2 * Math.PI - 0.1)).toBeCloseTo(0.2)
  })

  it('teste un point dans un cône', () => {
    const cone = { origin: vec(0, 0), facing: 0, reach: 2.2, arcDeg: 120 }
    expect(inCone(cone, vec(2.1, 0), 0)).toBe(true)
    expect(inCone(cone, vec(2.3, 0), 0)).toBe(false)
    const at70 = vec(Math.cos((70 * Math.PI) / 180) * 1.5, Math.sin((70 * Math.PI) / 180) * 1.5)
    expect(inCone(cone, at70, 0)).toBe(false)
    const at55 = vec(Math.cos((55 * Math.PI) / 180) * 1.5, Math.sin((55 * Math.PI) / 180) * 1.5)
    expect(inCone(cone, at55, 0)).toBe(true)
  })

  it('élargit la portée du rayon de la cible', () => {
    const cone = { origin: vec(0, 0), facing: 0, reach: 2.2, arcDeg: 120 }
    expect(inCone(cone, vec(2.5, 0), 0.4)).toBe(true)
  })
})
