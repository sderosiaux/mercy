// Moteur audio : un contexte injecté (AudioContext réel ou OfflineAudioContext), une banque décodée, et une mise à
// jour par tick de simulation. Le moteur lit le monde et ses évènements ; il n'écrit jamais dans le monde.
//
// Contrat d'appel : update() après CHAQUE step de la simulation, dans l'ordre des ticks. Les évènements d'un tick
// sautés seraient perdus (le moteur le consigne dans log.warnings) ; les morts restent coupées grâce à l'état.
import type { EntityId, FamilyKind, Vec2, World } from '../sim/index'
import { bankFor } from './bank'
import { GAME_JOURNAL_TICKS } from './constants'
import { direct, initialDirector, type Pools } from './director'
import { type AudioLog, type Bank, createGraph, type Graph, type JournalMode } from './graph'
import { byRole, type Manifest } from './manifest'
import { orientListener } from './orientation'

export const poolsOf = (m: Manifest): Pools => ({
  cri: byRole(m, 'cri').map((e) => e.id),
  halete: byRole(m, 'halètement').map((e) => e.id),
  inspire: byRole(m, 'inspiration').map((e) => e.id),
  etouffe: byRole(m, 'cri-etouffe').map((e) => e.id),
})

export interface AudioEngine {
  update(world: World, listener: Vec2): void
  log(): AudioLog
  readonly graph: Graph
  dispose(): void
}

export interface EngineOptions {
  // Horloge des commandes ; par défaut ctx.currentTime (hors ligne : l'instant de suspension, en début de quantum).
  readonly now?: () => number
  // Journal I1 : complet par défaut (banc hors ligne, mesure en direct) ; borné en jeu (createAudio).
  readonly journal?: JournalMode
}

export const createAudioEngine = (
  ctx: BaseAudioContext,
  bank: Bank,
  opts: EngineOptions = {},
): AudioEngine => {
  const pools = poolsOf(bank.manifest)
  const graph = createGraph(ctx, bank, { journal: opts.journal ?? 'complet' })
  let state = initialDirector()
  let last: number | null = null
  return {
    graph,
    update: (world, listener) => {
      if (last !== null && world.tick <= last) return
      if (last !== null && world.tick > last + 1)
        graph.log.warnings.push(
          `ticks ${last + 1} à ${world.tick - 1} non reçus : leurs évènements sont perdus`,
        )
      const now = opts.now ? opts.now() : ctx.currentTime
      const r = direct(state, world, listener, now, pools)
      state = r.state
      const family = new Map(world.creatures.map((c) => [c.id, c.family]))
      graph.apply(r.cmds, world.tick, now, (id: EntityId): FamilyKind | null => family.get(id) ?? null)
      graph.frame(world.tick, now, listener)
      last = world.tick
    },
    log: () => graph.log,
    dispose: () => graph.dispose(),
  }
}

// Point d'entrée du jeu : l'AudioContext ne se crée qu'après un geste de l'utilisateur (§24), au premier resume().
export interface GameAudio {
  resume(): Promise<void>
  // Nouvelle partie : coupe toutes les sources et repart d'un moteur neuf (requête C7 R3).
  reset(): void
  update(world: World, listener: Vec2): void
  log(): AudioLog | null
  readonly context: BaseAudioContext | null
}

export const createAudio = (
  opts: { baseUrl?: string; context?: BaseAudioContext; screenRight?: Vec2; journal?: JournalMode } = {},
): GameAudio => {
  // Revue de code M5 : en jeu, le journal I1 ne grossit pas avec la durée de la partie.
  const journal = opts.journal ?? { ticks: GAME_JOURNAL_TICKS }
  let ctx: BaseAudioContext | null = opts.context ?? null
  let engine: AudioEngine | null = null
  let bank: Bank | null = null
  let loading: Promise<void> | null = null
  return {
    resume: async () => {
      ctx ??= new AudioContext({ latencyHint: 'interactive' })
      if (ctx instanceof AudioContext && ctx.state !== 'running') await ctx.resume()
      const c = ctx
      if (opts.screenRight) orientListener(c, opts.screenRight) // la droite de l'écran sonne à droite (C5 R1)
      loading ??= bankFor(c, opts.baseUrl ?? '/audio/').then((b) => {
        bank = b
        engine = createAudioEngine(c, b, { journal })
      })
      await loading
    },
    // Revue de code M6 : l'ancien moteur arrête toutes ses lectures (boucles comprises) avant d'être remplacé.
    reset: () => {
      if (!ctx || !bank) return
      engine?.dispose()
      engine = createAudioEngine(ctx, bank, { journal })
    },
    update: (world, listener) => engine?.update(world, listener),
    log: () => engine?.log() ?? null,
    get context() {
      return ctx
    },
  }
}
