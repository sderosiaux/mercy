// Couleurs et lumières de la scène de la galerie. Le sol et le noir viennent de la palette du jeu
// (src/render/palette.ts, lue sans être modifiée) ; les lumières de la DA n'y sont pas encore : elles sont ici,
// nommées, jusqu'à ce que le rendu les porte.
import { PALETTE } from '../../../src/render/palette'

export const SCENE = {
  sol: PALETTE.gris.pierre, // sol de l'arène de P0
  fond: PALETTE.noir, // noir profond (§17), aussi couleur du brouillard
  torche: 0xff8a3c, // flamme de torche, corps noir vers 1900 K (ART_DIRECTION : seules sources chaudes)
  lune: 0x8ea4c6, // lune froide très faible qui dessine les silhouettes (ART_DIRECTION)
  neutre: PALETTE.lumiere.neutre, // lumière neutre de B2 : sans chroma, pour juger formes et couleurs
} as const

// Intensités en candela / lux (three, rendu physique). La DA veut le noir dominant, la torche vacillante.
export const LIGHTS = {
  torche: 14,
  torcheLointaine: 5,
  lune: 0.18,
  ambianteDA: 0.06,
  neutreCiel: 1.15,
  neutreSoleil: 2.2,
  brouillardDebut: 24, // brouillard linéaire : le sujet (à 21 m sous la caméra du §20) reste net, le fond se perd
  brouillardFin: 60,
  exposition: 1.15,
} as const

// Vacillement déterministe (somme de sinus incommensurables), entre 0,7 et 1,1 : une flamme, pas un néon.
export const flicker = (t: number): number =>
  0.9 + 0.1 * Math.sin(t * 7.3) + 0.06 * Math.sin(t * 13.1 + 1.7) + 0.04 * Math.sin(t * 23.9 + 0.4)
