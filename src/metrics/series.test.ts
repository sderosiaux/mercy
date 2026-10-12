// Série par tick (B4 I4) et notes d'état : mondes construits avec src/sim/testing.ts.
import { describe, expect, it } from 'vitest'
import type { Creature, SimEvent, World } from '../sim/index'
import { cmd, run, scene, withCreature, withPlayer } from '../sim/testing'
import { WAVES } from '../sim/waves'
import { tickNotes } from './notes'
import { seriesLine, voicesByRank } from './series'

const at = (x: number, z = 0) => ({ x, z })
const withEvents = (w: World, events: SimEvent[], tick = w.tick + 1): World => ({ ...w, tick, events })
const patchState = (w: World, id: number, state: Creature['state']): World => withCreature(w, id, { state })

describe('seriesLine', () => {
  const w0 = scene([
    { family: 'souriant', pos: at(3), state: 'hostile' }, // 1
    { family: 'souriant', pos: at(9) }, // 2 Rituel
    { family: 'souriant', pos: at(5), state: 'abattu' }, // 3
    { family: 'souriant', pos: at(7), state: 'abattu', cicatrices: 3 }, // 4 Résistant
    { family: 'souriant', pos: at(6), state: 'mort' }, // 5
    { family: 'souriant', pos: at(8.5), state: 'abattu' }, // 6, devient Membre errant
    { family: 'souriant', pos: at(8), state: 'hostile' }, // 7
  ])
  const w = withCreature(
    patchState(w0, 3, { kind: 'abattu', since: 0, riseAt: 360, cryAt: 0, claimedBy: null }),
    6,
    { family: 'membre' },
  )

  it('compte les états, les cris actifs, les voix, la horde à 8 m et les corps à 6 m', () => {
    expect(seriesLine(w)).toEqual({
      tick: 0,
      hostiles: 2,
      rituels: 1,
      abattusOrd: 2, // 3 et le Membre errant
      abattusRes: 1,
      absorbes: 0,
      morts: 1,
      nonMorts: 6,
      cris: 1, // 3 crie déjà (cryAt 0), 4 pas encore
      vocalisent: 2, // 3 et 4 ; un Membre errant n'a pas de voix
      horde8: 4, // Hostiles 1 et 7 (8 m compris), Abattus 3 et 4 ; le Rituel 2 et le membre à 8,5 m non
      abattus6: 1, // 3 à 5 m ; 4 est à 7 m
      morts6: 1, // 5 à 6 m pile
      vie: 100,
      ferveur: 0,
    })
  })

  it('un corps absorbé vocalise et crie dans le sac (D8)', () => {
    const inBag = patchState(w, 3, { kind: 'absorbe', into: 1, cryAt: 0 })
    const l = seriesLine(inBag)
    expect(l).toMatchObject({ absorbes: 1, abattusOrd: 1, cris: 1, vocalisent: 2 })
  })

  it('S-sat : 36 voix dès le tick 0, 36 cris à partir de fell + 30', () => {
    const s0 = scene(WAVES['S-sat'].spawns)
    expect(seriesLine(s0)).toMatchObject({ vocalisent: 36, cris: 0, abattusOrd: 36, nonMorts: 36 })
    expect(seriesLine(run(s0, 30).world)).toMatchObject({ vocalisent: 36, cris: 36 })
  })

  it('voicesByRank : corps qui vocalisent triés par distance au joueur, puis par id', () => {
    expect(voicesByRank(withPlayer(w, { pos: at(4.5) })).map((x) => x.id)).toEqual([3, 4])
    expect(voicesByRank(withPlayer(w, { pos: at(7.5) })).map((x) => x.id)).toEqual([4, 3])
    // 3 et 4 à 1 m du joueur : égalité, le plus petit id d'abord.
    expect(voicesByRank(withPlayer(w, { pos: at(6) })).map((x) => x.id)).toEqual([3, 4])
  })
})

