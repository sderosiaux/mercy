// Matières des modèles de la Forge (E2). Un corps vivant est un maillage à squelette dans la scène éclairée
// (MeshStandardMaterial et retouches), doublé dans la couche des signaux par son liseré (coque inversée gonflée le
// long des normales de contour) et par ses marques dorées de Résistant ; chacun a sa matière d'identification
// (B2 I1), avec la même géométrie et les mêmes déplacements de sommets. Un mort est figé et cuit dans un lot
// (BatchedMesh) de la scène, gris, sous la lumière du lieu comme tout le reste (E8).
import {
  AlwaysStencilFunc,
  BackSide,
  Color,
  DoubleSide,
  FrontSide,
  MeshDepthMaterial,
  MeshStandardMaterial,
  NoBlending,
  NotEqualStencilFunc,
  ReplaceStencilOp,
  RGBADepthPacking,
  ShaderMaterial,
  type Texture,
  Vector2,
  Vector3,
  Vector4,
  type WebGLProgramParametersWithUniforms,
} from 'three'
import { overlayUniforms } from '../materials'
import { PALETTE } from '../palette'
import { SCENE_TAG } from '../post'
import { urlParam } from '../quality'
import { DEPTH_TEST_GLSL, NOISE_GLSL, SCENE_DEPTH_CALL } from '../shaders'
import { CLASS_SHIFT_GLSL, type ClassShift, classShiftUniforms, NO_SHIFT } from './classes'

// Uniformes d'une instance, partagés par toutes ses matières (mêmes objets).
export interface ModelUniforms {
  readonly uHideArms: { value: Vector2 } // (gauche, droit) : 1 = bras sectionné, absent du corps
  readonly uSacScale: { value: number }
  readonly uSacCenter: { value: Vector3 }
  readonly uSacTint: { value: Color }
  readonly uSacGlow: { value: number }
  readonly uSacLumOnly: { value: number } // 1 : la lumière ne donne au sac que sa luminance (stades 0 à 2)
  readonly uHaloTint: { value: Color }
  readonly uHaloGlow: { value: number } // 0 : halo de fer ; > 0 : prière (vert maladif)
  readonly uSeams: { value: number } // Cicatrices visibles (0 à 3)
  readonly uExtrude: { value: number } // épaisseur du liseré (m)
  readonly uRimColor: { value: Color }
  readonly uMarkColor: { value: Color }
  readonly uIdBody: { value: Vector3 }
  readonly uIdRim: { value: Vector3 }
  readonly uIdMark: { value: Vector3 }
  // Sang sur le corps (E7, §17.1) : niveaux ancien et total (0 à 1, GoreMemory.stain), poids par région, hauteur (m).
  readonly uStainOld: { value: number }
  readonly uStainAll: { value: number }
  readonly uStainWeights: { value: Vector3 } // (ailleurs, bras, tablier)
  readonly uStainHeight: { value: number }
  readonly uStainDark: { value: number } // part de noir dans le sang séché (Bourreau : fonce ; créature : rouge brun)
}

export const modelUniforms = (sacCenter: Vector3): ModelUniforms => ({
  uHideArms: { value: new Vector2(0, 0) },
  uSacScale: { value: 1 },
  uSacCenter: { value: sacCenter.clone() },
  uSacTint: { value: new Color(PALETTE.chair.sac) },
  uSacGlow: { value: 0 },
  uSacLumOnly: { value: 1 },
  uHaloTint: { value: new Color(PALETTE.vertMaladif) },
  uHaloGlow: { value: 0 },
  uSeams: { value: 0 },
  uExtrude: { value: 0.04 },
  uRimColor: { value: new Color(PALETTE.ivoire.base) },
  uMarkColor: { value: new Color(PALETTE.or.base) },
  uIdBody: { value: new Vector3() },
  uIdRim: { value: new Vector3() },
  uIdMark: { value: new Vector3() },
  uStainOld: { value: 0 },
  uStainAll: { value: 0 },
  uStainWeights: { value: new Vector3(0.85, 0.85, 0.85) },
  uStainHeight: { value: 2 },
  uStainDark: { value: 0 },
})

