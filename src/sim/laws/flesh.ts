// L1 Chair et Abattu : à 0 de Chair, la créature tombe. Elle ne meurt pas.
import {
  type Draft,
  emit,
  familyOf,
  interrupt,
  isPresent,
  type MCreature,
  nearestWithin,
  radiusOf,
} from '../draft'
import { TUNING } from '../tuning'
import { dist, moveToward } from '../vec'

export const fall = (d: Draft, c: MCreature, by: 'player' | 'burst' | 'creature'): void => {
  if (c.state.kind !== 'rituel' && c.state.kind !== 'hostile') return
  interrupt(d, c, by)
  c.chair = 0
  const isMembre = c.family === 'membre'
  c.state = {
    kind: 'abattu',
    since: d.tick,
    riseAt: isMembre
      ? null
      : d.tick + (c.resistant ? TUNING.relevementResistant : TUNING.relevementOrdinaire),
    cryAt: isMembre ? null : d.tick + TUNING.criDelai,
    claimedBy: null,
  }
  emit(d, { type: 'fell', tick: d.tick, id: c.id })
}

// Un Abattu (hors Membre errant) rampe vers le support non mort le plus proche à moins de 12 m, même à terre (D13).
export const crawlTick = (d: Draft): void => {
  const step = TUNING.abattuCrawl / 60
  for (const c of d.creatures) {
    if (c.state.kind !== 'abattu' || c.state.claimedBy !== null || c.family === 'membre') continue
    const target = nearestWithin(
      d,
      c.pos,
      TUNING.supportRadius,
      (o) => o.id !== c.id && isPresent(o) && familyOf(d, o).isSupport,
    )
    if (!target) continue
    const contact = radiusOf(c) + radiusOf(target)
    if (dist(c.pos, target.pos) <= contact) continue
    c.pos = moveToward(c.pos, target.pos, step)
  }
}
