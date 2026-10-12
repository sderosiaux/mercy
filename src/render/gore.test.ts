import { describe, expect, it } from 'vitest'
import { step } from '../sim/index'
import { cmd, scene } from '../sim/testing'
import { GoreMemory, SPARK_TICKS } from './gore'

describe('mémoire du gore, tirée des évènements', () => {
  it('pose un décalque à chaque coup qui touche, une seule fois par tick', () => {
    const w0 = scene([{ family: 'souriant', pos: { x: 1.2, z: 0 }, state: 'hostile' }])
    const w1 = step(w0, cmd({ strike: true, aim: { x: 1.2, z: 0 } }))
    expect(w1.events.some((e) => e.type === 'hit')).toBe(true)
    const g = new GoreMemory()
    g.ingest(w1)
    g.ingest(w1)
    expect(g.decals.length).toBe(1)
    expect(g.decals[0]?.born).toBe(1)
    expect(g.lastHit).toBe(1)
  })

  it('n’ensanglante pas les Abattus placés au tick 0 d’une scène de test', () => {
    const g = new GoreMemory()
    g.ingest(scene([{ family: 'souriant', pos: { x: 3, z: 0 }, state: 'abattu' }]))
    expect(g.decals.length).toBe(0)
  })

  it('garde au plus 400 décalques : les plus anciens s’effacent (§17)', () => {
    const g = new GoreMemory()
    for (let i = 0; i < 410; i++) g.add({ x: i * 0.01, z: 0 }, 0.3, i)
    expect(g.decals.length).toBe(400)
    expect(g.decals[0]?.born).toBe(10)
  })

  it('fait jaillir un éclat doré d’un coup sur un Résistant à terre, puis l’éteint', () => {
    const w0 = scene([{ family: 'souriant', pos: { x: 1.2, z: 0 }, state: 'abattu', cicatrices: 3 }])
    const w1 = step(w0, cmd({ strike: true, aim: { x: 1.2, z: 0 } }))
    expect(w1.events.some((e) => e.type === 'clang')).toBe(true)
    const g = new GoreMemory()
    g.ingest(w1)
    expect(g.sparks.length).toBe(1)
    let w = w1
    for (let i = 0; i < SPARK_TICKS; i++) {
      w = step(w, cmd())
      g.ingest(w)
    }
    expect(g.sparks.length).toBe(0)
  })
})
