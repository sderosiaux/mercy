// Tests du réducteur sur des journaux d'évènements fabriqués à la main, une mesure à la fois.
import { describe, expect, it } from 'vitest'
import type { SimEvent } from '../sim/index'
import type { TickNote } from './notes'
import { reduceRun } from './reducer'
import type { SeriesLine } from './series'

const L0: SeriesLine = {
  tick: 0,
  hostiles: 0,
  rituels: 0,
  abattusOrd: 0,
  abattusRes: 0,
  absorbes: 0,
  morts: 0,
  nonMorts: 1,
  cris: 0,
  vocalisent: 0,
  horde8: 0,
  abattus6: 0,
  morts6: 0,
  vie: 100,
  ferveur: 0,
}
// Série des ticks 0 à n ; `at` modifie certaines lignes.
const series = (n: number, at: Record<number, Partial<SeriesLine>> = {}): SeriesLine[] =>
  Array.from({ length: n + 1 }, (_, t) => ({ ...L0, tick: t, ...at[t] }))
const run = (
  events: SimEvent[],
  opts: { n?: number; at?: Record<number, Partial<SeriesLine>>; notes?: TickNote[] } = {},
) =>
  reduceRun(events, { weapon: 'couperet', series: series(opts.n ?? 1000, opts.at), notes: opts.notes ?? [] })

const fell = (tick: number, id: number): SimEvent => ({ type: 'fell', tick, id })
const death = (
  tick: number,
  id: number,
  by: 'achevement' | 'sentence' | 'union' | 'variant-b' = 'achevement',
): SimEvent => ({
  type: 'death',
  tick,
  id,
  by,
})
const rise = (
  tick: number,
  id: number,
  cause: 'delai' | 'priere' | 'chirurgien' = 'delai',
  cicatrices = 1,
): SimEvent => ({
  type: 'rise',
  tick,
  id,
  cicatrices,
  cause,
})
const cryStart = (tick: number, id: number): SimEvent => ({ type: 'cry-start', tick, id })
const cryStop = (tick: number, id: number, cause: 'death' | 'rise' | 'reset' = 'death'): SimEvent => ({
  type: 'cry-stop',
  tick,
  id,
  cause,
})
const impact = (
  tick: number,
  sets: { debout?: number[]; abattusOrd?: number[]; abattusRes?: number[]; mortsDansZone?: number } = {},
): SimEvent => ({
  type: 'player-impact',
  tick,
  source: 'frappe',
  debout: sets.debout ?? [],
  abattusOrd: sets.abattusOrd ?? [],
  abattusRes: sets.abattusRes ?? [],
  mortsDansZone: sets.mortsDansZone ?? 0,
})
const alert = (tick: number, id: number): SimEvent => ({ type: 'alert', tick, id, cause: 'proximity' })
const waveEnd = (tick: number): SimEvent => ({ type: 'wave-end', tick })
const hitPlayer = (
  tick: number,
  amount: number,
  damageType: 'creature' | 'burst' = 'creature',
): SimEvent => ({
  type: 'hit',
  tick,
  target: 'player',
  amount,
  damageType,
  by: 99,
})
const chute = (
  tick: number,
  id: number,
  opts: { resistant?: boolean; family?: 'souriant' | 'membre' } = {},
): TickNote => ({
  kind: 'chute',
  tick,
  id,
  family: opts.family ?? 'souriant',
  resistant: opts.resistant ?? false,
})
const mortNote = (
  tick: number,
  id: number,
  p: {
    by?: 'achevement' | 'sentence' | 'union' | 'variant-b'
    enCombat?: boolean
    visee?: boolean
    rang?: number | null
    vocalisentAvant?: number
  } = {},
): TickNote => ({
  kind: 'mort',
  tick,
  id,
  by: p.by ?? 'achevement',
  enCombat: p.enCombat ?? true,
  visee: p.visee ?? true,
  rang: p.rang === undefined ? 1 : p.rang,
  vocalisentAvant: p.vocalisentAvant ?? 1,
})