// ---------------------------------------------------------------------------------------------------------
// Sommets : régions (aPart, aMark, aSeams), bras sectionnés, sac qui gonfle.

const VERT_PARS = /* glsl */ `
attribute float aPart;
attribute float aMark;
attribute vec3 aSeams;
attribute vec3 aRest;
varying vec3 vRest;
uniform vec2 uHideArms;
uniform float uSacScale;
uniform vec3 uSacCenter;
varying float vHide;
varying float vPart;
varying float vMark;
varying vec3 vSeams;
`

// Après begin_vertex (transformed = position, repère du maillage au repos).
const VERT_BODY = /* glsl */ `
  vPart = aPart;
  vMark = aMark;
  vSeams = aSeams;
  vRest = aRest;
  vHide = ( abs( aPart - 1.0 ) < 0.5 ? uHideArms.x : 0.0 ) + ( abs( aPart - 2.0 ) < 0.5 ? uHideArms.y : 0.0 );
  if ( abs( aPart - 3.0 ) < 0.5 ) transformed = uSacCenter + ( transformed - uSacCenter ) * uSacScale;
`

const FRAG_PARS = /* glsl */ `
varying float vHide;
varying float vPart;
varying float vMark;
varying vec3 vSeams;
varying vec3 vRest;
`

// Sang sur un corps (E7, §17.1) : taches tirées d'un bruit dans le repère du corps au repos (coulures verticales),
// d'autant plus couvrantes que le niveau monte ; plus fortes sur les bras et le tablier du Bourreau (« son arme, son
// tablier et ses bras se tachent à chaque libération et le gardent »). Le sang des 2 dernières secondes est rouge vif
// et mouillé ; l'ancien est rouge brun foncé et mat. Un mort reste gris (matière des morts, sans taches).
const STAIN_GLSL = /* glsl */ `
uniform float uStainOld;
uniform float uStainAll;
uniform vec3 uStainWeights;
uniform float uStainHeight;
uniform float uStainDark;
${NOISE_GLSL}
// (couverture 0 à 1, frais 0 ou 1)
vec2 e7Stain() {
  if ( uStainAll <= 0.0 ) return vec2( 0.0 );
  bool arm = abs( vPart - 1.0 ) < 0.5 || abs( vPart - 2.0 ) < 0.5;
  float h = vRest.y / max( uStainHeight, 0.1 );
  float apron = smoothstep( 0.0, 0.05, vRest.z ) * smoothstep( 0.28, 0.36, h ) * ( 1.0 - smoothstep( 0.66, 0.74, h ) );
  float w = max( arm ? uStainWeights.y : uStainWeights.x, apron * uStainWeights.z );
  float n = e1Fbm( vec2( vRest.x * 6.0 + vRest.z * 4.5, vRest.y * 2.2 ) ) * 0.65
    + e1Fbm( vec2( vRest.z * 13.0 - vRest.x * 9.0, vRest.y * 9.0 + 3.7 ) ) * 0.35;
  n = smoothstep( 0.18, 0.78, n );
  float all = smoothstep( n - 0.03, n + 0.03, uStainAll * w );
  float old = smoothstep( n - 0.03, n + 0.03, uStainOld * w );
  return vec2( all, all - old > 0.5 ? 1.0 : 0.0 );
}
`

type Patch = (s: WebGLProgramParametersWithUniforms) => void

