// L7 Indifférence : seuls les dégâts, la proximité et le bruit réveillent. Jamais la vue.
import { alert, type Draft } from '../draft'
import { TUNING } from '../tuning'
import { dist } from '../vec'

export const proximityTick = (d: Draft): void => {
  for (const c of d.creatures) {
    if (c.state.kind === 'rituel' && dist(c.pos, d.player.pos) <= TUNING.alertProximity)
      alert(d, c, 'proximity')
  }
}

export const noise = (
  d: Draft,
  center: { x: number; z: number },
  radius: number,
  cause: 'burst' | 'bark',
): void => {
  for (const c of d.creatures) {
    if (c.state.kind === 'rituel' && dist(c.pos, center) <= radius) alert(d, c, cause)
  }
}

export const canDecide = (
  c: { state: { kind: string; alertedAt?: number }; stunnedUntil: number },
  tick: number,
) =>
  c.state.kind === 'hostile' &&
  tick >= (c.state.alertedAt ?? 0) + TUNING.alertTurnTicks &&
  tick >= c.stunnedUntil
