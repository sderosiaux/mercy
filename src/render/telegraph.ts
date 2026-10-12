// Zones peintes au sol pendant un télégraphe (§18, §30.13) : la forme est la zone réelle que la simulation frappera,
// lue dans les effets que la famille renvoie pour cette action (resolve est pur : il ne modifie pas le monde). Une
// famille qui ne donne pas de zone retombe sur la portée et l'arc déclarés de l'action.
import { actionPhase, type Creature, TICK_HZ, type World } from '../sim/index'
import { RENDER } from './constants'

export type Zone =
  | { readonly kind: 'circle'; readonly x: number; readonly z: number; readonly r: number }
  | {
      readonly kind: 'cone'
      readonly x: number
      readonly z: number
      readonly facing: number
      readonly reach: number
      readonly arcDeg: number
    }

export const telegraphZones = (c: Creature, w: World, t: number): Zone[] => {
  const a = c.action
  if (a?.kind !== 'attaque') return []
  if (c.state.kind !== 'hostile' && c.state.kind !== 'rituel') return []
  if (actionPhase(a, Math.floor(t)) !== 'telegraphe') return []
  const fam = w.families[c.family]
  const def = fam?.actions[a.name]
  const out: Zone[] = []
  try {
    for (const e of fam?.resolve(w, c, a) ?? []) {
      if (e.kind !== 'damage') continue
      const ar = e.area
      if (ar.kind === 'circle') out.push({ kind: 'circle', x: ar.center.x, z: ar.center.z, r: ar.radius })
      else
        out.push({
          kind: 'cone',
          x: ar.origin.x,
          z: ar.origin.z,
          facing: ar.facing,
          reach: ar.reach,
          arcDeg: ar.arcDeg,
        })
    }
  } catch {
    out.length = 0
  }
  if (out.length === 0 && def) {
    if (def.arcDeg !== undefined)
      out.push({
        kind: 'cone',
        x: c.pos.x,
        z: c.pos.z,
        facing: c.facing,
        reach: def.reach,
        arcDeg: def.arcDeg,
      })
    else out.push({ kind: 'circle', x: c.pos.x, z: c.pos.z, r: def.reach })
  }
  return out
}

// Pulsation du remplissage pendant les 0,2 dernières secondes (rouge vif) : le danger bat, le sang ne bat pas.
export const telegraphPulse = (ticksRemaining: number, t: number): number =>
  ticksRemaining <= RENDER.rougeVifTicks ? 0.5 + 0.5 * Math.cos((2 * Math.PI * 9 * t) / TICK_HZ) : 0
