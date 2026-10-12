// Graphe Web Audio (graph.ts) contre un Web Audio de test qui applique les règles d'automatisation de la
// spécification (webaudio-fake.ts) : aucune suite de commandes du directeur ne doit lever d'exception, et chaque
// fondu repart du gain réellement atteint.
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  AGONIE_END_S,
  AGONIE_TICKS,
  AGONY_ATTACK_S,
  AGONY_DECAY_FROM_S,
  dbToGain,
  MASTER_DB,
  SOFT_FADE_S,
  STRANGLE_RATE,
  STRANGLE_S,
  VOICE_DUCK_ATTACK_S,
  VOICE_DUCK_DB,
  VOICE_DUCK_RELEASE_S,
  XFADE_S,
} from './constants'
import { type Cmd, FADE_TICKS, type Phase } from './director'
import { type Bank, createGraph, type Graph } from './graph'
import type { Manifest } from './manifest'
import {
  type FakeContext,
  FakeGainNode,
  type FakeNode,
  FakePannerNode,
  type FakeParam,
  FakeSourceNode,
  fakeBuffer,
  installFakeWebAudio,
} from './webaudio-fake'

const manifest = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../public/audio/manifest.json'), 'utf8'),
) as Manifest

let fake: ReturnType<typeof installFakeWebAudio>
let ctx: FakeContext
let graph: Graph
let buffers: Map<string, unknown>

beforeEach(() => {
  fake = installFakeWebAudio()
  ctx = fake.ctx
  buffers = new Map(manifest.files.map((e) => [e.id, fakeBuffer(e.frames, e.sampleRate)]))
  graph = createGraph(ctx as unknown as BaseAudioContext, { manifest, buffers } as unknown as Bank)
})
afterEach(() => fake.restore())

// Gain de lecture d'un fichier selon le manifeste (gainDb, 0 dB si absent).
const levelOf = (id: string): number => 10 ** ((manifest.files.find((f) => f.id === id)?.gainDb ?? 0) / 20)

const at = (tick: number, now: number, cmds: readonly Cmd[]): void => {
  ctx.currentTime = now
  graph.apply(cmds, tick, now, () => 'souriant')
}

const pos = { x: 1, z: 0 }
const start = (slot: number, id: number, file: string, ph: Phase = 'cri'): Cmd => ({
  t: 'voice-start',
  slot,
  id,
  phase: ph,
  muffled: false,
  file,
  pos,
})
const phase = (slot: number, id: number, file: string, muffled = false): Cmd => ({
  t: 'voice-phase',
  slot,
  id,
  phase: 'cri',
  muffled,
  file,
})
// Mort : la couche vivante tenue dans `slot` (null : aucune) s'éteint ; le râle `file` joue sur la piste `lane` (null :
// mort sans râle).
const agony = (
  slot: number | null,
  lane: number | null,
  id: number,
  file: string | null,
  muffled = false,
): Cmd => ({
  t: 'voice-agony',
  slot,
  lane,
  id,
  rank: 1,
  file,
  rate: 1,
  muffled,
  pos,
})

// Gains des lectures de fichier (une par source) : les GainNode directement alimentés par une source.
const partsOf = (): { src: FakeSourceNode; gain: FakeParam }[] =>
  ctx.nodes.flatMap((n) => {
    if (!(n instanceof FakeSourceNode)) return []
    const g = [...n.outputs][0]
    return g instanceof FakeGainNode ? [{ src: n, gain: g.gain }] : []
  })
// Lectures d'un fichier donné (le tampon factice identifie le fichier).
const sourcesOf = (file: string): FakeSourceNode[] =>
  ctx.nodes.filter((n): n is FakeSourceNode => n instanceof FakeSourceNode && n.buffer === buffers.get(file))
const partOf = (file: string, startAt?: number) =>
  partsOf().find(
    (p) => p.src.buffer === buffers.get(file) && (startAt === undefined || p.src.startAt === startAt),
  )

