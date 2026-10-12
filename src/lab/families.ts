// Registre du laboratoire. Seul le Souriant est écrit dans ce worktree ; le rendu ne dépend que de la famille, de
// l'état et de familyData, donc les autres familles sont des doublures de src/sim/testing.ts sans comportement de
// jeu propre. À l'intégration, remplacer ce registre par celui de src/sim/families/registry.ts.
import { type FamilyModule, type FamilyRegistry, souriant } from '../sim/index'
import { mannequin, poteau } from '../sim/testing'

// Doublure du Confesseur : prie sans fin, debout ou à terre, sans jamais relever personne (résolution vide).
const confesseur: FamilyModule = {
  ...mannequin({ channel: true, support: true }),
  kind: 'confesseur',
  size: 'small',
  base: { chair: 40, speed: 0, limbs: [] },
  canActWhileDown: true,
}

export const LAB_FAMILIES: FamilyRegistry = {
  souriant,
  recousu: mannequin(),
  confesseur,
  porteur: { ...poteau, kind: 'porteur' },
  chirurgien: { ...poteau, kind: 'chirurgien' },
}

// Variante inerte : un Confesseur qui ne prie pas (scènes S1, où il est mort, et S1e, où il doit rester à terre).
export const LAB_FAMILIES_QUIET: FamilyRegistry = { ...LAB_FAMILIES, confesseur: poteau }
