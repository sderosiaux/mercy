// Directeur audio sur la vraie simulation (scènes de B5 §6), sans contexte audio : décisions et comptes.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { BENCH_RATE, QUANTUM, VOICE_DUCK_HOLD_S } from '../audio/constants'
import { type Cmd, type DirectorState, direct, initialDirector } from '../audio/director'
import { vocalising } from '../audio/ends'
import { poolsOf } from '../audio/engine'
import type { Manifest } from '../audio/manifest'
import { b5 } from '../bots/b2b4b5/b5'
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

describe('directeur sur S1 (B5 §6)', () => {
  it('S1-hal : voix au tick de la chute, aucun cri, coupure nette au tick de la mort, rien après', () => {
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
    expect(cmdsOf(ticks, 'voice-end')).toEqual([
      expect.objectContaining({ tick: death, c: expect.objectContaining({ mode: 'cut', cause: 'mort' }) }),
    ])
    expect(events.some((e) => e.type === 'cry-start')).toBe(false)
  })

  it('S1-cri : phase cri au tick de cry-start, coupure au tick de la mort, atténuation et impact au même tick', () => {
    const { ticks, events } = runDirector(s1Scene('S1-cri'))
    const cry = evTick(events, 'cry-start')
    const death = evTick(events, 'death')
    expect(cmdsOf(ticks, 'voice-phase').map((x) => [x.tick, x.c.phase])).toEqual([[cry, 'cri']])
    expect(cmdsOf(ticks, 'voice-end').map((x) => [x.tick, x.c.mode])).toEqual([[death, 'cut']])
    expect(cmdsOf(ticks, 'duck-down').map((x) => x.tick)).toEqual([death])
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

  it('S1-sent : le cri tient jusqu’au coup fatal de la Sentence, puis coupure', () => {
    const { ticks, events } = runDirector(s1Scene('S1-sent'))
    const start = evTick(events, 'sentence-start') as number
    const death = events.find((e) => e.type === 'death')
    expect(death?.type === 'death' && death.by).toBe('sentence')
    const ends = cmdsOf(ticks, 'voice-end')
    expect(ends.map((x) => [x.tick, x.c.mode])).toEqual([[death?.tick, 'cut']])
    expect(ends[0]?.tick).toBeGreaterThan(start)
  })

  it('S1-insp : inspiration au tick de rise-telegraph, coupure au tick de la mort', () => {
    const { ticks, events } = runDirector(s1Scene('S1-insp'))
    const tel = evTick(events, 'rise-telegraph')
    const death = evTick(events, 'death')
    expect(cmdsOf(ticks, 'voice-phase').map((x) => [x.tick, x.c.phase])).toEqual([
      [evTick(events, 'cry-start'), 'cri'],
      [tel, 'inspiration'],
    ])
    expect(cmdsOf(ticks, 'voice-end').map((x) => [x.tick, x.c.mode])).toEqual([[death, 'cut']])
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
        const cutSlots = new Set(
          r.cmds.flatMap((c) => (c.t === 'voice-end' && c.mode === 'cut' ? [c.slot] : [])),
        )
        reusedSameTick += r.cmds.filter((c) => c.t === 'voice-start' && cutSlots.has(c.slot)).length
        if (w.creatures.every((c) => c.state.kind === 'mort')) break
      }
      expect(missing).toEqual([])
    },
  )

  it('ces parties réattribuent bien des emplacements coupés au tick de la coupure', () => {
    expect(reusedSameTick).toBeGreaterThan(0)
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
