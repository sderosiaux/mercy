// Souriant (§8.10) : petit, rapide, en groupe. Morsure en fente quand le joueur est à portée.
import { TUNING } from '../tuning'
import type { FamilyModule } from '../types'
import { dist } from '../vec'

const M = TUNING.souriant.morsure

export const souriant: FamilyModule = {
  kind: 'souriant',
  size: 'small',
  isSupport: false,
  base: { chair: TUNING.souriant.chair, speed: TUNING.souriant.speed, limbs: [] },
  actions: {
    morsure: {
      kind: 'attaque',
      telegraphTicks: M.telegraph,
      recoverTicks: M.recover,
      reach: M.reach,
      arcDeg: M.arcDeg,
    },
  },
  decide: (world, self) =>
    dist(self.pos, world.player.pos) <= M.reach + TUNING.playerRadius
      ? { kind: 'act', action: 'morsure', target: world.player.pos }
      : { kind: 'moveTo', target: world.player.pos },
  resolve: (_world, self) => [
    {
      kind: 'damage',
      area: { kind: 'cone', origin: self.pos, facing: self.facing, reach: M.reach, arcDeg: M.arcDeg },
      amount: M.damage,
      source: 'creature',
      abatSmall: false,
      staggerLarge: 0,
      hitsCreatures: false,
    },
  ],
}
