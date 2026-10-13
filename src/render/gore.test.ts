import { describe, expect, it } from 'vitest'
import { type SimEvent, step, TUNING, type World } from '../sim/index'
import { cmd, scene } from '../sim/testing'
import { RENDER } from './constants'
import {
  ballistic,
  decalScale,
  GoreMemory,
  isFresh,
  PLAYER_STAIN,
  SPARK_TICKS,
  STAIN_MAX,
  settledAt,
} from './gore'

describe('le sang de chaque coup (§17.1) : direction, arme, dégâts', () => {
  const base = scene([
    { family: 'souriant', pos: { x: 2, z: 0 }, state: 'hostile' },
    { family: 'souriant', pos: { x: -3, z: 2 }, state: 'abattu' },
  ])
  const at = (tick: number, events: World['events']): World => ({ ...base, tick, events })
  const hit = (tick: number, damageType: 'tranchant' | 'contondant', amount = 12): SimEvent => ({
    type: 'hit',
    tick,
    target: 1,
    amount,
    damageType,
    by: 'player',
  })

  it('le tranchant projette un arc en travers du coup et un jet au-delà du corps, dans le sens du coup', () => {
    const g = new GoreMemory()
    g.ingest(at(5, [hit(5, 'tranchant')]))
    const arc = g.decals.find((d) => d.kind === 'arc')
    const jet = g.decals.find((d) => d.kind === 'trainee')
    expect(arc).toBeDefined()
    expect(jet?.len ?? 0).toBeGreaterThan(3)
    // Joueur en (0, 0), cible en (2, 0) : le sang part vers +x, derrière la cible.
    expect(Math.cos(jet?.rot ?? Math.PI)).toBeCloseTo(1, 6)
    expect(jet?.x ?? 0).toBeGreaterThan(2)
    expect(arc?.x ?? 0).toBeGreaterThan(2)
    expect(g.droplets.length).toBeGreaterThan(0)
  })

  it('le contondant écrase en étoile et projette des éclats d’os qui retombent et restent', () => {
    const g = new GoreMemory()
    g.ingest(at(5, [hit(5, 'contondant')]))
    expect(g.decals.some((d) => d.kind === 'etoile')).toBe(true)
    const bones = g.chunks.filter((c) => c.kind === 'os')
    expect(bones.length).toBeGreaterThanOrEqual(2)
    for (const c of bones) {
      const later = ballistic(c, 5 + 600)
      expect(later.landed).toBe(true)
      expect(later.y).toBe(0)
      expect(ballistic(c, 5 + 1200)).toEqual(later)
    }
  })

  it('saigne en proportion des dégâts', () => {
    const small = new GoreMemory()
    small.ingest(at(5, [hit(5, 'tranchant', 4)]))
    const big = new GoreMemory()
    big.ingest(at(5, [hit(5, 'tranchant', 24)]))
    const size = (g: GoreMemory) => g.decals.find((d) => d.kind === 'arc')?.size ?? 0
    expect(size(big)).toBeGreaterThan(size(small))
    expect(big.droplets.length).toBeGreaterThan(small.droplets.length)
  })

  it('une gouttelette vole jusqu’au sol et y laisse une goutte, posée au tick où elle retombe', () => {
    const g = new GoreMemory()
    g.ingest(at(5, [hit(5, 'tranchant')]))
    const drops = g.droplets
    expect(drops.length).toBeGreaterThan(0)
    const gouttes = g.decals.filter((d) => d.kind === 'goutte')
    expect(gouttes.length).toBeGreaterThan(0)
    for (const d of gouttes) expect(d.born).toBeGreaterThan(5) // posée à l'atterrissage, pas au coup
    g.ingest(at(5 + 120, []))
    expect(g.droplets.length).toBe(0)
  })
})