describe('bornes de la partie (B1 §5, B4 §5)', () => {
  it('fini, T, T0, T_S et D quand la vague est vidée', () => {
    const m = run([impact(40), alert(50, 1), waveEnd(500)], { n: 500 })
    expect(m).toMatchObject({ fini: true, T: 500, T0: 50, TS: 500, D: 450 })
  })
  it("sans fin de vague : T est le dernier tick joué (CAP), T_S et D n'existent pas", () => {
    const m = run([alert(50, 1)], { n: 21600 })
    expect(m).toMatchObject({ fini: false, T: 21600, T0: 50, TS: null, D: null })
  })
  it('T0 : un impact qui touche une créature engage, un impact à vide non', () => {
    expect(run([impact(30), impact(40, { debout: [2] })]).T0).toBe(40)
    expect(run([impact(30, { mortsDansZone: 1 })]).T0).toBe(30)
    expect(run([impact(30)]).T0).toBeNull()
  })
})

describe('B1', () => {
  it('morts, dégâts, soins hors ticks de reset, perte, vieFin, confort', () => {
    const events = [
      hitPlayer(10, 30),
      hitPlayer(20, 40),
      { type: 'heal', tick: 30, amount: 8, source: 'sentence' } as SimEvent,
      { type: 'player-death', tick: 50 } as SimEvent,
      { type: 'reset', tick: 50 } as SimEvent,
      waveEnd(100),
    ]
    const at: Record<number, Partial<SeriesLine>> = {}
    for (let t = 10; t <= 100; t++) at[t] = { vie: t < 20 ? 70 : t < 30 ? 30 : t < 50 ? 38 : 100 }
    const m = run(events, { n: 100, at })
    expect(m.b1).toMatchObject({ morts: 1, degats: 70, soins: 8, perte: 62, vieFin: 100, confort: false })
  })
  it('confort : fini, aucune mort du joueur, vieFin ≥ 50 (50 compris, 49 non)', () => {
    const at = (vie: number) => Object.fromEntries(Array.from({ length: 101 }, (_, t) => [t, { vie }]))
    expect(run([waveEnd(100)], { n: 100, at: at(50) }).b1.confort).toBe(true)
    expect(run([waveEnd(100)], { n: 100, at: at(49) }).b1.confort).toBe(false)
    expect(run([], { n: 100, at: at(100) }).b1.confort).toBe(false)
  })
  it('vieFin est lue au tick T', () => {
    const m = run([waveEnd(60)], { n: 80, at: { 60: { vie: 77 }, 80: { vie: 12 } } })
    expect(m.b1.vieFin).toBe(77)
  })
  it('épisodes de corps : achevés, récupérés par chaque voie, exclus', () => {
    const events: SimEvent[] = [
      fell(10, 1),
      death(20, 1), // achevé
      fell(10, 2),
      rise(370, 2), // récupéré : Relèvement
      fell(10, 3),
      { type: 'absorb', tick: 30, id: 9, others: [3] }, // récupéré : absorbé
      fell(10, 4),
      rise(40, 4, 'priere'),
      { type: 'prayer-complete', tick: 40, id: 8, others: [4] }, // récupéré : prière (un seul comptage)
      fell(10, 5),
      { type: 'assemble', tick: 50, id: 7, others: [5], created: 20 }, // récupéré : assemblé
      { type: 'sever', tick: 60, owner: 6, limb: 'brasDroit', member: 21 },
      { type: 'reattach', tick: 70, owner: 6, limb: 'brasDroit', member: 21, by: 'contact' }, // récupéré
      { type: 'sever', tick: 60, owner: 6, limb: 'brasGauche', member: 22 },
      death(80, 22, 'union'), // achevé, quelle que soit la cause
      fell(90, 3), // expulsé : nouvel épisode
      fell(90, 10),
      { type: 'reset', tick: 100 }, // 3 et 10 exclus
      fell(200, 11), // ouvert à la fin : exclu
    ]
    expect(run(events).b1.episodes).toEqual({ acheves: 2, recuperes: 5, exclus: 3 })
  })
  it('O7 : part des morts données visées en combat ; O8 : premier Achèvement visé après le premier fell', () => {
    const notes = [
      mortNote(100, 1, { by: 'achevement', visee: true, enCombat: false }),
      mortNote(120, 2, { by: 'sentence', visee: true, enCombat: true }),
      mortNote(130, 3, { by: 'achevement', visee: false, enCombat: true }),
      mortNote(140, 4, { by: 'achevement', visee: true, enCombat: true }),
      mortNote(150, 5, { by: 'union', visee: false, enCombat: true }),
    ]
    const m = run([fell(40, 1)], { notes })
    expect(m.b1.O7).toEqual({ donnees: 4, viseesEnCombat: 2, part: 0.5 })
    expect(m.b1.O8).toEqual({ premierFell: 40, premierAchevementVise: 100, delai: 60 })
  })
  it("O8 : une Sentence n'est pas un Achèvement", () => {
    const m = run([fell(40, 1)], { notes: [mortNote(100, 1, { by: 'sentence' })] })
    expect(m.b1.O8.premierAchevementVise).toBeNull()
    expect(m.b1.O8.delai).toBeNull()
  })
})

