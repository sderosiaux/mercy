// C3 : Confesseur (§8.10, L7, D1, D2, D3, D6 ; B3 §3, §5.5, §12 I3, I4, I5, I12).
import { describe, expect, it } from 'vitest'
import { cmd, creature, ofType, type Run, run, scene, withCreature, withPlayer } from '../testing'
import { TUNING } from '../tuning'
import type { CreatureState, SimEvent, World } from '../types'
import { dist, vec } from '../vec'
import { confesseur, PRIERE } from './confesseur'

const C = TUNING.confesseur
const TURN = TUNING.alertTurnTicks // première décision d'une créature placée Hostile au tick 0
const families = { confesseur }
const BAND = vec(-8, 0) // joueur à 8 m d'un Confesseur placé en (0, 0) : il ne bouge pas
const NEVER = 1_000_000

const down = (since: number, riseAt: number | null = NEVER): CreatureState => ({
  kind: 'abattu',
  since,
  riseAt,
  cryAt: NEVER,
  claimedBy: null,
})

const prayerStarts = (events: readonly SimEvent[]) =>
  ofType(events, 'action-start')
    .filter((e) => e.action === PRIERE)
    .map((e) => [e.id, e.tick])
const completes = (events: readonly SimEvent[]) =>
  ofType(events, 'prayer-complete').map((e) => [e.id, e.tick, e.others])
const rises = (events: readonly SimEvent[]) =>
  ofType(events, 'rise').map((e) => [e.id, e.tick, e.cause, e.cicatrices])
const extend = (r: Run, n: number, f?: (w: World) => World): Run => {
  const next = run(f ? f(r.world) : r.world, n)
  return { world: next.world, events: [...r.events, ...next.events] }
}

describe('Confesseur : distance et Bâton', () => {
  it('recule à 7 m face au joueur trop proche, revient à 10 m du joueur trop loin, ne bouge pas entre les deux', () => {
    const near = run(scene([{ family: 'confesseur', pos: vec(3, 0), state: 'hostile' }], { families }), 240)
    const n = creature(near.world, 1)
    expect(dist(n.pos, near.world.player.pos)).toBeCloseTo(C.keepMin, 9)
    expect(n.facing).toBeCloseTo(Math.PI, 9) // recule en gardant le joueur en face
    expect(ofType(near.events, 'action-start')).toEqual([])

    const far = run(scene([{ family: 'confesseur', pos: vec(13, 0), state: 'hostile' }], { families }), 240)
    expect(dist(creature(far.world, 1).pos, far.world.player.pos)).toBeCloseTo(C.keepMax, 9)

    const mid = run(scene([{ family: 'confesseur', pos: vec(8.5, 0), state: 'hostile' }], { families }), 240)
    expect(creature(mid.world, 1).pos).toEqual(vec(8.5, 0))
  })

  it('frappe du Bâton (8) seulement au contact', () => {
    const contact = run(
      scene([{ family: 'confesseur', pos: vec(1.5, 0), state: 'hostile' }], { families }),
      TURN + C.baton.telegraph,
    )
    expect(ofType(contact.events, 'action-start').map((e) => [e.action, e.tick])).toEqual([['baton', TURN]])
    const hits = ofType(contact.events, 'hit').filter((h) => h.target === 'player')
    expect(hits.map((h) => [h.amount, h.tick, h.by])).toEqual([[8, TURN + C.baton.telegraph, 1]])
    expect(contact.world.player.vie).toBe(TUNING.vieMax - 8)

    // Juste hors de portée (1,6 m + rayon du joueur) : il recule, il ne frappe pas.
    const outside = run(
      scene([{ family: 'confesseur', pos: vec(2.5, 0), state: 'hostile' }], { families }),
      240,
    )
    expect(ofType(outside.events, 'action-start')).toEqual([])
    expect(outside.world.player.vie).toBe(TUNING.vieMax)
  })
})

