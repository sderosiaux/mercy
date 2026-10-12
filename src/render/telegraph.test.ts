// La zone peinte d'un télégraphe est la zone que la simulation frappera (audit §30.13, point 3).
import { describe, expect, it } from 'vitest'
import { type Action, type Creature, FAMILIES, TUNING, type World } from '../sim/index'
import { scene, withCreature } from '../sim/testing'
import { telegraphPulse, telegraphZones } from './telegraph'

const recousuWith = (name: string, limb: string | null): { w: World; c: Creature } => {
  let w = scene([{ family: 'recousu', pos: { x: 3, z: 1 }, facing: 0.7, state: 'hostile' }], {
    families: { recousu: FAMILIES.recousu },
  })
  const action: Action = { name, kind: 'attaque', start: 0, activeAt: 60, end: 100, target: null, limb }
  w = withCreature(w, 1, { action })
  const c = w.creatures[0] as Creature
  return { w, c }
}

describe('zones de télégraphe', () => {
  it('peint l’Empoignade comme un cercle de sa portée autour du Recousu, pas comme une bande', () => {
    const { w, c } = recousuWith('empoignade', 'brasGauche')
    const z = telegraphZones(c, w, 10)
    expect(z).toEqual([{ kind: 'circle', x: 3, z: 1, r: TUNING.recousu.empoignade.reach }])
  })

  it('peint le Marteau comme le cône réel (origine, orientation, portée, arc)', () => {
    const { w, c } = recousuWith('marteau', 'brasDroit')
    const z = telegraphZones(c, w, 10)
    expect(z).toEqual([
      {
        kind: 'cone',
        x: 3,
        z: 1,
        facing: 0.7,
        reach: TUNING.recousu.marteau.reach,
        arcDeg: TUNING.recousu.marteau.arcDeg,
      },
    ])
  })

  it('ne peint rien hors du télégraphe (frappe, récupération) ni pour un corps à terre', () => {
    const { w, c } = recousuWith('marteau', 'brasDroit')
    expect(telegraphZones(c, w, 60)).toEqual([])
    expect(telegraphZones(c, w, 80)).toEqual([])
    const down = {
      ...c,
      state: { kind: 'abattu', since: 0, riseAt: 360, cryAt: 30, claimedBy: null },
    } as Creature
    expect(telegraphZones(down, w, 10)).toEqual([])
  })

  it('ne bat que pendant les 0,2 dernières secondes', () => {
    expect(telegraphPulse(13, 50)).toBe(0)
    const beats = new Set<number>()
    for (let t = 0; t < 12; t++) beats.add(Math.round(telegraphPulse(12 - t, t) * 10))
    expect(beats.size).toBeGreaterThan(2)
  })
})
