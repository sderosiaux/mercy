// Attribution des 24 emplacements de voix (§19, L2 cas limites, B5.O8). Logique pure, testée sans son.
//
// Règle :
// - les 24 corps qui vocalisent les plus proches de l'auditeur (rang 1 à 24) ont droit à une voix ;
// - une voix déjà tenue reste à son corps tant qu'il garde un rang ≤ 28 (marge de B5.O8 c), sauf si un corps
//   des 24 premiers a besoin de l'emplacement et qu'aucun emplacement en fondu ne lui est déjà promis : on vole
//   alors la voix du plus mauvais rang hors des 24 ;
// - au-delà du rang 28, la voix est volée ;
// - une voix volée finit en fondu (§19) : l'emplacement reste occupé jusqu'à la fin du fondu, et le corps
//   qui l'attend la reçoit au premier tick où l'emplacement est libre.
// Les rangs 21 à 24 servent de zone d'approche : un corps qui y entre déclenche le vol plusieurs ticks avant
// d'atteindre les 20 premiers, que B5.O8 (c) garantit à 8 ticks près.
import type { EntityId, Tick } from '../sim/index'
import { MAX_HELD_RANK, VOICE_SLOTS } from './constants'

export type Slot =
  | { readonly kind: 'free' }
  | { readonly kind: 'voice'; readonly id: EntityId }
  | { readonly kind: 'ending'; readonly id: EntityId; readonly freeAt: Tick } // fin en cours, libre à freeAt

export interface Ranked {
  readonly id: EntityId
  readonly rank: number // 1 = le plus proche ; égalité de distance départagée par l'id croissant
}

export interface Allocation {
  readonly assign: readonly { readonly id: EntityId; readonly slot: number }[]
  readonly steal: readonly { readonly id: EntityId; readonly slot: number }[]
}

export const emptySlots = (): readonly Slot[] => Array.from({ length: VOICE_SLOTS }, () => ({ kind: 'free' }))

export const isFree = (s: Slot, tick: Tick): boolean =>
  s.kind === 'free' || (s.kind === 'ending' && tick >= s.freeAt)

// `slots` doit déjà refléter les fins de ce tick (morts, relèvements, absorptions…) : seules les voix encore
// tenues par un corps qui vocalise sont présentes en `voice`.
export const allocate = (ranked: readonly Ranked[], slots: readonly Slot[], tick: Tick): Allocation => {
  const rankOf = new Map(ranked.map((r) => [r.id, r.rank]))
  const slotOf = new Map<EntityId, number>()
  slots.forEach((s, i) => {
    if (s.kind === 'voice') slotOf.set(s.id, i)
  })
  const steal: { id: EntityId; slot: number }[] = []
  const stolen = new Set<EntityId>()

  // Voix tenues trop loin : volées.
  for (const [id, slot] of slotOf) {
    if ((rankOf.get(id) ?? Number.POSITIVE_INFINITY) > MAX_HELD_RANK) {
      steal.push({ id, slot })
      stolen.add(id)
    }
  }

  const free = slots.map((s, i) => (isFree(s, tick) ? i : -1)).filter((i) => i >= 0)
  const assign: { id: EntityId; slot: number }[] = []
  const wanting = ranked.filter((r) => r.rank <= VOICE_SLOTS && !slotOf.has(r.id))
  // Voix volables pour un corps des 24 premiers : tenues hors des 24, plus mauvais rang d'abord.
  const victims = [...slotOf.entries()]
    .filter(([id]) => !stolen.has(id) && (rankOf.get(id) ?? 0) > VOICE_SLOTS)
    .sort((a, b) => (rankOf.get(b[0]) ?? 0) - (rankOf.get(a[0]) ?? 0) || b[0] - a[0])
  // Emplacements en fin de fondu : ils serviront les corps en attente, inutile de voler une voix de plus pour eux.
  let pending = slots.filter((s) => s.kind === 'ending' && !isFree(s, tick)).length
  for (const w of wanting) {
    const slot = free.shift()
    if (slot !== undefined) {
      assign.push({ id: w.id, slot })
      continue
    }
    if (pending > 0) {
      pending--
      continue
    }
    const v = victims.shift()
    if (v) {
      steal.push({ id: v[0], slot: v[1] })
      stolen.add(v[0])
    }
  }
  return { assign, steal }
}

// Rangs des corps qui vocalisent : distance à l'auditeur, puis id croissant (B5 « Définitions communes »).
export const rankBodies = (
  bodies: readonly { readonly id: EntityId; readonly dist: number }[],
): readonly (Ranked & { readonly dist: number })[] =>
  [...bodies]
    .sort((a, b) => a.dist - b.dist || a.id - b.id)
    .map((b, i) => ({ id: b.id, dist: b.dist, rank: i + 1 }))
