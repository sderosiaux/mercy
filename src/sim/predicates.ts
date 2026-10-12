// Prédicats partagés entre le cœur, les familles et les bots, pour qu'ils ne divergent jamais. Une famille anticipe
// ce que le cœur acceptera en lisant le même prédicat que lui. Aucune dépendance au brouillon (draft.ts) : ils
// lisent le monde en lecture seule.
import { TUNING } from './tuning'
import type { Action, Creature, EntityId, Tick, Vec2 } from './types'
import { angleDiff, angleOf } from './vec'

export const PORTEUR_STAGE_KEY = 'stade'
export const CHANNEL_ACTIONS: ReadonlySet<string> = new Set(['priere', 'recoudre', 'assembler'])

// Arc arrière du Porteur (§8.10) : 120° centrés sur son dos.
export const inPorteurRearArc = (porteur: Creature, pos: Vec2): boolean =>
  angleDiff(angleOf(porteur.pos, pos), porteur.facing + Math.PI) <=
  (TUNING.porteur.rearArcDeg * Math.PI) / 360

export const voiceSeed = (seed: number, id: number): number =>
  (Math.imul(seed ^ 0x9e3779b9, 2654435761) ^ Math.imul(id, 2246822519)) >>> 0

// Abattu ordinaire libre : ni réservé (opération, Sentence), ni Résistant, ni Membre errant.
const freeOrdinaryBody = (c: Creature): boolean =>
  c.state.kind === 'abattu' && c.state.claimedBy === null && !c.resistant && c.family !== 'membre'

// Ce que le sac d'un Porteur peut prendre (§8.10, §26) : effet `absorb` du cœur et choix du Porteur.
export const absorbableBody = freeOrdinaryBody

// Ce que relève une prière ordinaire (§8.10, D3) : effet `raise` du cœur et liste du Confesseur.
export const raisableByPrayer = freeOrdinaryBody

// Un Abattu qu'un opérateur peut prendre : libre, ou déjà réservé par lui.
export const freeForOperator = (c: Creature, op: EntityId): boolean =>
  c.state.kind === 'abattu' && (c.state.claimedBy === null || c.state.claimedBy === op)

// Corps qu'un Chirurgien peut assembler (§8.10) : effet `assemble` du cœur et choix du Chirurgien.
export const assemblableBy = (c: Creature, op: EntityId): boolean =>
  freeForOperator(c, op) && !c.resistant && c.family !== 'membre'

// L7 : un Hostile décide une fois le pivot de tête fini, hors vacillement.
export const canDecide = (
  c: { state: { kind: string; alertedAt?: number }; stunnedUntil: number },
  tick: Tick,
): boolean =>
  c.state.kind === 'hostile' &&
  tick >= (c.state.alertedAt ?? 0) + TUNING.alertTurnTicks &&
  tick >= c.stunnedUntil

// Une créature sans action en cours que le cœur laisse décider : Hostile libre, ou Abattue non réservée et non
// vacillante pour une famille qui agit à terre (`canActWhileDown`).
export const freeToDecide = (c: Creature, tick: Tick, canActWhileDown: boolean): boolean =>
  c.state.kind === 'abattu'
    ? canActWhileDown && c.state.claimedBy === null && tick >= c.stunnedUntil
    : canDecide(c, tick)

// Le cœur retire une action au tick de sa fin, après sa résolution éventuelle.
export const actionEnded = (a: Action, tick: Tick): boolean => tick >= a.end

// Bornes de l'arène pour un corps de rayon `r`.
export const clampToArena = (p: Vec2, r: number): Vec2 => {
  const h = TUNING.arenaHalf - r
  return { x: Math.max(-h, Math.min(h, p.x)), z: Math.max(-h, Math.min(h, p.z)) }
}
