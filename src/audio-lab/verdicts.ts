// Mesures de B5 sur un rendu du banc (I3) : O1, O2, O3, O5, O6 (fin au relèvement), O7 (d), O8 (a), et ΔM de O10
// à titre indicatif. Les définitions sont celles du contrat gelé, agonie comprise (amendements A4 à A20) ; les causes
// de fin se lisent dans les SimEvent, jamais dans la cause déclarée par le module audio. O3 (a) se lit ici sur le
// niveau de sortie de l'emplacement, sans l'enveloppe de gain A1 : seule son extinction avant W2 est jugée.
import type { BenchResult } from '../audio/bench'
import { AGONIE_TICKS, DUCK_DB, DUCK_HOLD_S, QUANTUM, SILENCE_DB, TICK_S } from '../audio/constants'
import type { LogSource } from '../audio/graph'
import type { MeterInput } from '../audio/meter'
import { median } from '../audio/o11'
import type { EventOf, SimEvent } from '../sim/index'

const QMS = (QUANTUM / 48_000) * 1000
const qOfTime = (r: BenchResult, t: number) => Math.round((t * r.sampleRate) / QUANTUM)
// T_d hors ligne : t_d / 60 s, arrondi à la frontière de quantum suivante.
export const tdQ = (r: BenchResult, tick: number) => Math.ceil(((tick / 60) * r.sampleRate) / QUANTUM)

const L = (r: BenchResult, input: MeterInput, q: number): number => {
  const i = r.tables.inputs.indexOf(input)
  const v = r.tables.ms[i]?.[q - r.tables.firstQ]
  return v === undefined ? Number.NaN : v > 0 ? 10 * Math.log10(v) : Number.NEGATIVE_INFINITY
}
const lastQ = (r: BenchResult) => r.tables.firstQ + r.tables.count - 1

interface EndShape {
  readonly m: number // médiane des quanta non silencieux sur les 100 ms avant l'instant
  readonly lastLoud: number | null // dernier quantum à M − 10 dB ou plus
  readonly firstQuiet: number | null // premier quantum suivant à M − 40 dB ou moins
  readonly t30ms: number | null
  readonly sounded: boolean
}

// Forme d'une fin sur une prise, autour du quantum `atQ`, jusqu'à `untilQ` (réattribution ou fin du rendu).
const endShape = (r: BenchResult, input: MeterInput, atQ: number, untilQ: number): EndShape => {
  const win = Math.round(100 / QMS)
  const before: number[] = []
  for (let q = atQ - win; q < atQ; q++) {
    const l = L(r, input, q)
    if (l > SILENCE_DB) before.push(l)
  }
  if (before.length === 0)
    return { m: Number.NaN, lastLoud: null, firstQuiet: null, t30ms: null, sounded: false }
  const m = median(before)
  let lastLoud: number | null = null
  for (let q = atQ - win; q <= untilQ; q++) if (L(r, input, q) >= m - 10) lastLoud = q
  let firstQuiet: number | null = null
  if (lastLoud !== null)
    for (let q = lastLoud + 1; q <= untilQ; q++)
      if (L(r, input, q) <= m - 40) {
        firstQuiet = q
        break
      }
  const t30ms = lastLoud !== null && firstQuiet !== null ? (firstQuiet - lastLoud) * QMS : null
  return { m, lastLoud, firstQuiet, t30ms, sounded: true }
}

const slotInput = (slot: number) => `slot${slot}` as MeterInput

// Fin de l'occupation d'un emplacement par une source : quantum de la prochaine attribution, ou fin du rendu.
const reassignQ = (r: BenchResult, src: LogSource): number => {
  const next = r.log.sources
    .filter((s) => s.kind === 'voix' && s.slot === src.slot && s.startTime > src.startTime)
    .sort((a, b) => a.startTime - b.startTime)[0]
  return next ? qOfTime(r, next.startTime) - 1 : lastQ(r)
}

const evs = <T extends SimEvent['type']>(r: BenchResult, t: T) =>
  r.journal.events.filter((e) => e.type === t) as EventOf<T>[]

