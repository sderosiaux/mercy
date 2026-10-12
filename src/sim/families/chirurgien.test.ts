// C2 : le Chirurgien (§8.10), qui transforme les corps laissés à terre en Recousus (§9, L5, L6).
import { describe, expect, it } from 'vitest'
import { CHANNEL_ACTIONS } from '../predicates'
import { cmd, creature, ofType, run, scene, withCreature, withPlayer } from '../testing'
import type { SimEvent, SpawnDef, Vec2, World } from '../types'
import { add, dist, vec } from '../vec'
import { chirurgien } from './chirurgien'
import { recousu } from './recousu'

const FAMILIES = { chirurgien, recousu }
const FAR = vec(-12, -12)
const FIRST_DECISION = 24 // créature placée Hostile au tick 0 : pivot de tête de 0,4 s (L7)
const OPERATION = 180

const world = (spawns: readonly SpawnDef[], playerStart: Vec2 = FAR): World =>
  scene(spawns, { families: FAMILIES, playerStart })
const surgeon = (x: number, z = 0): SpawnDef => ({ family: 'chirurgien', pos: vec(x, z), state: 'hostile' })
const body = (x: number, z = 0, cicatrices: 0 | 3 = 0): SpawnDef => ({
  family: 'souriant',
  pos: vec(x, z),
  state: 'abattu',
  cicatrices,
})

const starts = (events: readonly SimEvent[], id: number) =>
  ofType(events, 'action-start').filter((e) => e.id === id)

describe('Chirurgien : caractéristiques', () => {
  it('petit support, 50 de Chair, 4 m/s ; opérations de 180 ticks aux noms réservés ; Scalpel', () => {
    expect(chirurgien.kind).toBe('chirurgien')
    expect(chirurgien.size).toBe('small')
    expect(chirurgien.isSupport).toBe(true)
    expect(chirurgien.base).toEqual({ chair: 50, speed: 4, limbs: [] })
    for (const name of ['recoudre', 'assembler']) {
      expect(CHANNEL_ACTIONS.has(name)).toBe(true)
      expect(chirurgien.actions[name]).toMatchObject({ kind: 'canalisation', channelTicks: OPERATION })
    }
    expect(chirurgien.actions.scalpel).toMatchObject({ kind: 'attaque', reach: 1.4 })
  })
})

describe('Chirurgien : distance au joueur', () => {
  it("fuit le joueur à moins de 4 m, à 4 m/s, puis s'arrête", () => {
    const w = world([surgeon(3)], vec(0, 0))
    expect(creature(run(w, FIRST_DECISION - 1).world, 1).pos.x).toBe(3)
    expect(creature(run(w, FIRST_DECISION + 9).world, 1).pos.x).toBeCloseTo(3 + (10 * 4) / 60, 9)
    const settled = run(w, 200).world
    const d = dist(creature(settled, 1).pos, settled.player.pos)
    expect(d).toBeGreaterThan(4)
    expect(d).toBeLessThanOrEqual(4 + 4 / 60 + 1e-9)
  })

  it('sans corps à opérer et joueur au-delà de 4 m : il garde ses distances sans bouger', () => {
    const r = run(world([surgeon(5)], vec(0, 0)), 200)
    expect(creature(r.world, 1).pos).toEqual(vec(5, 0))
    expect(ofType(r.events, 'action-start')).toHaveLength(0)
  })

  it('poursuivi en terrain ouvert, il fuit sans jamais sortir le Scalpel', () => {
    const r = run(world([surgeon(2)], vec(0, 0)), 150, cmd({ move: vec(1, 0) }))
    expect(starts(r.events, 1)).toHaveLength(0)
    expect(creature(r.world, 1).pos.x).toBeGreaterThan(2 + 4)
  })

  it('acculé dans un coin, joueur à portée : Scalpel, 10 dégâts après 24 ticks', () => {
    const corner = 15 - 0.4
    const r = run(world([surgeon(corner, corner)], vec(13.5, 13.5)), FIRST_DECISION + 24)
    expect(starts(r.events, 1).map((e) => [e.action, e.tick])).toEqual([['scalpel', FIRST_DECISION]])
    const hits = ofType(r.events, 'hit').filter((h) => h.target === 'player')
    expect(hits).toEqual([
      { type: 'hit', tick: FIRST_DECISION + 24, target: 'player', amount: 10, damageType: 'creature', by: 1 },
    ])
  })

  it('acculé mais joueur hors de portée de Scalpel : il attend', () => {
    const corner = 15 - 0.4
    const r = run(world([surgeon(corner, corner)], vec(12.5, 12.5)), 100)
    expect(starts(r.events, 1)).toHaveLength(0)
    expect(creature(r.world, 1).pos).toEqual(vec(corner, corner))
  })
})

