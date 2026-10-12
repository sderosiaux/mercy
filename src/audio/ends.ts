// Comment finit un son : agonie pour une mort donnée (la voix passe au râle, les autres sources s'éteignent, tout se
// tait à la fin de l'agonie), fondu pour tout le reste (§19, L4, principe 3).
// Logique pure : la cause se lit dans les SimEvent du tick et dans l'état du monde, jamais ailleurs.
import type { Creature, EntityId, FamilyKind, SimEvent } from '../sim/index'

export type EndCause =
  | 'mort'
  | 'relevement'
  | 'priere'
  | 'assemblage'
  | 'vol' // voix volée par le budget de 24
  | 'fin-action' // chant, scie, gargouillis, coutures : fin de la prière, de l'opération, du sac, chute
  | 'reinitialisation'
  | 'disparition' // entité retirée du monde sans autre cause connue

export type EndMode = 'agonie' | 'fade'

// La seule règle : une mort ouvre une agonie (et seule une mort donne un râle) ; toute autre fin est un fondu.
export const endModeFor = (cause: EndCause): EndMode => (cause === 'mort' ? 'agonie' : 'fade')

export const deathIdsOf = (events: readonly SimEvent[]): ReadonlySet<EntityId> =>
  new Set(events.flatMap((e) => (e.type === 'death' ? [e.id] : [])))

// Familles qui ont une voix : toutes, sauf le Membre errant (précision de phase B). Toute mort d'une créature d'une de
// ces familles donne un râle si le budget de voix le permet (décision de l'orchestrateur, 2026-10-12).
export const hasVoice = (f: FamilyKind): boolean => f !== 'membre'

// Un corps vocalise s'il est Abattu, ou absorbé dans le sac d'un Porteur (D8 : voix étouffée). Un Membre errant
// n'a pas de voix ; un corps assemblé en Recousu n'est plus un corps qui vocalise.
export const vocalising = (c: Creature, byId: ReadonlyMap<EntityId, Creature>): boolean =>
  hasVoice(c.family) &&
  (c.state.kind === 'abattu' || (c.state.kind === 'absorbe' && byId.get(c.state.into)?.family === 'porteur'))

// Cause de fin de la voix d'un corps qui avait une voix au tick précédent et n'en garde pas.
// `undefined` : la voix continue.
export const voiceEndCause = (
  id: EntityId,
  c: Creature | undefined,
  events: readonly SimEvent[],
  byId: ReadonlyMap<EntityId, Creature>,
): EndCause | undefined => {
  if (events.some((e) => e.type === 'death' && e.id === id) || c?.state.kind === 'mort') return 'mort'
  if (events.some((e) => e.type === 'reset')) return 'reinitialisation'
  if (!c) return 'disparition'
  if (vocalising(c, byId)) return undefined
  const rise = events.find((e) => e.type === 'rise' && e.id === id)
  if (rise && rise.type === 'rise') return rise.cause === 'priere' ? 'priere' : 'relevement'
  if (c.state.kind === 'absorbe') return 'assemblage'
  return 'disparition'
}

// Cause de fin d'une source hors voix (chant, scie, gargouillis, coutures) qui n'est plus voulue.
export const sourceEndCause = (
  id: EntityId,
  c: Creature | undefined,
  events: readonly SimEvent[],
): EndCause => {
  if (events.some((e) => e.type === 'death' && e.id === id) || c?.state.kind === 'mort') return 'mort'
  if (events.some((e) => e.type === 'reset')) return 'reinitialisation'
  if (!c) return 'disparition'
  return 'fin-action'
}
