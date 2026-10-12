// Revue P0 D3 : les prédicats que le cœur applique et que les familles anticipent vivent en un seul endroit.
import { describe, expect, it } from 'vitest'
import {
  absorbableBody,
  actionEnded,
  assemblableBy,
  canDecide,
  clampToArena,
  freeForOperator,
  freeToDecide,
  raisableByPrayer,
} from './predicates'
import { creature, scene, withCreature } from './testing'
import { TUNING } from './tuning'
import type { Action, Creature, SpawnDef } from './types'
import { vec } from './vec'

const one = (spawn: SpawnDef, patch: Partial<Creature> = {}): Creature =>
  creature(withCreature(scene([spawn]), 1, patch), 1)
const down = (patch: Partial<Creature> = {}, cicatrices: 0 | 3 = 0) =>
  one({ family: 'souriant', pos: vec(0, 0), state: 'abattu', cicatrices }, patch)
const claimed = (by: number | 'player') => {
  const c = down()
  return { ...c, state: c.state.kind === 'abattu' ? { ...c.state, claimedBy: by } : c.state }
}

describe('corps à terre', () => {
  it('sac du Porteur et prière : Abattu ordinaire, non réservé, pas un Membre errant', () => {
    for (const p of [absorbableBody, raisableByPrayer]) {
      expect(p(down())).toBe(true)
      expect(p(down({}, 3))).toBe(false) // Résistant
      expect(p(claimed(7))).toBe(false) // opération
      expect(p(claimed('player'))).toBe(false) // Sentence
      expect(p({ ...down(), family: 'membre' })).toBe(false)
      expect(p(one({ family: 'souriant', pos: vec(0, 0), state: 'hostile' }))).toBe(false)
    }
  })

  it('opérateur : libre ou réservé par lui ; assemblable sans Résistant ni Membre errant', () => {
    expect(freeForOperator(down(), 7)).toBe(true)
    expect(freeForOperator(claimed(7), 7)).toBe(true)
    expect(freeForOperator(claimed(8), 7)).toBe(false)
    expect(freeForOperator(claimed('player'), 7)).toBe(false)
    expect(assemblableBy(claimed(7), 7)).toBe(true)
    expect(assemblableBy(down({}, 3), 7)).toBe(false)
    expect(assemblableBy({ ...down(), family: 'membre' }, 7)).toBe(false)
  })
})

describe('le cœur appellera-t-il decide() ?', () => {
  it('Hostile : après le pivot de tête et hors vacillement ; jamais en Rituel', () => {
    const h = one({ family: 'souriant', pos: vec(0, 0), state: 'hostile' }, { stunnedUntil: 40 })
    expect(canDecide(h, TUNING.alertTurnTicks - 1)).toBe(false)
    expect(canDecide(h, 39)).toBe(false)
    expect(freeToDecide(h, 40, false)).toBe(true)
    expect(freeToDecide(one({ family: 'souriant', pos: vec(0, 0) }), 100, true)).toBe(false)
  })

  it('Abattu : seulement pour une famille qui agit à terre, non réservé, hors vacillement', () => {
    expect(freeToDecide(down(), 0, false)).toBe(false)
    expect(freeToDecide(down(), 0, true)).toBe(true)
    expect(freeToDecide(claimed(7), 0, true)).toBe(false)
    expect(freeToDecide(down({ stunnedUntil: 10 }), 9, true)).toBe(false)
  })

  it("une action s'arrête au tick de sa fin", () => {
    const a: Action = {
      name: 'x',
      kind: 'attaque',
      start: 0,
      activeAt: 5,
      end: 9,
      target: null,
      limb: null,
    }
    expect(actionEnded(a, 8)).toBe(false)
    expect(actionEnded(a, 9)).toBe(true)
  })
})

describe("bornes de l'arène", () => {
  it('ramène un point à arenaHalf − rayon sur chaque axe', () => {
    const h = TUNING.arenaHalf
    expect(clampToArena(vec(h + 3, -h - 3), 0.8)).toEqual({ x: h - 0.8, z: -(h - 0.8) })
    expect(clampToArena(vec(1, -2), 0.4)).toEqual({ x: 1, z: -2 })
  })
})