describe('drapeau 1 B5 : changements de fichier rapprochés sur une même voix', () => {
  it('deux changements à moins de XFADE_S (V6 graine 3 : 6,2507 s puis 6,3173 s) : pas d’exception, le fondu repart du gain courant', () => {
    at(370, 6.0, [start(0, 11, 'cri-01')])
    at(375, 6.250667, [phase(0, 11, 'cri-etouffe-01', true)])
    const t2 = 6.317333
    const before = new Map(partsOf().map((p) => [p, p.gain.valueAt(t2)]))
    expect(() => at(379, t2, [phase(0, 11, 'cri-02')])).not.toThrow()
    // Continuité : chaque lecture déjà programmée garde, à t2, le gain qu'elle avait juste avant le changement.
    for (const [p, v] of before) expect(p.gain.valueAt(t2)).toBeCloseTo(v, 6)
    // La lecture qui montait (cri étouffé) repart de son gain courant vers 0, en XFADE_S, puis s'arrête.
    const etouffe = partOf('cri-etouffe-01')
    expect(etouffe?.gain.valueAt(t2)).toBeGreaterThan(0.9)
    expect(etouffe?.gain.valueAt(t2 + XFADE_S)).toBeCloseTo(0, 9)
    expect(etouffe?.src.stopAt).toBeCloseTo(t2 + XFADE_S, 9)
    // La nouvelle lecture monte de 0 à son gain de lecture (manifeste).
    const neuf = partOf('cri-02', t2)
    expect(neuf?.gain.valueAt(t2)).toBe(0)
    expect(neuf?.gain.valueAt(t2 + XFADE_S)).toBeCloseTo(levelOf('cri-02'), 6)
  })

  it('deux changements au même instant (plusieurs pas dans une image) : pas d’exception, la lecture intermédiaire reste muette', () => {
    at(10, 1.0, [start(0, 1, 'cri-01')])
    at(40, 1.5, [phase(0, 1, 'cri-etouffe-01', true)])
    expect(() => at(41, 1.5, [phase(0, 1, 'cri-03')])).not.toThrow()
    const mid = partOf('cri-etouffe-01')
    for (const dt of [0, XFADE_S / 3, XFADE_S]) expect(mid?.gain.valueAt(1.5 + dt)).toBeCloseTo(0, 9)
    expect(mid?.src.stopAt).toBeCloseTo(1.5 + XFADE_S, 9)
    const last = partOf('cri-03')
    expect(last?.gain.valueAt(1.5 + XFADE_S)).toBeCloseTo(levelOf('cri-03'), 6)
    // Trois changements dans la même fenêtre, à 1 ms d'écart.
    expect(() => at(42, 1.501, [phase(0, 1, 'cri-04')])).not.toThrow()
    expect(() => at(43, 1.502, [phase(0, 1, 'cri-05', true)])).not.toThrow()
  })

  it('fins, agonies, absorption, nappe et atténuation pendant un fondu enchaîné : aucune exception', () => {
    at(1, 0.1, [start(0, 1, 'cri-01'), start(1, 2, 'cri-02'), start(2, 3, 'cri-03')])
    at(2, 0.12, [
      phase(0, 1, 'cri-etouffe-01', true),
      phase(1, 2, 'cri-etouffe-02', true),
      phase(2, 3, 'cri-etouffe-03', true),
    ])
    const seq: [number, number, Cmd[]][] = [
      // mort pendant le fondu enchaîné (agonie), fin douce pendant le fondu (vol), puis mort pendant la fin douce
      [3, 0.13, [{ t: 'death', id: 1 }, agony(0, 0, 1, 'rale-etouffe-01', true)]],
      [3, 0.13, [{ t: 'voice-end', slot: 1, id: 2, mode: 'fade', cause: 'vol' }]],
      [4, 0.15, [{ t: 'death', id: 2 }, agony(null, 1, 2, 'rale-02')]],
      // expulsion juste après une absorption, puis relèvement
      [4, 0.15, [phase(2, 3, 'cri-03')]],
      [5, 0.16, [{ t: 'voice-end', slot: 2, id: 3, mode: 'fade', cause: 'relevement' }]],
      // chant interrompu (étranglement) puis mort du chanteur
      [5, 0.16, [{ t: 'src-start', key: '9:chant:5', id: 9, kind: 'chant', rate: 1, offsetS: 0, pos }]],
      [
        6,
        0.17,
        [{ t: 'src-end', key: '9:chant:5', id: 9, mode: 'fade', cause: 'fin-action', strangle: true }],
      ],
      [7, 0.18, [{ t: 'death', id: 9 }]],
      // nappe : N = 1 → 0 (extinction de 2 s), puis N remonte pendant l'extinction, puis retombe
      [0, 0.0, [{ t: 'nappe', n: 1, prev: -1 }]],
      [8, 0.2, [{ t: 'nappe', n: 0, prev: 1 }]],
      [9, 0.5, [{ t: 'nappe', n: 1, prev: 0 }]],
      [10, 0.55, [{ t: 'nappe', n: 0, prev: 1 }]],
      [11, 0.55, [{ t: 'nappe', n: 0, prev: 0 }]],
      // atténuation : descente, prolongation dans la rampe, nouvelle descente pendant la remontée
      [12, 0.6, [{ t: 'duck-down', at: 0.6, releaseAt: 1.0 }]],
      [12, 0.601, [{ t: 'duck-extend', releaseAt: 1.001 }]],
      [13, 1.002, [{ t: 'duck-down', at: 1.002, releaseAt: 1.402 }]],
      [13, 1.002, [{ t: 'duck-extend', releaseAt: 1.402 }]],
    ]
    for (const [tick, now, cmds] of seq) expect(() => at(tick, now, cmds)).not.toThrow()
    // L'agonie étrangle toutes les lectures de la voix morte, fondu enchaîné compris, et le râle se tait à la fin
    // programmée : rien du mort ne sonne après.
    const dead = [...sourcesOf('cri-01'), ...sourcesOf('cri-etouffe-01')]
    expect(dead).toHaveLength(2)
    for (const s of dead) expect(s.stopAt).toBeLessThanOrEqual(0.13 + XFADE_S + 1e-12)
    expect(sourcesOf('rale-etouffe-01')[0]?.stopAt).toBeCloseTo(0.13 + AGONIE_END_S, 9)
    // Mort pendant la fin douce d'une voix volée : le fondu (déjà plus court que l'agonie) suit son cours, le râle part
    // seul sur sa piste et se tait à la fin de l'agonie.
    expect(sourcesOf('cri-02')[0]?.stopAt).toBeLessThanOrEqual(0.15 + AGONIE_END_S)
    expect(sourcesOf('rale-02')[0]?.startAt).toBe(0.15)
    expect(sourcesOf('rale-02')[0]?.stopAt).toBeCloseTo(0.15 + AGONIE_END_S, 9)
    // Mort pendant l'étranglement d'une prière (1 s) : il se tait à la fin de l'agonie.
    expect(sourcesOf('etranglement')[0]?.stopAt).toBeCloseTo(0.18 + AGONIE_END_S, 9)
    expect(graph.log.sources.find((x) => x.kind === 'chant')?.diedDuringFade).toEqual({ tick: 7, time: 0.18 })
  })
})

