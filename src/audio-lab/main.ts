// Laboratoire audio (dev) : charge une scène de B5 §6, la joue avec la simulation dans le banc hors ligne ou en
// direct, analyse la banque, et expose tout à un vérificateur par window.__mercy.
import {
  analyseBank,
  type BenchResult,
  excerpt,
  type LiveResult,
  levelDb,
  masterWav,
  QUANTUM,
  renderOffline,
  runLive,
  SILENCE_DB,
} from '../audio/index'
import { S1_VARIANTS, type S1Variant, type SceneDef, s1Scene, sNappeScene, sSatScene } from './scenes'
import { deltaM, o1, o2, o3, o5, o6, o7abc, o7d, o8a } from './verdicts'

const SCENES = [...S1_VARIANTS, 'S-nappe', 'S-sat'] as const
type SceneId = (typeof SCENES)[number]

const sceneOf = (id: SceneId, seed: number): SceneDef =>
  id === 'S-nappe' ? sNappeScene(seed) : id === 'S-sat' ? sSatScene(seed) : s1Scene(id as S1Variant, seed)

const results = new Map<string, BenchResult>()

const compactLog = (r: BenchResult) =>
  r.log.sources.map((s) => ({
    id: s.id,
    kind: s.kind,
    slot: s.slot,
    startTick: s.startTick,
    phases: s.phases.map((p) => [p.tick, p.phase, p.file, p.muffled]),
    endTick: s.endTick,
    endMode: s.endMode,
    endCause: s.endCause,
    endDurationS: s.endDurationS,
    cutDuringFade: s.cutDuringFade,
  }))

const summarize = (r: BenchResult) => {
  const single = r.label.startsWith('S1')
  const o3r = o3(r, single)
  return {
    label: r.label,
    sampleRate: r.sampleRate,
    ticks: r.ticks,
    quanta: r.tables.count,
    warnings: r.log.warnings,
    events: Object.fromEntries(
      ['fell', 'cry-start', 'rise-telegraph', 'rise', 'death', 'sentence-start', 'reset'].map((t) => [
        t,
        r.journal.events.filter((e) => e.type === t).map((e) => e.tick),
      ]),
    ),
    o1: o1(r),
    o2: o2(r, o3r),
    o3: o3r,
    o5: o5(r),
    o6: o6(r),
    o7d: o7d(r),
    o7abc: r.label === 'S-nappe' ? o7abc(r) : null,
    o8a: o8a(r),
    deltaM_indicatif: deltaM(r),
    sources: compactLog(r),
    oneshots: r.log.oneshots.map((o) => [o.tick, o.kind, o.id]),
    ducks: r.log.ducks,
    nappe: r.log.nappe,
  }
}

const bench = async (id: SceneId, seed = 1): Promise<BenchResult> => {
  const sc = sceneOf(id, seed)
  const r = await renderOffline({ label: id, world0: sc.world0, policy: sc.policy, ticks: sc.ticks })
  results.set(`${id}#${seed}`, r)
  return r
}

const toBase64 = (b: Uint8Array): string => {
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(s)
}

// Contrôle de déterminisme (B5.O1, répétitions) : deux rendus de la même scène, journaux et tables comparés.
const determinism = async (id: SceneId = 'S1-cri') => {
  const a = await bench(id)
  const b = await bench(id)
  const la = JSON.stringify(compactLog(a))
  const lb = JSON.stringify(compactLog(b))
  let maxDiffDb = 0
  let differing = 0
  for (let i = 0; i < a.tables.ms.length; i++) {
    const x = a.tables.ms[i] as Float32Array
    const y = b.tables.ms[i] as Float32Array
    for (let q = 0; q < Math.max(x.length, y.length); q++) {
      if (x[q] !== y[q]) {
        differing++
        const dx = 10 * Math.log10((x[q] ?? 0) + 1e-30)
        const dy = 10 * Math.log10((y[q] ?? 0) + 1e-30)
        maxDiffDb = Math.max(maxDiffDb, Math.abs(dx - dy))
      }
    }
  }
  const va = JSON.stringify(summarize(a), (_k, v) => (v === Number.POSITIVE_INFINITY ? 'inf' : v))
  const vb = JSON.stringify(summarize(b), (_k, v) => (v === Number.POSITIVE_INFINITY ? 'inf' : v))
  return {
    scene: id,
    identicalLog: la === lb,
    differingQuanta: differing,
    maxDiffDb,
    identicalVerdicts: va === vb,
  }
}

// I4 : Δ = A − V pour chaque mort d'un rendu en direct.
const liveDeltas = (r: LiveResult) => {
  const deaths = r.events.filter((e) => e.type === 'death')
  return deaths.map((d) => {
    const v = r.log.sources.find((s) => s.kind === 'voix' && s.id === d.id && s.endTick === d.tick)
    const frame = r.frames.find((f) => f.tick >= d.tick)
    if (!v || v.slot === null || !frame || v.endTime === null)
      return { id: d.id, tick: d.tick, deltaMs: null }
    const input = `slot${v.slot}` as const
    let q = Math.floor((v.endTime * r.sampleRate) / QUANTUM) - 4
    const endQ = r.tables.firstQ + r.tables.count
    while (q < endQ && levelDb(r.tables, input, q) > SILENCE_DB) q++
    const a = (q * QUANTUM) / r.sampleRate
    return {
      id: d.id,
      tick: d.tick,
      audioSilentAt: a,
      frameTime: frame.audioTime,
      deltaMs: (a - frame.audioTime) * 1000,
    }
  })
}

