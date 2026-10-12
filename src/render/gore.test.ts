import { describe, expect, it } from 'vitest'
import { type SimEvent, step, type World } from '../sim/index'
import { cmd, scene } from '../sim/testing'
import { ballistic, DROPLET_TICKS, decalScale, GoreMemory, isFresh, SPARK_TICKS } from './gore'

describe('gore de E1 : direction, arme, flaques, traînées, morceaux', () => {
  const base = scene([
    { family: 'souriant', pos: { x: 2, z: 0 }, state: 'hostile' },
    { family: 'souriant', pos: { x: -3, z: 2 }, state: 'abattu' },
  ])
  const at = (tick: number, events: World['events']): World => ({ ...base, tick, events })
  const hit = (tick: number, damageType: 'tranchant' | 'contondant'): SimEvent => ({
    type: 'hit',
    tick,
    target: 1,
    amount: 12,
    damageType,
    by: 'player',
  })

  it('le tranchant laisse une traînée allongée dans le sens du coup, au-delà du corps', () => {
    const g = new GoreMemory()
    g.ingest(at(5, [hit(5, 'tranchant')]))
    const d = g.decals[0]
    expect(d?.kind).toBe('trainee')
    expect(d?.len ?? 0).toBeGreaterThan(3)
    // Joueur en (0, 0), cible en (2, 0) : la traînée part vers +x, derrière la cible.
    expect(Math.cos(d?.rot ?? Math.PI)).toBeCloseTo(1, 6)
    expect(d?.x ?? 0).toBeGreaterThan(2)
    expect(g.droplets.length).toBeGreaterThan(0)
  })

  it('le contondant écrase (gerbe ronde) et projette des éclats d’os qui retombent et restent', () => {
    const g = new GoreMemory()
    g.ingest(at(5, [hit(5, 'contondant')]))
    expect(g.decals[0]?.kind).toBe('eclat')
    const bones = g.chunks.filter((c) => c.kind === 'os')
    expect(bones.length).toBe(2)
    for (const c of bones) {
      const later = ballistic(c, 5 + 600)
      expect(later.landed).toBe(true)
      expect(later.y).toBe(0)
      expect(ballistic(c, 5 + 1200)).toEqual(later)
    }
  })

  it('les gouttelettes ne vivent qu’une demi-seconde', () => {
    const g = new GoreMemory()
    g.ingest(at(5, [hit(5, 'tranchant')]))
    g.ingest(at(5 + DROPLET_TICKS, []))
    expect(g.droplets.length).toBe(0)
  })

  it('une flaque grandit sous un mort, puis cesse de grandir', () => {
    const g = new GoreMemory()
    g.ingest(at(10, [{ type: 'cry-start', tick: 10, id: 2 }]))
    g.ingest(at(20, [{ type: 'death', tick: 20, id: 2, by: 'achevement' }]))
    const pool = g.decals.find((d) => d.kind === 'flaque')
    expect(pool).toBeDefined()
    if (!pool) return
    expect(decalScale(pool, 20)).toBeCloseTo(0.25, 6)
    expect(decalScale(pool, 200)).toBeGreaterThan(decalScale(pool, 100))
    expect(decalScale(pool, 20 + pool.grow)).toBe(1)
    expect(decalScale(pool, 20 + pool.grow + 600)).toBe(1)
  })

  it('une Sentence sur un corps muet ne saigne presque pas', () => {
    const loud = new GoreMemory()
    loud.ingest(at(10, [{ type: 'cry-start', tick: 10, id: 2 }]))
    loud.ingest(at(20, [{ type: 'death', tick: 20, id: 2, by: 'sentence' }]))
    const mute = new GoreMemory()
    mute.ingest(at(20, [{ type: 'death', tick: 20, id: 2, by: 'sentence' }]))
    const size = (g: GoreMemory) => g.decals.find((d) => d.kind === 'flaque')?.size ?? 0
    expect(size(mute)).toBeLessThan(size(loud) / 2)
  })

  it('un corps qui rampe laisse une traînée, un corps immobile n’en laisse pas', () => {
    const g = new GoreMemory()
    const moved = (tick: number, x: number): World => ({
      ...base,
      tick,
      events: [],
      creatures: base.creatures.map((c) => (c.id === 2 ? { ...c, pos: { x, z: 2 } } : c)),
    })
    g.ingest(moved(1, -3))
    g.ingest(moved(2, -3))
    expect(g.decals.length).toBe(0)
    g.ingest(moved(60, -2.2))
    const trace = g.decals.find((d) => d.kind === 'trace')
    expect(trace).toBeDefined()
    expect(Math.abs(Math.cos(trace?.rot ?? 0))).toBeCloseTo(1, 6)
  })

  it('le sang est frais (rouge vif) pendant 2 s exactement', () => {
    expect(isFresh({ born: 0 }, 119)).toBe(true)
    expect(isFresh({ born: 0 }, 120)).toBe(false)
  })
})

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
