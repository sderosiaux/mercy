// Accumulateur de la boucle à pas fixe. Aucune horloge ici : l'appelant fournit l'instant (ms) de chaque image.
export const STEP_MS = 1000 / 60
export const MAX_STEPS_PER_FRAME = 5

export interface LoopState {
  readonly acc: number
  readonly last: number | null
}

export const initialLoop: LoopState = { acc: 0, last: null }

export const advance = (
  s: LoopState,
  now: number,
  hidden: boolean,
): { readonly state: LoopState; readonly steps: number; readonly alpha: number } => {
  if (hidden || s.last === null) return { state: { acc: 0, last: now }, steps: 0, alpha: 0 }
  const acc = s.acc + Math.max(0, now - s.last)
  const due = Math.floor(acc / STEP_MS + 1e-9) // tolérance aux arrondis flottants
  const steps = Math.min(due, MAX_STEPS_PER_FRAME)
  // Au-delà du plafond, le retard est abandonné (pas de spirale de rattrapage) ; seule la fraction de pas reste.
  const rest = Math.max(0, acc - due * STEP_MS)
  return { state: { acc: rest, last: now }, steps, alpha: rest / STEP_MS }
}
