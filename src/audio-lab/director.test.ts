// Directeur audio sur la vraie simulation (scènes de B5 §6), sans contexte audio : décisions et comptes.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AGONIE_S,
  AGONIE_TICKS,
  AGONY_LANES,
  BENCH_RATE,
  DUCK_HOLD_S,
  QUANTUM,
  VOICE_DUCK_HOLD_S,
} from '../audio/constants'
import { type Cmd, type DirectorState, direct, initialDirector } from '../audio/director'
import { hasVoice, vocalising } from '../audio/ends'
import { poolsOf } from '../audio/engine'
import type { Manifest } from '../audio/manifest'
import { b5, decideS1 } from '../bots/b2b4b5/b5'
import { createWorld, FAMILIES, type SimEvent, step, type World } from '../sim/index'
import { waveById } from '../sim/waves'
import { type SceneDef, s1Scene, sSatScene } from './scenes'

const manifest = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../public/audio/manifest.json'), 'utf8'),
) as Manifest
const pools = poolsOf(manifest)
const tickTime = (t: number) => (Math.ceil(((t / 60) * BENCH_RATE) / QUANTUM) * QUANTUM) / BENCH_RATE

interface Tk {
  readonly world: World
  readonly cmds: readonly Cmd[]
  readonly state: DirectorState
  readonly ranked: readonly { id: number; rank: number }[]
}

const runDirector = (sc: SceneDef): { ticks: Tk[]; events: SimEvent[] } => {
  let w = sc.world0
  let s = initialDirector()
  const ticks: Tk[] = []
  const events: SimEvent[] = []
  for (let k = 0; k <= sc.ticks; k++) {
    if (k > 0) w = step(w, sc.policy(w))
    events.push(...w.events)
    const r = direct(s, w, w.player.pos, tickTime(w.tick), pools)
    s = r.state
    ticks.push({ world: w, cmds: r.cmds, state: s, ranked: r.ranked })
  }
  return { ticks, events }
}

const cmdsOf = <T extends Cmd['t']>(ticks: readonly Tk[], t: T) =>
  ticks.flatMap((k) =>
    k.cmds.filter((c) => c.t === t).map((c) => ({ tick: k.world.tick, c: c as Extract<Cmd, { t: T }> })),
  )

const evTick = (events: readonly SimEvent[], type: SimEvent['type']) =>
  events.find((e) => e.type === type)?.tick

// Râle d'une voix tenue au tick de la mort : [tick, emplacement quitté, piste, a un fichier de râle].
const agonies = (ticks: readonly Tk[]) =>
  cmdsOf(ticks, 'voice-agony').map((x) => [x.tick, x.c.slot, x.c.lane, x.c.file !== null])

