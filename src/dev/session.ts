// Session de dev : suit les parties jouées sur l'hôte (une partie = du monde initial au prochain redémarrage),
// enregistre la télémétrie, pilote le bot, la pause, le pas unique et l'arrêt à un tick. Sans DOM : testée avec un
// hôte factice qui fait tourner la vraie simulation. N'écrit jamais dans le monde : elle passe par l'interface de
// l'hôte (redémarrage, source de commandes, pause, pas unique), comme le clavier.
import type { AudioLog, GameAudio } from '../audio/index'
import { makePolicy } from '../bots/harness'
import type { CommandSource, GameHost, GameStart } from '../game/host'
import { MAX_STEPS_PER_FRAME, STEP_MS } from '../game/loop'
import { hashWorld, type PlayerCommands, step, type World } from '../sim/index'
import { BLIND_TIMEOUT_TICKS, type BlindStep } from './blind'
import { createFrameRecorder, type FrameRecorder, type FrameStats } from './frames'
import {
  buildTelemetry,
  createRunRecorder,
  initialWorld,
  moteurCourant,
  type RunRecorder,
  type TelemetryFile,
} from './telemetry'

export type DevHost = Pick<
  GameHost,
  'world' | 'start' | 'restart' | 'setCommandSource' | 'setPaused' | 'stepOnce' | 'onStep' | 'onFrame'
> & { readonly audio: Pick<GameAudio, 'log'> }

export interface BlindContext {
  readonly testeur: number
  readonly step: BlindStep
}

export interface RunSetup {
  readonly start: GameStart
  readonly politique: string | null // null : clavier et souris
  readonly blind: BlindContext | null
}

interface AudioMark {
  readonly sources: number
  readonly frames: number
  readonly oneshots: number
  readonly ducks: number
  readonly nappe: number
  readonly warnings: number
}

export interface Run {
  readonly rang: number
  readonly setup: RunSetup
  readonly recorder: RunRecorder
  readonly rejouable: boolean
  readonly remarque: string | null
  readonly startRef: GameStart
  readonly audioMark: AudioMark
  horsDelai: boolean
  finNotifiee: boolean
  exporteAuTick: number | null // dernier tick contenu dans le dernier export
  frames: FrameStats | null // figé quand la partie se termine
}

export interface RunSummary {
  readonly rang: number
  readonly vague: string
  readonly graine: number
  readonly variante: string | null // null en mode aveugle
  readonly etiquette: string | null
  readonly politique: string | null
  readonly debut: number
  readonly fin: number
  readonly finVague: number | null
  readonly horsDelai: boolean
  readonly rejouable: boolean
  readonly exporte: boolean
}

export type RunEndReason = 'fin-vague' | 'hors-delai'

export interface SessionHooks {
  // La vague est finie, ou la limite de 300 s du mode aveugle est atteinte (la partie est alors en pause).
  onRunEnd?(run: Run, reason: RunEndReason): void
  // La partie est abandonnée (redémarrage) : dernier moment pour l'exporter.
  onRunLeave?(run: Run): void
  onChange?(): void
}

export interface Session {
  current(): Run
  previous(): Run | null
  runs(): readonly RunSummary[]
  restart(setup: RunSetup): void
  telemetry(run?: Run): TelemetryFile
  readonly frames: FrameRecorder
  setPaused(p: boolean): void
  paused(): boolean
  step(n?: number): void // pause, puis n pas uniques
  runTo(tick: number): void // pause, puis pas uniques jusqu'au tick (sans attendre l'horloge)
  driveTo(tick: number): void // joue au rythme du jeu jusqu'au tick exact, puis pause (B2 I3)
  driving(): number | null
  dispose(): void
}

// Exportée telle qu'elle est maintenant : un export fait en cours de partie ne couvre pas la suite.
export const isExported = (r: Run): boolean => r.exporteAuTick === r.recorder.last().tick

const EMPTY_MARK: AudioMark = { sources: 0, frames: 0, oneshots: 0, ducks: 0, nappe: 0, warnings: 0 }

const markOf = (log: AudioLog | null): AudioMark =>
  log === null
    ? EMPTY_MARK
    : {
        sources: log.sources.length,
        frames: log.frames.length,
        oneshots: log.oneshots.length,
        ducks: log.ducks.length,
        nappe: log.nappe.length,
        warnings: log.warnings.length,
      }