export interface O1Result {
  readonly deaths: number
  readonly endOffsets: readonly number[] // tick de fin − tick de la mort, pour chaque source de l'id
  readonly startVsFell: readonly number[]
  readonly criVsCryStart: readonly number[]
  readonly inspVsTelegraph: readonly number[]
  readonly startsAfterDeath: number
  readonly pass: boolean
}

export const o1 = (r: BenchResult): O1Result => {
  const deaths = evs(r, 'death')
  const endOffsets: number[] = []
  let startsAfterDeath = 0
  for (const d of deaths) {
    for (const s of r.log.sources.filter((x) => x.id === d.id)) {
      if (s.startTick > d.tick || (s.startTick === d.tick && s.kind !== 'râle')) startsAfterDeath++
      else if (s.endTick !== null && s.endCause === 'mort') endOffsets.push(s.endTick - d.tick)
      else if (s.diedDuringFade) endOffsets.push(s.diedDuringFade.tick - d.tick)
      else if (s.endTick === null) endOffsets.push(Number.POSITIVE_INFINITY) // jamais finie : écart infini
    }
  }
  const voices = r.log.sources.filter((s) => s.kind === 'voix')
  const startVsFell: number[] = []
  const criVsCryStart: number[] = []
  const inspVsTelegraph: number[] = []
  // « Pour chaque voix attribuée hors saturation (au plus 24 corps qui vocalisent) » : les chutes en saturation
  // ne comptent pas pour l'écart début de voix / fell.
  const saturated = (tick: number) => (r.journal.ticks.find((x) => x.tick === tick)?.vocal.length ?? 0) > 24
  for (const f of evs(r, 'fell')) {
    if (saturated(f.tick)) continue
    const v = voices.find((s) => s.id === f.id && s.startTick >= f.tick - 0 && s.startTick <= f.tick + 60)
    if (v) startVsFell.push(v.startTick - f.tick)
    else startVsFell.push(Number.NaN)
  }
  for (const c of evs(r, 'cry-start')) {
    if (saturated(c.tick)) continue
    const v = voices.find(
      (s) => s.id === c.id && s.startTick <= c.tick && (s.endTick ?? Number.POSITIVE_INFINITY) >= c.tick,
    )
    const ph = v?.phases.find((p) => p.phase === 'cri' && p.tick >= c.tick - 60)
    criVsCryStart.push(ph ? ph.tick - c.tick : Number.NaN)
  }
  for (const c of evs(r, 'rise-telegraph')) {
    if (saturated(c.tick)) continue
    const v = voices.find(
      (s) => s.id === c.id && s.startTick <= c.tick && (s.endTick ?? Number.POSITIVE_INFINITY) >= c.tick,
    )
    const ph = v?.phases.find((p) => p.phase === 'inspiration' && p.tick >= c.tick - 60)
    inspVsTelegraph.push(ph ? ph.tick - c.tick : Number.NaN)
  }
  const all = [...endOffsets, ...startVsFell, ...criVsCryStart, ...inspVsTelegraph]
  return {
    deaths: deaths.length,
    endOffsets,
    startVsFell,
    criVsCryStart,
    inspVsTelegraph,
    startsAfterDeath,
    pass: all.every((x) => x === 0) && startsAfterDeath === 0,
  }
}

export interface O3Death {
  readonly id: number
  readonly tick: number
  readonly by: string
  readonly living: boolean // voix vivante à la mort (emplacement qui sonnait dans les 100 ms avant T_d)
  readonly rale: boolean
  readonly lane: number | null
  readonly aSilentFromW2: boolean | null // (a) couche vivante éteinte au début de W2
  readonly bStartQ: number | null // (b) premier quantum non silencieux de la piste, relatif à T_d
  readonly b: boolean | null
  readonly L: readonly number[] // L_1 à L_4 (dB)
  readonly c: boolean | null
  readonly d: boolean | null
  readonly e: boolean // rien après T_a + 2 q (emplacement, piste)
  readonly f: boolean | null // Sentence : le cri tient jusqu'au coup fatal
  readonly g: boolean | null // scènes S1 : bus des créatures silencieux après T_a + 2 q
}

