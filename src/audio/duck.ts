// Atténuation de l'ambiance (§8.2, §19, D9) : −6 dB dès une mort, sans empilement, jusqu'à 0,4 s après la
// dernière mort d'une grappe. Machine d'état pure, en temps audio (secondes).
import { DUCK_HOLD_S, QUANTUM_S } from './constants'

export type DuckState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'held'; readonly since: number; readonly releaseAt: number }

export type DuckCmd =
  | { readonly t: 'duck-down'; readonly at: number; readonly releaseAt: number } // descente vers −6 dB, remontée prévue
  | { readonly t: 'duck-extend'; readonly releaseAt: number } // déjà à −6 dB : la remontée recule

export const DUCK_IDLE: DuckState = { kind: 'idle' }

// Rampe d'un quantum à chaque bord : la plus courte qui évite le clic, bien sous l'image que B5.O5 tolère.
export const DUCK_RAMP_S = QUANTUM_S

export const duckStep = (
  s: DuckState,
  deaths: boolean,
  now: number,
): { state: DuckState; cmd: DuckCmd | null } => {
  if (!deaths) {
    if (s.kind === 'held' && now >= s.releaseAt + DUCK_RAMP_S) return { state: DUCK_IDLE, cmd: null }
    return { state: s, cmd: null }
  }
  const releaseAt = now + DUCK_HOLD_S
  if (s.kind === 'held' && now < s.releaseAt) {
    // Même grappe : pas d'empilement, seule la remontée recule.
    return { state: { kind: 'held', since: s.since, releaseAt }, cmd: { t: 'duck-extend', releaseAt } }
  }
  // Au repos, ou pendant la remontée : nouvelle descente depuis le niveau courant.
  return { state: { kind: 'held', since: now, releaseAt }, cmd: { t: 'duck-down', at: now, releaseAt } }
}
