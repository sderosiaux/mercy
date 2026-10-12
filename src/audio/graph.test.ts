// Graphe Web Audio (graph.ts) contre un Web Audio de test qui applique les règles d'automatisation de la
// spécification (webaudio-fake.ts) : aucune suite de commandes du directeur ne doit lever d'exception, et chaque
// fondu repart du gain réellement atteint.
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CUT_RAMP_S, QUANTUM_S, XFADE_S } from './constants'
import type { Cmd, Phase } from './director'
import { type Bank, createGraph, type Graph } from './graph'
import type { Manifest } from './manifest'
import {
  type FakeContext,
  FakeGainNode,
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
    // La nouvelle lecture monte de 0 à 1.
    const neuf = partOf('cri-02', t2)
    expect(neuf?.gain.valueAt(t2)).toBe(0)
    expect(neuf?.gain.valueAt(t2 + XFADE_S)).toBeCloseTo(1, 6)
  })

  it('deux changements au même instant (plusieurs pas dans une image) : pas d’exception, la lecture intermédiaire reste muette', () => {
    at(10, 1.0, [start(0, 1, 'cri-01')])
    at(40, 1.5, [phase(0, 1, 'cri-etouffe-01', true)])
    expect(() => at(41, 1.5, [phase(0, 1, 'cri-03')])).not.toThrow()
    const mid = partOf('cri-etouffe-01')
    for (const dt of [0, XFADE_S / 3, XFADE_S]) expect(mid?.gain.valueAt(1.5 + dt)).toBeCloseTo(0, 9)
    expect(mid?.src.stopAt).toBeCloseTo(1.5 + XFADE_S, 9)
    const last = partOf('cri-03')
    expect(last?.gain.valueAt(1.5 + XFADE_S)).toBeCloseTo(1, 6)
    // Trois changements dans la même fenêtre, à 1 ms d'écart.
    expect(() => at(42, 1.501, [phase(0, 1, 'cri-04')])).not.toThrow()
    expect(() => at(43, 1.502, [phase(0, 1, 'cri-05', true)])).not.toThrow()
  })

  it('fins, coupures, absorption, nappe et atténuation pendant un fondu enchaîné : aucune exception', () => {
    at(1, 0.1, [start(0, 1, 'cri-01'), start(1, 2, 'cri-02'), start(2, 3, 'cri-03')])
    at(2, 0.12, [
      phase(0, 1, 'cri-etouffe-01', true),
      phase(1, 2, 'cri-etouffe-02', true),
      phase(2, 3, 'cri-etouffe-03', true),
    ])
    const seq: [number, number, Cmd[]][] = [
      // mort pendant le fondu enchaîné (coupure), fin douce pendant le fondu (vol), puis mort pendant la fin douce
      [3, 0.13, [{ t: 'voice-end', slot: 0, id: 1, mode: 'cut', cause: 'mort' }]],
      [3, 0.13, [{ t: 'voice-end', slot: 1, id: 2, mode: 'fade', cause: 'vol' }]],
      [4, 0.15, [{ t: 'voice-end', slot: 1, id: 2, mode: 'cut', cause: 'mort' }]],
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
      [7, 0.18, [{ t: 'src-end', key: '9:chant:5', id: 9, mode: 'cut', cause: 'mort', strangle: false }]],
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
    // La coupure arrête toutes les lectures de la voix morte, fondu enchaîné compris, au bout de la rampe.
    const dead = [...sourcesOf('cri-01'), ...sourcesOf('cri-etouffe-01')]
    expect(dead).toHaveLength(2)
    for (const s of dead) expect(s.stopAt).toBeLessThanOrEqual(0.13 + CUT_RAMP_S + 1e-12)
  })
})

describe('emplacement coupé et réattribué au même tick (B5.O1, O8 b)', () => {
  it('la voix suivante démarre deux quanta après la coupure : la rampe, puis un quantum muet sur l’emplacement', () => {
    at(100, 2.0, [start(5, 1, 'cri-01')])
    at(200, 3.0, [
      { t: 'voice-end', slot: 5, id: 1, mode: 'cut', cause: 'mort' },
      start(5, 2, 'cri-02', 'halètement'),
    ])
    const old = sourcesOf('cri-01')[0]
    const neu = sourcesOf('cri-02')[0]
    expect(old?.stopAt).toBeCloseTo(3.0 + CUT_RAMP_S, 9)
    expect(neu?.startAt).toBeCloseTo(3.0 + CUT_RAMP_S + QUANTUM_S, 9)
    const log = graph.log.sources.find((s) => s.id === 2)
    expect(log?.startTick).toBe(200)
    expect(log?.startTime).toBeCloseTo(3.0 + CUT_RAMP_S + QUANTUM_S, 9)
  })

  it('un emplacement libre démarre la voix à l’instant même', () => {
    at(200, 3.0, [start(4, 2, 'cri-02')])
    expect(sourcesOf('cri-02')[0]?.startAt).toBe(3.0)
  })
})

describe('gain de lecture du manifeste (B5.O11 g, cri-07)', () => {
  const level = 10 ** ((manifest.files.find((f) => f.id === 'cri-07')?.gainDb ?? 0) / 20)

  it('le manifeste porte le gain de cri-07, et le lecteur l’applique au début de voix comme au fondu enchaîné', () => {
    expect(level).toBeLessThan(1)
    at(10, 1.0, [start(0, 1, 'cri-07'), start(1, 2, 'cri-01')])
    expect(partOf('cri-07')?.gain.valueAt(1.0)).toBeCloseTo(level, 9)
    expect(partOf('cri-01')?.gain.valueAt(1.0)).toBe(1)
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

  it('fin douce sans étranglement : 0,3 s ; coupure : un quantum', () => {
    at(5, 1.0, [start(0, 1, 'cri-01'), start(1, 2, 'cri-02')])
    at(6, 1.1, [
      { t: 'voice-end', slot: 0, id: 1, mode: 'fade', cause: 'vol' },
      { t: 'voice-end', slot: 1, id: 2, mode: 'cut', cause: 'mort' },
    ])
    expect(graph.log.sources.find((x) => x.id === 1)?.endDurationS).toBeCloseTo(0.3, 9)
    expect(graph.log.sources.find((x) => x.id === 2)?.endDurationS).toBeCloseTo(CUT_RAMP_S, 9)
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
      if (t % 60 === 30) cmds.push({ t: 'voice-end', slot: 0, id: t - 30, mode: 'cut', cause: 'mort' })
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
    expect(g.log.sources.length).toBeLessThanOrEqual(21)
    expect(g.log.oneshots.length).toBeLessThanOrEqual(21)
    expect(g.log.sources.some((s) => s.startTick === 6000 && s.endTick === null)).toBe(true) // voix en cours
  })

  it('complet (banc) : tout est gardé', () => {
    const g = createGraph(ctx as unknown as BaseAudioContext, bank())
    run(g, 6010)
    expect(g.log.frames).toHaveLength(6010)
    expect(g.log.sources).toHaveLength(101)
  })
})
