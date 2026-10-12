// window.__mercy : l'objet des vérificateurs. Lecture seule : gelé, propriété non modifiable, et chaque lecture du
// monde renvoie une copie. Le pilotage (pause, pas, redémarrage, bot) passe par l'hôte, jamais par le monde.
import { analyseBank, type BenchResult, excerpt, masterWav, renderOffline, runLive } from '../audio/index'
import { makePolicy, POLICIES } from '../bots/harness'
import type { GameHost, GameStart } from '../game/host'
import { hashWorld, type PlayerCommands, type Variant, type World } from '../sim/index'
import { parseCorrespondence } from './blind'
import { decodeCommand } from './commands'
import { engineFingerprint, type FingerprintRequest, mathProbe } from './engine'
import type { Session } from './session'
import { initialWorld, parseTelemetry, replayTelemetry, telemetryJson } from './telemetry'

// Politique du registre en fonction (World) => PlayerCommands, mémoire comprise (bancs audio de B5).
const policyFn = (spec: string, world0: World): ((w: World) => PlayerCommands) => {
  const policy = makePolicy(spec)
  let memory = policy.init(world0)
  return (w) => {
    const [cmd, next] = policy.decide(w, memory)
    memory = next
    return cmd
  }
}

export interface BenchRequest {
  readonly wave?: string
  readonly scene?: string
  readonly seed?: number
  readonly variant?: Variant
  readonly policy: string
  readonly ticksMax: number
  readonly label?: string
}

const benchWorld = (o: BenchRequest): { world0: World; label: string } => {
  const vague = o.scene ?? o.wave
  if (vague === undefined) throw new Error('renderOffline : wave ou scene obligatoire')
  if (!Number.isInteger(o.ticksMax) || o.ticksMax < 1) throw new Error('ticksMax : entier ≥ 1 obligatoire')
  const graine = o.seed ?? 1
  const variante = o.variant ?? 'A'
  return {
    world0: initialWorld({ vague, graine, variante }),
    label: o.label ?? `${vague}#${graine}${variante}:${o.policy}`,
  }
}

const toBase64 = (b: Uint8Array): string => {
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(s)
}

export interface MercyDeps {
  readonly host: GameHost
  readonly session: Session
  readonly exportRun: (which?: 'courante' | 'precedente') => string
  readonly restart: (o: { wave: string; seed?: number; variant?: Variant; policy?: string | null }) => void
  readonly blind: () => boolean
}

const deepFreeze = <T>(o: T): T => {
  if (o !== null && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    for (const v of Object.values(o)) deepFreeze(v)
  }
  return o
}