describe('Chirurgien : (a) recoudre et relever', () => {
  it('relève sur-le-champ un Recousu Abattu après 180 ticks, +1 Cicatrice ; le corps lui est réservé pendant', () => {
    const w = world([surgeon(0), { family: 'recousu', pos: vec(1, 0), state: 'abattu' }])
    const during = run(w, FIRST_DECISION + 100)
    expect(starts(during.events, 1).map((e) => e.action)).toEqual(['recoudre'])
    const s = creature(during.world, 2).state
    expect(s.kind === 'abattu' && s.claimedBy).toBe(1)
    const done = run(w, FIRST_DECISION + OPERATION)
    const rise = ofType(done.events, 'rise')
    expect(rise).toEqual([
      { type: 'rise', tick: FIRST_DECISION + OPERATION, id: 2, cicatrices: 1, cause: 'chirurgien' },
    ])
    const r = creature(done.world, 2)
    expect(r.state.kind).toBe('hostile')
    expect(r.chairMax).toBe(240)
  })

  it('recoud un Membre errant de Recousu à son propriétaire (reattach par le Chirurgien)', () => {
    // Recousu à 2,6 m du joueur : Marteau au tick 24 ; trois coups de Couperet sectionnent le bras droit au tick 67.
    const w = world(
      [{ family: 'recousu', pos: vec(2.6, 0), state: 'hostile', facing: Math.PI }, surgeon(2.6, -7)],
      vec(0, 0),
    )
    const cut = run(w, 67, (wo) => cmd({ strike: wo.tick >= 24, aim: vec(2.6, 0) }))
    const member = ofType(cut.events, 'sever')[0]?.member ?? -1
    expect(creature(cut.world, member).family).toBe('membre')
    const r = run(withPlayer(cut.world, { pos: vec(-12, 12), action: null }), 300)
    const reattach = ofType(r.events, 'reattach')
    expect(reattach).toHaveLength(1)
    expect(reattach[0]).toMatchObject({ owner: 1, limb: 'brasDroit', member, by: 2 })
    expect(starts(r.events, 2).map((e) => e.action)).toEqual(['recoudre'])
    expect(creature(r.world, 1).limbs[0]?.state).toBe('ok')
    expect(r.world.creatures.find((c) => c.id === member)).toBeUndefined()
  })

  it('(a) passe avant (b) : le Recousu Abattu avant deux corps plus proches', () => {
    const w = world([
      surgeon(0),
      body(-0.6, 0.2),
      body(-0.6, -0.2),
      { family: 'recousu', pos: vec(3, 0), state: 'abattu' },
    ])
    const first = starts(run(w, 100).events, 1)[0]
    expect(first?.action).toBe('recoudre')
    const s = creature(run(w, 100).world, 4).state
    expect(s.kind === 'abattu' && s.claimedBy).toBe(1)
  })
})

