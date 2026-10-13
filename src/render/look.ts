// Logique pure de couleur : ce qu'un corps montre selon son état (§7 L1, L3, L4 ; §17 ; §21 ; D13),
// la couleur d'un télégraphe selon les ticks restants (§18), la lueur du sac du Porteur (§8.10, §17).
// Toutes les fonctions prennent l'horloge de rendu t en ticks (tick + alpha), jamais l'horloge murale.
import { type Creature, TICK_HZ, TUNING } from '../sim/index'
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
// déjà gris. Un mort donné en jeu passe au gris pendant son agonie (L4 : TUNING.agonie, seule source, partagée
// avec l'audio) : gris cadavérique à la fin de l'agonie.
export const agonyProgress = (c: Creature, t: number): number => {
  if (c.state.kind !== 'mort') return 0
  if (c.spawn?.state === 'mort') return 1
  return TUNING.agonie > 0 ? clamp01((t - c.state.at) / TUNING.agonie) : 1
}
export const greyMix = agonyProgress

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

const toLinear = (c8: number): number => {
  const c = c8 / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const toSrgb8 = (l: number): number => {
  const c = Math.min(1, Math.max(0, l))
  return Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055))
}
const channels = (hex: number): [number, number, number] => [
  toLinear((hex >> 16) & 255),
  toLinear((hex >> 8) & 255),
  toLinear(hex & 255),
]
const luminanceOf = (hex: number): number => {
  const [r, g, b] = channels(hex)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

// Pâleur d'un cadavre (L4, E8) : la couleur vivante perd sa couleur vers le gris cadavérique de la palette, à
// luminance égale : désaturée, ni éclaircie ni assombrie (« sans être éclaircie »). La teinte du gris vient de la
// palette (normal, clair, sombre), la luminance de la couleur vivante.
export const pallor = (living: number, greyTone: GreyTone = 'normal'): number => {
  const g = GREY[greyTone]
  const k = luminanceOf(living) / Math.max(1e-6, luminanceOf(g))
  const [r, gg, b] = channels(g)
  return (toSrgb8(r * k) << 16) | (toSrgb8(gg * k) << 8) | toSrgb8(b * k)
}

// Couleur d'une partie du corps : sa couleur vivante, ramenée à sa pâleur de cadavre selon greyMix.
export const tone = (living: number, grey: number, greyTone: GreyTone = 'normal'): number =>
  grey <= 0 ? living : mixHex(living, pallor(living, greyTone), grey)

// Marques dorées d'un Résistant : or tant qu'il vit, gris avec le reste du corps à la mort (D13).
export const marksOf = (c: Creature, grey: number): number | null =>
  c.resistant ? tone(PALETTE.or.base, grey, 'normal') : null

// Lueur du sac du Porteur selon son stade (0 à 3) ; rouge vif au stade 3 (§17).
export const sacColor = (stage: number): number => {
  if (stage >= 3) return PALETTE.rougeVif
  if (stage <= 0) return PALETTE.chair.sac
  return mixHex(PALETTE.chair.sac, PALETTE.chair.sacLueur, stage / 2)
}

// Le rouge vif ne désigne que le sac au stade 3 (§17, §30.10 ; audit du §30, E5). Une lumière chaude ou rouge sur
// un albédo rouge pousse le produit vers le primaire rouge de l'écran, que la courbe ACES rend tel quel : c'est le
// rouge vif. Mesuré avant E5 : sac vide sous la chandelle du Bourreau à ΔE00 6,7 du rouge vif ; sac au stade 2 sous
// sa propre lueur à 9,4, et la chair voisine à 6,5. D'où deux règles, aux stades 0 à 2 seulement :
// - le sac ne prend des lumières que leur luminance, sa chromaticité reste la couleur du stade : mise à l'échelle
//   seule, à travers l'exposition, ACES et l'étalonnage des personnages, la couleur du stade 2 ne s'approche jamais
//   à moins de 13,7 du rouge vif (stade 1 : 18,3 ; stade 0 : 23,5) ;
// - le sac n'éclaire rien (lights.ts) : aucune teinte de la palette assez rouge pour se lire « sac » ne tient la
//   chair d'un voisin hors du rouge vif à toutes les distances.
// Au stade 3, la lumière garde sa couleur et le sac éclaire en rouge vif : c'est le danger imminent.
export const sacLuminanceOnly = (stage: number): boolean => stage < 3
export const sacCastsLight = (stage: number): boolean => stage >= 3

// Décalque de sang : rouge vif pendant 2 s, puis rouge brun (§17).
export const decalColor = (age: number): number =>
  age < RENDER.sangFraisTicks ? PALETTE.rougeVif : PALETTE.rougeBrun.sangAncien