describe('la libération (§17.1) : gerbe, flaque qui s’étend pendant l’agonie et après, brume', () => {
  const base = scene([
    { family: 'souriant', pos: { x: 2, z: 0 }, state: 'hostile' },
    { family: 'souriant', pos: { x: -3, z: 2 }, state: 'abattu' },
  ])
  const at = (tick: number, events: World['events']): World => ({ ...base, tick, events })

  it('une flaque grandit sous un mort pendant l’agonie et quelques secondes, puis cesse de grandir', () => {
    const g = new GoreMemory()
    g.ingest(at(10, [{ type: 'cry-start', tick: 10, id: 2 }]))
    g.ingest(at(20, [{ type: 'death', tick: 20, id: 2, by: 'achevement' }]))
    const pool = g.decals.find((d) => d.kind === 'flaque')
    expect(pool).toBeDefined()
    if (!pool) return
    expect(decalScale(pool, 20)).toBeCloseTo(0.25, 6)
    expect(decalScale(pool, 20 + TUNING.agonie)).toBeGreaterThan(decalScale(pool, 20))
    expect(decalScale(pool, 200)).toBeGreaterThan(decalScale(pool, 20 + TUNING.agonie))
    expect(pool.grow).toBeGreaterThan(TUNING.agonie)
    expect(decalScale(pool, 20 + pool.grow)).toBe(1)
    expect(decalScale(pool, 20 + pool.grow + 600)).toBe(1)
    // Gerbe : un jet de gouttelettes vers le haut. Pas de brume lumineuse (retirée à la demande du concepteur).
    expect(g.droplets.filter((d) => d.born === 20).length).toBeGreaterThan(30)
  })

  it('la Sentence donne le plus de sang', () => {
    const run = (by: 'achevement' | 'sentence'): GoreMemory => {
      const g = new GoreMemory()
      g.ingest(at(20, [{ type: 'death', tick: 20, id: 2, by }]))
      return g
    }
    const ach = run('achevement')
    const sen = run('sentence')
    const pools = (g: GoreMemory) =>
      g.decals.filter((d) => d.kind === 'flaque').reduce((s, d) => s + d.size * d.size, 0)
    expect(pools(sen)).toBeGreaterThan(pools(ach))
    expect(sen.droplets.length).toBeGreaterThan(ach.droplets.length)
  })

  it('un Abattu saigne tant qu’il vit : sa flaque cesse de s’étendre quand il se relève', () => {
    const g = new GoreMemory()
    g.ingest(at(30, [{ type: 'fell', tick: 30, id: 2 }]))
    const pool = g.decals.find((d) => d.kind === 'flaque')
    expect(pool?.grow).toBeGreaterThan(300)
    g.ingest(at(200, [{ type: 'rise', tick: 200, id: 2, cicatrices: 1, cause: 'delai' }]))
    const stopped = g.decals.find((d) => d.kind === 'flaque')
    expect(stopped?.until).toBe(200)
    if (stopped) expect(decalScale(stopped, 600)).toBe(decalScale(stopped, 200))
  })

  it('un sac qui éclate arrose tout son rayon (2 m + 1 m par stade) et trempe les corps qui en sortent', () => {
    const g = new GoreMemory()
    g.ingest(at(40, [{ type: 'burst', tick: 40, id: 1, others: [2], cause: 'contact', stage: 2 }]))
    // Les éclaboussures posées par l'éclatement couvrent le disque ; les gouttelettes peuvent voler au-delà.
    const splats = g.decals.filter((d) => d.born === 40)
    const far = Math.max(...splats.map((d) => Math.hypot(d.x - 2, d.z)))
    expect(far).toBeGreaterThan(0.8 * (2 + 2))
    expect(far).toBeLessThanOrEqual(2 + 2 + 0.01)
    expect(g.stain(2, 41).all).toBeGreaterThanOrEqual(0.8) // trempé de sang frais
    // Après 2 s, il en garde des taches : le sang séché ne couvre pas la chair qui le dit vivant (B2.O1).
    expect(g.stain(2, 40 + 120).all).toBe(STAIN_MAX.creatureOld)
    expect(g.stain(2, 40 + 120).old).toBe(STAIN_MAX.creatureOld)
  })
})

