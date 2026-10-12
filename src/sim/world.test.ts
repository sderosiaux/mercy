import { describe, expect, it } from 'vitest'
import { hashWorld } from './index'
import { cmd, mannequin, poteau, run, scene } from './testing'
import type { World } from './types'
import { vec } from './vec'

const deepFreeze = <T>(o: T): T => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    for (const v of Object.values(o)) deepFreeze(v)
  }
  return o
}

describe('step', () => {
  it("ne modifie jamais le monde d'entrée", () => {
    const w = scene(
      [
        { family: 'souriant', pos: vec(1.5, 0), state: 'rituel' },
        { family: 'souriant', pos: vec(0, 1.8), state: 'abattu' },
        { family: 'recousu', pos: vec(-3, 0), state: 'hostile' },
        { family: 'confesseur', pos: vec(6, 6), state: 'rituel' },
      ],
      { families: { recousu: mannequin(), confesseur: poteau } },
    )
    let world: World = w
    for (let i = 0; i < 200; i++) {
      deepFreeze(world)
      world = run(
        world,
        1,
        cmd({ strike: i % 3 === 0, sentence: i === 50, rite: i === 120 ? 'balayage' : null, aim: vec(1, 1) }),
      ).world
    }
    expect(world.tick).toBe(200)
  })

  it('même graine, mêmes commandes : même hash', () => {
    const make = () =>
      run(
        scene([{ family: 'souriant', pos: vec(3, 0), state: 'hostile' }], { seed: 9 }),
        300,
        cmd({ strike: true, aim: vec(3, 0) }),
      ).world
    expect(hashWorld(make())).toBe(hashWorld(make()))
  })
})
