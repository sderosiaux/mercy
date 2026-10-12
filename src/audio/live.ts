// B5 I4 : mesure en direct dans un vrai AudioContext. Mêmes tables par quantum (horodatées en temps audio par le
// mesureur), plus, pour chaque image affichée, le tick du monde affiché et le currentTime lu dans le rappel
// requestAnimationFrame, et les latences du contexte.
// La boucle est une boucle à pas fixe (accumulateur, 5 pas au plus par image) ; update() suit chaque step.
import { type PlayerCommands, type SimEvent, step, TICK_HZ, type World } from '../sim/index'
import { loadBank } from './bank'
import { createAudioEngine } from './engine'
import type { AudioLog } from './graph'
import { attachMeter, loadMeterModule, type MeterTables } from './meter'

export interface LiveFrame {
  readonly frame: number
  readonly tick: number // tick du monde affiché par cette image
  readonly audioTime: number // ctx.currentTime lu dans le rappel requestAnimationFrame
}

export interface LiveResult {
  readonly sampleRate: number
  readonly baseLatency: number
  readonly outputLatency: number
  readonly frames: readonly LiveFrame[]
  readonly tables: MeterTables
  readonly log: AudioLog
  readonly events: readonly SimEvent[]
}

export const runLive = async (
  ctx: AudioContext,
  o: { world0: World; policy: (w: World) => PlayerCommands; ticks: number; baseUrl?: string; tailS?: number },
): Promise<LiveResult> => {
  if (ctx.state !== 'running') await ctx.resume()
  await loadMeterModule(ctx)
  const bank = await loadBank(ctx, o.baseUrl ?? '/audio/')
  const engine = createAudioEngine(ctx, bank)
  const meter = attachMeter(ctx, engine.graph.taps, 0, 16)
  const events: SimEvent[] = [...o.world0.events]
  const frames: LiveFrame[] = []
  let w = o.world0
  engine.update(w, w.player.pos)
  const t0 = performance.now()
  let done = 0
  await new Promise<void>((resolve) => {
    const loop = () => {
      const due = Math.floor(((performance.now() - t0) / 1000) * TICK_HZ)
      let n = 0
      while (done < due && done < o.ticks && n < 5) {
        w = step(w, o.policy(w))
        events.push(...w.events)
        engine.update(w, w.player.pos)
        done++
        n++
      }
      frames.push({ frame: frames.length, tick: w.tick, audioTime: ctx.currentTime })
      if (done >= o.ticks) resolve()
      else requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  })
  await new Promise((r) => setTimeout(r, (o.tailS ?? 0.5) * 1000))
  meter.flush()
  await new Promise((r) => setTimeout(r, 100))
  return {
    sampleRate: ctx.sampleRate,
    baseLatency: ctx.baseLatency,
    outputLatency: ctx.outputLatency,
    frames,
    tables: meter.tables(),
    log: engine.log(),
    events,
  }
}