describe('passage au râle : couche vivante dans son emplacement, râle sur sa piste (L4, §19, B5 A4, A19, O1, O8 b)', () => {
  // Les gains qui alimentent un nœud.
  const feeders = (n: unknown) => ctx.nodes.filter((x) => x.outputs.has(n as never))

  it('la couche vivante s’éteint dans son emplacement, le râle part sur sa piste ; la chute du même tick prend l’emplacement à la fin de l’extinction', () => {
    at(100, 2.0, [start(5, 1, 'cri-01')])
    at(200, 3.0, [agony(5, 0, 1, 'rale-01'), start(5, 2, 'cri-02', 'halètement')])
    // La voix neuve est attribuée au tick de la chute (journal) et sonne quand la couche vivante du mort s'est tue.
    const neu = sourcesOf('cri-02')[0]
    expect(neu?.startAt).toBeCloseTo(3.0 + STRANGLE_S, 12)
    const log = graph.log.sources.find((s) => s.id === 2)
    expect(log?.startTick).toBe(200)
    expect(log?.startTime).toBeCloseTo(3.0 + STRANGLE_S, 12)
    expect(sourcesOf('cri-01')[0]?.stopAt).toBeCloseTo(3.0 + STRANGLE_S, 12)
    // L'emplacement reçoit la couche vivante du mort puis la voix neuve ; la piste 0 reçoit le râle seul.
    expect(feeders(graph.taps.slots[5])).toHaveLength(2)
    const laneFeeders = feeders(graph.taps.agony[0])
    expect(laneFeeders).toHaveLength(1)
    // Le râle ne passe pas par l'étage des voix : il n'est pas baissé par la mise à mort qu'il signale.
    const ralePan = [...(laneFeeders[0]?.outputs ?? [])].find((x) => x instanceof FakePannerNode)
    expect(ralePan && [...ralePan.outputs]).toEqual([graph.taps.creatures])
    const dead = graph.log.sources.find((s) => s.id === 1 && s.kind === 'voix')
    expect(dead?.endTick).toBe(200)
    expect(dead?.endMode).toBe('agonie')
    expect(dead?.endDurationS).toBeCloseTo(STRANGLE_S, 12)
    expect(dead?.phases.at(-1)).toEqual({
      tick: 200,
      time: 3.0,
      phase: 'cri',
      file: 'cri-01',
      muffled: false,
      rate: 1,
      rateTo: STRANGLE_RATE,
      rampS: STRANGLE_S,
    })
    const rale = graph.log.sources.find((s) => s.id === 1 && s.kind === 'râle')
    expect(rale?.slot).toBeNull()
    expect(rale?.lane).toBe(0)
    expect(rale?.rank).toBe(1)
    expect(rale?.startTick).toBe(200)
    expect(rale?.startTime).toBe(3.0)
    expect(rale?.endMode).toBe('agonie')
    expect(rale?.endDurationS).toBeCloseTo(AGONIE_END_S, 12)
    expect(rale?.agonyEnd?.tick).toBe(200 + AGONIE_TICKS)
    expect(rale?.agonyEnd?.time).toBeCloseTo(3.0 + AGONIE_END_S, 12)
    expect(rale?.phases).toEqual([
      { tick: 200, time: 3.0, phase: 'râle', file: 'rale-01', muffled: false, rate: 1, offsetS: 0 },
    ])
  })

  it('mort sans râle (Sentence avant le cri, rang > 24) : la couche vivante s’éteint sans baisse de hauteur, aucune piste', () => {
    at(100, 2.0, [start(5, 1, 'halete-01', 'halètement')])
    at(130, 2.5, [agony(5, null, 1, null)])
    const h = partOf('halete-01')
    expect(h?.src.playbackRate.valueAt(2.5 + STRANGLE_S)).toBe(1)
    expect(h?.gain.valueAt(2.5 + STRANGLE_S)).toBeCloseTo(0, 9)
    expect(graph.log.sources.filter((s) => s.kind === 'râle')).toEqual([])
    for (const t of graph.taps.agony) expect(feeders(t)).toHaveLength(0)
    expect(graph.log.sources.find((s) => s.id === 1)?.endMode).toBe('agonie')
  })

  it('le cri s’étrangle (vitesse qui tombe, fondu sortant), le râle monte à l’image du coup, tient, s’éteint et se tait à la fin de l’agonie', () => {
    at(100, 2.0, [start(5, 1, 'cri-01')])
    at(200, 3.0, [agony(5, 0, 1, 'rale-01')])
    const cri = partOf('cri-01')
    expect(cri?.src.playbackRate.valueAt(3.0)).toBe(1)
    expect(cri?.src.playbackRate.valueAt(3.0 + STRANGLE_S)).toBeCloseTo(STRANGLE_RATE, 9)
    expect(cri?.gain.valueAt(3.0)).toBeCloseTo(levelOf('cri-01'), 6)
    expect(cri?.gain.valueAt(3.0 + STRANGLE_S)).toBeCloseTo(0, 9)
    expect(cri?.src.stopAt).toBeCloseTo(3.0 + STRANGLE_S, 9)
    const rale = partOf('rale-01')
    const lvl = levelOf('rale-01')
    expect(rale?.src.startAt).toBe(3.0)
    expect(rale?.gain.valueAt(3.0)).toBe(0)
    expect(rale?.gain.valueAt(3.0 + AGONY_ATTACK_S)).toBeCloseTo(lvl, 6)
    expect(rale?.gain.valueAt(3.0 + AGONY_DECAY_FROM_S)).toBeCloseTo(lvl, 6)
    expect(rale?.gain.valueAt(3.0 + AGONIE_END_S - 1e-6)).toBeLessThan(lvl * 0.0011)
    expect(rale?.gain.valueAt(3.0 + AGONIE_END_S)).toBe(0)
    expect(rale?.src.stopAt).toBeCloseTo(3.0 + AGONIE_END_S, 9)
  })

  it('un mort sans voix tenue (debout) : le râle part seul sur sa piste, sans toucher aux emplacements', () => {
    at(200, 3.0, [agony(null, 3, 7, 'rale-04')])
    const s = graph.log.sources.find((x) => x.id === 7)
    expect(s?.kind).toBe('râle')
    expect(s?.slot).toBeNull()
    expect(s?.lane).toBe(3)
    expect(s?.startTick).toBe(200)
    expect(s?.endTick).toBe(200)
    expect(feeders(graph.taps.agony[3])).toHaveLength(1)
    for (const t of graph.taps.slots) expect(feeders(t)).toHaveLength(0)
    expect(sourcesOf('rale-04')[0]?.startAt).toBe(3.0)
  })

  it('les sources d’un mort s’éteignent pendant l’agonie et se taisent à sa fin', () => {
    at(5, 1.0, [
      { t: 'src-start', key: '9:gargouillis:5', id: 9, kind: 'gargouillis', rate: 1, offsetS: 0, pos },
    ])
    at(50, 2.0, [
      { t: 'death', id: 9 },
      { t: 'src-end', key: '9:gargouillis:5', id: 9, mode: 'agonie', cause: 'mort', strangle: false },
    ])
    const s = graph.log.sources.find((x) => x.kind === 'gargouillis')
    expect(s?.endMode).toBe('agonie')
    expect(s?.endDurationS).toBeCloseTo(AGONIE_END_S, 12)
    expect(sourcesOf('gargouillis')[0]?.stopAt).toBeCloseTo(2.0 + AGONIE_END_S, 9)
    const death = [...(feeders(graph.taps.others) as FakeGainNode[])][0]?.gain
    expect(death?.valueAt(2.0)).toBe(1)
    expect(death?.valueAt(2.0 + AGONIE_END_S / 2)).toBeLessThan(0.1)
    expect(death?.valueAt(2.0 + AGONIE_END_S)).toBe(0)
  })

  it('un emplacement libre démarre la voix à l’instant même', () => {
    at(200, 3.0, [start(4, 2, 'cri-02')])
    expect(sourcesOf('cri-02')[0]?.startAt).toBe(3.0)
  })
})