describe('Chirurgien : (b) assembler', () => {
  it('trois Abattus à moins de 2 m les uns des autres deviennent un Recousu de 240 de Chair, sans spawn', () => {
    const w = world([surgeon(0), body(0.5, 0), body(1.5, 0.5), body(1.5, -0.5)])
    const r = run(w, FIRST_DECISION + OPERATION)
    expect(starts(r.events, 1).map((e) => [e.action, e.tick])).toEqual([['assembler', FIRST_DECISION]])
    const assemble = ofType(r.events, 'assemble')
    expect(assemble).toEqual([
      { type: 'assemble', tick: FIRST_DECISION + OPERATION, id: 1, others: [2, 3, 4], created: 5 },
    ])
    const born = creature(r.world, 5)
    expect(born.family).toBe('recousu')
    expect(born.size).toBe('large')
    expect(born.chair).toBe(240)
    expect(born.chairMax).toBe(240)
    expect(born.spawn).toBeNull()
    expect(born.state.kind).toBe('hostile')
    expect(born.limbs).toEqual([
      { id: 'brasDroit', hp: 40, hpMax: 40, state: 'ok' },
      { id: 'brasGauche', hp: 40, hpMax: 40, state: 'ok' },
    ])
    for (const id of [2, 3, 4]) {
      const b = creature(r.world, id)
      expect(b.state).toMatchObject({ kind: 'absorbe', into: 5 })
      expect(b.unionOf).toBe(5)
    }
  })

  it('deux corps donnent 160 de Chair ; un quatrième corps reste à terre', () => {
    const two = run(world([surgeon(0), body(0.5, 0), body(1, 0.5)]), FIRST_DECISION + OPERATION)
    expect(ofType(two.events, 'assemble')[0]?.others).toEqual([2, 3])
    expect(creature(two.world, 4).chairMax).toBe(160)
    const four = run(
      world([surgeon(0), body(0.5, 0), body(1, 0.5), body(1, -0.5), body(1.5, 0)]),
      FIRST_DECISION + OPERATION,
    )
    expect(ofType(four.events, 'assemble')[0]?.others).toHaveLength(3)
    expect(creature(four.world, 6).chairMax).toBe(240)
    const left = [2, 3, 4, 5].filter((id) => creature(four.world, id).state.kind === 'abattu')
    expect(left).toHaveLength(1)
  })

  it("n'assemble pas des corps à plus de 2 m les uns des autres ; L1 les rapproche, puis il opère", () => {
    const w = world([surgeon(0), body(3, 0), body(-3, 0)])
    const early = run(w, 100)
    expect(starts(early.events, 1)).toHaveLength(0)
    expect(dist(creature(early.world, 2).pos, creature(early.world, 3).pos)).toBeGreaterThan(2)
    let cur = early.world
    let started: World | null = null
    while (cur.tick < 300 && !started) {
      cur = run(cur, 1).world
      if (cur.events.some((e) => e.type === 'action-start')) started = cur
    }
    expect(started).not.toBeNull()
    const s = started as World
    expect(dist(creature(s, 2).pos, creature(s, 3).pos)).toBeLessThanOrEqual(2)
    expect(s.tick + OPERATION).toBeLessThan(360) // avant leur Relèvement
    expect(ofType(run(s, OPERATION).events, 'assemble')[0]?.others).toHaveLength(2)
  })

  it("n'assemble jamais des Résistants", () => {
    const r = run(world([surgeon(0), body(0.5, 0, 3), body(1, 0.5, 3)]), 400)
    expect(starts(r.events, 1)).toHaveLength(0)
    expect(ofType(r.events, 'assemble')).toHaveLength(0)
  })

  // En jeu, L1 serre les corps autour du Chirurgien et la règle se voit peu : on lit directement l'effet rendu
  // en fin d'opération, sur un monde figé.
  it("fin d'opération : seuls des corps tous à moins de 2 m les uns des autres sont assemblés", () => {
    const w = world([surgeon(-5), body(0, 0), body(1.9, 0), body(-1.9, 0)])
    const self = creature(w, 1)
    const action = {
      name: 'assembler',
      kind: 'canalisation' as const,
      start: 0,
      activeAt: OPERATION,
      end: OPERATION,
      target: 2,
      limb: null,
    }
    expect(chirurgien.resolve(w, self, action)).toEqual([{ kind: 'assemble', ids: [2, 3] }])
    const lone = world([surgeon(-5), body(0, 0), body(2.1, 0)])
    expect(chirurgien.resolve(lone, creature(lone, 1), action)).toEqual([])
  })
})

describe('Chirurgien : une opération est interrompue par tout coup', () => {
  // Corps derrière le Chirurgien, hors du cône du joueur : seul le Chirurgien est touché.
  const cases: [string, SpawnDef[]][] = [
    ['assembler', [surgeon(1.5), body(2.2, 0.3), body(2.2, -0.3)]],
    ['recoudre', [surgeon(1.5), { family: 'recousu', pos: vec(2.6, 0), state: 'abattu' }]],
  ]
  for (const [action, spawns] of cases) {
    it(`${action} : un coup de Couperet l'interrompt, rien n'est produit, la réservation tombe, il fuit`, () => {
      const w = world(spawns, vec(-3, 0))
      const channeling = run(w, 40)
      expect(starts(channeling.events, 1).map((e) => e.action)).toEqual([action])
      const close = withPlayer(channeling.world, { pos: vec(-0.5, 0) })
      const hit = run(close, 1, cmd({ strike: true, aim: vec(1.5, 0) }))
      expect(ofType(hit.events, 'action-interrupted')).toEqual([
        { type: 'action-interrupted', tick: 41, id: 1, action, by: 'player' },
      ])
      const later = run(hit.world, OPERATION)
      expect(ofType(later.events, 'assemble')).toHaveLength(0)
      expect(ofType(later.events, 'rise').filter((e) => e.cause === 'chirurgien')).toHaveLength(0)
      expect(creature(later.world, 1).pos.x).toBeGreaterThan(1.5)
      const target = creature(hit.world, 2).state
      expect(target.kind === 'abattu' && target.claimedBy).not.toBe(1)
    })
  }
})