let liveCtx: AudioContext | null = null
const live = async (id: SceneId = 'S1-cri') => {
  liveCtx ??= new AudioContext({ latencyHint: 'interactive' })
  const sc = sceneOf(id, 1)
  const r = await runLive(liveCtx, { world0: sc.world0, policy: sc.policy, ticks: sc.ticks })
  return {
    scene: id,
    sampleRate: r.sampleRate,
    baseLatency: r.baseLatency,
    outputLatency: r.outputLatency,
    frames: r.frames.length,
    deltas: liveDeltas(r),
    warnings: r.log.warnings,
  }
}

const api = {
  scenes: SCENES,
  analyseBank: () => analyseBank(),
  renderOffline: async (o: { scene: SceneId; seed?: number }) => summarize(await bench(o.scene, o.seed ?? 1)),
  benchS1: async () => {
    const out = []
    for (const v of S1_VARIANTS) out.push(summarize(await bench(v)))
    return out
  },
  determinism,
  live,
  audioLog: (key = 'S1-cri#1') => results.get(key)?.log ?? null,
  events: (key = 'S1-cri#1') => results.get(key)?.journal ?? null,
  masterWavBase64: (key = 'S1-cri#1', fromS = 0, toS = Number.POSITIVE_INFINITY) => {
    const r = results.get(key)
    return r ? toBase64(masterWav(r, fromS, toS)) : null
  },
  excerptBase64: (key = 'S1-cri#1', centerTick?: number) => {
    const r = results.get(key)
    if (!r) return null
    const d = r.journal.events.find((e) => e.type === 'death')
    const ex = excerpt(r, centerTick ?? d?.tick ?? 0)
    return { fromTick: ex.fromTick, toTick: ex.toTick, key: ex.key, wav: toBase64(ex.wav) }
  },
  results: () => [...results.keys()],
}

declare global {
  interface Window {
    __mercy: typeof api
  }
}
window.__mercy = api

// --- Interface minimale ---------------------------------------------------------------------------------

const out = document.getElementById('out') as HTMLPreElement
const status = document.getElementById('status') as HTMLElement
const json = (v: unknown) => JSON.stringify(v, (_k, x) => (x === Number.POSITIVE_INFINITY ? 'inf' : x), 2)
const show = (label: string, v: unknown, state: 'done' | 'error') => {
  status.textContent = label
  status.dataset.state = state
  out.textContent = json(v)
}
const busy = (label: string, f: () => Promise<unknown>) => async () => {
  status.textContent = `${label}…`
  status.dataset.state = 'busy'
  try {
    show(label, await f(), 'done')
  } catch (e) {
    show(`${label} : erreur`, String(e), 'error')
  }
}

// I7 : extrait WAV de 6 s autour de la mort de S1-cri, et sa clé de réponses, téléchargés comme fichiers.
const download = (name: string, data: BlobPart, type: string) => {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([data], { type }))
  a.download = name
  a.click()
}
const exportExcerpt = async () => {
  const key = 'S1-cri#1'
  const r = results.get(key) ?? (await bench('S1-cri'))
  const d = r.journal.events.find((e) => e.type === 'death')
  const ex = excerpt(r, d?.tick ?? 0)
  download('extrait-S1-cri.wav', ex.wav.slice().buffer, 'audio/wav')
  const meta = { scene: 'S1-cri', fromTick: ex.fromTick, toTick: ex.toTick, key: ex.key }
  return meta
}

document.getElementById('bank')?.addEventListener('click', busy('Analyse de la banque', api.analyseBank))
document.getElementById('s1')?.addEventListener('click', busy('Banc hors ligne S1', api.benchS1))
document.getElementById('det')?.addEventListener(
  'click',
  busy('Déterminisme S1-cri', () => determinism('S1-cri')),
)
document.getElementById('live')?.addEventListener(
  'click',
  busy('Direct S1-cri', () => live('S1-cri')),
)
document.getElementById('wav')?.addEventListener('click', busy('Extrait WAV S1-cri', exportExcerpt))
// Scènes de foule : résumé sans la liste des sources (trop longue), verdicts compris.
const crowd = (id: SceneId) => async () => {
  const { sources: _s, ...rest } = summarize(await bench(id))
  return { ...rest, voices: _s.filter((x) => x.kind === 'voix').length }
}
document
  .getElementById('snappe')
  ?.addEventListener('click', busy('Banc hors ligne S-nappe', crowd('S-nappe')))
document.getElementById('ssat')?.addEventListener('click', busy('Banc hors ligne S-sat', crowd('S-sat')))