// Entrées du journal audio écrites depuis le début de la partie. Les fins de sources commencées avant restent
// dans le journal complet (window.__mercy.audioLog()).
export const audioSlice = (log: AudioLog | null, m: AudioMark): AudioLog | null =>
  log === null
    ? null
    : {
        sources: log.sources.slice(m.sources),
        frames: log.frames.slice(m.frames),
        oneshots: log.oneshots.slice(m.oneshots),
        ducks: log.ducks.slice(m.ducks),
        nappe: log.nappe.slice(m.nappe),
        warnings: log.warnings.slice(m.warnings),
      }

export const createSession = (host: DevHost, hooks: SessionHooks = {}): Session => {
  const frames = createFrameRecorder()
  let rang = 0
  let lastAfter: World | null = null // dernier monde reçu après un step : sert à reconnaître un redémarrage
  let pausedByDev = false
  let drive: { until: number; acc: number } | null = null
  const summaries: RunSummary[] = []
  let prev: Run | null = null

  // Bot dans le navigateur : la politique du registre de src/bots, avec sa mémoire, initialisée sur le monde
  // initial comme dans playRun. Si le monde reçu n'est pas celui du dernier step, la partie a redémarré : la
  // mémoire repart de ce monde.
  const policySource = (spec: string): CommandSource => {
    const policy = makePolicy(spec)
    let memory: unknown = null
    let seen: World | null = null
    return (w) => {
      if (seen === null || w !== lastAfter) memory = policy.init(w)
      const [cmd, next] = policy.decide(w, memory)
      memory = next
      seen = w
      return cmd
    }
  }

  const beginRun = (
    setup: RunSetup,
    world0: World,
    opts: { rejouable: boolean; remarque: string | null },
  ): Run => {
    rang++
    frames.reset()
    lastAfter = world0
    return {
      rang,
      setup,
      recorder: createRunRecorder(world0),
      rejouable: opts.rejouable,
      remarque: opts.remarque,
      startRef: host.start(),
      audioMark: markOf(host.audio.log()),
      horsDelai: false,
      finNotifiee: false,
      exporteAuTick: null,
      frames: null,
    }
  }

  const summaryOf = (r: Run): RunSummary => {
    const last = r.recorder.last()
    return {
      rang: r.rang,
      vague: r.setup.start.wave,
      graine: r.setup.start.seed,
      variante: r.setup.blind ? null : r.setup.start.variant,
      etiquette: r.setup.blind?.step.etiquette ?? null,
      politique: r.setup.politique,
      debut: r.recorder.world0.tick,
      fin: last.tick,
      finVague: last.wave.endedAt,
      horsDelai: r.horsDelai,
      rejouable: r.rejouable,
      exporte: isExported(r),
    }
  }

  const leave = (r: Run): void => {
    r.frames = frames.stats()
    hooks.onRunLeave?.(r)
    summaries.push(summaryOf(r))
    prev = r
  }

  // Partie en cours au moment de l'installation : rejouable seulement si on la prend au monde initial.
  const w0 = host.world()
  const s0 = host.start()
  let cur = beginRun({ start: s0, politique: null, blind: null }, w0, {
    rejouable: w0.tick === 0,
    remarque: w0.tick === 0 ? null : `outils de dev branchés au tick ${w0.tick} : début de partie perdu`,
  })

  const onStep = (world: World, cmds: PlayerCommands): void => {
    const run = cur
    const restarted = world.tick !== run.recorder.last().tick + 1 || host.start() !== run.startRef
    if (restarted) {
      // Redémarrage fait hors de la session (touche Entrée de main.ts) : on recrée le monde initial à partir des
      // paramètres de l'hôte et on vérifie qu'il mène bien au monde reçu.
      leave(run)
      const setup: RunSetup = { ...run.setup, start: host.start() }
      const base = initialWorld({
        vague: setup.start.wave,
        graine: setup.start.seed,
        variante: setup.start.variant,
      })
      const ok = world.tick === 1 && hashWorld(step(base, cmds)) === hashWorld(world)
      if (ok) cur = beginRun(setup, base, { rejouable: true, remarque: null })
      else {
        cur = beginRun(setup, world, {
          rejouable: false,
          remarque: `redémarrage hors des outils de dev, monde initial non retrouvé (tick ${world.tick})`,
        })
        lastAfter = world
        hooks.onChange?.()
        return
      }
    }
    cur.recorder.record(cmds, world)
    lastAfter = world
    const r = cur
    if (!r.finNotifiee && world.wave.endedAt !== null) {
      r.finNotifiee = true
      hooks.onRunEnd?.(r, 'fin-vague')
    }
    // B4 §11 : 300 s après T0 sans fin de vague, la partie s'arrête et compte comme hors délai.
    const t0 = r.recorder.t0()
    if (
      r.setup.blind !== null &&
      !r.horsDelai &&
      world.wave.endedAt === null &&
      t0 !== null &&
      world.tick - t0 >= BLIND_TIMEOUT_TICKS
    ) {
      r.horsDelai = true
      r.finNotifiee = true
      setPaused(true)
      hooks.onRunEnd?.(r, 'hors-delai')
    }
    if (restarted) hooks.onChange?.()
  }

  const setPaused = (p: boolean): void => {
    pausedByDev = p
    if (!p) drive = null
    host.setPaused(p)
  }

  const onFrame = (ms: number): void => {
    if (!pausedByDev || drive !== null) frames.push(ms) // ignorées en pause des outils, sauf pendant driveTo
    const d = drive
    if (d === null) return
    d.acc += ms
    let n = 0
    while (d.acc + 1e-9 >= STEP_MS && n < MAX_STEPS_PER_FRAME && host.world().tick < d.until) {
      host.stepOnce()
      d.acc -= STEP_MS
      n++
    }
    if (n === MAX_STEPS_PER_FRAME) d.acc = Math.min(d.acc, STEP_MS) // pas de spirale de rattrapage
    if (host.world().tick >= d.until) {
      drive = null
      hooks.onChange?.()
    }
  }

  const offStep = host.onStep(onStep)
  const offFrame = host.onFrame(onFrame)

  const telemetry = (run: Run = cur): TelemetryFile => {
    const s = run.setup
    return buildTelemetry(
      run.recorder,
      {
        testeur: s.blind?.testeur ?? null,
        etape: s.blind?.step.etape ?? 'libre',
        bloc: s.blind?.step.bloc ?? null,
        rang: run.rang,
        etiquette: s.blind?.step.etiquette ?? null,
        aveugle: s.blind !== null,
        vague: s.start.wave,
        graine: s.start.seed,
        variante: s.start.variant,
        politique: s.politique,
        horsDelai: run.horsDelai,
        rejouable: run.rejouable,
        remarque: run.remarque,
      },
      {
        audio: audioSlice(host.audio.log(), run.audioMark),
        frames: run === cur ? frames.stats() : run.frames,
        moteur: moteurCourant(),
      },
    )
  }

  return {
    current: () => cur,
    previous: () => prev,
    runs: () => [...summaries, summaryOf(cur)],
    restart: (setup) => {
      // La politique est construite d'abord : un nom inconnu lève une erreur avant tout changement.
      const source = setup.politique === null ? null : policySource(setup.politique)
      // Une partie qui n'a pas joué un seul tick ne compte pas : elle est remplacée, pas archivée.
      if (cur.recorder.commands().length > 0) leave(cur)
      else rang--
      drive = null
      host.restart(setup.start)
      host.setCommandSource(source)
      cur = beginRun(setup, host.world(), { rejouable: host.world().tick === 0, remarque: null })
      hooks.onChange?.()
    },
    telemetry,
    frames,
    setPaused,
    paused: () => pausedByDev,
    step: (n = 1) => {
      setPaused(true)
      for (let i = 0; i < n; i++) host.stepOnce()
    },
    runTo: (tick) => {
      setPaused(true)
      while (host.world().tick < tick) host.stepOnce()
    },
    driveTo: (tick) => {
      setPaused(true)
      pausedByDev = true
      drive = { until: tick, acc: 0 }
    },
    driving: () => drive?.until ?? null,
    dispose: () => {
      offStep()
      offFrame()
    },
  }
}
