// API publique de la simulation, figée en fin de phase B (.mercy/plan.md).

import { hashValue } from './hash'
import { sentenceTargetOf } from './player/bourreau'
import type { Action, ActionPhase, PlayerCommands, Tick, Vec2, World } from './types'

export { datan2, dcos, dhypot, dpowInt, dsin } from './dmath'
export { souriant } from './families/souriant'
export { CHANNEL_ACTIONS, inPorteurRearArc, PORTEUR_STAGE_KEY } from './predicates'
export { TICK_HZ, TUNING, ticks } from './tuning'
export * from './types'
export { createWorld, step } from './world'

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