// O3 (amendement A7, A17, A19) : passage au râle, râle, silence.
export const o3 = (
  r: BenchResult,
  singleCreatureScene: boolean,
): { deaths: O3Death[]; unsounded: number; pass: boolean } => {
  const out: O3Death[] = []
  let unsounded = 0
  const end = lastQ(r) + 1
  for (const d of evs(r, 'death')) {
    const td = tdQ(r, d.tick)
    const ta = tdQ(r, d.tick + AGONIE_TICKS)
    const w = (ta - (td + 2)) / 4
    const W = [0, 1, 2, 3].map((k) => [Math.round(td + 2 + k * w), Math.round(td + 2 + (k + 1) * w)] as const)
    const mine = r.log.sources.filter((s) => s.id === d.id)
    const v = mine.find((s) => s.kind === 'voix' && s.endTick === d.tick && s.endMode === 'agonie')
    const rl = mine.find((s) => s.kind === 'râle' && s.startTick === d.tick)
    const slot = v?.slot ?? null
    let living = false
    let aSilent: boolean | null = null
    let f: boolean | null = null
    let mv = Number.NaN
    if (v && slot !== null) {
      const pre: number[] = []
      for (let q = td - 37; q < td; q++) {
        const l = L(r, slotInput(slot), q)
        if (l > SILENCE_DB) pre.push(l)
      }
      living = pre.length > 0
      if (living) {
        mv = median(pre)
        const until = Math.min(reassignQ(r, v) + 1, end)
        aSilent = true
        for (let q = (W[1] as readonly [number, number])[0]; q < until; q++)
          if (L(r, slotInput(slot), q) > SILENCE_DB) aSilent = false
        const ss = evs(r, 'sentence-start')
          .filter((x) => x.target === d.id && x.tick <= d.tick)
          .pop()
        if (d.by === 'sentence' && ss) {
          f = true
          for (let q = tdQ(r, ss.tick); q <= td - 1; q++) if (L(r, slotInput(slot), q) <= mv - 30) f = false
        }
      }
    }
    if (!living && !rl) {
      unsounded++
      continue
    }
    let bStart: number | null = null
    let b: boolean | null = null
    let c: boolean | null = null
    let dd: boolean | null = null
    let Ls: number[] = []
    let e = true
    const lane = rl?.lane ?? null
    if (rl && lane !== null) {
      const inp = `agonie${lane}` as MeterInput
      for (let q = td - 4; q < td + 40; q++)
        if (L(r, inp, q) > SILENCE_DB) {
          bStart = q - td
          break
        }
      const mean = (a: number, z: number) => {
        let s = 0
        for (let q = a; q < z; q++) {
          const l = L(r, inp, q)
          s += Number.isFinite(l) ? 10 ** (l / 10) : 0
        }
        return 10 * Math.log10(s / Math.max(1, z - a))
      }
      Ls = W.map(([a, z]) => mean(a, z))
      const [l1, l2, l3, l4] = Ls as [number, number, number, number]
      let f10: number | null = null
      for (let q = td - 2; q < ta; q++)
        if (L(r, inp, q) >= l1 - 10) {
          f10 = q
          break
        }
      b =
        bStart !== null &&
        bStart >= -2 &&
        bStart <= 1 &&
        f10 !== null &&
        f10 < td + 6 &&
        (!living || l1 >= mv - 10)
      c = l2 <= l1 + 1 && l3 <= l2 + 1 && l4 <= l3 + 1 && l4 <= l1 - 10
      let last30: number | null = null
      let lastNz: number | null = null
      for (let q = td; q < ta + 40 && q < end; q++) {
        const l = L(r, inp, q)
        if (l >= l1 - 30) last30 = q
        if (l > SILENCE_DB) lastNz = q
      }
      dd =
        last30 !== null &&
        last30 >= (W[2] as readonly [number, number])[0] &&
        lastNz !== null &&
        L(r, inp, lastNz) <= l1 - 30
      for (let q = ta + 2; q < ta + 40 && q < end; q++) if (L(r, inp, q) > SILENCE_DB) e = false
    }
    if (v && slot !== null) {
      const until = Math.min(reassignQ(r, v) + 1, end)
      for (let q = ta + 2; q < until; q++) if (L(r, slotInput(slot), q) > SILENCE_DB) e = false
    }
    let g: boolean | null = null
    if (singleCreatureScene) {
      g = true
      for (let q = ta + 2; q < end; q++) if (L(r, 'creatures', q) > SILENCE_DB) g = false
    }
    out.push({
      id: d.id,
      tick: d.tick,
      by: d.by,
      living,
      rale: rl !== undefined,
      lane,
      aSilentFromW2: aSilent,
      bStartQ: bStart,
      b,
      L: Ls,
      c,
      d: dd,
      e,
      f,
      g,
    })
  }
  const pass = out.every(
    (x) =>
      x.aSilentFromW2 !== false &&
      x.b !== false &&
      x.c !== false &&
      x.d !== false &&
      x.e &&
      x.f !== false &&
      x.g !== false,
  )
  return { deaths: out, unsounded, pass }
}