describe('directeur sur S1 (B5 §6)', () => {
  it('S1-hal : voix au tick de la chute, aucun cri, râle sur une piste d’agonie au tick de la mort, rien après', () => {
    const { ticks, events } = runDirector(s1Scene('S1-hal'))
    const fell = evTick(events, 'fell')
    const death = evTick(events, 'death')
    expect(fell).toBeDefined()
    expect(death).toBeDefined()
    expect((death as number) < (fell as number) + 30).toBe(true)
    expect(cmdsOf(ticks, 'voice-start')).toEqual([
      expect.objectContaining({ tick: fell, c: expect.objectContaining({ phase: 'halètement' }) }),
    ])
    expect(cmdsOf(ticks, 'voice-phase')).toEqual([])
    expect(cmdsOf(ticks, 'voice-end')).toEqual([])
    expect(agonies(ticks)).toEqual([[death, 0, 0, true]])
    expect(events.some((e) => e.type === 'cry-start')).toBe(false)
  })

  it('S1-cri : phase cri au tick de cry-start, râle au tick de la mort, atténuation et impact au même tick', () => {
    const { ticks, events } = runDirector(s1Scene('S1-cri'))
    const cry = evTick(events, 'cry-start')
    const death = evTick(events, 'death') as number
    expect(cmdsOf(ticks, 'voice-phase').map((x) => [x.tick, x.c.phase])).toEqual([[cry, 'cri']])
    expect(cmdsOf(ticks, 'voice-end')).toEqual([])
    expect(agonies(ticks)).toEqual([[death, 0, 0, true]])
    // Le râle est celui qui suit le cri du corps (même timbre, champ `follows` du manifeste).
    const cri = cmdsOf(ticks, 'voice-phase')[0]?.c.file
    const rale = cmdsOf(ticks, 'voice-agony')[0]?.c.file
    expect(manifest.files.find((f) => f.id === rale)?.follows).toBe(cri)
    // Ducking de l'ambiance : de la mort jusqu'à 0,4 s après la fin du râle (§8.2).
    const down = cmdsOf(ticks, 'duck-down')
    expect(down.map((x) => x.tick)).toEqual([death])
    expect(down[0]?.c.releaseAt).toBeCloseTo(tickTime(death) + AGONIE_S + DUCK_HOLD_S, 12)
    expect(
      cmdsOf(ticks, 'oneshot')
        .filter((x) => x.tick === death)
        .map((x) => x.c.kind),
    ).toEqual(['impact-tranchant'])
    // N passe de 1 à 0 au tick de la mort : extinction de la nappe.
    expect(cmdsOf(ticks, 'nappe').map((x) => [x.tick, x.c.n])).toEqual([
      [0, 1],
      [death, 0],
    ])
  })

  it('S1-cri : les autres voix sont baissées au tick de la mort (D-fix3, tour 2 de B5.O10), jusqu’à VOICE_DUCK_HOLD_S après', () => {
    const { ticks, events } = runDirector(s1Scene('S1-cri'))
    const death = evTick(events, 'death') as number
    const down = cmdsOf(ticks, 'voice-duck-down')
    expect(down.map((x) => x.tick)).toEqual([death])
    expect(down[0]?.c.at).toBeCloseTo(tickTime(death), 12)
    expect(down[0]?.c.releaseAt).toBeCloseTo(tickTime(death) + VOICE_DUCK_HOLD_S, 12)
    expect(cmdsOf(ticks, 'voice-duck-extend')).toEqual([])
  })

  it('S1-sent : le cri tient jusqu’au coup fatal de la Sentence, puis râle', () => {
    const { ticks, events } = runDirector(s1Scene('S1-sent'))
    const start = evTick(events, 'sentence-start') as number
    const death = events.find((e) => e.type === 'death')
    expect(death?.type === 'death' && death.by).toBe('sentence')
    expect(cmdsOf(ticks, 'voice-end')).toEqual([])
    expect(agonies(ticks)).toEqual([[death?.tick, 0, 0, true]])
    expect(death?.tick).toBeGreaterThan(start)
  })

  it('Sentence avant le cri : exécution silencieuse, aucun râle, le halètement s’éteint dans son emplacement', () => {
    // S1 avec Sentence dès la chute (k = 0) : la Sentence part avant fell + 30, le corps reste muet (L7, phase B).
    const sc = s1Scene('S1-hal')
    const { ticks, events } = runDirector({ ...sc, policy: (w) => decideS1(0, 'sentence', w), ticks: 300 })
    const death = events.find((e) => e.type === 'death')
    expect(death?.type === 'death' && death.by).toBe('sentence')
    expect(events.some((e) => e.type === 'cry-start')).toBe(false)
    expect(agonies(ticks)).toEqual([[death?.tick, 0, null, false]])
    expect(cmdsOf(ticks, 'agony-denied').map((x) => [x.tick, x.c.reason])).toEqual([[death?.tick, 'muet']])
  })

  it('S1-insp : inspiration au tick de rise-telegraph, râle au tick de la mort', () => {
    const { ticks, events } = runDirector(s1Scene('S1-insp'))
    const tel = evTick(events, 'rise-telegraph')
    const death = evTick(events, 'death')
    expect(cmdsOf(ticks, 'voice-phase').map((x) => [x.tick, x.c.phase])).toEqual([
      [evTick(events, 'cry-start'), 'cri'],
      [tel, 'inspiration'],
    ])
    expect(cmdsOf(ticks, 'voice-end')).toEqual([])
    expect(agonies(ticks)).toEqual([[death, 0, 0, true]])
  })

  it('S1-rel : le relèvement finit la voix en fondu, jamais en coupure, et sans atténuation', () => {
    const { ticks, events } = runDirector(s1Scene('S1-rel'))
    const rise = evTick(events, 'rise')
    const ends = cmdsOf(ticks, 'voice-end')
    expect(ends[0]).toEqual(
      expect.objectContaining({
        tick: rise,
        c: expect.objectContaining({ mode: 'fade', cause: 'relevement' }),
      }),
    )
    expect(ends.every((x) => x.c.mode === 'fade')).toBe(true)
    expect(cmdsOf(ticks, 'duck-down')).toEqual([])
    expect(cmdsOf(ticks, 'voice-duck-down')).toEqual([])
  })

  it('aucune source ne démarre pour un id après sa mort, et deux exécutions donnent les mêmes commandes', () => {
    for (const v of ['S1-hal', 'S1-cri', 'S1-sent', 'S1-insp'] as const) {
      const a = runDirector(s1Scene(v))
      const death = evTick(a.events, 'death') as number
      const late = a.ticks
        .filter((k) => k.world.tick >= death)
        .flatMap((k) => k.cmds.filter((c) => c.t === 'voice-start' || c.t === 'src-start'))
      expect(late).toEqual([])
      const b = runDirector(s1Scene(v))
      expect(JSON.stringify(b.ticks.map((k) => k.cmds))).toBe(JSON.stringify(a.ticks.map((k) => k.cmds)))
    }
  })
})