describe('gain de lecture du manifeste (B5.O11 g, cri-07)', () => {
  const level = levelOf('cri-07')

  it('cri-07 garde sa correction de −3,33 dB sur les autres cris, et le lecteur applique chaque gain au début de voix comme au fondu enchaîné', () => {
    // D-fix2 : −3,33 dB ramènent cri-07 au niveau des cris ; D-fix3 (tour 1) monte tous les cris du même gain.
    expect(20 * Math.log10(level / levelOf('cri-01'))).toBeCloseTo(-3.33, 2)
    at(10, 1.0, [start(0, 1, 'cri-07'), start(1, 2, 'cri-01'), start(2, 3, 'halete-01', 'halètement')])
    expect(partOf('cri-07')?.gain.valueAt(1.0)).toBeCloseTo(level, 9)
    expect(partOf('cri-01')?.gain.valueAt(1.0)).toBeCloseTo(levelOf('cri-01'), 9)
    // Sans gain au manifeste, le fichier est joué tel quel.
    expect(manifest.files.find((f) => f.id === 'halete-01')?.gainDb).toBeUndefined()
    expect(partOf('halete-01')?.gain.valueAt(1.0)).toBe(1)
    at(20, 2.0, [phase(1, 2, 'cri-07')])
    const p = partOf('cri-07', 2.0)
    expect(p?.gain.valueAt(2.0)).toBe(0)
    expect(p?.gain.valueAt(2.0 + XFADE_S)).toBeCloseTo(level, 6)
  })
})

