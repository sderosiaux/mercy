// Hôte de partie : ce que les outils de dev (C7) peuvent lire et piloter, sans jamais écrire dans le monde.
import type { GameAudio } from '../audio/engine'
import type { Renderer } from '../render/index'
import type { PlayerCommands, Variant, World } from '../sim/index'

export interface GameStart {
  readonly wave: string
  readonly seed: number
  readonly variant: Variant
}

export type CommandSource = (world: World) => PlayerCommands

export interface GameHost {
  world(): World
  start(): GameStart
  // Redémarre une partie neuve (graine, vague, variante). Le monde précédent est abandonné.
  restart(next: GameStart): void
  // Remplace les commandes du joueur (bot dans le navigateur). null : retour au clavier et à la souris.
  setCommandSource(source: CommandSource | null): void
  // Filtre appliqué à toutes les commandes avant la simulation (mode aveugle : Couperet seul, requête C7 R5).
  setCommandFilter(filter: ((c: PlayerCommands) => PlayerCommands) | null): void
  // Rendu piloté (B2 I2) : en pause, la boucle n'avance plus ; stepOnce() avance d'un tick et rend avec alpha = 1.
  setPaused(paused: boolean): void
  stepOnce(): void
  // Appelé après chaque step, avec les commandes appliquées à ce step.
  onStep(listener: (world: World, commands: PlayerCommands) => void): () => void
  // Appelé à chaque image affichée, avec sa durée en ms.
  onFrame(listener: (frameMs: number) => void): () => void
  readonly renderer: Renderer
  readonly audio: GameAudio
}