describe('budget de 24 voix sur S-sat (B5.O8, 36 corps, auditeur qui se déplace)', () => {
  const { ticks } = runDirector(sSatScene())

  it('(a) jamais plus de 24 emplacements occupés, fondus compris', () => {
    const worst = Math.max(...ticks.map((k) => k.state.slots.filter((s) => s.kind !== 'free').length))
    expect(worst).toBeLessThanOrEqual(24)
  })

  it('(c) chaque corps de rang ≤ 20 a une voix, sauf entré dans les 20 premiers depuis moins de 8 ticks', () => {
    const enteredTop20 = new Map<number, number>()
    const violations: string[] = []
    let prevTop = new Set<number>()
    for (const k of ticks) {
      const top = new Set(k.ranked.filter((r) => r.rank <= 20).map((r) => r.id))
      for (const id of top) if (!prevTop.has(id)) enteredTop20.set(id, k.world.tick)
      prevTop = top
      for (const id of top) {
        if (k.state.voices.has(id)) continue
        const since = k.world.tick - (enteredTop20.get(id) ?? 0)
        if (since >= 8) violations.push(`tick ${k.world.tick} : corps ${id} sans voix depuis ${since} ticks`)
      }
    }
    expect(violations).toEqual([])
  })

  it('(c) chaque voix tenue (hors fondu) appartient à un corps de rang ≤ 28', () => {
    const bad = ticks.flatMap((k) => {
      const rank = new Map(k.ranked.map((r) => [r.id, r.rank]))
      return [...k.state.voices.keys()]
        .filter((id) => (rank.get(id) ?? 99) > 28)
        .map((id) => `${k.world.tick}:${id}`)
    })
    expect(bad).toEqual([])
  })

  it('le déplacement force des vols de voix, tous en fondu', () => {
    const steals = cmdsOf(ticks, 'voice-end')
    expect(steals.length).toBeGreaterThan(0)
    expect(steals.every((x) => x.c.cause === 'vol' && x.c.mode === 'fade')).toBe(true)
  })
})

