// Hôte factice pour les tests de src/dev : même contrat que l'hôte de main.ts (source de commandes, pause, pas unique,
// écouteurs par step et par image), avec la vraie simulation et le vrai registre des familles. Le « clavier » est une
// fonction de commandes fournie par le test.
import type { CommandSource, GameStart } from '../game/host'
import { MAX_STEPS_PER_FRAME, STEP_MS } from '../game/loop'
import type { PlayerCommands, World } from '../sim/index'
import { step } from '../sim/index'
import type { DevHost } from './session'
import { initialWorld } from './telemetry'

export interface FakeHost extends DevHost {
  // Une image de `ms` millisecondes : écouteurs d'image d'abord, puis les steps dus (5 au plus), comme main.ts.
  frame(ms?: number): void
  frames(n: number, ms?: number): void
  isPaused(): boolean
}

export const createFakeHost = (start: GameStart, keyboard: (w: World) => PlayerCommands): FakeHost => {
  let current = start
  let world = initialWorld({ vague: start.wave, graine: start.seed, variante: start.variant })
  let source: CommandSource | null = null
  let paused = false
  let acc = 0
  const stepListeners = new Set<(w: World, c: PlayerCommands) => void>()
  const frameListeners = new Set<(ms: number) => void>()
  const simulate = (): void => {
    const cmds = source ? source(world) : keyboard(world)
    world = step(world, cmds)
    for (const l of stepListeners) l(world, cmds)
  }
  const host: FakeHost = {
    world: () => world,
    start: () => current,
    restart: (next) => {
      current = next
      world = initialWorld({ vague: next.wave, graine: next.seed, variante: next.variant })
      acc = 0
    },
    setCommandSource: (s) => {
      source = s
    },
    setPaused: (p) => {
      paused = p
    },
    stepOnce: () => simulate(),
    onStep: (l) => {
      stepListeners.add(l)
      return () => stepListeners.delete(l)
    },
    onFrame: (l) => {
      frameListeners.add(l)
      return () => frameListeners.delete(l)
    },
    audio: { log: () => null },
    frame: (ms = STEP_MS) => {
      for (const l of frameListeners) l(ms)
      if (paused) {
        acc = 0
        return
      }
      acc += ms
      const due = Math.floor(acc / STEP_MS + 1e-9)
      const n = Math.min(due, MAX_STEPS_PER_FRAME)
      acc = Math.max(0, acc - due * STEP_MS)
      for (let i = 0; i < n; i++) simulate()
    },
    frames: (n, ms) => {
      for (let i = 0; i < n; i++) host.frame(ms)
    },
    isPaused: () => paused,
  }
  return host
}
