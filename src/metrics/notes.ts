// Notes d'état par tick : ce qu'une mesure doit lire dans le monde (positions, point visé, rangs) au tick d'un
// évènement, et qu'un évènement seul ne porte pas. Calculées sur la transition (monde d'avant, commandes
// appliquées, monde d'après), par le banc à chaque step et par la télémétrie humaine au rejeu (C7).
import type { Creature, FamilyKind, PlayerCommands, SimEvent, Vec2, World } from '../sim/index'
import { voicesByRank } from './series'

// Paramètres de mesure fixés par les contrats.
export const AIM_BODY_M = 1.5 // B1.O7 : point visé à 1,5 m ou moins du corps
export const F_DEAD_M = 1.0 // B2.O8a : un mort à 1,0 m ou moins du point visé
export const PROBE_DEAD_M = 0.6 // B2.O8b : un mort à 0,6 m ou moins du point visé
export const PROBE_ALIVE_M = 2.5 // B2.O8b : aucune créature non morte à 2,5 m ou moins du point visé
export const F_NEAR_M = 2.5 // B2.O8c : F pressée à 2,5 m ou moins du Résistant

export type DeathCause = 'achevement' | 'sentence' | 'union' | 'variant-b'

export type TickNote =
  // Une note par `fell` : famille et statut au moment de la chute (B4.O4, B2.O8c).
  | {
      readonly kind: 'chute'
      readonly tick: number
      readonly id: number
      readonly family: FamilyKind | null
      readonly resistant: boolean
    }
  // Une note par `death`. enCombat et visee : B1.O7 et O8. rang et vocalisentAvant : B5.O10, lus au tick t_d − 1.
  | {
      readonly kind: 'mort'
      readonly tick: number
      readonly id: number
      readonly by: DeathCause
      readonly enCombat: boolean
      readonly visee: boolean
      readonly rang: number | null
      readonly vocalisentAvant: number
    }
  // `sentence-none` (F sans cible) avec un mort près du point visé : B2.O8a.
  | { readonly kind: 'f-vide'; readonly tick: number; readonly mortProche: boolean }
  // Début d'une Frappe (`player-impact` de source frappe) : frappe de sondage de B2.O8b.
  | { readonly kind: 'frappe'; readonly tick: number; readonly sondage: boolean }
  // F pressée avec des Résistants à terre à 2,5 m ou moins du joueur : B2.O8c.
  | { readonly kind: 'f'; readonly tick: number; readonly resistantsProches: readonly number[] }

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z)

const byId = (w: World, id: number): Creature | undefined => w.creatures.find((c) => c.id === id)

// B4 : T0 est le premier tick qui porte une alerte ou un impact du joueur touchant une créature.
export const isEngagement = (e: SimEvent): boolean =>
  e.type === 'alert' ||
  (e.type === 'player-impact' &&
    e.debout.length + e.abattusOrd.length + e.abattusRes.length + e.mortsDansZone > 0)

// B1.O7 : visée = Sentence ; ou Achèvement avec le point visé à 1,5 m ou moins du corps et strictement plus près du
// corps que de toute créature Hostile (sans Hostile, seule la distance compte : B1.O8).
const aimedAt = (next: World, aim: Vec2, body: Creature): boolean => {
  const dBody = dist(aim, body.pos)
  if (dBody > AIM_BODY_M) return false
  return next.creatures.every((c) => c.state.kind !== 'hostile' || dist(aim, c.pos) > dBody)
}

// Point visé d'une Sentence : celui de la commande du tick, ou celui de la commande mise en attente (tampon).
const sentenceAim = (prev: World, cmds: PlayerCommands): Vec2 =>
  cmds.sentence ? cmds.aim : (prev.player.buffer?.aim ?? cmds.aim)

export const tickNotes = (prev: World, cmds: PlayerCommands, next: World): TickNote[] => {
  const notes: TickNote[] = []
  const tick = next.tick
  let ranksBefore: ReturnType<typeof voicesByRank> | null = null
  for (const e of next.events) {
    if (e.type === 'fell') {
      const c = byId(next, e.id)
      notes.push({
        kind: 'chute',
        tick,
        id: e.id,
        family: c?.family ?? null,
        resistant: c?.resistant ?? false,
      })
    } else if (e.type === 'death') {
      const body = byId(next, e.id)
      const given = e.by === 'achevement' || e.by === 'sentence'
      ranksBefore ??= voicesByRank(prev)
      const ranks = ranksBefore
      const r = ranks.findIndex((v) => v.id === e.id)
      notes.push({
        kind: 'mort',
        tick,
        id: e.id,
        by: e.by,
        enCombat: next.creatures.some((c) => c.state.kind === 'hostile'),
        visee: given && body !== undefined && (e.by === 'sentence' || aimedAt(next, cmds.aim, body)),
        rang: r < 0 ? null : r + 1,
        vocalisentAvant: ranks.length,
      })
    } else if (e.type === 'sentence-none') {
      const aim = sentenceAim(prev, cmds)
      notes.push({
        kind: 'f-vide',
        tick,
        mortProche: next.creatures.some((c) => c.state.kind === 'mort' && dist(c.pos, aim) <= F_DEAD_M),
      })
    } else if (e.type === 'player-impact' && e.source === 'frappe') {
      const deadNear = next.creatures.some(
        (c) => c.state.kind === 'mort' && dist(c.pos, cmds.aim) <= PROBE_DEAD_M,
      )
      const aliveNear = next.creatures.some(
        (c) => c.state.kind !== 'mort' && dist(c.pos, cmds.aim) <= PROBE_ALIVE_M,
      )
      notes.push({ kind: 'frappe', tick, sondage: deadNear && !aliveNear })
    }
  }
  if (cmds.sentence) {
    const near = next.creatures
      .filter((c) => c.state.kind === 'abattu' && c.resistant && dist(c.pos, next.player.pos) <= F_NEAR_M)
      .map((c) => c.id)
    if (near.length > 0) notes.push({ kind: 'f', tick, resistantsProches: near })
  }
  return notes
}
