// L4 La Mort et L5 Union. Seul le joueur appelle kill() directement (Achèvement, Sentence, variante B) ;
// L5 propage cette mort aux parties.
import { crying, type Draft, emit, type MCreature } from '../draft'

export type DeathCause = 'achevement' | 'sentence' | 'union' | 'variant-b'

export const kill = (d: Draft, c: MCreature, by: DeathCause): void => {
  if (c.state.kind === 'mort') return
  if (crying(c, d.tick)) emit(d, { type: 'cry-stop', tick: d.tick, id: c.id, cause: 'death' })
  c.state = { kind: 'mort', at: d.tick }
  c.action = null
  emit(d, { type: 'death', tick: d.tick, id: c.id, by })
  // L5 : une créature et ses parties partagent une seule mort, dans la même image.
  for (const part of d.creatures) {
    if (part.unionOf === c.id && part.state.kind !== 'mort') kill(d, part, 'union')
  }
}
