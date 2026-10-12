// Mémoire d'animation : une suite d'états par corps tirée des mondes observés ; un rembobinage l'efface ; observer
// deux fois le même monde ne change rien ; un coup et une chute donnent le fondu court de la recette d'interruption.
import { describe, expect, it } from 'vitest'
import { FAMILIES, step } from '../../sim/index'
import { cmd, scene } from '../../sim/testing'
import { AnimMemory, BASE_FADE_TICKS, odometerAt } from './memory'
import { INTERRUPT_FADE_FRAMES } from './playback'

const world = () =>
  scene([{ family: 'souriant', pos: { x: 1.3, z: 0 }, facing: Math.PI, state: 'hostile' }], {
    families: FAMILIES,
  })

describe('mémoire', () => {
  it('suit les états de base avec le tick de leur début', () => {
    const mem = new AnimMemory()
    let w = world()
    mem.observe(w)
    while (w.tick < 40) {
      w = step(w, cmd())
      mem.observe(w)
    }
    const segs = mem.track(1)?.segments ?? []
    const attack = segs.find((s) => s.key.kind === 'attack')
    expect(attack).toBeDefined()
    expect(attack?.from).toBe(attack?.key.kind === 'attack' ? attack.key.start : -1)
    expect(attack?.fade).toBe(BASE_FADE_TICKS)
  })
  it('observer deux fois le même monde ne change rien ; un tick qui recule efface tout', () => {
    const mem = new AnimMemory()
    let w = world()
    mem.observe(w)
    for (let k = 0; k < 10; k++) {
      w = step(w, cmd())
      mem.observe(w)
    }
    const before = JSON.stringify(mem.track(1))
    mem.observe(w)
    expect(JSON.stringify(mem.track(1))).toBe(before)
    mem.observe(world())
    expect(mem.track(1)?.segments.length).toBe(1)
    expect(mem.lastTick).toBe(0)
  })
  it('une chute sur coup prend le fondu de la recette d’interruption', () => {
    const mem = new AnimMemory()
    let w = scene([{ family: 'souriant', pos: { x: 1.2, z: 0 }, facing: Math.PI, state: 'hostile' }], {
      families: FAMILIES,
    })
    mem.observe(w)
    while (w.creatures[0]?.state.kind !== 'abattu' && w.tick < 200) {
      w = step(w, cmd({ strike: w.player.action === null, aim: w.creatures[0]?.pos }))
      mem.observe(w)
    }
    const down = mem.track(1)?.segments.find((s) => s.key.kind === 'down')
    expect(down?.fade).toBe(INTERRUPT_FADE_FRAMES)
    expect(mem.track(1)?.hits.length).toBeGreaterThan(0)
  })
  it('odomètre : interpolé entre deux ticks observés', () => {
    const mem = new AnimMemory()
    let w = scene([{ family: 'souriant', pos: { x: 9, z: 0 }, facing: Math.PI, state: 'hostile' }], {
      families: FAMILIES,
    })
    mem.observe(w)
    for (let k = 0; k < 30; k++) {
      w = step(w, cmd())
      mem.observe(w)
    }
    const tr = mem.track(1)
    if (!tr) throw new Error('piste absente')
    const a = odometerAt(tr, w.tick - 1)
    const b = odometerAt(tr, w.tick)
    expect(b).toBeGreaterThan(a)
    expect(odometerAt(tr, w.tick - 0.5)).toBeCloseTo((a + b) / 2, 9)
  })
})