describe('tickNotes', () => {
  // Un mort en (1, 0), un Hostile en (3, 0), deux Abattus qui vocalisent avant la mort.
  const base = scene([
    { family: 'souriant', pos: at(1), state: 'abattu' }, // 1 : mourra
    { family: 'souriant', pos: at(3), state: 'hostile' }, // 2
    { family: 'souriant', pos: at(0.5, 1), state: 'abattu' }, // 3 : plus proche du joueur
    { family: 'souriant', pos: at(-2, 0), state: 'abattu', cicatrices: 3 }, // 4 : Résistant à 2 m
  ])
  const prev = base
  const dead = patchState(base, 1, { kind: 'mort', at: 1 })
  const deathOf = (by: 'achevement' | 'sentence' | 'union'): World =>
    withEvents(dead, [{ type: 'death', tick: 1, id: 1, by }])

  it('chute : famille et statut Résistant lus dans le monde du tick', () => {
    const next = withEvents(base, [
      { type: 'fell', tick: 1, id: 4 },
      { type: 'fell', tick: 1, id: 3 },
    ])
    expect(tickNotes(prev, cmd(), next)).toEqual([
      { kind: 'chute', tick: 1, id: 4, family: 'souriant', resistant: true },
      { kind: 'chute', tick: 1, id: 3, family: 'souriant', resistant: false },
    ])
  })

  it('mort visée : point visé à 1,5 m du corps et strictement plus près de lui que de tout Hostile', () => {
    const note = (by: 'achevement' | 'sentence' | 'union', aim: { x: number; z: number }) =>
      tickNotes(prev, cmd({ aim }), deathOf(by))[0]
    expect(note('achevement', at(1.2))).toMatchObject({ kind: 'mort', visee: true, enCombat: true })
    expect(note('achevement', at(2.5))).toMatchObject({ visee: false }) // 1,5 m du corps mais 0,5 m de l'Hostile
    expect(note('achevement', at(1, 1.6))).toMatchObject({ visee: false }) // 1,6 m du corps
    expect(note('achevement', at(2, 0))).toMatchObject({ visee: false }) // égalité : pas strictement plus près
    expect(note('sentence', at(-10))).toMatchObject({ visee: true })
    expect(note('union', at(1))).toMatchObject({ visee: false })
  })

  it('mort hors combat : sans Hostile, seule la distance compte', () => {
    const calm = patchState(dead, 2, { kind: 'mort', at: 0 })
    const n = tickNotes(
      prev,
      cmd({ aim: at(2.4) }),
      withEvents(calm, [{ type: 'death', tick: 1, id: 1, by: 'achevement' }]),
    )
    expect(n[0]).toMatchObject({ enCombat: false, visee: true })
  })

  it('mort : rang et nombre de voix lus dans le monde d’avant (t_d − 1)', () => {
    const n = tickNotes(prev, cmd(), deathOf('achevement'))[0]
    // Avant : 1 à 1 m, 3 à 1,12 m, 4 à 2 m → rangs 1 (id 1), 2 (id 3), 3 (id 4).
    expect(n).toMatchObject({ rang: 1, vocalisentAvant: 3 })
    const far = tickNotes(withPlayer(prev, { pos: at(-3) }), cmd(), deathOf('achevement'))[0]
    expect(far).toMatchObject({ rang: 3 })
  })

  it('F sans cible avec un mort à 1,0 m du point visé (B2.O8a), y compris le point de la commande en attente', () => {
    const none = withEvents(dead, [{ type: 'sentence-none', tick: 1 }])
    expect(tickNotes(prev, cmd({ sentence: true, aim: at(2) }), none)).toContainEqual({
      kind: 'f-vide',
      tick: 1,
      mortProche: true,
    })
    expect(tickNotes(prev, cmd({ sentence: true, aim: at(2.1) }), none)).toContainEqual({
      kind: 'f-vide',
      tick: 1,
      mortProche: false,
    })
    const buffered = withPlayer(prev, { buffer: { cmd: 'sentence', until: 9, aim: at(1.5) } })
    expect(tickNotes(buffered, cmd({ aim: at(-9) }), none)[0]).toMatchObject({ mortProche: true })
  })

  it('frappe de sondage : un mort à 0,6 m du point visé, aucune créature non morte à 2,5 m (B2.O8b)', () => {
    const lone = patchState(
      patchState(patchState(dead, 2, { kind: 'mort', at: 0 }), 3, { kind: 'mort', at: 0 }),
      4,
      {
        kind: 'mort',
        at: 0,
      },
    )
    const strike: SimEvent = {
      type: 'player-impact',
      tick: 1,
      source: 'frappe',
      comboStep: 0,
      debout: [],
      abattusOrd: [],
      abattusRes: [],
      mortsDansZone: 1,
    }
    expect(tickNotes(prev, cmd({ aim: at(1.5) }), withEvents(lone, [strike]))[0]).toEqual({
      kind: 'frappe',
      tick: 1,
      sondage: true,
    })
    expect(tickNotes(prev, cmd({ aim: at(1.7) }), withEvents(lone, [strike]))[0]).toMatchObject({
      sondage: false,
    })
    // Le Hostile 2 est à 1,5 m du point visé : ce n'est plus un sondage.
    expect(tickNotes(prev, cmd({ aim: at(1.5) }), withEvents(dead, [strike]))[0]).toMatchObject({
      sondage: false,
    })
  })

  it('F pressée près d’un Résistant à terre (B2.O8c) ; rien sans F ou sans Résistant à 2,5 m', () => {
    const next = withEvents(base, [])
    expect(tickNotes(prev, cmd({ sentence: true }), next)).toEqual([
      { kind: 'f', tick: 1, resistantsProches: [4] },
    ])
    expect(tickNotes(prev, cmd(), next)).toEqual([])
    const far = withPlayer(next, { pos: at(2) })
    expect(tickNotes(prev, cmd({ sentence: true }), far)).toEqual([])
  })
})
