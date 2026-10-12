// B5 §6 : b5(D), s1(k, verbe), s-nappe, s-sat. Une situation construite par branche du pseudo-code, puis les
// scènes S1 (5 variantes), S-nappe et S-sat de src/sim/waves.ts jouées au banc : chacune doit produire ce que
// la table du §6 annonce (sinon, défaut de scène à rapporter, pas un verdict sur B5).
import { describe, expect, it } from 'vitest'
import {
  type EventOf,
  FAMILIES,
  type PlayerCommands,
  type SimEvent,
  type SpawnDef,
  type Vec2,
  type World,
} from '../../sim/index'
import { creature, scene, withCreature, withPlayer } from '../../sim/testing'
import { DEFAULT_SPEC, makePolicy, playRun, type RunSpec } from '../harness'
import { base, decideB5, decideS1, decideSNappe, decideSSat, S_SAT_FIN } from './b5'

const v = (x: number, z: number): Vec2 => ({ x, z })
const S = (x: number, z: number, state: SpawnDef['state'], cicatrices: 0 | 3 = 0): SpawnDef => ({
  family: 'souriant',
  pos: v(x, z),
  state,
  cicatrices,
})
const W = (spawns: readonly SpawnDef[], tick = 0): World => ({
  ...scene(spawns, { families: FAMILIES }),
  tick,
})
const close = (a: Vec2, b: Vec2): void => {
  expect(a.x).toBeCloseTo(b.x, 9)
  expect(a.z).toBeCloseTo(b.z, 9)
}
const INF = Number.POSITIVE_INFINITY

describe('communes', () => {
  it('base : immobile, vise p.pos + (1, 0), rien de pressé', () => {
    const w = withPlayer(W([]), { pos: v(2, 3) })
    expect(base(w)).toEqual({
      move: v(0, 0),
      aim: v(3, 3),
      strike: false,
      dodge: false,
      sentence: false,
      rite: null,
      swapWeapon: false,
    } satisfies PlayerCommands)
  })
})

