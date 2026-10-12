// API publique de la simulation, figée en fin de phase B (.mercy/plan.md).

import { hashValue } from './hash'
import { sentenceTargetOf } from './player/bourreau'
import type { Action, ActionPhase, PlayerCommands, Tick, Variant, Vec2, World } from './types'

export { datan2, dcos, dhypot, dpowInt, dsin } from './dmath'
export { souriant } from './families/souriant'
export { CHANNEL_ACTIONS, CONFESSEUR_INVECTIVE_KEY, inPorteurRearArc, PORTEUR_STAGE_KEY } from './predicates'
export { TICK_HZ, TUNING, ticks } from './tuning'
export * from './types'
export { createWorld, step } from './world'

// Variante du jeu (§27) : B, retenue par le concepteur le 2026-10-12. A reste jouable sur demande explicite. Le banc
// des bots n'en dépend pas : ses parties nomment toujours leur variante.
export const DEFAULT_VARIANT: Variant = 'B'

// Variante demandée (paramètre d'URL, panneau de dev) ; absente ou inconnue : celle du jeu.
export const variantOrDefault = (v: string | null | undefined): Variant =>
  v === 'A' || v === 'B' ? v : DEFAULT_VARIANT

export const hashWorld = (w: World): string => {
  const { families: _f, events: _e, ...state } = w
  return hashValue(state)
}

export const sentenceTarget = (w: World, aim: Vec2): number | null => sentenceTargetOf(w, aim)

export const actionPhase = (a: Action, tick: Tick): ActionPhase =>
  a.kind === 'canalisation'
    ? 'canalisation'
    : tick < a.activeAt
      ? 'telegraphe'
      : tick === a.activeAt
        ? 'active'
        : 'recuperation'

export const voiceSeed = (w: World, id: number): number => voiceSeedOf(w.seed, id)

import { voiceSeed as voiceSeedOf } from './predicates'

export const IDLE_COMMANDS: PlayerCommands = {
  move: { x: 0, z: 0 },
  aim: { x: 1, z: 0 },
  strike: false,
  dodge: false,
  sentence: false,
  rite: null,
  swapWeapon: false,
}
export { FAMILIES } from './families/registry'