describe('journal I1 : durée de fin programmée', () => {
  // Constaté au banc (V4 graine 6 A, b5(∞)) : l'étranglement d'un chant interrompu sonne encore 1 s sur le bus des
  // autres sources, mais le journal ne déclarait que le fondu de 0,3 s ; la fin d'un autre chant, 0,4 s plus tard, a
  // été mesurée comme isolée alors que l'étranglement occupait le bus.
  it('prière interrompue : la fin dure jusqu’au bout de l’étranglement, pas seulement le fondu', () => {
    const e = manifest.files.find((f) => f.id === 'etranglement')
    const len = ((e?.frames ?? 0) - (e?.startOffset ?? 0)) / (e?.sampleRate ?? 1)
    expect(len).toBeGreaterThan(0.3)
    at(5, 1.0, [{ t: 'src-start', key: '9:chant:5', id: 9, kind: 'chant', rate: 1, offsetS: 0, pos }])
    at(50, 2.0, [
      { t: 'src-end', key: '9:chant:5', id: 9, mode: 'fade', cause: 'fin-action', strangle: true },
    ])
    const s = graph.log.sources.find((x) => x.kind === 'chant')
    expect(s?.strangle).toBe(true)
    expect(s?.endDurationS).toBeCloseTo(len, 9)
  })

  it('fin douce sans étranglement : SOFT_FADE_S (112 quanta) ; agonie : jusqu’à sa fin programmée', () => {
    at(5, 1.0, [start(0, 1, 'cri-01'), start(1, 2, 'cri-02')])
    at(6, 1.1, [{ t: 'voice-end', slot: 0, id: 1, mode: 'fade', cause: 'vol' }, agony(1, 0, 2, 'rale-02')])
    expect(graph.log.sources.find((x) => x.id === 1)?.endDurationS).toBeCloseTo(SOFT_FADE_S, 9)
    const two = graph.log.sources.filter((x) => x.id === 2)
    expect(two.find((x) => x.kind === 'voix')?.endDurationS).toBeCloseTo(STRANGLE_S, 9)
    expect(two.find((x) => x.kind === 'râle')?.endDurationS).toBeCloseTo(AGONIE_END_S, 9)
  })
})

describe('revue de code M6 : dispose() arrête tout ce que le graphe joue', () => {
  it('vent, nappe, voix, fondu enchaîné, chant, fin douce en cours et sons ponctuels sont arrêtés, puis tout est déconnecté', () => {
    at(0, 0, [{ t: 'nappe', n: 3, prev: -1 }])
    at(10, 1.0, [start(0, 1, 'cri-01'), start(1, 2, 'cri-02')])
    at(11, 1.02, [phase(0, 1, 'inspire-01')])
    at(12, 1.03, [{ t: 'src-start', key: '7:chant:12', id: 7, kind: 'chant', rate: 1, offsetS: 0, pos }])
    at(13, 1.05, [{ t: 'voice-end', slot: 1, id: 2, mode: 'fade', cause: 'vol' }])
    at(14, 1.06, [{ t: 'oneshot', kind: 'impact-contondant', id: 1, pos }])
    ctx.currentTime = 1.07
    graph.dispose()
    const sources = ctx.nodes.filter((n): n is FakeSourceNode => n instanceof FakeSourceNode)
    expect(sources).toHaveLength(7) // vent, nappe, 2 voix, 1 fondu enchaîné, chant, impact
    for (const s of sources) {
      expect(s.stopAt).not.toBeNull()
      expect(s.stopAt as number).toBeLessThanOrEqual(1.07)
      expect(s.playingAt(1.07)).toBe(false)
      expect(s.disconnected).toBe(true)
    }
    expect(ctx.nodes.filter((n) => n instanceof FakeGainNode).every((n) => n.disconnected)).toBe(true)
  })
})