// O2 (amendement A6) : une mort avant fell + 30 n'a ni cry-start ni phase cri ; sa voix (halètement) passe au râle selon
// O3 (le corps resté muet après une Sentence précoce ne râle pas) ; un Abattu encore vivant à fell + 30 a son
// cry-start et sa phase cri exactement à ce tick.
export const o2 = (r: BenchResult, o3r: ReturnType<typeof o3>) => {
  const fell = new Map<number, number>()
  for (const f of evs(r, 'fell')) if (!fell.has(f.id)) fell.set(f.id, f.tick)
  const early = evs(r, 'death').filter((d) => d.tick < (fell.get(d.id) ?? Number.POSITIVE_INFINITY) + 30)
  const rows = early.map((d) => {
    const cry = evs(r, 'cry-start').some((c) => c.id === d.id)
    const criPhase = r.log.sources.some((s) => s.id === d.id && s.phases.some((p) => p.phase === 'cri'))
    const m = o3r.deaths.find((x) => x.id === d.id && x.tick === d.tick)
    const mute = d.by === 'sentence'
    const o3ok =
      m !== undefined &&
      m.aSilentFromW2 !== false &&
      m.b !== false &&
      m.c !== false &&
      m.d !== false &&
      m.e &&
      (mute ? !m.rale : m.rale)
    return {
      id: d.id,
      deathTick: d.tick,
      fellTick: fell.get(d.id),
      cryStart: cry,
      criPhase,
      mute,
      rale: m?.rale ?? false,
      pass: !cry && !criPhase && o3ok,
    }
  })
  const late = evs(r, 'cry-start').map((c) => ({ id: c.id, offset: c.tick - (fell.get(c.id) ?? Number.NaN) }))
  return {
    early: rows,
    cryStartOffsets: late,
    pass: rows.every((x) => x.pass) && late.every((x) => x.offset === 30),
  }
}

export interface O5Cluster {
  readonly firstTick: number
  readonly lastTick: number
  readonly aFirstQuantumAtMinus5Ms: number | null
  readonly a: boolean
  readonly bOutOfRange: number
  readonly b: boolean
  readonly cRAt500: number
  readonly c: boolean
  readonly dDurationBelowMinus3Ms: number
  readonly dExpectedMs: number
  readonly d: boolean
}