export const createMercyApi = (d: MercyDeps) => {
  const { host, session } = d
  const benches = new Map<string, BenchResult>()
  const run = () => session.current()
  const api = {
    version: 1,
    // ---- Lecture ----
    // Instantané du monde courant, copie profonde sans le registre des familles (fonctions).
    snapshot: (): Omit<World, 'families'> => {
      const { families: _f, ...state } = host.world()
      return structuredClone(state)
    },
    hash: (): string => hashWorld(host.world()),
    tick: (): number => host.world().tick,
    start: (): GameStart & { politique: string | null; aveugle: boolean } => {
      const s = run().setup
      return { ...s.start, politique: s.politique, aveugle: s.blind !== null }
    },
    // B5 I2 : évènements depuis le début de la partie, et par tick N et les corps qui vocalisent avec leur distance.
    events: () => run().recorder.journal(),
    // B1 §12.6, B2 I6 : commandes appliquées à chaque step (point visé compris), tick du monde produit.
    commands: (): (PlayerCommands & { tick: number })[] => {
      const t0 = run().recorder.world0.tick
      return run()
        .recorder.commands()
        .map((c, i) => ({ tick: t0 + i + 1, ...decodeCommand(c) }))
    },
    series: () => [...run().recorder.series()],
    notes: () => [...run().recorder.notes()],
    metrics: () => run().recorder.metrics(),
    // B5 I1 : journal audio complet du moteur du jeu (null tant que l'audio n'a pas démarré).
    audioLog: () => {
      const log = host.audio.log()
      return log === null ? null : structuredClone(log)
    },
    frames: () => ({ ...session.frames.stats(), depuisPartie: run().rang }),
    resetFrames: () => session.frames.reset(),
    runs: () => session.runs(),
    policies: (): string[] => Object.keys(POLICIES),
    // Télémétrie de la partie en cours (ou de la précédente), objet ou JSON tel qu'exporté.
    telemetry: (which: 'courante' | 'precedente' = 'courante') => {
      const r = which === 'courante' ? run() : session.previous()
      return r === null ? null : session.telemetry(r)
    },
    telemetryJson: (which: 'courante' | 'precedente' = 'courante') => {
      const r = which === 'courante' ? run() : session.previous()
      return r === null ? null : telemetryJson(session.telemetry(r))
    },
    exportTelemetry: (which: 'courante' | 'precedente' = 'courante') => d.exportRun(which),
    // Rejeu d'un export dans ce moteur JS (exact quand l'export vient du même navigateur).
    replay: (json: string, correspondenceJson?: string) =>
      replayTelemetry(parseTelemetry(json), {
        correspondence:
          correspondenceJson === undefined ? undefined : parseCorrespondence(JSON.parse(correspondenceJson)),
      }),
    // ---- Pilotage (par l'hôte) ----
    pause: () => session.setPaused(true),
    resume: () => session.setPaused(false),
    paused: () => session.paused(),
    step: (n = 1) => session.step(n),
    runTo: (tick: number) => session.runTo(tick),
    driveTo: (tick: number) => session.driveTo(tick),
    restart: (o: { wave: string; seed?: number; variant?: Variant; policy?: string | null }) => {
      if (d.blind()) throw new Error('mode aveugle : le redémarrage passe par le panneau')
      d.restart(o)
    },
    // ---- Empreinte du moteur JS : à comparer à Node (src/dev/engine-cli.ts) ----
    engine: {
      fingerprint: (o: FingerprintRequest) => ({
        request: o,
        moteur: navigator.userAgent,
        rows: engineFingerprint(o),
        math: mathProbe(),
      }),
    },
    // ---- Instruments du rendu (B2 §12 I1, I2, I4) ----
    render: {
      readPixels: () => host.renderer.debug.readPixels(),
      idPass: () => host.renderer.debug.idPass(),
      poses: () => host.renderer.debug.poses(),
      stats: () => host.renderer.debug.stats(),
      setShake: (on: boolean) => host.renderer.debug.setShake(on),
      isolate: (id: number | null) => host.renderer.debug.isolate(id),
      hide: (ids: readonly number[]) => host.renderer.debug.hide(ids),
      project: (x: number, y: number, z: number) => host.renderer.debug.project(x, y, z),
      gpu: () => host.renderer.debug.gpu(),
    },
    // ---- Instruments audio (B5 I3, I4, I9) : le vrai module src/audio ----
    audio: {
      // B5 I3 : { wave ou scene, seed, variant, policy, ticksMax } → résumé ; le résultat complet via bench(clé).
      renderOffline: async (o: BenchRequest) => {
        const { world0, label } = benchWorld(o)
        const r = await renderOffline({
          label,
          world0,
          policy: policyFn(o.policy, world0),
          ticks: o.ticksMax,
        })
        benches.set(label, r)
        return {
          key: label,
          sampleRate: r.sampleRate,
          quantum: r.quantum,
          ticks: r.ticks,
          finalTick: r.finalTick,
          quanta: r.tables.count,
          sources: r.log.sources.length,
          events: r.journal.events.length,
          warnings: r.log.warnings,
        }
      },
      bench: (key: string) => benches.get(key) ?? null,
      benches: () => [...benches.keys()],
      masterWavBase64: (key: string, fromS = 0, toS = Number.POSITIVE_INFINITY) => {
        const r = benches.get(key)
        return r ? toBase64(masterWav(r, fromS, toS)) : null
      },
      excerptBase64: (key: string, centerTick: number, seconds = 6) => {
        const r = benches.get(key)
        if (!r) return null
        const ex = excerpt(r, centerTick, seconds)
        return { fromTick: ex.fromTick, toTick: ex.toTick, key: ex.key, wav: toBase64(ex.wav) }
      },
      // B5 I4 : mesure en direct dans le contexte audio du jeu (créé au clic de l'écran titre).
      runLive: async (o: BenchRequest & { readonly tailS?: number }) => {
        const ctx = host.audio.context
        if (!(ctx instanceof AudioContext)) throw new Error("audio non démarré : cliquer « Entrer » d'abord")
        const { world0 } = benchWorld(o)
        return runLive(ctx, { world0, policy: policyFn(o.policy, world0), ticks: o.ticksMax, tailS: o.tailS })
      },
      analyseBank: () => analyseBank(),
    },
  }
  return deepFreeze(api)
}

export type MercyApi = ReturnType<typeof createMercyApi>

export const MERCY_KEY = '__mercy'

// Propriété non modifiable de window. Pas d'augmentation globale de Window : le laboratoire audio déclare déjà
// son propre __mercy (src/audio-lab/main.ts), sur une autre page.
export const exposeMercy = (target: object, api: MercyApi): (() => void) => {
  Object.defineProperty(target, MERCY_KEY, {
    value: api,
    writable: false,
    enumerable: false,
    configurable: true,
  })
  return () => {
    if ((target as Record<string, unknown>)[MERCY_KEY] === api)
      delete (target as Record<string, unknown>)[MERCY_KEY]
  }
}