describe('revue de code M5 : journal I1 borné en jeu, complet au banc', () => {
  const run = (g: Graph, ticks: number) => {
    for (let t = 0; t < ticks; t++) {
      const now = t / 60
      ctx.currentTime = now
      const cmds: Cmd[] = []
      // une voix par seconde, coupée une demi-seconde plus tard ; un impact par seconde
      if (t % 60 === 0)
        cmds.push(start(0, t, 'cri-01'), { t: 'oneshot', kind: 'impact-tranchant', id: t, pos })
      if (t % 60 === 30) cmds.push(agony(0, 0, t - 30, 'rale-01'))
      g.apply(cmds, t, now, () => 'souriant')
      g.frame(t, now, { x: 0, z: 0 })
    }
  }
  const bank = () => ({ manifest, buffers }) as unknown as Bank

  it('borné : au plus deux horizons de ticks gardés, entrées récentes intactes', () => {
    const g = createGraph(ctx as unknown as BaseAudioContext, bank(), { journal: { ticks: 600 } })
    run(g, 6010)
    expect(g.log.frames.length).toBeLessThanOrEqual(1200)
    expect(g.log.frames.length).toBeGreaterThanOrEqual(600)
    expect(g.log.frames[g.log.frames.length - 1]?.tick).toBe(6009)
    expect(g.log.sources.length).toBeLessThanOrEqual(42) // voix et râles
    expect(g.log.oneshots.length).toBeLessThanOrEqual(21)
    expect(g.log.sources.some((s) => s.startTick === 6000 && s.endTick === null)).toBe(true) // voix en cours
  })

  it('complet (banc) : tout est gardé', () => {
    const g = createGraph(ctx as unknown as BaseAudioContext, bank())
    run(g, 6010)
    expect(g.log.frames).toHaveLength(6010)
    expect(g.log.sources).toHaveLength(201) // 101 voix, 100 râles
  })
})