describe('b5(D)', () => {
  it('p.action ≠ null : base, même avec une cible à portée (Frappe comprise)', () => {
    const w = withPlayer(W([S(1, 0, 'hostile'), S(0, 1, 'abattu', 3)]), {
      action: { kind: 'frappe', start: 0, end: 21 },
    })
    for (const D of [0, 60, INF]) expect(decideB5(D, w)).toEqual(base(w))
  })
  it('Résistant à 2,3 m : Sentence sur Rés[0], pressée aux ticks pairs seulement', () => {
    const pairT = W([S(2.3, 0, 'abattu', 3), S(0, 2.2, 'abattu', 3), S(1, 0, 'hostile')], 10)
    expect(decideB5(60, pairT)).toEqual({ ...base(pairT), aim: v(0, 2.2), sentence: true })
    const impair = { ...pairT, tick: 11 }
    expect(decideB5(60, impair)).toEqual({ ...base(impair), aim: v(0, 2.2), sentence: false })
    expect(decideB5(60, W([S(2.4, 0, 'abattu', 3)])).sentence).toBe(false)
  })
  it('prêt(c) : ordinaire à terre depuis D ticks au moins ; D = ∞ : jamais', () => {
    // Abattu au tick 0 (since = 0), à 2 m.
    const at = (t: number) => W([S(2, 0, 'abattu')], t)
    expect(decideB5(0, at(0))).toEqual({ ...base(at(0)), aim: v(2, 0), strike: true })
    expect(decideB5(60, at(59)).strike).toBe(false)
    expect(decideB5(60, at(60))).toEqual({ ...base(at(60)), aim: v(2, 0), strike: true })
    expect(decideB5(INF, at(300)).strike).toBe(false)
    expect(decideB5(INF, at(300))).toEqual(base(at(300))) // C = ∅ : l'Abattu non prêt n'est pas une cible
    expect(decideB5(0, W([S(2.1, 0, 'abattu')])).strike).toBe(false) // au-delà de 2,0 m : on marche
  })
  it('Balayage : Ferveur ≥ 25 et au moins 3 créatures debout à 3,8 m', () => {
    const trois = withPlayer(W([S(3.8, 0, 'hostile'), S(0, 3, 'rituel'), S(-3, 0, 'hostile')]), {
      ferveur: 25,
    })
    expect(decideB5(60, trois)).toEqual({ ...base(trois), rite: 'balayage' })
    expect(decideB5(60, withPlayer(trois, { ferveur: 24 })).rite).toBeNull()
    const deux = withPlayer(W([S(3.9, 0, 'hostile'), S(0, 3, 'rituel'), S(-3, 0, 'hostile')]), {
      ferveur: 50,
    })
    expect(decideB5(60, deux).rite).toBeNull()
  })
  it('l’ordre des branches : Sentence, puis Ord à 2 m, puis Balayage, puis debout à 2 m', () => {
    const w = withPlayer(
      W([S(1, 0, 'hostile'), S(0, 1, 'hostile'), S(-1, 0, 'hostile'), S(0, -1.5, 'abattu')]),
      {
        ferveur: 100,
      },
    )
    expect(decideB5(0, w).strike).toBe(true) // Ord[0] avant le Balayage
    expect(decideB5(0, w).aim).toEqual(v(0, -1.5))
    expect(decideB5(INF, w).rite).toBe('balayage') // pas d'Ord : Balayage
    const res = withCreature(w, 4, { resistant: true, cicatrices: 3 })
    expect(decideB5(0, { ...res, tick: 2 }).sentence).toBe(true) // Rés[0] avant tout
  })
  it('debout à 2 m : frappe Deb[0], le plus proche (égalité : plus petit id)', () => {
    const w = W([S(0, 2, 'rituel'), S(2, 0, 'hostile'), S(0, -1.9, 'abattu')])
    expect(decideB5(60, w)).toEqual({ ...base(w), aim: v(0, 2), strike: true })
  })
  it('sinon, marche vers C[0] = le plus proche de Ord ∪ Rés ∪ Deb ; C = ∅ : base', () => {
    const w = W([S(0, 6, 'hostile'), S(4, 0, 'abattu'), S(-5, 0, 'abattu', 3)], 100)
    const out = decideB5(60, w)
    expect(out.aim).toEqual(v(4, 0))
    close(out.move, v(1, 0))
    expect(out.strike || out.sentence || out.dodge || out.rite !== null).toBe(false)
    const out2 = decideB5(INF, w) // l'ordinaire n'est jamais prêt : le Résistant (5 m) passe devant l'Hostile
    expect(out2.aim).toEqual(v(-5, 0))
    expect(decideB5(60, W([S(1, 0, 'mort')]))).toEqual(base(W([S(1, 0, 'mort')])))
  })
  it('jamais d’Esquive ni de Charge', () => {
    const w = withPlayer(W([S(1, 0, 'hostile'), S(0, 5, 'hostile')]), { vie: 1, ferveur: 100 })
    for (const D of [0, 60, INF]) {
      const out = decideB5(D, w)
      expect(out.dodge).toBe(false)
      expect(out.rite).not.toBe('charge')
    }
  })
})

describe('s1(k, verbe)', () => {
  // Abattu depuis le tick 10.
  const abattuDepuis = (since: number, t: number): World => {
    const w = W([S(2, 0, 'abattu'), S(5, 5, 'hostile')], t)
    const c = creature(w, 1)
    if (c.state.kind !== 'abattu') throw new Error('fixture')
    return withCreature(w, 1, { state: { ...c.state, since } })
  }
  it('cible : la créature d’id minimal ; base.aim = c.pos ; debout → Frappe maintenue', () => {
    const w = W([S(2, 0, 'rituel'), S(1, 0, 'hostile')])
    for (const verbe of ['frappe', 'sentence', 'aucun'] as const)
      expect(decideS1(120, verbe, w)).toEqual({ ...base(w), aim: v(2, 0), strike: true })
  })
  it('à terre avant since + k : base visant le corps', () => {
    const w = abattuDepuis(10, 129)
    expect(decideS1(120, 'frappe', w)).toEqual({ ...base(w), aim: v(2, 0) })
  })
  it('verbe frappe, t ≥ since + k : Frappe maintenue', () => {
    const w = abattuDepuis(10, 130)
    expect(decideS1(120, 'frappe', w)).toEqual({ ...base(w), aim: v(2, 0), strike: true })
  })
  it('verbe sentence, t ≥ since + k : F aux ticks pairs si aucune action en cours', () => {
    const w = abattuDepuis(10, 130)
    expect(decideS1(120, 'sentence', w)).toEqual({ ...base(w), aim: v(2, 0), sentence: true })
    expect(decideS1(120, 'sentence', { ...w, tick: 131 }).sentence).toBe(false)
    const busy = withPlayer(w, { action: { kind: 'sentence', start: 130, end: 166 } })
    expect(decideS1(120, 'sentence', busy)).toEqual({ ...base(busy), aim: v(2, 0) })
  })
  it('verbe aucun : jamais rien sur le corps', () => {
    const w = abattuDepuis(10, 500)
    expect(decideS1(0, 'aucun', w)).toEqual({ ...base(w), aim: v(2, 0) })
  })
  it('cible morte : base visant le corps', () => {
    const w = W([S(2, 0, 'mort'), S(1, 0, 'hostile')])
    expect(decideS1(0, 'frappe', w)).toEqual({ ...base(w), aim: v(2, 0) })
  })
})