describe('Confesseur : prière', () => {
  it('au moins 2 Abattus à moins de 8 m : 150 ticks de canalisation, puis tous les ordinaires du rayon se relèvent', () => {
    const w = scene(
      [
        { family: 'confesseur', pos: vec(0, 0), state: 'hostile' },
        { family: 'souriant', pos: vec(3, 0), state: 'abattu' },
        { family: 'souriant', pos: vec(0, 5), state: 'abattu' },
        { family: 'souriant', pos: vec(-2, 2), state: 'abattu', cicatrices: 3 }, // Résistant
        { family: 'souriant', pos: vec(13, 0), state: 'abattu' }, // hors rayon, trop loin pour ramper
      ],
      { families, playerStart: BAND },
    )
    const r = run(w, TURN + C.prayerChannel)
    expect(prayerStarts(r.events)).toEqual([[1, TURN]])
    expect(completes(r.events)).toEqual([[1, TURN + C.prayerChannel, [2, 3]]])
    expect(rises(r.events)).toEqual([
      [2, TURN + C.prayerChannel, 'priere', 1],
      [3, TURN + C.prayerChannel, 'priere', 1],
    ])
    const raised = creature(r.world, 2)
    expect(raised.state.kind).toBe('hostile')
    expect(raised.chairMax).toBe(TUNING.souriant.chair * 1.5)
    expect(raised.chair).toBe(raised.chairMax)
    const resistant = creature(r.world, 4)
    expect(resistant.state.kind).toBe('abattu')
    expect(resistant.cicatrices).toBe(3)
    expect(creature(r.world, 5).state.kind).toBe('abattu')
  })

  it('déclenchement : debout, il ne se compte pas ; un Résistant compte ; un Membre errant ne compte pas', () => {
    const base = (third: 'none' | 'resistant' | 'membre') => {
      const w = scene(
        [
          { family: 'confesseur', pos: vec(0, 0), state: 'hostile' },
          { family: 'souriant', pos: vec(3, 0), state: 'abattu' },
          ...(third === 'none'
            ? []
            : [
                {
                  family: 'souriant' as const,
                  pos: vec(0, 3),
                  state: 'abattu' as const,
                  cicatrices: third === 'resistant' ? (3 as const) : (0 as const),
                },
              ]),
        ],
        { families, playerStart: BAND },
      )
      return third === 'membre'
        ? withCreature(w, 3, { family: 'membre', state: down(0, null), unionOf: null })
        : w
    }
    expect(prayerStarts(run(base('none'), 300).events)).toEqual([])
    expect(prayerStarts(run(base('membre'), 300).events)).toEqual([])
    const withResistant = run(base('resistant'), TURN + C.prayerChannel)
    expect(prayerStarts(withResistant.events)).toEqual([[1, TURN]])
    expect(completes(withResistant.events)).toEqual([[1, TURN + C.prayerChannel, [2]]])
  })

  it('le rayon de 8 m se mesure au tick de la fin, sur les corps présents à ce moment-là', () => {
    const w = scene(
      [
        { family: 'confesseur', pos: vec(0, 0), state: 'hostile' },
        { family: 'souriant', pos: vec(3, 0), state: 'abattu' },
        { family: 'souriant', pos: vec(0, 3), state: 'abattu' },
        { family: 'souriant', pos: vec(-13, 13), state: 'abattu' },
        { family: 'souriant', pos: vec(13, -13), state: 'abattu' },
      ],
      { families, playerStart: BAND },
    )
    const end = TURN + C.prayerChannel
    const before = run(w, end - 1)
    expect(completes(before.events)).toEqual([])
    const r = extend(before, 1, (wo) =>
      withCreature(withCreature(wo, 4, { pos: vec(8, 0) }), 5, { pos: vec(0, -8.01) }),
    )
    expect(completes(r.events)).toEqual([[1, end, [2, 3, 4]]])
    expect(creature(r.world, 5).state.kind).toBe('abattu')
  })

  it("un corps réservé par une Sentence n'est pas relevé, la Sentence le tue ensuite", () => {
    const w = scene(
      [
        { family: 'confesseur', pos: vec(0, 0), state: 'hostile' },
        { family: 'souriant', pos: vec(-6, 0), state: 'abattu' },
        { family: 'souriant', pos: vec(3, 0), state: 'abattu' },
        { family: 'souriant', pos: vec(0, 4), state: 'abattu' },
      ],
      { families, playerStart: vec(-5, 0) },
    )
    const end = TURN + C.prayerChannel
    const r = run(w, end + 20, (wo) => cmd({ sentence: wo.tick === end - 25, aim: vec(-4, 0) }))
    expect(ofType(r.events, 'sentence-start').map((e) => [e.target, e.tick])).toEqual([[2, end - 24]])
    expect(completes(r.events)).toEqual([[1, end, [3, 4]]])
    expect(rises(r.events).map(([id]) => id)).toEqual([3, 4])
    expect(ofType(r.events, 'death').map((e) => [e.id, e.by])).toEqual([[2, 'sentence']])
  })

  it('recharge de 600 ticks après une prière achevée', () => {
    const w = scene(
      [
        { family: 'confesseur', pos: vec(0, 0), state: 'hostile' },
        { family: 'souriant', pos: vec(3, 0), state: 'abattu' },
        { family: 'souriant', pos: vec(0, 3), state: 'abattu' },
      ],
      { families, playerStart: BAND },
    )
    const end = TURN + C.prayerChannel
    // Les deux relevés sont remis à terre juste après : le champ est de nouveau plein pendant la recharge.
    const refill = (wo: World): World =>
      withCreature(withCreature(wo, 2, { pos: vec(3, 0), chair: 0, action: null, state: down(wo.tick) }), 3, {
        pos: vec(0, 3),
        chair: 0,
        action: null,
        state: down(wo.tick),
      })
    const r = extend(run(w, end + 6), C.prayerCooldown + C.prayerChannel, refill)
    const second = end + C.prayerCooldown
    expect(prayerStarts(r.events)).toEqual([
      [1, TURN],
      [1, second],
    ])
    expect(completes(r.events)).toEqual([
      [1, end, [2, 3]],
      [1, second + C.prayerChannel, [2, 3]],
    ])
    expect(creature(r.world, 2).cicatrices).toBe(2)
  })
})