describe('ducking des autres voix après une mort (D-fix3, tour 2 de B5.O10)', () => {
  const G = dbToGain(VOICE_DUCK_DB)
  const voices = () => graph.taps.voices as unknown as FakeGainNode
  // Panoramique d'une lecture : source → gain de lecture → fondu → coupure → (panoramique, prise).
  const pannerOf = (file: string): FakePannerNode | undefined => {
    let n: FakeNode | undefined = sourcesOf(file)[0]
    for (let k = 0; k < 3 && n; k++) n = [...n.outputs][0]
    return n ? [...n.outputs].find((x): x is FakePannerNode => x instanceof FakePannerNode) : undefined
  }

  it('les voix passent par un étage commun, après les prises des emplacements ; les autres sources n’y passent pas', () => {
    at(10, 1.0, [
      start(0, 1, 'cri-01'),
      { t: 'src-start', key: '9:chant:10', id: 9, kind: 'chant', rate: 1, offsetS: 0, pos },
    ])
    const vp = pannerOf('cri-01')
    expect(vp && [...vp.outputs]).toEqual([graph.taps.voicesPre])
    expect([...(graph.taps.voicesPre as unknown as FakeGainNode).outputs]).toEqual([voices()])
    expect([...voices().outputs]).toEqual([graph.taps.creatures])
    const cp = pannerOf('chant')
    expect(cp && [...cp.outputs]).toEqual([graph.taps.creatures])
    // La prise de l'emplacement 0 est alimentée avant le panoramique (avant spatialisation et ducking).
    const slotTap = graph.taps.slots[0] as unknown as FakeGainNode
    const feeders = ctx.nodes.filter((n) => n.outputs.has(slotTap as never))
    expect(feeders.length).toBe(1)
    expect([...(feeders[0]?.outputs ?? [])]).toContain(vp)
  })

  it('une mort : la voix qui meurt passe en agonie hors de l’étage, les autres descendent de VOICE_DUCK_DB en VOICE_DUCK_ATTACK_S, tiennent jusqu’à la remontée puis reviennent', () => {
    at(10, 1.0, [start(0, 1, 'cri-01'), start(1, 2, 'cri-02')])
    at(70, 2.0, [agony(0, 0, 1, 'rale-01'), { t: 'voice-duck-down', at: 2.0, releaseAt: 2.4 }])
    const g = voices().gain
    expect(g.valueAt(2.0)).toBeCloseTo(1, 9)
    expect(g.valueAt(2.0 + VOICE_DUCK_ATTACK_S / 2)).toBeLessThan(1)
    expect(g.valueAt(2.0 + VOICE_DUCK_ATTACK_S / 2)).toBeGreaterThan(G)
    expect(g.valueAt(2.0 + VOICE_DUCK_ATTACK_S)).toBeCloseTo(G, 6)
    expect(g.valueAt(2.4)).toBeCloseTo(G, 6)
    expect(g.valueAt(2.4 + VOICE_DUCK_RELEASE_S)).toBeCloseTo(1, 6)
    // La voix morte : agonie ; son râle joue hors de l'étage ; la voix baissée n'a ni fin ni vol au journal.
    const dead = graph.log.sources.find((x) => x.id === 1)
    const alive = graph.log.sources.find((x) => x.id === 2)
    expect(dead?.endMode).toBe('agonie')
    expect(pannerOf('rale-01') && [...(pannerOf('rale-01')?.outputs ?? [])]).toEqual([graph.taps.creatures])
    expect(alive?.endTick).toBeNull()
    expect(alive?.endCause).toBeNull()
    expect(sourcesOf('cri-02')[0]?.stopAt).toBeNull()
    expect(graph.log.ducks).toEqual([{ tick: 70, time: 2.0, t: 'voice-duck-down', releaseAt: 2.4 }])
  })

  it('une grappe pendant la descente : pas de saut, la descente finit comme prévu et la remontée recule', () => {
    at(70, 2.0, [{ t: 'voice-duck-down', at: 2.0, releaseAt: 2.4 }])
    const g = voices().gain
    const t1 = 2.0 + VOICE_DUCK_ATTACK_S / 4
    const v1 = g.valueAt(t1)
    at(72, t1, [{ t: 'voice-duck-extend', releaseAt: t1 + 0.4 }])
    expect(g.valueAt(t1)).toBeCloseTo(v1, 9)
    expect(g.valueAt(2.0 + VOICE_DUCK_ATTACK_S)).toBeCloseTo(G, 6)
    expect(g.valueAt(2.41)).toBeCloseTo(G, 6) // l’ancienne remontée (2,4 s) a reculé à t1 + 0,4 s
    expect(g.valueAt(t1 + 0.4 + VOICE_DUCK_RELEASE_S)).toBeCloseTo(1, 6)
  })

  it('une mort pendant la remontée redescend depuis le niveau courant', () => {
    at(70, 2.0, [{ t: 'voice-duck-down', at: 2.0, releaseAt: 2.4 }])
    const g = voices().gain
    const t2 = 2.4 + VOICE_DUCK_RELEASE_S / 2
    const v2 = g.valueAt(t2)
    expect(v2).toBeGreaterThan(G)
    expect(v2).toBeLessThan(1)
    at(95, t2, [{ t: 'voice-duck-down', at: t2, releaseAt: t2 + 0.4 }])
    expect(g.valueAt(t2)).toBeCloseTo(v2, 9)
    expect(g.valueAt(t2 + VOICE_DUCK_ATTACK_S)).toBeCloseTo(G, 6)
  })

  // Constaté au banc (S-nappe) : après une mort sans autre voix, l'étage des voix n'a rien à traiter et Chrome n'avance
  // pas son automatisation ; la voix suivante sortait à −7,4 dB jusqu'à la mort suivante. Le gain courant est reposé à
  // chaque voix qui arrive, sans saut, rampe en cours comprise.
  it('une voix qui arrive repose le gain courant de l’étage, sans changer la courbe', () => {
    at(70, 2.0, [{ t: 'voice-duck-down', at: 2.0, releaseAt: 2.4 }])
    const g = voices().gain
    const before = [2.2, 2.42, 2.45, 3.0].map((t) => g.valueAt(t))
    at(145, 2.42, [start(3, 9, 'cri-03')])
    expect(g.calls.at(-1)).toBe(`set ${g.valueAt(2.42)} @2.42`)
    expect([2.2, 2.42, 2.45, 3.0].map((t) => g.valueAt(t))).toEqual(before.map((v) => expect.closeTo(v, 9)))
    at(300, 5.0, [start(4, 10, 'cri-04')])
    expect(g.calls.at(-1)).toBe('set 1 @5')
  })
})