describe('s-nappe', () => {
  const dead = (w: World, id: number, at: number): World =>
    withCreature(w, id, { state: { kind: 'mort', at } })
  it('base jusqu’à dernier + 180 (dernier = 0 sans mort)', () => {
    expect(decideSNappe(W([S(1, 0, 'hostile')], 179))).toEqual(base(W([S(1, 0, 'hostile')], 179)))
    const w = dead(W([S(1, 0, 'hostile'), S(5, 0, 'rituel')], 379), 1, 200)
    expect(decideSNappe(w)).toEqual(base(w))
  })
  it('puis la créature non morte d’id minimal : marche vers elle si elle est debout et à plus de 2 m', () => {
    const w = dead(W([S(1, 0, 'hostile'), S(0, 5, 'rituel'), S(0.5, 0, 'rituel')], 380), 1, 200)
    const out = decideSNappe(w)
    expect(out.aim).toEqual(v(0, 5))
    close(out.move, v(0, 1))
    expect(out.strike).toBe(false)
  })
  it('à 2 m ou moins, ou à terre : Frappe maintenue sans bouger', () => {
    const pres = W([S(2, 0, 'rituel')], 180)
    expect(decideSNappe(pres)).toEqual({ ...base(pres), aim: v(2, 0), strike: true })
    const terre = W([S(5, 0, 'abattu')], 180)
    expect(decideSNappe(terre)).toEqual({ ...base(terre), aim: v(5, 0), strike: true })
  })
  it('plus aucune créature non morte : base', () => {
    const w = dead(W([S(1, 0, 'hostile')], 900), 1, 100)
    expect(decideSNappe(w)).toEqual(base(w))
  })
})

describe('s-sat', () => {
  it.each([
    [0, v(0, 0)],
    [89, v(0, 0)],
    [90, v(0, 1)],
    [149, v(0, 1)],
    [150, v(0, -1)],
    [209, v(0, -1)],
    [210, v(0, -1)],
    [264, v(0, -1)],
  ])('t = %i : move %o', (t, move) => {
    const w = W([], t)
    expect(decideSSat(w)).toEqual({ ...base(w), move })
  })
  it('fin à t = 265', () => {
    expect(S_SAT_FIN).toBe(265)
  })
})

// Scènes de waves.ts jouées au banc avec les politiques du registre.
const scenePlay = (wave: string, policy: string, patch: Partial<RunSpec> = {}) =>
  playRun({ ...DEFAULT_SPEC, wave, policy, seed: 1, timeoutTicks: 3000, ...patch })
const ofType = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T): EventOf<T>[] =>
  events.filter((e) => e.type === type) as EventOf<T>[]