describe('B3 (§5.2)', () => {
  it('prières : PD, PA, PIj (par le joueur seulement), CR, RP', () => {
    const events: SimEvent[] = [
      { type: 'action-start', tick: 10, id: 8, action: 'priere' },
      { type: 'action-start', tick: 11, id: 8, action: 'baton' },
      { type: 'action-interrupted', tick: 20, id: 8, action: 'priere', by: 'player' },
      { type: 'action-interrupted', tick: 21, id: 8, action: 'priere', by: 'burst' },
      { type: 'action-interrupted', tick: 22, id: 8, action: 'baton', by: 'player' },
      { type: 'action-start', tick: 700, id: 8, action: 'priere' },
      rise(850, 1, 'priere', 3),
      rise(850, 2, 'priere', 1),
      { type: 'prayer-complete', tick: 850, id: 8, others: [1, 2] },
      { type: 'prayer-complete', tick: 900, id: 8, others: [] },
    ]
    expect(run(events).b3).toMatchObject({ PD: 2, PA: 2, PIj: 1, CR: 2, RP: 1 })
  })
  it('AB, éclatements par cause, VB, CH', () => {
    const events: SimEvent[] = [
      { type: 'absorb', tick: 10, id: 9, others: [1] },
      { type: 'absorb', tick: 100, id: 9, others: [2] },
      { type: 'burst', tick: 200, id: 9, others: [1, 2], cause: 'dos', stage: 2 },
      { type: 'burst', tick: 300, id: 9, others: [], cause: 'contact', stage: 3 },
      { type: 'burst', tick: 400, id: 9, others: [], cause: 'delai', stage: 3 },
      { type: 'burst', tick: 410, id: 19, others: [], cause: 'delai', stage: 3 },
      hitPlayer(300, 40, 'burst'),
      hitPlayer(301, 6, 'creature'),
      { type: 'player-rite', tick: 50, rite: 'charge' },
      { type: 'player-rite', tick: 60, rite: 'balayage' },
    ]
    expect(run(events).b3).toMatchObject({ AB: 2, ECd: 1, ECc: 1, ECt: 2, VB: 40, CH: 1, V: 46 })
  })
  it("AEP : abattus par l'éclatement de dos, moins les expulsés et le Porteur", () => {
    const burstHit = (tick: number, target: number): SimEvent => ({
      type: 'hit',
      tick,
      target,
      amount: 30,
      damageType: 'burst',
      by: 9,
    })
    const events: SimEvent[] = [
      fell(200, 1), // expulsé
      fell(200, 2), // expulsé
      { type: 'burst', tick: 200, id: 9, others: [1, 2], cause: 'dos', stage: 2 },
      { type: 'expel', tick: 200, id: 9, others: [1, 2] },
      burstHit(200, 3),
      fell(200, 3), // abattu par l'éclatement
      burstHit(200, 4),
      fell(200, 4),
      burstHit(200, 5), // touché, pas abattu (grand)
      fell(200, 9), // le Porteur vide tombe
      burstHit(500, 6),
      fell(500, 6),
      { type: 'burst', tick: 500, id: 19, others: [], cause: 'contact', stage: 3 }, // pas de dos : hors AEP
    ]
    expect(run(events).b3.AEP).toEqual([2])
  })
  it('MC : corps assemblés + Relèvements par Chirurgien + recoutures faites par un Chirurgien', () => {
    const events: SimEvent[] = [
      { type: 'assemble', tick: 10, id: 7, others: [1, 2, 3], created: 20 },
      rise(30, 4, 'chirurgien'),
      rise(40, 5, 'delai'),
      { type: 'reattach', tick: 50, owner: 6, limb: 'brasDroit', member: 21, by: 7 },
      { type: 'reattach', tick: 60, owner: 6, limb: 'brasGauche', member: 22, by: 'contact' },
    ]
    expect(run(events).b3.MC).toBe(5)
  })
  it('PIc : interruption précédée d’une Charge dans [t − 21, t]', () => {
    const interrupt = (tick: number): SimEvent => ({
      type: 'action-interrupted',
      tick,
      id: 8,
      action: 'priere',
      by: 'player',
    })
    const charge = (tick: number): SimEvent => ({ type: 'player-rite', tick, rite: 'charge' })
    expect(run([charge(100), interrupt(121)]).b3.PIc).toBe(1)
    expect(run([charge(100), interrupt(100)]).b3.PIc).toBe(1)
    expect(run([charge(100), interrupt(122)]).b3.PIc).toBe(0)
  })
  it('O3a : Charges suivies d’un éclatement de dos dans les 120 ticks', () => {
    const charge = (tick: number): SimEvent => ({ type: 'player-rite', tick, rite: 'charge' })
    const burst = (tick: number, cause: 'dos' | 'contact'): SimEvent => ({
      type: 'burst',
      tick,
      id: 9,
      others: [],
      cause,
      stage: 1,
    })
    const m = run([
      charge(100),
      burst(220, 'dos'),
      charge(500),
      burst(621, 'dos'),
      charge(800),
      burst(810, 'contact'),
    ])
    expect(m.b3.O3a).toEqual({ charges: 3, suiviesDos: 1 })
  })
})