describe('emplacement d’une voix volée réattribué (B5.O8 a)', () => {
  // Instant d'un tick au banc : t/60 s arrondi à la frontière de quantum suivante (B5, T_d).
  const tickTime = (t: number) => (Math.ceil(((t / 60) * 48_000) / 128) * 128) / 48_000

  it('la voix suivante démarre quand le fondu de la voix volée est fini, quelle que soit la phase du tick sur la grille des quanta', () => {
    for (let ts = 1; ts <= 12; ts++) {
      const g = createGraph(ctx as unknown as BaseAudioContext, { manifest, buffers } as unknown as Bank)
      const run = (tick: number, cmds: readonly Cmd[]) => {
        ctx.currentTime = tickTime(tick)
        g.apply(cmds, tick, tickTime(tick), () => 'souriant')
      }
      run(ts - 1, [start(7, 100 + ts, 'cri-01')])
      run(ts, [{ t: 'voice-end', slot: 7, id: 100 + ts, mode: 'fade', cause: 'vol' }])
      run(ts + FADE_TICKS, [start(7, 200 + ts, 'cri-02')])
      const old = g.log.sources.find((x) => x.id === 100 + ts)
      const neu = g.log.sources.find((x) => x.id === 200 + ts)
      // Le journal I1 (fin + durée de fin programmée) et le son disent la même chose : aucun chevauchement.
      expect(neu?.startTime).toBeGreaterThanOrEqual((old?.endTime ?? 0) + (old?.endDurationS ?? 0) - 1e-12)
      g.dispose()
    }
  })
})

describe('journal I1 : lecture d’une source hors voix (B5 amendement A1)', () => {
  // L'enveloppe de gain se mesure contre le fichier tel que joué au même point de lecture : le journal doit dire où
  // la lecture commence et à quelle vitesse elle avance (gargouillis : un ton par stade).
  it('offset de départ, vitesse et chaque changement de vitesse sont au journal', () => {
    at(5, 1.0, [
      { t: 'src-start', key: '9:gargouillis:5', id: 9, kind: 'gargouillis', rate: 1, offsetS: 0.25, pos },
    ])
    at(30, 1.5, [{ t: 'src-rate', key: '9:gargouillis:5', rate: 2 ** (2 / 12) }])
    const s = graph.log.sources.find((x) => x.id === 9)
    expect(s?.phases).toEqual([
      { tick: 5, time: 1.0, phase: null, file: 'gargouillis', muffled: false, rate: 1, offsetS: 0.25 },
      {
        tick: 30,
        time: 1.5,
        phase: null,
        file: 'gargouillis',
        muffled: false,
        rate: 2 ** (2 / 12),
        offsetS: 0.25,
      },
    ])
  })
})

describe('prière interrompue : l’étranglement finit en fondu (B5.O6, fin sans mort)', () => {
  // Le fichier d'étranglement s'éteint de lui-même, mais une fin sans mort ne doit pas dépendre du contenu généré :
  // le lecteur programme un fondu de SOFT_FADE_S à la fin de l'étranglement (enveloppe de gain, amendement A1).
  it('le gain de l’étranglement tient, puis descend de 60 dB sur les SOFT_FADE_S dernières secondes, puis 0', () => {
    const e = manifest.files.find((f) => f.id === 'etranglement')
    const len = ((e?.frames ?? 0) - (e?.startOffset ?? 0)) / (e?.sampleRate ?? 1)
    at(5, 1.0, [{ t: 'src-start', key: '9:chant:5', id: 9, kind: 'chant', rate: 1, offsetS: 0, pos }])
    at(50, 2.0, [
      { t: 'src-end', key: '9:chant:5', id: 9, mode: 'fade', cause: 'fin-action', strangle: true },
    ])
    const g = partOf('etranglement')?.gain
    const lvl = levelOf('etranglement')
    expect(g?.valueAt(2.0)).toBeCloseTo(lvl, 9)
    expect(g?.valueAt(2.0 + len - SOFT_FADE_S)).toBeCloseTo(lvl, 9)
    expect(g?.valueAt(2.0 + len - SOFT_FADE_S / 2)).toBeLessThan(lvl * 0.1)
    expect(g?.valueAt(2.0 + len - 1e-6)).toBeLessThan(lvl * 0.0011)
    expect(g?.valueAt(2.0 + len)).toBe(0)
  })
})

describe('marge du master (crêtes au-dessus de 0 dBFS au banc de B5)', () => {
  // Au banc (403 rendus), la somme des voix proches, des sources et de la nappe dépassait 0 dBFS : jusqu'à +7,4 dBFS
  // après le tour 1 et la lecture unique des impacts. En direct, tout ce qui dépasse écrête. Le master porte un gain
  // fixe qui ramène la crête la plus haute mesurée sous −1 dBFS ; toutes les prises de mesure sont en amont.
  it('le master applique MASTER_DB, une marge d’au moins 8 dB', () => {
    const m = graph.taps.master as unknown as FakeGainNode
    expect(MASTER_DB).toBeLessThanOrEqual(-8.4)
    expect(m.gain.valueAt(0)).toBeCloseTo(dbToGain(MASTER_DB), 12)
  })
})
