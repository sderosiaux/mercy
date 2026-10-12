// Interactions du cœur avec les vraies familles (requêtes des builders C1 et C2).
import { describe, expect, it } from 'vitest'
import { confesseur } from './families/confesseur'
import { porteur } from './families/porteur'
import { cmd, creature, ofType, run, scene } from './testing'
import { TUNING } from './tuning'
import { vec } from './vec'

describe('éclatement provoqué pendant un coup (C1 R1)', () => {
  it("le coup qui fait éclater le sac n'achève pas ce que l'éclatement abat, quel que soit l'ordre des id", () => {
    const w = scene(
      [
        { family: 'porteur', pos: vec(0, 0), facing: 0, state: 'rituel' },
        { family: 'souriant', pos: vec(-1.2, 1.1), state: 'rituel' },
      ],
      { families: { porteur }, playerStart: vec(-2.55, 0) },
    )
    // Le coup touche après l'anticipation de la Frappe (décision du 2026-10-12).
    const r = run(w, 1 + TUNING.weapons.couperet.windup, cmd({ strike: true, aim: vec(0, 0) }))
    expect(ofType(r.events, 'burst').map((b) => b.cause)).toEqual(['dos'])
    expect(ofType(r.events, 'death')).toHaveLength(0)
    expect(creature(r.world, 2).state.kind).toBe('abattu')
  })
})

describe('corps avalé pendant une canalisation (C1, Confesseur dans un sac)', () => {
  it('un Confesseur à terre qui prie et se fait absorber perd sa prière', () => {
    const w = scene(
      [
        { family: 'confesseur', pos: vec(0, 0), state: 'abattu' },
        { family: 'souriant', pos: vec(1.5, 0), state: 'abattu' },
        { family: 'porteur', pos: vec(0, 2.5), state: 'rituel' },
      ],
      { families: { confesseur, porteur }, playerStart: vec(-12, -12) },
    )
    const r = run(w, 300)
    const absorbed = ofType(r.events, 'absorb').find((a) => a.others.includes(1))
    expect(absorbed).toBeDefined()
    const cut = ofType(r.events, 'action-interrupted').find((e) => e.id === 1)
    expect(cut?.tick).toBe(absorbed?.tick)
    expect(ofType(r.events, 'prayer-complete').filter((e) => e.id === 1)).toHaveLength(0)
  })
})