describe('emplacement coupé par une mort, réattribué au même tick (B5.O1, O8 b)', () => {
  // Parties où le vérificateur B5 a relevé des corps tombés sans voix au tick de leur chute (Balayage qui tue et
  // abat au même tick, emplacements coupés libérés à t + 1) : V6, politique b5, graines 4, 7, 9 et 13.
  const games = [
    ['V6', 4, 'A', 60],
    ['V6', 7, 'A', Number.POSITIVE_INFINITY],
    ['V6', 9, 'A', Number.POSITIVE_INFINITY],
    ['V6', 13, 'B', Number.POSITIVE_INFINITY],
  ] as const
  let reusedSameTick = 0

  it.each(games)(
    '%s graine %i %s, b5(%s) : toute chute a sa voix au tick même quand 24 corps au plus vocalisent',
    (wave, seed, variant, D) => {
      const policy = b5(D)
      let w = createWorld({ seed, variant, wave: waveById(wave), families: FAMILIES })
      let s = initialDirector()
      const missing: string[] = []
      for (let k = 0; k < 10_800; k++) {
        if (k > 0) w = step(w, policy.decide(w, null)[0])
        const r = direct(s, w, w.player.pos, tickTime(w.tick), pools)
        s = r.state
        const byId = new Map(w.creatures.map((c) => [c.id, c]))
        const nV = w.creatures.filter((c) => vocalising(c, byId)).length
        for (const e of w.events) {
          if (e.type !== 'fell' || nV > 24) continue
          const c = byId.get(e.id)
          if (c && vocalising(c, byId) && !s.voices.has(e.id))
            missing.push(`tick ${w.tick} : corps ${e.id} (${nV} vocalisent)`)
        }
        const leftSlots = new Set(
          r.cmds.flatMap((c) => (c.t === 'voice-agony' && c.slot !== null ? [c.slot] : [])),
        )
        reusedSameTick += r.cmds.filter((c) => c.t === 'voice-start' && leftSlots.has(c.slot)).length
        if (w.creatures.every((c) => c.state.kind === 'mort')) break
      }
      expect(missing).toEqual([])
    },
  )

  it('ces parties réattribuent bien au tick de la mort des emplacements quittés par une agonie', () => {
    expect(reusedSameTick).toBeGreaterThan(0)
  })
})