describe('Recousu assemblé : L5 et L6', () => {
  const assembled = (): World =>
    run(world([surgeon(0), body(0.5, 0), body(1.5, 0.5), body(1.5, -0.5)]), FIRST_DECISION + OPERATION).world

  it("l'achever tue les corps dont il est fait, dans le même tick (L5)", () => {
    const w = assembled()
    const pos = creature(w, 5).pos
    const near = withPlayer(w, { pos: add(pos, vec(-1.8, 0)) })
    const weak = withCreature(near, 5, { chair: 1 })
    const r = run(weak, 22, (wo) => cmd({ strike: true, aim: creature(wo, 5).pos }))
    expect(ofType(r.events, 'fell').map((e) => e.id)).toContain(5)
    const deaths = ofType(r.events, 'death')
    expect(deaths.map((d) => [d.id, d.by])).toEqual([
      [5, 'achevement'],
      [2, 'union'],
      [3, 'union'],
      [4, 'union'],
    ])
    expect(new Set(deaths.map((d) => d.tick)).size).toBe(1)
  })

  it('à la mort du joueur, le Recousu né en combat disparaît et les corps reviennent à leur origine (L6)', () => {
    const w = assembled()
    const r = run(withPlayer(w, { vie: 0 }), 1)
    expect(ofType(r.events, 'reset')).toHaveLength(1)
    expect(r.world.creatures.map((c) => c.id)).toEqual([1, 2, 3, 4])
    for (const id of [2, 3, 4]) {
      const b = creature(r.world, id)
      expect(b.state.kind).toBe('abattu')
      expect(b.unionOf).toBeNull()
    }
  })
})

describe('Chirurgien : attention 4 du plan, deux Chirurgiens au même tick', () => {
  // Avec trois corps, le second Chirurgien trouverait encore une paire libre si les corps du groupe du premier
  // n'étaient pas écartés : c'est le cas qui distingue « ne prend rien » de « prend ce qui reste ».
  const cases: [string, SpawnDef[], number[]][] = [
    ['deux corps', [body(0.6, 0), body(-0.6, 0)], [3, 4]],
    ['trois corps', [body(0.6, 0), body(-0.6, 0), body(0, 0)], [5, 3, 4]],
  ]
  for (const [label, bodies, others] of cases) {
    it(`mêmes corps à assembler (${label}) : le plus petit id les prend tous, l'autre ne prend rien`, () => {
      const w = world([surgeon(0, 0.5), surgeon(0, -0.5), ...bodies])
      const r = run(w, FIRST_DECISION + OPERATION)
      expect(starts(r.events, 1).map((e) => [e.action, e.tick])).toEqual([['assembler', FIRST_DECISION]])
      expect(starts(r.events, 2)).toHaveLength(0)
      expect(ofType(r.events, 'assemble')).toEqual([
        {
          type: 'assemble',
          tick: FIRST_DECISION + OPERATION,
          id: 1,
          others,
          created: bodies.length + 3,
        },
      ])
    })
  }

  it("même Recousu Abattu : le plus petit id le relève, même si l'autre est plus près", () => {
    const w = world([surgeon(0, 1), surgeon(0, -0.9), { family: 'recousu', pos: vec(0, 0), state: 'abattu' }])
    const r = run(w, FIRST_DECISION + OPERATION)
    expect(starts(r.events, 1).map((e) => e.action)).toEqual(['recoudre'])
    expect(starts(r.events, 2)).toHaveLength(0)
    expect(ofType(r.events, 'rise')).toEqual([
      { type: 'rise', tick: FIRST_DECISION + OPERATION, id: 3, cicatrices: 1, cause: 'chirurgien' },
    ])
  })
})
