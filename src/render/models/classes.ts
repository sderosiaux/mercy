// Décalage des classes réservées (§17, §30.10, ART_DIRECTION « les sens de jeu passent avant le réalisme ») : les
// matières des modèles qui, éclairées et étalonnées, se liraient comme le gris des morts, l'ivoire ou l'or du
// liseré, sont déplacées par le rendu juste assez pour sortir de la classe. La seule source de couleur est la
// palette : la cible est la chair vivante des modèles (PALETTE.chairModele), modulée par la luminance relative du
// texel (le détail de la texture reste, la couleur moyenne du corps devient celle de la palette).
//
// Deux poussées, dans l'albédo (linéaire), de force 0 à 1 :
// - gris → chair : un texel terne (saturation faible) va vers la chair de la famille. Un vivant ne se lit jamais
//   gris (B2.O1 : C* médian du corps ≥ 15 à l'écran ; l'étalonnage désature les tons ternes, §17) ;
// - ivoire, or → chair : un texel jaune pâle ou doré (masque de porcelaine, chasuble dorée) va vers la même cible.
// Les forces sont les plus petites qui gardent B2.O1 avec une marge d'au moins 1 (S1a, S1e) : voir le rapport.
import { Color } from 'three'
import { PALETTE } from '../palette'

export interface ClassShift {
  readonly tint: number // couleur de la palette vers laquelle on déplace
  readonly gris: number // force de la poussée hors du gris (0 à 1)
  readonly jaune: number // force de la poussée hors de l'ivoire et de l'or (0 à 1)
}

export const NO_SHIFT: ClassShift = { tint: PALETTE.technique.neutre, gris: 0, jaune: 0 }

// Par personnage (forme, E2). Le Bourreau n'est pas une créature (pas de B2.O1) : seulement hors de l'ivoire, de l'or
// et du gris (audit §30.10).
export const CLASS_SHIFTS: Readonly<Record<string, ClassShift>> = {
  souriant: { tint: PALETTE.chairModele.souriant, gris: 0.55, jaune: 0.55 },
  recousu: { tint: PALETTE.chairModele.recousu, gris: 0.6, jaune: 0.6 },
  porteur: { tint: PALETTE.chairModele.porteur, gris: 0.7, jaune: 0.7 },
  confesseur: { tint: PALETTE.chairModele.confesseur, gris: 0.3, jaune: 0.3 },
  chirurgien: { tint: PALETTE.chairModele.chirurgien, gris: 0.6, jaune: 0.6 },
  bourreau: { tint: PALETTE.bourreau.cuir, gris: 0.5, jaune: 0.8 },
}

// Instrument (captures avant / après, réglage) : `decalage=0` (aucun décalage), `decalage=0.8` (même force pour tous)
// ou `decalage=souriant:0.7;recousu:1` (par personnage ; les autres gardent leur réglage).
export const parseShiftOverride = (p: string | null): ((id: string) => number | null) => {
  if (p === null) return () => null
  if (Number.isFinite(Number(p))) return () => Number(p)
  const m = new Map(
    p
      .split(';')
      .map((kv) => kv.split(':'))
      .filter((kv) => kv.length === 2 && Number.isFinite(Number(kv[1])))
      .map((kv) => [kv[0] as string, Number(kv[1])]),
  )
  return (id) => m.get(id) ?? null
}

export const shiftFor = (id: string, override: number | null): ClassShift => {
  const s = CLASS_SHIFTS[id] ?? NO_SHIFT
  return override === null ? s : { ...s, gris: s.gris > 0 ? override : 0, jaune: s.jaune > 0 ? override : 0 }
}

// La cible d'un texel déplacé : la couleur de chair de la palette (teinte et luminance moyenne, comme les corps du
// jalon 1), modulée par la luminance relative du texel (l / moyenne de la texture) : le détail reste, la couleur
// moyenne du corps devient celle de la palette.
export const CLASS_SHIFT_GLSL = /* glsl */ `
uniform vec3 uShiftTint;
uniform float uShiftGris;
uniform float uShiftJaune;
uniform float uShiftMeanLum;
vec3 e2ClassShift( vec3 c ) {
  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  float mx = max( c.r, max( c.g, c.b ) );
  float mn = min( c.r, min( c.g, c.b ) );
  float sat = ( mx - mn ) / max( mx, 1e-4 );
  // Terne : peu saturé (le gris des morts, et ce que l'étalonnage désature).
  float terne = 1.0 - smoothstep( 0.55, 0.9, sat );
  // Jaune : teinte (en sRGB approché) entre l'orange et le jaune, celle de l'ivoire jauni (46°) et de l'or terni
  // (40°) ; une chair rose (10 à 20°) n'est pas touchée.
  vec3 s = pow( max( c, vec3( 0.0 ) ), vec3( 1.0 / 2.2 ) );
  float smx = max( s.r, max( s.g, s.b ) );
  float smn = min( s.r, min( s.g, s.b ) );
  float hue = ( s.r >= smx && smx > smn ) ? 60.0 * ( s.g - s.b ) / ( smx - smn ) : -1.0;
  float ssat = ( smx - smn ) / max( smx, 1e-4 );
  float jaune = smoothstep( 26.0, 34.0, hue ) * ( 1.0 - smoothstep( 70.0, 80.0, hue ) ) * smoothstep( 0.12, 0.25, ssat );
  float k = clamp( uShiftGris * terne + uShiftJaune * jaune, 0.0, 1.0 );
  vec3 target = uShiftTint * clamp( l / max( uShiftMeanLum, 1e-3 ), 0.3, 2.0 );
  return mix( c, target, k );
}
`

export const classShiftUniforms = (s: ClassShift, meanLum: number): Record<string, { value: unknown }> => ({
  uShiftTint: { value: new Color(s.tint) },
  uShiftGris: { value: s.gris },
  uShiftJaune: { value: s.jaune },
  uShiftMeanLum: { value: meanLum },
})