describe('Confesseur : interruption (L7, D1, D6)', () => {
  it('la Charge interrompt la prière ; la recharge part de l’interruption', () => {
    const w0 = scene(
      [
        { family: 'confesseur', pos: vec(0, 0), state: 'hostile' },
        { family: 'souriant', pos: vec(-3, 3), state: 'abattu' },
        { family: 'souriant', pos: vec(-3, -3), state: 'abattu' },
      ],
      { families, playerStart: vec(-4, 0) },
    )
    const w = withPlayer(withCreature(withCreature(w0, 2, { state: down(0) }), 3, { state: down(0) }), {
      ferveur: TUNING.charge.cost,
      lastFerveurGain: NEVER,
    })
    const r = run(w, 900, (wo) => cmd({ rite: wo.tick === 59 ? 'charge' : null, aim: vec(4, 0) }))
    const cut = ofType(r.events, 'action-interrupted')
    expect(cut.map((e) => [e.id, e.action, e.by])).toEqual([[1, PRIERE, 'player']])
    const at = cut[0]?.tick ?? -1
    expect(at).toBeGreaterThan(TURN)
    expect(at).toBeLessThan(TURN + C.prayerChannel)
    expect(prayerStarts(r.events)).toEqual([
      [1, TURN],
      [1, at + C.prayerCooldown],
    ])
    expect(completes(r.events)).toEqual([[1, at + C.prayerCooldown + C.prayerChannel, [2, 3]]])
  })

  it('un coup sans effet sur la Chair (Résistant à terre) interrompt, même au tick qui suit le début', () => {
    const w0 = scene(
      [
        { family: 'confesseur', pos: vec(0, 0), state: 'abattu', cicatrices: 3 },
        { family: 'souriant', pos: vec(3, 0), state: 'abattu' },
      ],
      { families, playerStart: vec(-2.65, 0) },
    )
    const w = withCreature(withCreature(w0, 1, { state: down(0) }), 2, { state: down(0) })
    // Prière lancée au tick 1 (à terre, lui-même compris : 2 Abattus) ; coup au tick 2.
    const r = run(w, 610, (wo) => cmd({ strike: wo.tick === 1, aim: vec(0, 0) }))
    expect(ofType(r.events, 'clang').map((e) => [e.id, e.tick])).toEqual([[1, 2]])
    expect(ofType(r.events, 'action-interrupted').map((e) => [e.id, e.action, e.by, e.tick])).toEqual([
      [1, PRIERE, 'player', 2],
    ])
    expect(creature(r.world, 1).chair).toBe(0)
    expect(creature(r.world, 2).state.kind).toBe('abattu')
    expect(prayerStarts(r.events)).toEqual([
      [1, 1],
      [1, 2 + C.prayerCooldown],
    ])
  })
})