describe('B4 (§5)', () => {
  it('O1 : attribution du temps aux actions, les ticks d’un impact vide passent à l’action suivante', () => {
    const events: SimEvent[] = [
      impact(60), // à vide, avant T0 : hors fenêtre d'engagement
      alert(100, 1),
      impact(100, { debout: [1] }), // utile : durée nominale, 21 ticks au Couperet
      impact(121, { abattusOrd: [1] }), // nettoyage : 21
      impact(142, {}), // vide : 21, passés à l'action suivante
      impact(163, { debout: [2], abattusOrd: [3] }), // utile : 21 + 21
      { type: 'sentence-start', tick: 200, target: 3 }, // Sentence : 37, plus 60 jusqu'à T_S
      waveEnd(260),
    ]
    const m = run(events, { n: 260 })
    expect(m.b4.O1.ticks).toEqual({ utile: 63, nettoyage: 21, sentence: 97 })
    expect(m.b4.O1.part).toBeCloseTo(21 / 181, 12)
    expect(m.b4.impacts).toEqual({ utile: 2, nettoyage: 1, vide: 1 })
  })
  it('O1 : la durée nominale suit l’arme (33 ticks à la Masse) ; un impact vide final passe à la précédente', () => {
    const events: SimEvent[] = [
      alert(100, 1),
      impact(100, { abattusOrd: [1] }),
      impact(133, {}),
      waveEnd(150),
    ]
    const m = reduceRun(events, { weapon: 'masse', series: series(150), notes: [] })
    expect(m.b4.O1.ticks).toEqual({ utile: 0, nettoyage: 33 + 33 + 17, sentence: 0 })
    expect(m.b4.O1.part).toBe(1)
    // Départ au Couperet, Masse prise au tick 1 : l'arme équipée à la première action est la Masse.
    const swapped = reduceRun([{ type: 'weapon-swap', tick: 1, weapon: 'masse' }, ...events], {
      weapon: 'couperet',
      series: series(150),
      notes: [],
    })
    expect(swapped.b4.O1.ticks.nettoyage).toBe(33 + 33 + 17)
  })
  it('O2 : impacts de nettoyage pur par mort donnée (les morts par Union sortent du dénominateur)', () => {
    const events: SimEvent[] = [
      alert(10, 1),
      impact(10, { abattusOrd: [1] }),
      impact(31, { abattusOrd: [2] }),
      impact(52, { debout: [3] }),
      death(10, 1),
      death(31, 2, 'sentence'),
      death(52, 3, 'variant-b'),
      death(52, 4, 'union'),
    ]
    const m = run(events)
    expect(m.b4.mortsDonnees).toBe(3)
    expect(m.b4.O2).toBeCloseTo(2 / 3, 12)
  })
  it('O3 : queues de fin de combat fermées, rompues, ouvertes', () => {
    const at: Record<number, Partial<SeriesLine>> = {
      10: { hostiles: 2 },
      11: { hostiles: 0, abattusOrd: 3 }, // E = 11
      12: { hostiles: 0, abattusOrd: 2 },
      50: { hostiles: 0, abattusOrd: 0 }, // fermée : 39 ticks
      60: { hostiles: 1 },
      61: { hostiles: 0, abattusOrd: 1 }, // E = 61
      62: { hostiles: 1, abattusOrd: 1 }, // rompue (Relèvement)
      63: { hostiles: 0, abattusOrd: 1 }, // E = 63, jamais fermée
      64: { hostiles: 0, abattusOrd: 1 },
    }
    // Les ticks non cités valent 0 Hostile et 0 Abattu, sauf la queue ouverte qu'on prolonge jusqu'à la fin.
    for (let t = 65; t <= 100; t++) at[t] = { hostiles: 0, abattusOrd: 1 }
    for (let t = 13; t < 50; t++) at[t] = { hostiles: 0, abattusOrd: 1 }
    const m = run([], { n: 100, at })
    expect(m.b4.O3).toEqual({ queues: [39], rompues: 1, ouvertes: 1 })
  })
  it('O4 : Relèvements par délai sur chutes ordinaires (Résistants et Membres errants exclus)', () => {
    const events: SimEvent[] = [
      fell(10, 1),
      rise(370, 1),
      fell(10, 2),
      rise(30, 2, 'priere'),
      fell(10, 3),
      rise(490, 3),
      fell(10, 4),
    ]
    const notes = [
      chute(10, 1),
      chute(10, 2),
      chute(10, 3, { resistant: true }),
      chute(10, 4, { family: 'membre' }),
    ]
    expect(run(events, { notes }).b4.O4).toEqual({ chutesOrd: 2, relevementsDelai: 1, part: 0.5 })
  })
  it('O6 : part des morts données par variante B ; O7 : pic de la horde ; O8 : morts du joueur', () => {
    const events: SimEvent[] = [
      death(10, 1, 'variant-b'),
      death(11, 2),
      death(12, 3, 'sentence'),
      death(13, 4, 'variant-b'),
      { type: 'player-death', tick: 20 },
    ]
    const m = run(events, { at: { 5: { horde8: 12 }, 6: { horde8: 17 }, 7: { horde8: 3 } } })
    expect(m.b4.O6).toEqual({ variantB: 2, part: 0.5 })
    expect(m.b4.O7.pic).toBe(17)
    expect(m.b4.O8.mortsJoueur).toBe(1)
  })
  it('O9 : cris actifs au début du tick d’un Achèvement, part des Achèvements qui coupent un cri', () => {
    const events: SimEvent[] = [
      cryStart(40, 1),
      cryStart(40, 2),
      cryStart(40, 3),
      fell(45, 4),
      cryStop(50, 1),
      death(50, 1),
      cryStop(50, 2),
      death(50, 2),
      death(50, 4), // encore muet : ne coupe pas de cri
      cryStart(50, 5), // commence après le geste du joueur : ne compte pas au tick 50
    ]
    const m = run(events)
    expect(m.b4.O9).toEqual({
      crisParAchevement: [2, 2, 3],
      achevements: 3,
      coupentUnCri: 2,
      partCoupentUnCri: 2 / 3,
    })
  })
  it('O10 : corps-temps, somme des Abattus ordinaires sur les ticks', () => {
    expect(
      run([], { n: 10, at: { 2: { abattusOrd: 3 }, 3: { abattusOrd: 4 }, 9: { abattusOrd: 1 } } }).b4.O10
        .corpsTemps,
    ).toBe(8)
  })
  it('Balayages par minute d’engagement, délais fell → death des Achèvements', () => {
    const events: SimEvent[] = [
      alert(0, 1),
      { type: 'player-rite', tick: 100, rite: 'balayage' },
      { type: 'player-rite', tick: 200, rite: 'balayage' },
      fell(100, 1),
      death(130, 1),
      { type: 'sever', tick: 140, owner: 6, limb: 'brasDroit', member: 21 },
      death(150, 21),
      fell(160, 3),
      death(170, 3, 'sentence'),
      waveEnd(1800),
    ]
    const m = run(events, { n: 1800 })
    expect(m.b4.balayages).toBe(2)
    expect(m.b4.balayagesParMinute).toBeCloseTo(4, 12)
    expect(m.b4.delaisAchevement).toEqual([30, 10])
  })
})

