// B5 I3 : banc hors ligne. Un OfflineAudioContext à 48 000 Hz, le vrai moteur (src/audio), la vraie simulation :
// un tick par image virtuelle de 1/60 s, mise à jour audio à chaque image (suspend puis resume). Rend les tables
// par quantum (I3), le journal audio (I1) et le journal des évènements avec N et les rangs par tick (I2).
// B5 I7 : extraits WAV découpés dans le master rendu, avec leur clé de réponses calculée depuis les SimEvent.
import { type PlayerCommands, type SimEvent, step, TICK_HZ, type World } from '../sim/index'
import { rankBodies } from './alloc'
import { loadBank } from './bank'
import { BENCH_RATE, QUANTUM } from './constants'
import { vocalising } from './ends'
import { createAudioEngine } from './engine'
import type { AudioLog, Bank } from './graph'
import { attachMeter, loadMeterModule, type MeterTables } from './meter'
import { encodeWav } from './wav'

export interface TickInfo {
  readonly tick: number
  readonly n: number // créatures dont l'état n'est pas « mort »
  readonly listener: { readonly x: number; readonly z: number }
  readonly vocal: readonly (readonly [id: number, dist: number])[] // corps qui vocalisent, triés (distance, id)
}

export interface EventJournal {
  readonly events: readonly SimEvent[]
  readonly ticks: readonly TickInfo[]
}

export interface BenchOptions {
  readonly label: string
  readonly world0: World
  readonly policy: (w: World) => PlayerCommands
  readonly ticks: number // nombre de steps après world0
  readonly baseUrl?: string
  readonly bank?: Bank
}

export interface BenchResult {
  readonly label: string
  readonly sampleRate: number
  readonly quantum: number
  readonly ticks: number
  readonly tables: MeterTables
  readonly log: AudioLog
  readonly journal: EventJournal
  readonly master: readonly Float32Array[] // gauche, droite
  readonly finalTick: number
}

const tickInfo = (w: World): TickInfo => {
  const byId = new Map(w.creatures.map((c) => [c.id, c]))
  const l = w.player.pos
  const bodies = w.creatures
    .filter((c) => vocalising(c, byId))
    .map((c) => ({ id: c.id, dist: Math.hypot(c.pos.x - l.x, c.pos.z - l.z) }))
  return {
    tick: w.tick,
    n: w.creatures.filter((c) => c.state.kind !== 'mort').length,
    listener: { x: l.x, z: l.z },
    vocal: rankBodies(bodies).map((b) => [b.id, b.dist] as const),
  }
}

const waitFor = async (cond: () => boolean, ms: number): Promise<boolean> => {
  const t0 = performance.now()
  while (!cond()) {
    if (performance.now() - t0 > ms) return false
    await new Promise((r) => setTimeout(r, 5))
  }
  return true
}

export const renderOffline = async (o: BenchOptions): Promise<BenchResult> => {
  const quanta = Math.ceil((((o.ticks + 1) / TICK_HZ) * BENCH_RATE) / QUANTUM)
  const length = quanta * QUANTUM
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length, sampleRate: BENCH_RATE })
  await loadMeterModule(ctx)
  const bank = o.bank ?? (await loadBank(ctx, o.baseUrl ?? '/audio/'))
  const engine = createAudioEngine(ctx, bank)
  const meter = attachMeter(ctx, engine.graph.taps, quanta)
  const events: SimEvent[] = []
  const ticks: TickInfo[] = []
  let w = o.world0
  const record = (x: World) => {
    events.push(...x.events)
    ticks.push(tickInfo(x))
  }
  record(w)
  engine.update(w, w.player.pos) // tick 0, à t = 0
  for (let k = 1; k <= o.ticks; k++) {
    // Suspension arrondie au quantum supérieur (spec Web Audio) : c'est T_d de B5 pour le tick k.
    ctx.suspend(k / TICK_HZ).then(() => {
      w = step(w, o.policy(w))
      record(w)
      engine.update(w, w.player.pos)
      return ctx.resume()
    })
  }
  const rendered = await ctx.startRendering()
  // Chaque quantum doit être reçu : on attend les quanta distincts, pas seulement le nombre de messages.
  const complete = await waitFor(() => meter.integrity().distinct >= quanta, 10_000)
  const integ = meter.integrity()
  if (!complete || integ.duplicates.length > 0 || integ.missing.length > 0)
    engine
      .log()
      .warnings.push(
        `mesureur : ${integ.distinct} quanta distincts reçus sur ${quanta}, en double : [${integ.duplicates.slice(0, 20).join(', ')}], jamais reçus : [${integ.missing.slice(0, 20).join(', ')}]`,
      )
  if (integ.jitter > 0)
    engine
      .log()
      .warnings.push(`mesureur : currentFrame hors du quantum compté ${integ.jitter} fois (tables justes)`)
  return {
    label: o.label,
    sampleRate: BENCH_RATE,
    quantum: QUANTUM,
    ticks: o.ticks,
    tables: meter.tables(),
    log: engine.log(),
    journal: { events, ticks },
    master: [rendered.getChannelData(0), rendered.getChannelData(1)],
    finalTick: w.tick,
  }
}

export const masterWav = (r: BenchResult, fromS = 0, toS = Number.POSITIVE_INFINITY): Uint8Array => {
  const a = Math.max(0, Math.round(fromS * r.sampleRate))
  const b = Math.min(r.master[0]?.length ?? 0, Math.round(toS * r.sampleRate))
  return encodeWav(
    r.master.map((ch) => ch.slice(a, b)),
    r.sampleRate,
  )
}

// I7 : extrait de `seconds` centré sur un tick, avec la clé de réponses lue dans les SimEvent de la fenêtre.
export interface Excerpt {
  readonly wav: Uint8Array
  readonly fromTick: number
  readonly toTick: number
  readonly key: {
    readonly deaths: readonly { tick: number; id: number; by: string }[]
    readonly endsWithoutDeath: readonly { tick: number; id: number; type: string }[]
    readonly answer: 'mort' | 'pas de mort'
  }
}

export const excerpt = (r: BenchResult, centerTick: number, seconds = 6): Excerpt => {
  const half = (seconds * TICK_HZ) / 2
  const fromTick = Math.max(0, Math.round(centerTick - half))
  const toTick = fromTick + seconds * TICK_HZ
  const inWin = (t: number) => t >= fromTick && t < toTick
  const deaths = r.journal.events.flatMap((e) =>
    e.type === 'death' && inWin(e.tick) ? [{ tick: e.tick, id: e.id, by: e.by }] : [],
  )
  const endsWithoutDeath = r.journal.events.flatMap((e) =>
    (e.type === 'rise' || e.type === 'cry-stop') &&
    inWin(e.tick) &&
    !(e.type === 'cry-stop' && e.cause === 'death')
      ? [{ tick: e.tick, id: e.id, type: e.type }]
      : [],
  )
  return {
    wav: masterWav(r, fromTick / TICK_HZ, toTick / TICK_HZ),
    fromTick,
    toTick,
    key: { deaths, endsWithoutDeath, answer: deaths.length > 0 ? 'mort' : 'pas de mort' },
  }
}