export const o5 = (
  r: BenchResult,
): { clusters: O5Cluster[]; eViolations: number; fViolations: number; pass: boolean } => {
  const R = (q: number): number | null => {
    const pre = L(r, 'ambiance-avant', q)
    if (!(pre > SILENCE_DB)) return null
    return L(r, 'ambiance-apres', q) - pre
  }
  const deathTicks = [...new Set(evs(r, 'death').map((d) => d.tick))].sort((a, b) => a - b)
  const tSec = (tick: number) => (tdQ(r, tick) * QUANTUM) / r.sampleRate
  // Amendement A10 : l'atténuation dure de T_d à T_a + 400 ms ; D = A_g + 400 ms.
  const D = AGONIE_TICKS * TICK_S + DUCK_HOLD_S
  const clusters: { first: number; last: number }[] = []
  for (const t of deathTicks) {
    const c = clusters[clusters.length - 1]
    if (c && tSec(t) - tSec(c.last) < D) c.last = t
    else clusters.push({ first: t, last: t })
  }
  const out: O5Cluster[] = []
  for (const c of clusters) {
    const T1 = tSec(c.first)
    const T2 = tSec(c.last)
    const q1 = tdQ(r, c.first)
    const q2 = tdQ(r, c.last)
    let qa: number | null = null
    for (let q = q1; q <= lastQ(r); q++) {
      const x = R(q)
      if (x !== null && x <= DUCK_DB + 1) {
        qa = q
        break
      }
    }
    const aMs = qa === null ? null : ((qa * QUANTUM) / r.sampleRate) * 1000 - T1 * 1000
    let bBad = 0
    for (let q = qOfTime(r, T1 + 0.017); q < qOfTime(r, T2 + D - 0.017); q++) {
      const x = R(q)
      if (x !== null && (x < DUCK_DB - 1 || x > DUCK_DB + 1)) bBad++
    }
    const q500 = Math.floor(((T2 + D + 0.1) * r.sampleRate) / QUANTUM)
    const r500 = R(q500) ?? Number.NaN
    let below = 0
    for (let q = q1 - 10; q <= q2 + Math.round((D * 1000 + 600) / QMS); q++) {
      const x = R(q)
      if (x !== null && x <= -3) below++
    }
    const dMs = below * QMS
    const expected = (T2 - T1 + D) * 1000
    out.push({
      firstTick: c.first,
      lastTick: c.last,
      aFirstQuantumAtMinus5Ms: aMs,
      a: aMs !== null && aMs <= 17,
      bOutOfRange: bBad,
      b: bBad === 0,
      cRAt500: r500,
      c: r500 >= -1,
      dDurationBelowMinus3Ms: dMs,
      dExpectedMs: expected,
      d: Math.abs(dMs - expected) <= 17,
    })
  }
  // (e) hors des fenêtres [T_d ; T_d + D + 17 ms] de toutes les morts : aucun quantum à R ≤ −3 dB. (f) R ≥ −7 partout.
  const windows = deathTicks.map((t) => [tdQ(r, t), tdQ(r, t) + Math.floor((D * 1000 + 17) / QMS)] as const)
  let e = 0
  let f = 0
  for (let q = r.tables.firstQ; q <= lastQ(r); q++) {
    const x = R(q)
    if (x === null) continue
    if (x <= -3 && !windows.some(([a, b]) => q >= a && q <= b)) e++
    if (x < DUCK_DB - 1) f++
  }
  return {
    clusters: out,
    eViolations: e,
    fViolations: f,
    pass: out.every((c) => c.a && c.b && c.c && c.d) && e === 0 && f === 0,
  }
}

export interface O6End {
  readonly id: number
  readonly tick: number
  readonly cause: string // lue dans les SimEvent
  readonly t30ms: number | null
  readonly pass: boolean
}