describe('B5', () => {
  it('O2 : la demi-seconde silencieuse', () => {
    const events: SimEvent[] = [
      fell(100, 1),
      death(110, 1), // mort avant fell + 30, sans cri
      fell(100, 2),
      cryStart(105, 2), // (journal fabriqué) un cri avant la mort : violation comptée
      cryStop(120, 2),
      death(120, 2),
      fell(100, 3),
      cryStart(130, 3), // vivant à fell + 30, cri exactement à fell + 30
      fell(100, 4),
      { type: 'sentence-start', tick: 110, target: 4 },
      death(146, 4, 'sentence'), // muet : écart « sentence »
      fell(100, 5),
      death(130, 5), // mort pile à fell + 30
      fell(200, 6),
      { type: 'expel', tick: 200, id: 9, others: [6] }, // expulsé en criant : pas de nouveau cry-start
      fell(300, 7), // vivant à 330, aucun cri : écart « autre »
      fell(990, 8), // la partie finit avant fell + 30 : hors mesure
    ]
    const m = run(events, { notes: [chute(100, 1), chute(990, 8)] })
    expect(m.b5.O2).toEqual({
      mortsAvant30: 2,
      mortsAvant30AvecCri: 1,
      mortsA30: 1,
      vivantsA30: 4,
      criA30: 1,
      ecartsA30: { sentence: 1, expulse: 1, autre: 1 },
    })
  })
  it('O2 : un corps avalé puis expulsé repart d’une nouvelle chute', () => {
    const events: SimEvent[] = [
      fell(400, 9),
      { type: 'absorb', tick: 405, id: 7, others: [9] },
      fell(410, 9), // expulsé pendant son halètement
      { type: 'expel', tick: 410, id: 7, others: [9] },
      death(420, 9), // mort avant 410 + 30 : la première chute ne compte pas comme « vivant à 430 »
    ]
    expect(run(events).b5.O2).toMatchObject({ mortsAvant30: 1, vivantsA30: 0 })
  })
  it('D1 : phase de la voix à la mort', () => {
    const events: SimEvent[] = [
      fell(10, 1),
      death(20, 1), // halètement
      fell(10, 2),
      cryStart(40, 2),
      cryStop(50, 2),
      death(50, 2), // cri
      fell(10, 3),
      cryStart(40, 3),
      { type: 'rise-telegraph', tick: 280, id: 3 },
      cryStop(300, 3),
      death(300, 3, 'sentence'), // inspiration
      death(310, 4, 'variant-b'), // debout : aucune
      { type: 'sever', tick: 320, owner: 6, limb: 'brasDroit', member: 21 },
      death(330, 21, 'union'), // Membre errant : aucune
    ]
    const D1 = run(events).b5.D1
    expect(D1.achevement).toEqual({ haletement: 1, cri: 1, inspiration: 0, aucune: 0 })
    expect(D1.sentence).toEqual({ haletement: 0, cri: 0, inspiration: 1, aucune: 0 })
    expect(D1['variant-b']).toEqual({ haletement: 0, cri: 0, inspiration: 0, aucune: 1 })
    expect(D1.union).toEqual({ haletement: 0, cri: 0, inspiration: 0, aucune: 1 })
  })
  it('O6 : fins sans mort par cause ; O9 : groupes Union ; O7 et O8 : N et voix dans la série', () => {
    const events: SimEvent[] = [
      rise(10, 1),
      rise(20, 2, 'priere'),
      { type: 'prayer-complete', tick: 20, id: 8, others: [2, 3] },
      { type: 'assemble', tick: 30, id: 7, others: [4, 5], created: 20 },
      { type: 'absorb', tick: 40, id: 9, others: [6] },
      death(50, 20),
      death(50, 4, 'union'),
      death(50, 5, 'union'),
      death(60, 9),
      death(60, 6, 'union'),
    ]
    const at = {
      1: { nonMorts: 5, vocalisent: 25 },
      2: { nonMorts: 3, vocalisent: 26 },
      3: { vocalisent: 24 },
    }
    const m = run(events, { n: 3, at })
    expect(m.b5.O6).toEqual({ releve: 2, priere: 2, assemblage: 2, absorption: 1 })
    expect(m.b5.O9.groupes).toBe(2)
    expect(m.b5.O7).toEqual({ nMax: 5, valeursN: 3 })
    expect(m.b5.O8).toEqual({ vocalisentMax: 26, ticksSatures: 2 })
  })
  it('O10 : morts données au rang 1, en phase cri ou inspiration, classées par voix actives à t_d − 1', () => {
    const events: SimEvent[] = []
    for (const id of [1, 2, 3, 4]) events.push(fell(10, id), cryStart(40, id))
    events.push(
      cryStop(100, 1),
      death(100, 1),
      cryStop(101, 2),
      death(101, 2),
      cryStop(102, 3),
      death(102, 3),
    )
    events.push(fell(10, 5), death(103, 5)) // phase halètement : hors mesure
    const notes = [
      mortNote(100, 1, { rang: 1, vocalisentAvant: 4 }), // classe 1
      mortNote(101, 2, { rang: 1, vocalisentAvant: 5 }), // classe 2
      mortNote(102, 3, { rang: 2, vocalisentAvant: 3 }), // pas au rang 1
      mortNote(103, 5, { rang: 1, vocalisentAvant: 1 }),
    ]
    expect(run(events, { notes }).b5.O10).toEqual({ classe1: 1, classe2: 1 })
  })
})