const patchVertex: Patch = (s) => {
  s.vertexShader = s.vertexShader
    .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_BODY}`)
}

// ---------------------------------------------------------------------------------------------------------
// Corps vivant (scène éclairée)

// Un corps vivant reçoit la lumière de la scène (E6, retour du concepteur : « la lumière devrait s'appliquer à lui de
// manière normale ») : le plancher de luminance de E4, qui relevait les corps dans la pénombre, est retiré, sans
// remplaçant. Reste la translucidité de la chair d'avant E4 (E2, comme les segments du jalon 1) : 7 % de l'albédo,
// la même partout. Elle est gardée parce que l'équilibre des classes réservées en dépend (§30.10, mesure E6 : sans
// elle, sous les lumières chaudes et la prière, 2 pixels « or » sur un Confesseur debout et 1 à 3 sur le Bourreau,
// contre 0 avec elle). Instrument (E6) : `translucidite=<part>` (0 : lumière de la scène seule).
export const TRANSLUCENCE_DEFAULT = 0.07
const translucenceFromUrl = Number(urlParam('translucidite') ?? Number.NaN)
const TRANSLUCENCE = Number.isFinite(translucenceFromUrl) ? translucenceFromUrl : TRANSLUCENCE_DEFAULT

export const bodyMaterial = (
  map: Texture | null,
  roughness: number,
  u: ModelUniforms,
  shift: ClassShift,
  meanLum: number,
): MeshStandardMaterial => {
  const m = new MeshStandardMaterial({ map, roughness, metalness: 0, envMapIntensity: 0.25 })
  const cs = classShiftUniforms(shift, meanLum)
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u, cs)
    patchVertex(s)
    s.fragmentShader = s.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
${FRAG_PARS}
uniform vec3 uSacTint;
uniform float uSacGlow;
uniform float uSacLumOnly;
uniform vec3 uHaloTint;
uniform float uHaloGlow;
uniform float uSeams;
${CLASS_SHIFT_GLSL}
${STAIN_GLSL}`,
      )
      .replace('void main() {', 'void main() {\n  if ( vHide > 0.5 ) discard;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
  float e2Lum = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
  diffuseColor.rgb = e2ClassShift( diffuseColor.rgb );
  bool e2Sac = abs( vPart - 3.0 ) < 0.5;
  bool e2Halo = abs( vPart - 4.0 ) < 0.5;
  // Sac : membrane terne au stade 0 ; chargé, il luit (surtout émissif, comme la lueur du jalon 1 : sa couleur ne
  // dépend pas des lumières voisines, qui la brûleraient vers l'orange).
  if ( e2Sac ) diffuseColor.rgb = uSacTint * mix( 1.0 + 1.5 * e2Lum, 0.1 + 0.1 * e2Lum, step( 0.001, uSacGlow ) );
  if ( e2Halo && uHaloGlow > 0.0 ) diffuseColor.rgb = uHaloTint * ( 0.5 + e2Lum );
  // Coutures des Cicatrices : une par Cicatrice, sombre (plaie recousue).
  float e2Seam = max( max( step( 0.5, vSeams.x ) * step( 0.5, uSeams ), step( 0.5, vSeams.y ) * step( 1.5, uSeams ) ),
    step( 0.5, vSeams.z ) * step( 2.5, uSeams ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, ${glslColor(PALETTE.chair.plaie)}, e2Seam * 0.85 );
  vec2 e7S = ( e2Sac || e2Halo ) ? vec2( 0.0 ) : e7Stain();
  vec3 e7Blood = e7S.y > 0.5 ? ${glslColor(PALETTE.rougeVif)} : mix( ${glslColor(PALETTE.rougeBrun.sangAncien)}, ${glslColor(PALETTE.rougeBrun.sangNoir)}, uStainDark );
  diffuseColor.rgb = mix( diffuseColor.rgb, e7Blood, e7S.x );`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
  roughnessFactor = mix( roughnessFactor, e7S.y > 0.5 ? 0.15 : 0.72, e7S.x );`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  ${TRANSLUCENCE > 0 ? `totalEmissiveRadiance += diffuseColor.rgb * ${TRANSLUCENCE.toFixed(4)};` : ''}
  totalEmissiveRadiance += diffuseColor.rgb * 0.12 * e7S.x * e7S.y;
  if ( e2Sac ) totalEmissiveRadiance += uSacTint * uSacGlow;
  if ( e2Halo ) totalEmissiveRadiance += uHaloTint * uHaloGlow;`,
      )
      // Masque des personnages (E3) : alpha 0 dans la scène (matière opaque, sans mélange), lu par la composition pour
      // leur laisser la couleur que l'étalonnage froid retire au décor (post.ts, LOOK.modelSaturation).
      // Sac aux stades 0 à 2 (E5) : la lumière reçue ne lui donne que sa luminance ; la chromaticité reste celle de la
      // couleur du stade (palette). Pourquoi : look.ts, sacLuminanceOnly.
      .replace(
        '#include <opaque_fragment>',
        `if ( e2Sac && uSacLumOnly > 0.5 ) {
    vec3 e5Lit = outgoingLight - totalEmissiveRadiance;
    vec3 e5Tint = uSacTint / max( dot( uSacTint, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-6 );
    outgoingLight = e5Tint * dot( e5Lit, vec3( 0.2126, 0.7152, 0.0722 ) ) + totalEmissiveRadiance;
  }
  #include <opaque_fragment>
  // Personnage (SCENE_TAG, post.ts) : 0, gardé hors du rouge vif ; 0,25 sur le sac au stade 3 (danger imminent) et
  // sur le sang des 2 dernières secondes.
  gl_FragColor.a = ( ( e2Sac && uSacLumOnly < 0.5 ) || e7S.x * e7S.y > 0.5 ) ? ${SCENE_TAG.modeleRougeVif.toFixed(2)} : ${SCENE_TAG.modele.toFixed(2)};`,
      )
  }
  m.customProgramCacheKey = () => `e2-body-${TRANSLUCENCE}`
  return m
}

// Ombre portée : mêmes déplacements, bras sectionnés absents.
export const bodyDepthMaterial = (u: ModelUniforms): MeshDepthMaterial => {
  const m = new MeshDepthMaterial({ depthPacking: RGBADepthPacking })
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u)
    patchVertex(s)
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('void main() {', 'void main() {\n  if ( vHide > 0.5 ) discard;')
  }
  m.customProgramCacheKey = () => 'e2-depth'
  return m
}

// ---------------------------------------------------------------------------------------------------------
// Couche des signaux : liseré, marques ; matières d'identification.

const OVERLAY_VERT = (extrude: boolean): string => /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
attribute vec3 aOutline;
${VERT_PARS}
uniform float uExtrude;
void main() {
  vec3 objectNormal = aOutline;
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  vec3 transformed = vec3( position );
  ${VERT_BODY}
  #include <skinning_vertex>
  ${extrude ? 'transformed += normalize( objectNormal ) * uExtrude;' : ''}
  #include <project_vertex>
}
`

// Test contre la profondeur de la scène (shaders.ts) : liseré sans tolérance (la coque n'apparaît que hors du corps),
// marques à 1 cm. La matière d'identification de chacun appelle le même test (B2 I1, arbitrage E4).
const SIGNAL_FRAG = (marks: boolean): string => /* glsl */ `
uniform vec3 uColor;
${FRAG_PARS}
${DEPTH_TEST_GLSL}
void main() {
  if ( vHide > 0.5 ) discard;
  ${marks ? `if ( vMark < 0.5 ) discard;\n  ${SCENE_DEPTH_CALL.marque}` : SCENE_DEPTH_CALL.liseré}
  gl_FragColor = vec4( uColor, 1.0 );
  #include <colorspace_fragment>
}
`

// Instrument (E5, §30.10) : `idsac=1` donne au sac du Porteur le rôle 7 dans la passe d'identification, pour mesurer
// la couleur du sac seul. Sans lui, le sac est du corps (B2). Lu au chargement du module : les outils de dev
// réécrivent l'URL au redémarrage.
export const ROLE_SAC_INSTRUMENT = 7
const ID_SAC = urlParam('idsac') === '1'
// Corps (scène) : aucun test de scène. Liseré et marques (couche des signaux) : le leur.
const ID_FRAG = (which: 'body' | 'rim' | 'mark'): string => /* glsl */ `
uniform vec3 uId;
${FRAG_PARS}
${which === 'body' ? '' : DEPTH_TEST_GLSL}
void main() {
  if ( vHide > 0.5 ) discard;
  ${which === 'mark' ? `if ( vMark < 0.5 ) discard;\n  ${SCENE_DEPTH_CALL.marque}` : ''}
  ${which === 'rim' ? SCENE_DEPTH_CALL.liseré : ''}
  gl_FragColor = vec4( uId, 1.0 );
  ${which === 'body' && ID_SAC ? `if ( abs( vPart - 3.0 ) < 0.5 ) gl_FragColor.b = ${ROLE_SAC_INSTRUMENT}.0 / 255.0;` : ''}
}
`

// Liseré (§7 L1) : couleur exacte de la palette, ni lumière ni étalonnage, testé contre la profondeur de la scène.
// Seulement hors de la silhouette du corps : le masque du corps (gabarit, valeur propre au corps) est dessiné juste
// avant, et la coque ne passe que là où il n'est pas — contour de survol à la Diablo, sans lignes intérieures.
export const rimMaterial = (u: ModelUniforms): ShaderMaterial =>
  stencilTest(
    new ShaderMaterial({
      vertexShader: OVERLAY_VERT(true),
      fragmentShader: SIGNAL_FRAG(false),
      uniforms: { ...overlayUniforms, ...u, uColor: u.uRimColor },
      side: BackSide,
    }),
  )

const stencilTest = (m: ShaderMaterial): ShaderMaterial => {
  m.stencilWrite = true // active le test
  m.stencilWriteMask = 0x00
  m.stencilFunc = NotEqualStencilFunc
  m.stencilRef = 1
  return m
}

// Masque du corps dans le gabarit (aucune couleur, aucune profondeur), pour le liseré du même corps.
export const silhouetteMaterial = (u: ModelUniforms): ShaderMaterial => {
  const m = new ShaderMaterial({
    vertexShader: OVERLAY_VERT(false),
    fragmentShader: `${FRAG_PARS}\nvoid main() {\n  if ( vHide > 0.5 ) discard;\n  gl_FragColor = vec4( 0.0 );\n}`,
    uniforms: { ...u },
    side: FrontSide,
    colorWrite: false,
    depthWrite: false,
    depthTest: false,
  })
  m.stencilWrite = true
  m.stencilWriteMask = 0xff
  m.stencilFunc = AlwaysStencilFunc
  m.stencilZPass = ReplaceStencilOp
  m.stencilRef = 1
  return m
}

// Valeur de gabarit d'un corps pour l'image (1 à 255).
export const setStencil = (ref: number, ...ms: ShaderMaterial[]): void => {
  for (const m of ms) m.stencilRef = ref
}

// Marques dorées d'un Résistant (couronne, bandes du buste) : par-dessus le corps, couleur exacte de la palette.
export const markMaterial = (u: ModelUniforms): ShaderMaterial =>
  new ShaderMaterial({
    vertexShader: OVERLAY_VERT(false),
    fragmentShader: SIGNAL_FRAG(true),
    uniforms: { ...overlayUniforms, ...u, uColor: u.uMarkColor },
    side: FrontSide,
  })

export const idMaterial = (u: ModelUniforms, which: 'body' | 'rim' | 'mark'): ShaderMaterial => {
  const m = new ShaderMaterial({
    vertexShader: OVERLAY_VERT(which === 'rim'),
    fragmentShader: ID_FRAG(which),
    uniforms: {
      ...(which === 'body' ? {} : overlayUniforms),
      ...u,
      uId: which === 'body' ? u.uIdBody : which === 'rim' ? u.uIdRim : u.uIdMark,
    },
    side: which === 'rim' ? BackSide : FrontSide,
  })
  return which === 'rim' ? stencilTest(m) : m
}

// ---------------------------------------------------------------------------------------------------------
// Morts (E8 : dans la scène éclairée, sous la lumière du lieu comme tout le reste). Trois formes, une même matière :
// - lot (BatchedMesh) : pose figée cuite en coordonnées monde, une fois l'agonie finie (ou un mort placé) ; couleur
//   d'instance : (id >> 8, id & 255, -, passage à la pâleur 0 → 1) ;
// - peau (agonie, E7) : la version allégée du corps sur le squelette de l'instance, qui s'effondre pendant l'agonie
//   (TUNING.agonie) ; sa dernière image est la pose cuite ensuite dans le lot ;
// - maillage (agonie d'un Membre errant) : la pièce de bras, posée par sa matrice.
// Hors du lot, la couleur d'instance vient de l'uniforme uInst (mêmes composantes).
//
// La pâleur d'un cadavre (L4, décision du concepteur du 2026-10-12) : pendant l'agonie, la matière du vivant (la
// texture décalée vers la chair de la palette, exactement comme sur le corps vivant) perd sa couleur vers le gris
// cadavérique de la palette, à luminance égale : désaturée, ni éclaircie, ni argentée. Les marques dorées d'un
// Résistant passent de l'or au gris avec le reste. La translucidité de la chair (corps vivant) s'éteint avec la vie,
// pendant l'agonie : un mort n'émet rien (B2.O1 (3)), et la lumière du corps ne saute pas au coup fatal. Ensuite, la
// lumière de la scène s'applique comme au sol (torches, chandelle du Bourreau, lune, ambiance, ombres, reflets) : dans
// le noir, un mort se devine ; sous une flamme, c'est un corps blême. Reflets de l'environnement et ombres reçues :
// ceux du corps vivant ; sa chair devient mate (DEAD_ROUGHNESS). Alpha de la scène : SCENE_TAG.mort (post.ts).

export type DeadForm = 'batch' | 'skin' | 'mesh'

// Rugosité d'un cadavre (forme, E8) : la chair humide du vivant (ART_DIRECTION « Matières ») sèche et devient mate
// pendant l'agonie, comme le sang qui sèche (§17.1). Un gris encore brillant renvoie le ciel froid et la lune en
// reflets bleutés : c'est l'aspect argenté que le concepteur a écarté. Mesure : rapport E8.
const DEAD_ROUGHNESS = 0.9

const linearOf = (hex: number): Color => new Color(hex) // three : converti en linéaire

// Chromaticité du gris cadavérique de la palette, ramenée à une luminance de 1.
const greyChroma = (): Color => {
  const c = linearOf(PALETTE.gris.cadaverique)
  const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
  return c.multiplyScalar(1 / l)
}

const instGlsl = (form: DeadForm): string =>
  form === 'batch'
    ? '#if defined( USE_COLOR_ALPHA )\n  vec4 e8Inst = vColor;\n#else\n  vec4 e8Inst = uInst;\n#endif'
    : '  vec4 e8Inst = uInst;'

const deadPatch =
  (form: DeadForm): ((s: WebGLProgramParametersWithUniforms) => void) =>
  (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aMark;\nvarying float vE8Mark;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vE8Mark = aMark;')
    s.fragmentShader = s.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec4 uInst;
uniform vec3 uGreyChroma;
uniform vec3 uMarkGold;
uniform float uTranslucence;
varying float vE8Mark;
${CLASS_SHIFT_GLSL}`,
      )
      // Couleur d'instance : l'identité et le passage à la pâleur, jamais une teinte de l'albédo.
      .replace(
        '#include <color_fragment>',
        `${instGlsl(form)}
  vec3 e8Living = vE8Mark > 0.5 ? uMarkGold : e2ClassShift( diffuseColor.rgb );
  float e8Pale = clamp( e8Inst.a, 0.0, 1.0 );
  diffuseColor.rgb = mix( e8Living, uGreyChroma * dot( e8Living, vec3( 0.2126, 0.7152, 0.0722 ) ), e8Pale );`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
  roughnessFactor = mix( roughnessFactor, ${DEAD_ROUGHNESS.toFixed(2)}, e8Pale );`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  totalEmissiveRadiance += e8Living * uTranslucence * ( 1.0 - e8Pale );`,
      )
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>\n  gl_FragColor.a = ${SCENE_TAG.mort.toFixed(4)};`,
      )
  }

export const deadMaterial = (
  map: Texture | null,
  meanLum: number,
  form: DeadForm = 'batch',
  shift: ClassShift = NO_SHIFT,
  roughness = 0.6,
): MeshStandardMaterial => {
  const m = new MeshStandardMaterial({
    map,
    roughness,
    metalness: 0,
    envMapIntensity: 0.25,
    // Deux faces : le regroupement de sommets de la version allégée retourne parfois un triangle ; vu de dos, il
    // trouerait le corps (three retourne la normale d'une face arrière).
    side: DoubleSide,
    // Dessiné après la brume de sang (DEAD_RENDER_ORDER, materials.ts), sans mélange, en une passe.
    transparent: true,
    blending: NoBlending,
  })
  m.forceSinglePass = true
  const uniforms = {
    uInst: { value: new Vector4() },
    uGreyChroma: { value: greyChroma() },
    uMarkGold: { value: linearOf(PALETTE.or.base) },
    uTranslucence: { value: TRANSLUCENCE },
    ...classShiftUniforms(shift, meanLum),
  }
  m.userData.inst = uniforms.uInst // couleur d'instance hors du lot (layer.ts)
  const patch = deadPatch(form)
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms)
    patch(s)
  }
  m.customProgramCacheKey = () => `e8-mort-${form}-${TRANSLUCENCE}`
  return m
}

