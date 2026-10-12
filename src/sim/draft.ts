// État de travail d'un step. step() copie le monde dans un brouillon mutable, le fait avancer d'un tick,
// puis le rend en lecture seule. Muter ici est volontaire (boucle chaude) ; le monde d'entrée n'est jamais touché.
import { dpowInt } from './dmath'
import { MEMBRE } from './families/membre'
import { TUNING } from './tuning'
import type {
  Creature,
  EntityId,
  FamilyModule,
  FamilyRegistry,
  Player,
  RngState,
  SimEvent,
  Tick,
  Variant,
  Vec2,
  WaveRuntime,
} from './types'
import { dist } from './vec'

export type Mutable<T> = { -readonly [K in keyof T]: T[K] }
export type MCreature = Mutable<Creature>
export type MPlayer = Mutable<Player>

export interface Draft {
  tick: Tick
  seed: number
  rng: RngState
  variant: Variant
  player: MPlayer
  creatures: MCreature[]
  nextId: EntityId
  events: SimEvent[]
  wave: Mutable<WaveRuntime>
  families: FamilyRegistry
}

export const emit = (d: Draft, e: SimEvent): void => {
  d.events.push(e)
}

export const byId = (d: Draft, id: EntityId): MCreature | undefined => d.creatures.find((c) => c.id === id)

export const familyOf = (d: Draft, c: Creature): FamilyModule => {
  if (c.family === 'membre') return MEMBRE
  const f = d.families[c.family]
  if (!f) throw new Error(`famille absente du registre : ${c.family}`)
  return f
}

export const radiusOf = (c: Creature): number =>
  (c.size === 'small' ? TUNING.radiusSmall : TUNING.radiusLarge) *
  dpowInt(TUNING.cicatriceSizeMul, c.cicatrices)

export const isStanding = (c: Creature): boolean => c.state.kind === 'rituel' || c.state.kind === 'hostile'
export const isDown = (c: Creature): boolean => c.state.kind === 'abattu'
export const isPresent = (c: Creature): boolean => c.state.kind !== 'mort' && c.state.kind !== 'absorbe'

export const baseChair = (d: Draft, c: Creature): number =>
  c.familyData.baseChair ?? familyOf(d, c).base.chair
export const chairMaxFor = (base: number, cicatrices: number): number =>
  base * dpowInt(TUNING.cicatriceChairMul, cicatrices)

export const crying = (c: Creature, tick: Tick): boolean =>
  (c.state.kind === 'abattu' || c.state.kind === 'absorbe') && c.state.cryAt !== null && c.state.cryAt <= tick

export const gainFerveur = (d: Draft, amount: number, source: string): void => {
  const before = d.player.ferveur
  d.player.ferveur = Math.min(TUNING.ferveur.max, before + amount)
  d.player.lastFerveurGain = d.tick
  emit(d, { type: 'ferveur', tick: d.tick, delta: d.player.ferveur - before, source })
}

export const heal = (d: Draft, fraction: number, source: 'sentence' | 'reset'): void => {
  const before = d.player.vie
  d.player.vie = Math.min(TUNING.vieMax, before + TUNING.vieMax * fraction)
  emit(d, { type: 'heal', tick: d.tick, amount: d.player.vie - before, source })
}

export const alert = (
  d: Draft,
  c: MCreature,
  cause: 'damage' | 'proximity' | 'cry' | 'burst' | 'bark',
): void => {
  if (c.state.kind !== 'rituel') return
  c.state = { kind: 'hostile', alertedAt: d.tick }
  emit(d, { type: 'alert', tick: d.tick, id: c.id, cause })
}

export const interrupt = (d: Draft, c: MCreature, by: 'player' | 'burst' | 'creature'): void => {
  if (!c.action) return
  emit(d, { type: 'action-interrupted', tick: d.tick, id: c.id, action: c.action.name, by })
  c.action = null
}

export const nearestWithin = (
  d: Draft,
  from: Vec2,
  radius: number,
  keep: (c: MCreature) => boolean,
): MCreature | undefined => {
  let best: MCreature | undefined
  let bestD = Number.POSITIVE_INFINITY
  for (const c of d.creatures) {
    if (!keep(c)) continue
    const dd = dist(from, c.pos)
    if (dd <= radius && dd < bestD) {
      best = c
      bestD = dd
    }
  }
  return best
}