describe('Confesseur : à terre', () => {
  it('il prie à terre, et sa prière le relève avec les autres', () => {
    const w = scene(
      [
        { family: 'confesseur', pos: vec(0, 0), state: 'abattu' },
        { family: 'souriant', pos: vec(3, 0), state: 'abattu' },
      ],
      { families, playerStart: vec(-12, -12) },
    )
    const r = run(w, 1 + C.prayerChannel)
    expect(prayerStarts(r.events)).toEqual([[1, 1]])
    expect(completes(r.events)).toEqual([[1, 1 + C.prayerChannel, [1, 2]]])
    expect(rises(r.events)).toEqual([
      [1, 1 + C.prayerChannel, 'priere', 1],
      [2, 1 + C.prayerChannel, 'priere', 1],
    ])
    expect(ofType(r.events, 'action-end').map((e) => [e.id, e.action])).toEqual([[1, PRIERE]])
    const self = creature(r.world, 1)
    expect(self.state.kind).toBe('hostile')
    expect(self.chairMax).toBe(C.chair * 1.5)
  })

  it('abattu par le joueur, il se met à prier au sol au même tick', () => {
    const w0 = scene(
      [
        { family: 'confesseur', pos: vec(1.5, 0), state: 'hostile' },
        { family: 'souriant', pos: vec(3, 1), state: 'abattu' },
      ],
      { families },
    )
    const w = withCreature(w0, 1, { chair: 10 })
    const r = run(w, 5 + C.prayerChannel, (wo) => cmd({ strike: wo.tick === 4, aim: vec(1.5, 0) }))
    expect(ofType(r.events, 'fell').map((e) => [e.id, e.tick])).toEqual([[1, 5]])
    expect(prayerStarts(r.events)).toEqual([[1, 5]])
    expect(completes(r.events)).toEqual([[1, 5 + C.prayerChannel, [1, 2]]])
  })

  it('relevé au délai pendant sa prière, il la finit debout : fin normale, la recharge part de la fin', () => {
    const w0 = scene(
      [
        { family: 'confesseur', pos: vec(0, 0), state: 'abattu' },
        { family: 'souriant', pos: vec(3, 0), state: 'abattu' },
        { family: 'souriant', pos: vec(13, 13), state: 'abattu' },
      ],
      { families, playerStart: BAND },
    )
    const w = withCreature(withCreature(w0, 1, { state: down(0, 50) }), 3, { state: down(0) })
    const end = 1 + C.prayerChannel
    const first = run(w, end + 9)
    expect(rises(first.events)).toEqual([
      [1, 50, 'delai', 1],
      [2, end, 'priere', 1],
    ])
    expect(ofType(first.events, 'action-interrupted')).toEqual([])
    expect(completes(first.events)).toEqual([[1, end, [2]]])
    // Deux corps de nouveau à portée : la prière suivante attend la fin de la recharge comptée depuis `end`.
    const r = extend(first, C.prayerCooldown, (wo) =>
      withCreature(withCreature(wo, 2, { pos: vec(3, 0), chair: 0, action: null, state: down(wo.tick) }), 3, {
        pos: vec(0, 3),
        state: down(wo.tick),
      }),
    )
    expect(prayerStarts(r.events)).toEqual([
      [1, 1],
      [1, end + C.prayerCooldown],
    ])
  })
})