describe('scènes de B5 au banc (src/sim/waves.ts)', () => {
  const s1Run = (variante: string, patch: Partial<RunSpec> = {}) => {
    const { result, trace } = scenePlay('S1', `s1:variante=${variante}`, { tailTicks: 180, ...patch })
    const fell = ofType(trace.events, 'fell')[0]?.tick ?? Number.NaN
    const death = ofType(trace.events, 'death')[0]
    return { result, events: trace.events, fell, death }
  }
  it('S1-hal : mort pendant le halètement (avant fell + 30), aucun cri, environ 21 ticks après la chute', () => {
    const { result, events, fell, death } = s1Run('S1-hal')
    expect(death?.by).toBe('achevement')
    expect((death?.tick ?? 0) - fell).toBeLessThan(30)
    expect(ofType(events, 'cry-start')).toEqual([])
    expect(result.endTick).toBe((death?.tick ?? 0) + 180)
  })
  it('S1-cri : mort pendant le cri (après cry-start, avant rise-telegraph)', () => {
    const { events, fell, death } = s1Run('S1-cri')
    expect(death?.by).toBe('achevement')
    expect(ofType(events, 'cry-start').map((e) => e.tick)).toEqual([fell + 30])
    expect(death?.tick ?? 0).toBeGreaterThanOrEqual(fell + 120)
    expect(ofType(events, 'rise-telegraph')).toEqual([])
  })
  it('S1-sent : cri tenu pendant la Sentence, coupé au coup fatal', () => {
    const { events, fell, death } = s1Run('S1-sent')
    expect(death?.by).toBe('sentence')
    const start = ofType(events, 'sentence-start')[0]
    expect(start?.tick ?? 0).toBeGreaterThan(fell + 30)
    expect(ofType(events, 'cry-start')).toHaveLength(1)
    expect(ofType(events, 'rise-telegraph')).toEqual([])
    expect(ofType(events, 'cry-stop')).toEqual([
      expect.objectContaining({ tick: death?.tick, cause: 'death' }),
    ])
  })
  it('S1-insp : mort pendant l’inspiration (après rise-telegraph, avant rise)', () => {
    const { events, death } = s1Run('S1-insp')
    expect(death?.by).toBe('achevement')
    const tel = ofType(events, 'rise-telegraph')[0]
    expect(tel).toBeDefined()
    expect(death?.tick ?? 0).toBeGreaterThan(tel?.tick ?? 0)
    expect(ofType(events, 'rise')).toEqual([])
  })
  it('S1-rel : relèvement sans mort jusqu’à since + 420', () => {
    const probe = s1Run('S1-rel', { timeoutTicks: 2000 })
    const { result, events } = s1Run('S1-rel', { timeoutTicks: probe.fell + 420 })
    expect(result.timeout).toBe(true)
    expect(result.endTick).toBe(probe.fell + 420)
    expect(ofType(events, 'death')).toEqual([])
    expect(ofType(events, 'rise').map((e) => e.tick)).toEqual([probe.fell + 360])
  })
  it('S-nappe : N passe de 6 à 0 par paliers d’au moins 3 s, achevés pendant le halètement, aucun cri', () => {
    const { result, trace } = scenePlay('S-nappe', 's-nappe', { tailTicks: 180, timeoutTicks: 10_000 })
    const deaths = ofType(trace.events, 'death')
    expect(result.fini).toBe(true)
    expect(deaths).toHaveLength(6)
    expect(deaths.every((d) => d.by === 'achevement')).toBe(true)
    for (let i = 1; i < deaths.length; i++)
      expect((deaths[i]?.tick ?? 0) - (deaths[i - 1]?.tick ?? 0)).toBeGreaterThanOrEqual(180)
    expect(ofType(trace.events, 'cry-start')).toEqual([])
    expect(ofType(trace.events, 'alert').filter((e) => e.cause === 'cry')).toEqual([])
  })
  it('S-sat : 36 Abattus, joueur qui monte puis redescend, fin à 265 avant toute inspiration', () => {
    const { result, trace } = scenePlay('S-sat', 's-sat', { timeoutTicks: S_SAT_FIN })
    expect(result.endTick).toBe(S_SAT_FIN)
    expect(ofType(trace.events, 'fell')).toHaveLength(36)
    expect(ofType(trace.events, 'rise-telegraph')).toEqual([])
    expect(ofType(trace.events, 'death')).toEqual([])
    expect(trace.series.length).toBe(S_SAT_FIN + 1)
  })
  it('les politiques du registre sont celles du module', () => {
    const w = W([S(2, 0, 'abattu')], 60)
    expect(makePolicy('b5:D=60').decide(w, null)[0]).toEqual(decideB5(60, w))
    expect(makePolicy('s1:k=120:verbe=sentence').decide(w, null)[0]).toEqual(decideS1(120, 'sentence', w))
  })
})

// Conséquence de la lecture littérale de « si p.action ≠ null : renvoyer base » : la Frappe n'est pas maintenue
// pendant l'action, donc le combo retombe à 0 à la fin de chaque coup (bourreau.ts, fin d'action sans strike).
// Consigné dans .mercy/requests/C6c.md ; ce test fige la lecture, il ne la juge pas.
describe('b5(D) au banc : chaque coup est le premier du combo', () => {
  it.each(['b5:D=0', 'b5:D=60', 'b5:D=inf'])('%s sur V1, graine 1 : comboStep toujours 0', (policy) => {
    const { trace } = scenePlay('V1', policy, { timeoutTicks: 10_800 })
    const frappes = ofType(trace.events, 'player-impact').filter((e) => e.source === 'frappe')
    expect(frappes.length).toBeGreaterThan(10)
    expect(new Set(frappes.map((e) => e.comboStep))).toEqual(new Set([0]))
  })
})
