// Recette de lecture des clips, commune à la validation (qui la mesure) et à la galerie (qui la montre). Le
// moteur du jeu l'appliquera à l'intégration : elle est aussi écrite dans le manifeste.
//
// - Interruption (L7, §18) : un coup coupe l'attaque ou la canalisation en 2 images au plus à 60 i/s. On fond
//   l'action en cours vers la réaction sur INTERRUPT_FADE_FRAMES images.
// - Mort (L4, §18, §30.3) : pas de clip. La créature se fige sur sa pose courante en gelant l'horloge du mélangeur
//   (mixer.timeScale = 0). Mettre les actions en pause ne suffit pas : un fondu en cours continue de faire varier
//   les poids, donc la pose (mesuré par la validation). Arrêter les actions ramène la pose de repos : interdit.
import { type AnimationAction, type AnimationMixer, LoopOnce, LoopRepeat } from 'three'

export const SIM_FPS = 60
export const FRAME_S = 1 / SIM_FPS
export const INTERRUPT_FADE_FRAMES = 2
export const INTERRUPT_FADE_S = INTERRUPT_FADE_FRAMES * FRAME_S

export interface ClipRecipe {
  readonly name: string
  readonly boucle: boolean
  readonly startS: number // début lu dans le clip (amorce retirée, ou anticipation sautée)
  readonly rate: number // vitesse de lecture qui cale le clip sur la simulation
  readonly impactS: number | null
}

export const playClip = (action: AnimationAction, recipe: ClipRecipe): AnimationAction => {
  action.reset()
  action.setLoop(recipe.boucle ? LoopRepeat : LoopOnce, recipe.boucle ? Number.POSITIVE_INFINITY : 1)
  action.clampWhenFinished = !recipe.boucle
  action.timeScale = recipe.rate
  action.time = recipe.startS
  action.play()
  return action
}

export const interrupt = (
  from: AnimationAction,
  to: AnimationAction,
  recipe: ClipRecipe,
  fadeS: number = INTERRUPT_FADE_S,
): AnimationAction => {
  to.reset()
  to.setLoop(LoopOnce, 1)
  to.clampWhenFinished = true
  to.timeScale = recipe.rate
  to.time = recipe.startS
  to.play()
  from.crossFadeTo(to, fadeS, false)
  return to
}

export const freeze = (mixer: AnimationMixer): void => {
  mixer.timeScale = 0
}