// O6 sur un rendu : T30 des fins sans mort (cause lue dans les évènements), fins orphelines, et continuité pendant
// les phases cri et inspiration (passages ≥ 8 quanta à M₂₀₀ − 30 dB).
export const o6 = (
  r: BenchResult,
): { ends: O6End[]; orphans: number; continuityGaps: number; pass: boolean } => {
  const ends: O6End[] = []
  let orphans = 0
  const resets = evs(r, 'reset').map((e) => e.tick)
  for (const s of r.log.sources) {
    if (s.endTick === null || s.endTime === null) continue
    const t = s.endTick
    const atTick = r.journal.events.filter((e) => e.tick === t)
    if (atTick.some((e) => e.type === 'death' && e.id === s.id)) continue
    const has = (f: (e: SimEvent) => boolean) => atTick.some(f)
    const cause = has((e) => e.type === 'rise' && e.id === s.id)
      ? 'relevement'
      : has((e) => e.type === 'prayer-complete' && e.others.includes(s.id))
        ? 'priere'
        : has((e) => e.type === 'assemble' && e.others.includes(s.id))
          ? 'assemblage'
          : has((e) => e.type === 'absorb' && e.others.includes(s.id))
            ? 'absorption'
            : resets.some((x) => t >= x && t < x + 120)
              ? 'reinitialisation'
              : s.kind !== 'voix' &&
                  has(
                    (e) =>
                      ((e.type === 'fell' || e.type === 'action-end' || e.type === 'action-interrupted') &&
                        e.id === s.id) ||
                      ((e.type === 'prayer-complete' || e.type === 'burst') && e.id === s.id),
                  )
                ? 'fin-action'
                : s.kind === 'voix' && atTick.every((e) => !('id' in e) || e.id !== s.id)
                  ? 'vol-de-voix'
                  : 'orpheline'
    if (cause === 'orpheline') orphans++
    let t30: number | null = null
    if (s.kind === 'voix' && s.slot !== null) {
      const at = qOfTime(r, s.endTime)
      const next = r.log.sources
        .filter((x) => x.kind === 'voix' && x.slot === s.slot && x.startTime > s.startTime)
        .sort((a, b) => a.startTime - b.startTime)[0]
      const until = next ? qOfTime(r, next.startTime) - 1 : lastQ(r)
      t30 = endShape(r, slotInput(s.slot), at, until).t30ms
    }
    ends.push({
      id: s.id,
      tick: t,
      cause,
      t30ms: t30,
      pass: cause !== 'orpheline' && (t30 === null || t30 >= 80),
    })
  }
  // Continuité : phases cri et inspiration de chaque voix.
  let gaps = 0
  for (const s of r.log.sources) {
    if (s.kind !== 'voix' || s.slot === null) continue
    const cri = s.phases.find((p) => p.phase === 'cri' || p.phase === 'inspiration')
    if (!cri) continue
    const from = qOfTime(r, cri.time)
    const to = s.endTime !== null ? qOfTime(r, s.endTime) - 1 : lastQ(r)
    let run = 0
    for (let q = from; q <= to; q++) {
      const prev: number[] = []
      for (let k = q - 75; k < q; k++) prev.push(L(r, slotInput(s.slot), k))
      const m200 = median(prev.filter((x) => Number.isFinite(x)))
      if (L(r, slotInput(s.slot), q) <= m200 - 30) {
        run++
        if (run === 8) gaps++
      } else run = 0
    }
  }
  return {
    ends,
    orphans,
    continuityGaps: gaps,
    pass: ends.every((e) => e.pass) && orphans === 0 && gaps === 0,
  }
}

// O7 (d) : quand une mort amène N à 0 à l'instant T, premier quantum silencieux de la nappe dans [T + 1,9 ; T + 2,1] s.
export const o7d = (
  r: BenchResult,
): { extinctions: { tick: number; firstSilentAfterS: number | null; pass: boolean }[]; pass: boolean } => {
  const ex: { tick: number; firstSilentAfterS: number | null; pass: boolean }[] = []
  for (let i = 1; i < r.journal.ticks.length; i++) {
    const a = r.journal.ticks[i - 1]
    const b = r.journal.ticks[i]
    if (!a || !b || !(a.n > 0 && b.n === 0)) continue
    const td = tdQ(r, b.tick)
    let first: number | null = null
    for (let q = td; q <= lastQ(r); q++)
      if (!(L(r, 'nappe', q) > SILENCE_DB)) {
        first = q
        break
      }
    const s = first === null ? null : ((first - td) * QUANTUM) / r.sampleRate
    ex.push({ tick: b.tick, firstSilentAfterS: s, pass: s !== null && s >= 1.9 && s <= 2.1 })
  }
  return { extinctions: ex, pass: ex.every((e) => e.pass) }
}