// Uniforme de la couleur d'instance d'une matière des morts (formes peau et maillage).
export const deadInst = (m: MeshStandardMaterial): { value: Vector4 } => m.userData.inst as { value: Vector4 }

// Passe d'identification d'un mort : objet de la scène, sans test contre la profondeur de la scène (B2 I1).
const DEAD_ID_FRAG = /* glsl */ `
varying vec4 vInst;
void main() {
  gl_FragColor = vec4( vInst.r, vInst.g, ${(1 / 255).toFixed(8)}, 1.0 );
}
`
const DEAD_ID_VERT = (form: DeadForm): string => /* glsl */ `
#include <common>
${form === 'batch' ? '#include <batching_pars_vertex>' : ''}
${form === 'skin' ? '#include <skinning_pars_vertex>' : ''}
${form === 'batch' ? '' : 'uniform vec4 uInst;'}
varying vec4 vInst;
void main() {
  vec3 transformed = vec3( position );
${
  form === 'batch'
    ? `  #include <batching_vertex>
  mat4 e7Model = modelMatrix * batchingMatrix;
  vInst = getBatchingColor( getIndirectIndex( gl_DrawID ) );`
    : `  mat4 e7Model = modelMatrix;
  vInst = uInst;`
}
${
  form === 'skin'
    ? `  #include <skinbase_vertex>
  #include <skinning_vertex>`
    : ''
}
  gl_Position = projectionMatrix * viewMatrix * e7Model * vec4( transformed, 1.0 );
}
`

export const deadIdMaterial = (form: DeadForm = 'batch', inst?: { value: Vector4 }): ShaderMaterial =>
  new ShaderMaterial({
    vertexShader: DEAD_ID_VERT(form),
    fragmentShader: DEAD_ID_FRAG,
    uniforms: { uInst: inst ?? { value: new Vector4() } },
    side: DoubleSide,
  })

function glslColor(hex: number): string {
  const c = new Color(hex)
  return `vec3( ${c.r.toFixed(5)}, ${c.g.toFixed(5)}, ${c.b.toFixed(5)} )`
}
