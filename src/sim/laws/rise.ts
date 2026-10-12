// L3 Relèvement et Cicatrices.
import { baseChair, chairMaxFor, crying, type Draft, emit, interrupt, type MCreature } from '../draft'
import { TUNING } from '../tuning'

export const rise = (d: Draft, c: MCreature, cause: 'delai' | 'priere' | 'chirurgien'): void => {
  if (c.state.kind !== 'abattu') return
  if (crying(c, d.tick)) emit(d, { type: 'cry-stop', tick: d.tick, id: c.id, cause: 'rise' })
  const cic = Math.min(3, c.cicatrices + 1) as 0 | 1 | 2 | 3
  c.cicatrices = cic
  c.resistant = cic >= 3
  c.chairMax = chairMaxFor(baseChair(d, c), cic)
  c.chair = c.chairMax
  c.limbs = c.limbs.map((l) => ({ ...l, hp: l.hpMax, state: 'ok' }))
  // Une canalisation commencée à terre (prière du Confesseur) continue debout ; toute autre action s'arrête.
  if (c.action && c.action.kind !== 'canalisation') interrupt(d, c, 'creature')
  // Déjà Hostile : pas de nouveau pivot de tête.
  c.state = { kind: 'hostile', alertedAt: d.tick - TUNING.alertTurnTicks }
  emit(d, { type: 'rise', tick: d.tick, id: c.id, cicatrices: cic, cause })
}

// Un corps réservé ne se relève pas et son télégraphe ne part pas (riseTick l'ignore). Quand la réservation tombe
// alors que l'heure du Relèvement est passée ou à moins de 1,5 s, le Relèvement est reporté : le télégraphe part
// au tick même (riseTick passe après tout ce qui libère un corps) et précède toujours le Relèvement (L3).
export const releaseClaim = (d: Draft, c: MCreature): void => {
  if (c.state.kind !== 'abattu' || c.state.claimedBy === null) return
  const earliest = d.tick + TUNING.relevementTelegraph
  const riseAt = c.state.riseAt !== null && c.state.riseAt < earliest ? earliest : c.state.riseAt
  c.state = { ...c.state, claimedBy: null, riseAt }
}

export const riseTick = (d: Draft): void => {
  for (const c of d.creatures) {
    if (c.state.kind !== 'abattu' || c.state.riseAt === null || c.state.claimedBy !== null) continue
    if (d.tick === c.state.riseAt - TUNING.relevementTelegraph) {
      emit(d, { type: 'rise-telegraph', tick: d.tick, id: c.id })
    }
    if (d.tick >= c.state.riseAt) rise(d, c, 'delai')
  }
}
