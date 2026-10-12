// Recette de lecture des clips de la Forge : le jeu en est la source (décision de l'orchestrateur, E2). Mêmes noms
// exportés et mêmes constantes que tools/forge/playback.ts, que la galerie et la validation de la Forge liront ici à
// la fusion.
//
// - Interruption (L7, §18) : un coup coupe l'attaque ou la canalisation en 2 images au plus à 60 i/s. On fond
//   l'action en cours vers la réaction sur INTERRUPT_FADE_FRAMES images.
// - Mort (L4, §18, §30.3) : pas de clip. La créature se fige sur sa pose courante en gelant l'horloge du mélangeur
//   (mixer.timeScale = 0). Mettre les actions en pause ne suffit pas : un fondu en cours continue de faire varier
//   les poids, donc la pose (mesuré par la validation). Arrêter les actions ramène la pose de repos : interdit.
//
// Le jeu ne fait pas avancer de mélangeur avec une horloge : la pose d'une image est une fonction des ticks de la
// simulation (B2 I2, rendu image par image exact). Les fonctions pures `clipTimeAt` et `fadeWeightAt` donnent, pour
// un temps écoulé depuis le début de la lecture, exactement ce que `playClip` et `interrupt` produisent dans un
// mélangeur avancé pas à pas (playback.test.ts le vérifie) ; geler l'horloge revient à évaluer la pose au tick de la
// mort.
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

// ---------------------------------------------------------------------------------------------------------
// Équivalents purs (le jeu)

// Temps lu dans le clip `elapsedS` secondes après playClip(recipe) (ou interrupt, toujours en lecture unique) :
// une boucle repart de 0 à la fin du clip (LoopRepeat de three), une lecture unique s'arrête sur sa dernière image
// (clampWhenFinished).
export const clipTimeAt = (recipe: ClipRecipe, durationS: number, elapsedS: number, once = false): number => {
  const raw = recipe.startS + Math.max(0, elapsedS) * recipe.rate
  if (recipe.boucle && !once) {
    if (durationS <= 0) return 0
    const r = raw % durationS
    return r < 0 ? r + durationS : r
  }
  return Math.min(durationS, Math.max(0, raw))
}

// Poids de l'action d'arrivée d'un fondu linéaire (crossFadeTo sans déformation) commencé il y a `elapsedS`
// secondes ; l'action de départ a le poids complémentaire.
export const fadeWeightAt = (elapsedS: number, fadeS: number = INTERRUPT_FADE_S): number => {
  if (fadeS <= 0) return elapsedS >= 0 ? 1 : 0
  return Math.min(1, Math.max(0, elapsedS / fadeS))
}

// Vitesse de lecture qui fait tomber le repère d'impact du clip au tick actif de l'action de la simulation : le clip
// part de `startS` au tick de départ de l'action et atteint `impactS` après `windowTicks` ticks (le télégraphe de la
// simulation). Sans repère d'impact ou sans fenêtre, la vitesse du manifeste.
export const impactRate = (recipe: ClipRecipe, windowTicks: number): number => {
  if (recipe.impactS === null || windowTicks <= 0) return recipe.rate
  const span = recipe.impactS - recipe.startS
  return span > 0 ? span / (windowTicks * FRAME_S) : recipe.rate
}