describe('B2', () => {
  it('S3 : t* est le premier tick de [600 ; 3600] avec 15 corps à 6 m, dont 4 Abattus et 4 morts', () => {
    const at = {
      599: { abattus6: 8, morts6: 8 },
      700: { abattus6: 11, morts6: 3 },
      701: { abattus6: 3, morts6: 12 },
      702: { abattus6: 4, morts6: 11 },
    }
    expect(run([], { n: 4000, at }).b2.S3.tStar).toBe(702)
    expect(run([], { n: 4000, at: { 3601: { abattus6: 8, morts6: 8 } } }).b2.S3.tStar).toBeNull()
  })
  it('O8 : temps de combat, F sur un mort, frappe de sondage, indices en temps de combat', () => {
    const at: Record<number, Partial<SeriesLine>> = {}
    for (let t = 0; t <= 100; t++) at[t] = { nonMorts: t >= 1 && t <= 20 ? 0 : 1 }
    const notes: TickNote[] = [
      { kind: 'f-vide', tick: 50, mortProche: true },
      { kind: 'f-vide', tick: 51, mortProche: false },
      { kind: 'frappe', tick: 60, sondage: true },
      { kind: 'frappe', tick: 61, sondage: false },
    ]
    const m = run([], { n: 100, at, notes })
    expect(m.b2.O8.tempsCombat).toBe(80)
    expect(m.b2.O8.O8a).toEqual([30])
    expect(m.b2.O8.O8b).toEqual([40])
  })
  it('O8c : chutes de Résistant avec clang, manquée = deux clangs et Relèvement sans F à 2,5 m', () => {
    const clang = (tick: number, id: number): SimEvent => ({ type: 'clang', tick, id })
    const events: SimEvent[] = [
      fell(10, 1),
      clang(20, 1),
      clang(41, 1),
      rise(490, 1), // manquée
      fell(10, 2),
      clang(20, 2),
      clang(41, 2),
      rise(490, 2), // F pressée près de lui : pas manquée
      fell(10, 3),
      clang(20, 3),
      rise(490, 3), // un seul clang : listée, pas manquée
      fell(10, 4),
      rise(490, 4), // aucun clang : non listée
      fell(10, 5),
      clang(20, 5),
      death(80, 5, 'sentence'),
    ]
    const notes: TickNote[] = [
      ...[1, 2, 3, 4, 5].map((id) => chute(10, id, { resistant: true })),
      { kind: 'f', tick: 300, resistantsProches: [2] },
      { kind: 'f', tick: 600, resistantsProches: [1] }, // après le Relèvement : ne compte pas
    ]
    const r = run(events, { notes }).b2.O8.O8c
    expect(r.map((x) => [x.id, x.clangs, x.fProche, x.issue, x.manquee])).toEqual([
      [1, 2, false, 'releve', true],
      [2, 2, true, 'releve', false],
      [3, 1, false, 'releve', false],
      [5, 1, false, 'mort', false],
    ])
  })
})
