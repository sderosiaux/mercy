// Prédicats partagés entre la simulation et les bots, pour qu'ils ne divergent jamais.
import { TUNING } from './tuning'
import type { Creature, Vec2 } from './types'
import { angleDiff, angleOf } from './vec'

export const PORTEUR_STAGE_KEY = 'stade'
export const CHANNEL_ACTIONS: ReadonlySet<string> = new Set(['priere', 'recoudre', 'assembler'])

// Arc arrière du Porteur (§8.10) : 120° centrés sur son dos.
export const inPorteurRearArc = (porteur: Creature, pos: Vec2): boolean =>
  angleDiff(angleOf(porteur.pos, pos), porteur.facing + Math.PI) <=
  (TUNING.porteur.rearArcDeg * Math.PI) / 360

export const voiceSeed = (seed: number, id: number): number =>
  (Math.imul(seed ^ 0x9e3779b9, 2654435761) ^ Math.imul(id, 2246822519)) >>> 0