// O7 (a), (b), (c) : niveau moyen de la nappe (énergie, avant atténuation) sur 1 s, 2 s après le dernier changement
// de N, tant que N reste constant et que 24 corps au plus vocalisent ; ρ de Spearman entre N et ce niveau.
export const o7abc = (r: BenchResult) => {
  const ticks = r.journal.ticks
  const windows: { n: number; fromTick: number; levelDb: number }[] = []
  let lastChange = 0
  for (let i = 1; i <= ticks.length; i++) {
    const cur = ticks[i]
    const prev = ticks[i - 1]
    if (!prev) continue
    if (cur && cur.n === prev.n) continue
    // Période [lastChange, i − 1] à N constant.
    const from = lastChange + 120
    const to = from + 60
    const period = ticks.slice(lastChange, i)
    if (prev.tick >= to - 1 && period.every((x) => x.vocal.length <= 24)) {
      let e = 0
      let n = 0
      const i0 = r.tables.inputs.indexOf('nappe')
      for (let q = tdQ(r, from); q < tdQ(r, to); q++) {
        e += r.tables.ms[i0]?.[q - r.tables.firstQ] ?? 0
        n++
      }
      windows.push({ n: prev.n, fromTick: from, levelDb: 10 * Math.log10(e / Math.max(1, n)) })
    }
    lastChange = i
  }
  const rank = (xs: readonly number[]) => {
    const sorted = [...xs].map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0])
    const out = new Array<number>(xs.length)
    for (let k = 0; k < sorted.length; ) {
      let j = k
      while (
        j + 1 < sorted.length &&
        (sorted[j + 1] as readonly [number, number])[0] === (sorted[k] as readonly [number, number])[0]
      )
        j++
      for (let m = k; m <= j; m++) out[(sorted[m] as readonly [number, number])[1]] = (k + j) / 2 + 1
      k = j + 1
    }
    return out
  }
  const finite = windows.filter((w) => Number.isFinite(w.levelDb))
  const rx = rank(finite.map((w) => w.n))
  const ry = rank(finite.map((w) => w.levelDb))
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length
  const mx = mean(rx)
  const my = mean(ry)
  let sxy = 0
  let sxx = 0
  let syy = 0
  rx.forEach((x, i) => {
    const y = ry[i] as number
    sxy += (x - mx) * (y - my)
    sxx += (x - mx) ** 2
    syy += (y - my) ** 2
  })
  const rho = sxy / Math.sqrt(sxx * syy)
  const l1 = windows.find((w) => w.n === 1)?.levelDb ?? Number.NaN
  const l0 = windows.find((w) => w.n === 0)?.levelDb ?? Number.NaN
  const falseEmpty = windows.filter((w) => w.n >= 1 && w.levelDb < l1 - 3).length
  return {
    windows,
    rho,
    L1: l1,
    L1minusL0: l1 - l0,
    falseEmpty,
    pass: rho >= 0.95 && falseEmpty === 0 && l1 >= -50 && l1 - l0 >= 30,
  }
}

// O8 (a) : nombre maximal d'emplacements non silencieux par quantum.
export const o8a = (r: BenchResult): { maxNonSilentSlots: number; pass: boolean } => {
  let worst = 0
  for (let q = r.tables.firstQ; q <= lastQ(r); q++) {
    let n = 0
    for (let s = 0; s < 24; s++) if (L(r, slotInput(s), q) > SILENCE_DB) n++
    worst = Math.max(worst, n)
  }
  return { maxNonSilentSlots: worst, pass: worst <= 24 }
}

// O10, indicatif hors des parties R (amendement A14) : ΔM = L_master[T_a + 100 ; T_a + 400 ms] − L_master[T_d − 300 ; T_d].
export const deltaM = (r: BenchResult): { id: number; tick: number; deltaDb: number }[] => {
  const energy = (from: number, to: number) => {
    let s = 0
    let n = 0
    for (let q = from; q < to; q++) {
      for (const inp of ['master-g', 'master-d'] as const) {
        const i = r.tables.inputs.indexOf(inp)
        s += r.tables.ms[i]?.[q - r.tables.firstQ] ?? 0
        n++
      }
    }
    return 10 * Math.log10(s / Math.max(1, n))
  }
  return evs(r, 'death').map((d) => {
    const td = tdQ(r, d.tick)
    const ta = tdQ(r, d.tick + AGONIE_TICKS)
    const ms = (x: number) => Math.round(x / QMS)
    return { id: d.id, tick: d.tick, deltaDb: energy(ta + ms(100), ta + ms(400)) - energy(td - ms(300), td) }
  })
}