describe('râles : qui râle, quand, sur quelle piste (L4, L5, §19 ; décisions de l’orchestrateur du 2026-10-12)', () => {
  // Parties de R où des créatures meurent debout (variante B), en grappe (Balayage) et par Union.
  const games = [
    ['V2', 1, 'B', 60],
    ['V4', 2, 'B', 60],
    ['V6', 4, 'A', 60],
    ['V6', 7, 'B', Number.POSITIVE_INFINITY],
  ] as const
  const runGame = (wave: string, seed: number, variant: 'A' | 'B', D: number) => {
    const policy = b5(D)
    let w = createWorld({ seed, variant, wave: waveById(wave), families: FAMILIES })
    let s = initialDirector()
    const out: { w: World; r: ReturnType<typeof direct> }[] = []
    for (let k = 0; k < 10_800; k++) {
      if (k > 0) w = step(w, policy.decide(w, null)[0])
      const r = direct(s, w, w.player.pos, tickTime(w.tick), pools)
      s = r.state
      out.push({ w, r })
      if (w.creatures.every((c) => c.state.kind === 'mort')) break
    }
    return out
  }
  const all = games.map(([wave, seed, variant, D]) => runGame(wave, seed, variant, D))

  it('chaque mort d’une famille qui a une voix a un râle au tick de la mort, ou un refus motivé ; le Membre jamais', () => {
    let fresh = 0
    let union = 0
    for (const game of all) {
      for (const { w, r } of game) {
        const byId = new Map(w.creatures.map((c) => [c.id, c]))
        for (const e of w.events) {
          if (e.type !== 'death') continue
          const c = byId.get(e.id)
          const ag = r.cmds.filter((x) => x.t === 'voice-agony' && x.id === e.id)
          const denied = r.cmds.filter((x) => x.t === 'agony-denied' && x.id === e.id)
          if (!c || !hasVoice(c.family)) {
            expect(ag).toEqual([])
            expect(denied).toEqual([])
            continue
          }
          expect(ag.length + denied.length).toBeGreaterThanOrEqual(1)
          expect(ag.length).toBeLessThanOrEqual(1)
          const a = ag[0]
          if (a?.t === 'voice-agony' && a.slot === null) fresh++
          if (a && e.by === 'union') union++
        }
      }
    }
    expect(fresh).toBeGreaterThan(0) // des morts sans voix tenue (debout, variante B) râlent
    expect(union).toBeGreaterThan(0)
  })

  it('aucune source ne démarre pour un mort après sa mort ; une piste sert 24 ticks puis se libère', () => {
    for (const game of all) {
      const deadAt = new Map<number, number>()
      const laneBusy = new Map<number, number>()
      for (const { w, r } of game) {
        for (const e of w.events) if (e.type === 'death') deadAt.set(e.id, e.tick)
        for (const c of r.cmds) {
          if (c.t === 'voice-start' || c.t === 'src-start')
            expect(deadAt.has(c.id) && (deadAt.get(c.id) as number) <= w.tick).toBe(false)
          if (c.t === 'voice-agony' && c.lane !== null) {
            expect(deadAt.get(c.id)).toBe(w.tick)
            expect(c.lane).toBeLessThan(AGONY_LANES)
            expect(c.rank).toBeLessThanOrEqual(24)
            // Une piste n'est jamais rouverte avant la fin de l'agonie qu'elle porte, ni au tick même où elle se tait.
            expect(laneBusy.get(c.lane) ?? -1).toBeLessThan(w.tick)
            laneBusy.set(c.lane, w.tick + AGONIE_TICKS)
          }
        }
      }
    }
  })

  it('Union : toutes les parties qui meurent avec le tout râlent dans la même image (même tick, même instant)', () => {
    let groups = 0
    for (const game of all) {
      for (const { w, r } of game) {
        const unionIds = w.events.flatMap((e) => (e.type === 'death' && e.by === 'union' ? [e.id] : []))
        if (unionIds.length === 0) continue
        groups++
        const ag = r.cmds.filter((c) => c.t === 'voice-agony')
        for (const id of unionIds) {
          const c = w.creatures.find((x) => x.id === id)
          if (c && hasVoice(c.family))
            expect(
              ag.some((a) => a.t === 'voice-agony' && a.id === id) ||
                r.cmds.some((x) => x.t === 'agony-denied' && x.id === id),
            ).toBe(true)
        }
      }
    }
    expect(groups).toBeGreaterThan(0)
  })
})

describe('sons d’impact (B5.O10, crêtes du master)', () => {
  // Un coup qui touche plusieurs cibles : les impacts ne sont pas spatialisés et partent au même échantillon. N
  // copies du même fichier s'additionnent en phase (+20 log N dB) sans rien dire de plus : une seule lecture par
  // type et par tick.
  it('un seul impact par type et par tick, quel que soit le nombre de cibles touchées ou tuées', () => {
    const w0 = s1Scene('S1-cri').world0
    const hit = (target: number): SimEvent => ({
      type: 'hit',
      tick: 50,
      target,
      amount: 1,
      damageType: 'tranchant',
      by: 'player',
    })
    const w: World = {
      ...w0,
      tick: 50,
      events: [
        hit(11),
        hit(12),
        hit(13),
        { type: 'death', tick: 50, id: 14, by: 'achevement' },
        { type: 'death', tick: 50, id: 15, by: 'achevement' },
        { type: 'clang', tick: 50, id: 16 },
        { type: 'clang', tick: 50, id: 17 },
      ],
    }
    const r = direct(initialDirector(), w, w.player.pos, tickTime(50), pools)
    const shots = r.cmds.flatMap((c) => (c.t === 'oneshot' ? [c.kind] : []))
    expect(shots.sort()).toEqual(['clang', 'impact-tranchant'])
  })
})
