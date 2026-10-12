// Logique pure de couleur : ce qu'un corps montre selon son état (§7 L1, L3, L4 ; §17 ; §21 ; D13),
// la couleur d'un télégraphe selon les ticks restants (§18), la lueur du sac du Porteur (§8.10, §17).
// Toutes les fonctions prennent l'horloge de rendu t en ticks (tick + alpha), jamais l'horloge murale.
import { type Creature, TICK_HZ } from '../sim/index'
import { RENDER } from './constants'
import { mixHex, PALETTE } from './palette'

export type BodyClass = 'debout' | 'abattu' | 'resistant' | 'mort' | 'absorbe'

export const bodyClass = (c: Creature): BodyClass => {
  switch (c.state.kind) {
    case 'rituel':
    case 'hostile':
      return 'debout'
    case 'abattu':
      return c.resistant ? 'resistant' : 'abattu'
    case 'absorbe':
      return 'absorbe'
    case 'mort':
      return 'mort'
  }
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))

// Battement du liseré : sinusoïde à 1 Hz, au creux à l'instant de la chute.
export const pulse = (t: number, since: number): number =>
  0.5 - 0.5 * Math.cos((2 * Math.PI * RENDER.lisereHz * (t - since)) / TICK_HZ)

// Un mort placé (scène de test D12, chargement de sauvegarde §22) n'a pas eu de coup fatal à l'écran : il est
// déjà gris. Un mort donné en jeu passe au gris en 0,3 s à partir du tick de sa mort (L4).
export const greyMix = (c: Creature, t: number): number => {
  if (c.state.kind !== 'mort') return 0
  if (c.spawn?.state === 'mort') return 1
  return clamp01((t - c.state.at) / RENDER.grisTicks)
}

export interface Rim {
  readonly color: number
  readonly strong: boolean // ciblé par la Sentence : liseré intensifié (§21)
}

// Liseré : seulement sur un Abattu. Ivoire pour un ordinaire, or pour un Résistant ; il s'éteint à la mort.
export const rimOf = (c: Creature, t: number, targeted: boolean): Rim | null => {
  if (c.state.kind !== 'abattu') return null
  const tones = c.resistant ? PALETTE.or : PALETTE.ivoire
  if (targeted) return { color: tones.crete, strong: true }
  return { color: mixHex(tones.creux, tones.crete, pulse(t, c.state.since)), strong: false }
}

export type GreyTone = 'normal' | 'clair' | 'sombre'

const GREY: Record<GreyTone, number> = {
  normal: PALETTE.gris.cadaverique,
  clair: PALETTE.gris.cadaveriqueClair,
  sombre: PALETTE.gris.cadaveriqueSombre,
}

// Couleur d'une partie du corps : sa couleur vivante, ramenée au gris cadavérique selon greyMix.
export const tone = (living: number, grey: number, greyTone: GreyTone = 'normal'): number =>
  grey <= 0 ? living : mixHex(living, GREY[greyTone], grey)

// Marques dorées d'un Résistant : or tant qu'il vit, gris avec le reste du corps à la mort (D13).
export const marksOf = (c: Creature, grey: number): number | null =>
  c.resistant ? tone(PALETTE.or.base, grey, 'normal') : null

// Télégraphe au sol : rouge brun, puis rouge vif pendant les 12 derniers ticks avant l'impact (§18).
export const telegraphColor = (ticksRemaining: number): number =>
  ticksRemaining <= RENDER.rougeVifTicks ? PALETTE.rougeVif : PALETTE.rougeBrun.telegraphe

// Lueur du sac du Porteur selon son stade (0 à 3) ; rouge vif au stade 3 (§17).
export const sacColor = (stage: number): number => {
  if (stage >= 3) return PALETTE.rougeVif
  if (stage <= 0) return PALETTE.chair.sac
  return mixHex(PALETTE.chair.sac, PALETTE.chair.sacLueur, stage / 2)
}

// Décalque de sang : rouge vif pendant 2 s, puis rouge brun (§17).
export const decalColor = (age: number): number =>
  age < RENDER.sangFraisTicks ? PALETTE.rougeVif : PALETTE.rougeBrun.sangAncien
