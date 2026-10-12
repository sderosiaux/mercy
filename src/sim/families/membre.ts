// Membre errant (§8.4) : petit Abattu ordinaire, sans voix, qui rampe vers son propriétaire. Son comportement
// vit dans anatomy.ts ; ce module ne porte que ses caractéristiques.
import type { FamilyModule } from '../types'

export const MEMBRE: FamilyModule = {
  kind: 'membre',
  size: 'small',
  isSupport: false,
  base: { chair: 1, speed: 0, limbs: [] },
  actions: {},
  decide: () => ({ kind: 'idle' }),
  resolve: () => [],
}