describe('le sang reste (§17.1) : couche du sol, plafond, taches', () => {
  it('ne s’efface pas : un décalque fini passe dans la couche du sol, rien n’est perdu', () => {
    const g = new GoreMemory()
    for (let i = 0; i < 1000; i++) g.add({ x: (i % 40) * 0.5, z: Math.floor(i / 40) * 0.5 }, 0.3, i)
    const w = scene([])
    g.ingest({ ...w, tick: 1200, events: [] })
    expect(g.decals.length + g.absorbed.length).toBe(1000)
    // Passent dans la couche ceux qui ne sont plus frais (2 s) et ne s'étendent plus.
    for (const a of g.absorbed) expect(settledAt(a.decal)).toBeLessThanOrEqual(1199)
    for (const d of g.decals) expect(isFresh(d, 1199)).toBe(true)
  })

  it('plafonne à 400 les gouttelettes en vol et les flaques qui s’étendent, sans rien effacer du sol', () => {
    const g = new GoreMemory()
    const w = scene([])
    for (let i = 0; i < 450; i++) g.add({ x: i * 0.1, z: 0 }, 0.4, 10, 'flaque', { grow: 600 })
    g.ingest({ ...w, tick: 20, events: [] })
    const growing = g.decals.filter((d) => d.grow > 0 && decalScale(d, 19) < 1)
    expect(growing.length + g.droplets.length).toBeLessThanOrEqual(RENDER.decalquesMax)
    expect(g.decals.length + g.absorbed.length).toBe(450)
  })

  it('le sang frais est rouge vif pendant 2 s exactement', () => {
    expect(isFresh({ born: 0 }, 119)).toBe(true)
    expect(isFresh({ born: 0 }, 120)).toBe(false)
  })

  it('le Bourreau se tache à chaque libération et garde son sang, même après sa mort (L6)', () => {
    const w = scene([{ family: 'souriant', pos: { x: 2, z: 0 }, state: 'abattu' }])
    const g = new GoreMemory()
    g.ingest({ ...w, tick: 10, events: [{ type: 'death', tick: 10, id: 1, by: 'achevement' }] })
    const fresh = g.stain(PLAYER_STAIN, 10)
    expect(fresh.all).toBeGreaterThan(0)
    expect(fresh.old).toBe(0) // frais pendant 2 s
    const old = g.stain(PLAYER_STAIN, 10 + RENDER.sangFraisTicks)
    expect(old.old).toBe(old.all)
    g.ingest({ ...w, tick: 400, events: [{ type: 'reset', tick: 400 }] })
    expect(g.stain(PLAYER_STAIN, 400).all).toBe(fresh.all)
  })
})

describe('mémoire du sang, tirée des évènements', () => {
  it('ensanglante une seule fois par tick, un coup qui touche', () => {
    const w0 = scene([{ family: 'souriant', pos: { x: 1.2, z: 0 }, state: 'hostile' }])
    // La Frappe touche après son anticipation (décision du 2026-10-12) : au tick 1 + windup.
    const impact = 1 + TUNING.weapons.couperet.windup
    let w1 = w0
    for (let i = 0; i < impact; i++) w1 = step(w1, cmd({ strike: true, aim: { x: 1.2, z: 0 } }))
    expect(w1.events.some((e) => e.type === 'hit')).toBe(true)
    const g = new GoreMemory()
    g.ingest(w1)
    const n = g.decals.length
    expect(n).toBeGreaterThan(0)
    g.ingest(w1)
    expect(g.decals.length).toBe(n)
    expect(Math.min(...g.decals.map((d) => d.born))).toBe(impact)
    expect(g.lastHit).toBe(impact)
  })

  it('n’ensanglante pas les Abattus placés au tick 0 d’une scène de test', () => {
    const g = new GoreMemory()
    g.ingest(scene([{ family: 'souriant', pos: { x: 3, z: 0 }, state: 'abattu' }]))
    expect(g.decals.length).toBe(0)
  })

  it('un coup sur un Résistant à terre ne saigne pas : il fait jaillir un éclat doré, puis l’éteint', () => {
    const w0 = scene([{ family: 'souriant', pos: { x: 1.2, z: 0 }, state: 'abattu', cicatrices: 3 }])
    // La Frappe touche après son anticipation (décision du 2026-10-12) : au tick 1 + windup.
    let w1 = w0
    for (let i = 0; i < 1 + TUNING.weapons.couperet.windup; i++)
      w1 = step(w1, cmd({ strike: true, aim: { x: 1.2, z: 0 } }))
    expect(w1.events.some((e) => e.type === 'clang')).toBe(true)
    const g = new GoreMemory()
    g.ingest(w1)
    expect(g.sparks.length).toBe(1)
    expect(g.decals.length).toBe(0)
    let w = w1
    for (let i = 0; i < SPARK_TICKS; i++) {
      w = step(w, cmd())
      g.ingest(w)
    }
    expect(g.sparks.length).toBe(0)
  })

  it('une nouvelle partie repart de zéro (la couche du sol aussi)', () => {
    const g = new GoreMemory()
    g.add({ x: 0, z: 0 }, 0.3, -1000)
    g.ingest({ ...scene([]), tick: 1, events: [] })
    expect(g.absorbed.length).toBe(1)
    const gen = g.generation
    g.clear()
    expect(g.absorbed.length).toBe(0)
    expect(g.generation).not.toBe(gen)
  })
})