describe('Confesseur : invective', () => {
  it('en passant Hostile, il alerte une seule fois les créatures en Rituel à moins de 10 m', () => {
    let w = scene(
      [
        { family: 'confesseur', pos: vec(0, 0), state: 'rituel' },
        { family: 'souriant', pos: vec(0, -9.5), state: 'rituel' },
        { family: 'souriant', pos: vec(-5, 9.5), state: 'rituel' },
      ],
      // 2,3 m : assez près pour la proximité (2,5 m), hors du contact du Bâton (2,05 m) : il recule vers −x.
      { families, playerStart: vec(2.3, 0) },
    )
    expect(dist(creature(w, 1).pos, creature(w, 3).pos)).toBeGreaterThan(TUNING.alertBark)
    const events: SimEvent[] = []
    let closest = Number.POSITIVE_INFINITY
    for (let i = 0; i < 300; i++) {
      w = run(w, 1).world
      events.push(...w.events)
      closest = Math.min(closest, dist(creature(w, 1).pos, creature(w, 3).pos))
    }
    expect(ofType(events, 'alert').map((e) => [e.id, e.cause])).toEqual([
      [1, 'proximity'],
      [2, 'bark'],
    ])
    // Plus tard, le Confesseur passe à moins de 10 m de la troisième : pas de seconde invective.
    expect(closest).toBeLessThanOrEqual(TUNING.alertBark)
    expect(creature(w, 3).state.kind).toBe('rituel')
  })
})

describe('Confesseur : deux Confesseurs sur les mêmes corps (attention 4)', () => {
  const field = (bAlertedAt: number) =>
    withCreature(
      scene(
        [
          { family: 'confesseur', pos: vec(0, 0), state: 'hostile' },
          { family: 'confesseur', pos: vec(2, 0), state: 'hostile' },
          { family: 'souriant', pos: vec(1, 2), state: 'abattu' },
          { family: 'souriant', pos: vec(1, -2), state: 'abattu' },
          { family: 'souriant', pos: vec(1, 3), state: 'abattu' },
        ],
        { families, playerStart: vec(1, -9) },
      ),
      2,
      { state: { kind: 'hostile', alertedAt: bAlertedAt } },
    )

  it('même tick de fin : le plus petit id relève, chaque corps une seule fois', () => {
    const end = TURN + C.prayerChannel
    const r = run(field(0), end)
    expect(prayerStarts(r.events)).toEqual([
      [1, TURN],
      [2, TURN],
    ])
    expect(completes(r.events)).toEqual([
      [1, end, [3, 4, 5]],
      [2, end, []],
    ])
    expect(rises(r.events)).toEqual([
      [3, end, 'priere', 1],
      [4, end, 'priere', 1],
      [5, end, 'priere', 1],
    ])
  })

  it('fins décalées : la seconde prière ne relève pas une deuxième fois', () => {
    const r = run(field(36), 400)
    expect(prayerStarts(r.events)).toEqual([
      [1, TURN],
      [2, 36 + TURN],
    ])
    expect(completes(r.events)).toEqual([
      [1, TURN + C.prayerChannel, [3, 4, 5]],
      [2, 36 + TURN + C.prayerChannel, []],
    ])
    expect(ofType(r.events, 'rise')).toHaveLength(3)
    expect([3, 4, 5].map((id) => creature(r.world, id).cicatrices)).toEqual([1, 1, 1])
  })
})

describe('Sentence sur un Confesseur qui prie à terre (ruling orchestrateur)', () => {
  it('la saisie de la Sentence interrompt sa prière : il ne relève personne', () => {
    const w = scene(
      [
        { family: 'confesseur', pos: vec(1.8, 0), state: 'abattu' },
        { family: 'souriant', pos: vec(4, 0), state: 'abattu' },
      ],
      { families: { confesseur } },
    )
    const praying = run(w, 10)
    expect(creature(praying.world, 1).action?.name).toBe('priere')
    const r = run(praying.world, 200, (wo) =>
      cmd({ sentence: wo.tick === praying.world.tick, aim: vec(1.8, 0) }),
    )
    expect(ofType(r.events, 'action-interrupted').map((e) => [e.id, e.by])).toContainEqual([1, 'player'])
    expect(ofType(r.events, 'prayer-complete')).toHaveLength(0)
    expect(creature(r.world, 1).state.kind).toBe('mort')
  })
})
