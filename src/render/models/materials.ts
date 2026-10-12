// Matières des modèles de la Forge (E2). Un corps vivant est un maillage à squelette dans la scène éclairée
// (MeshStandardMaterial et retouches), doublé dans la couche des signaux par son liseré (coque inversée gonflée le
// long des normales de contour) et par ses marques dorées de Résistant ; chacun a sa matière d'identification
// (B2 I1), avec la même géométrie et les mêmes déplacements de sommets. Un mort est figé et cuit dans un lot
// (BatchedMesh) de la couche des morts, gris, sous la seule lumière fixe du lieu (comme au jalon 1).
import {
  AlwaysStencilFunc,
  BackSide,
  Color,
  DoubleSide,
  FrontSide,
  MeshDepthMaterial,
  MeshStandardMaterial,
  NotEqualStencilFunc,
  ReplaceStencilOp,
  RGBADepthPacking,
  ShaderMaterial,
  type Texture,
  Vector2,
  Vector3,
  type WebGLProgramParametersWithUniforms,
} from 'three'
import { fixedLightUniforms, overlayUniforms } from '../materials'
import { PALETTE } from '../palette'
import { fogUniforms, gradeUniforms } from '../post'
import { urlParam } from '../quality'
import {
  DEPTH_TEST_GLSL,
  FOG_GLSL,
  GRADE_GLSL,
  MAX_FIXED_LIGHTS,
  SCENE_DEPTH_CALL,
  TONEMAP_GLSL,
} from '../shaders'
import { CLASS_SHIFT_GLSL, type ClassShift, classShiftUniforms } from './classes'

// Uniformes d'une instance, partagés par toutes ses matières (mêmes objets).
export interface ModelUniforms {
  readonly uHideArms: { value: Vector2 } // (gauche, droit) : 1 = bras sectionné, absent du corps
  readonly uSacScale: { value: number }
  readonly uSacCenter: { value: Vector3 }
  readonly uSacTint: { value: Color }
  readonly uSacGlow: { value: number }
  readonly uHaloTint: { value: Color }
  readonly uHaloGlow: { value: number } // 0 : halo de fer ; > 0 : prière (vert maladif)
  readonly uSeams: { value: number } // Cicatrices visibles (0 à 3)
  readonly uExtrude: { value: number } // épaisseur du liseré (m)
  readonly uRimColor: { value: Color }
  readonly uMarkColor: { value: Color }
  readonly uIdBody: { value: Vector3 }
  readonly uIdRim: { value: Vector3 }
  readonly uIdMark: { value: Vector3 }
}

export const modelUniforms = (sacCenter: Vector3): ModelUniforms => ({
  uHideArms: { value: new Vector2(0, 0) },
  uSacScale: { value: 1 },
  uSacCenter: { value: sacCenter.clone() },
  uSacTint: { value: new Color(PALETTE.chair.sac) },
  uSacGlow: { value: 0 },
  uHaloTint: { value: new Color(PALETTE.vertMaladif) },
  uHaloGlow: { value: 0 },
  uSeams: { value: 0 },
  uExtrude: { value: 0.04 },
  uRimColor: { value: new Color(PALETTE.ivoire.base) },
  uMarkColor: { value: new Color(PALETTE.or.base) },
  uIdBody: { value: new Vector3() },
  uIdRim: { value: new Vector3() },
  uIdMark: { value: new Vector3() },
})

// ---------------------------------------------------------------------------------------------------------
// Sommets : régions (aPart, aMark, aSeams), bras sectionnés, sac qui gonfle.

const VERT_PARS = /* glsl */ `
attribute float aPart;
attribute float aMark;
attribute vec3 aSeams;
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
  vHide = ( abs( aPart - 1.0 ) < 0.5 ? uHideArms.x : 0.0 ) + ( abs( aPart - 2.0 ) < 0.5 ? uHideArms.y : 0.0 );
  if ( abs( aPart - 3.0 ) < 0.5 ) transformed = uSacCenter + ( transformed - uSacCenter ) * uSacScale;
`

const FRAG_PARS = /* glsl */ `
varying float vHide;
varying float vPart;
varying float vMark;
varying vec3 vSeams;
`

type Patch = (s: WebGLProgramParametersWithUniforms) => void

const patchVertex: Patch = (s) => {
  s.vertexShader = s.vertexShader
    .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_BODY}`)
}

// ---------------------------------------------------------------------------------------------------------
// Corps vivant (scène éclairée)

// Plancher de la chair vivante (E4, B2.O1 dans le noir) : loin de toute flamme, un corps vivant ne descend pas sous
// cette part de son albédo (translucidité de la chair, ART_DIRECTION « Matières »). C'est une lumière propre à la chair
// qui ne s'ajoute que dans le noir : un corps éclairé au-dessus du plancher ne change pas, le sol reste noir, les morts
// (couche des morts) n'y passent jamais. Forme, réglée sur S1b et S1d (rapport E4) : le Recousu Résistant s10 de S1b,
// à 11 m du Bourreau dans le coin de l'image, est le plus sombre (C* du corps 6,5 sans plancher) ; 0,35 lui donne
// une marge d'au moins 2 sur B2.O1. Instrument : `plancher=<part>`.
export const LIVING_FLOOR = 0.35
const floorFromUrl = Number(urlParam('plancher') ?? Number.NaN)
export const livingFloorUniform = { value: Number.isFinite(floorFromUrl) ? floorFromUrl : LIVING_FLOOR }
export const NO_FLOOR = { value: 0 } // le Bourreau : sombre, il vit dans sa propre lumière

export const bodyMaterial = (
  map: Texture | null,
  roughness: number,
  u: ModelUniforms,
  shift: ClassShift,
  meanLum: number,
  floor: { value: number },
): MeshStandardMaterial => {
  const m = new MeshStandardMaterial({ map, roughness, metalness: 0, envMapIntensity: 0.25 })
  const cs = classShiftUniforms(shift, meanLum)
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u, cs, { uLivingFloor: floor })
    patchVertex(s)
    s.fragmentShader = s.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
${FRAG_PARS}
uniform vec3 uSacTint;
uniform float uSacGlow;
uniform vec3 uHaloTint;
uniform float uHaloGlow;
uniform float uSeams;
uniform float uLivingFloor;
${CLASS_SHIFT_GLSL}`,
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
  diffuseColor.rgb = mix( diffuseColor.rgb, ${glslColor(PALETTE.chair.plaie)}, e2Seam * 0.85 );`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  // Chair : un peu de lumière qui traverse (comme les segments du jalon 1).
  totalEmissiveRadiance += diffuseColor.rgb * 0.07;
  if ( e2Sac ) totalEmissiveRadiance += uSacTint * uSacGlow;
  if ( e2Halo ) totalEmissiveRadiance += uHaloTint * uHaloGlow;`,
      )
      // Masque des personnages (E3) : alpha 0 dans la scène (matière opaque, sans mélange), lu par la composition pour
      // leur laisser la couleur que l'étalonnage froid retire au décor (post.ts, LOOK.modelSaturation).
      // Plancher de la chair (E4) : la luminance ne descend pas sous celle de l'albédo × uLivingFloor ; ce qui manque
      // est rendu dans la couleur de l'albédo (la chair, pas la lumière froide de la nuit). Au-dessus : rien ne change.
      .replace(
        '#include <opaque_fragment>',
        `{
    vec3 e4Floor = diffuseColor.rgb * uLivingFloor;
    float e4Lf = dot( e4Floor, vec3( 0.2126, 0.7152, 0.0722 ) );
    float e4Lo = dot( outgoingLight, vec3( 0.2126, 0.7152, 0.0722 ) );
    outgoingLight += e4Floor * clamp( 1.0 - e4Lo / max( e4Lf, 1e-6 ), 0.0, 1.0 );
  }
  #include <opaque_fragment>
  gl_FragColor.a = 0.0;`,
      )
  }
  m.customProgramCacheKey = () => 'e2-body'
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
// Morts (couche des morts, lot BatchedMesh) : pose figée cuite en coordonnées monde. Gris cadavérique, avec le
// détail de luminance de la texture autour de la pâleur de la palette ; lumière fixe du lieu seulement (B2.O1, O5).
// Couleur d'instance : (id >> 8, id & 255, -, passage au gris 0 → 1).

const DEAD_VERT = /* glsl */ `
#include <common>
#include <batching_pars_vertex>
attribute float aMark;
varying vec3 vNormalW;
varying vec3 vWorld;
varying vec2 vUv;
varying float vMarkD;
varying vec4 vInst;
void main() {
  #include <batching_vertex>
  vec4 w = modelMatrix * batchingMatrix * vec4( position, 1.0 );
  vWorld = w.xyz;
  vNormalW = normalize( mat3( modelMatrix * batchingMatrix ) * normal );
  vUv = uv;
  vMarkD = aMark;
  vInst = getBatchingColor( getIndirectIndex( gl_DrawID ) );
  gl_Position = projectionMatrix * viewMatrix * w;
}
`

const DEAD_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uMeanLum;
uniform vec3 uGrey;
uniform vec3 uGreyLight;
uniform vec4 uFixedPos[ ${MAX_FIXED_LIGHTS} ];
uniform float uFixedLum[ ${MAX_FIXED_LIGHTS} ];
uniform int uFixedCount;
uniform vec3 uMoonDir;
uniform float uMoonLum;
uniform float uDeadAmbient;
uniform vec4 uLantern;
uniform float uLanternLum;
uniform vec3 uCamPosW;
uniform float uExposure;
uniform vec2 uResolution;
varying vec3 vNormalW;
varying vec3 vWorld;
varying vec2 vUv;
varying float vMarkD;
varying vec4 vInst;
${DEPTH_TEST_GLSL}
${TONEMAP_GLSL}
${GRADE_GLSL}
${FOG_GLSL}
void main() {
  ${SCENE_DEPTH_CALL.signal}
  vec3 tex = texture2D( uMap, vUv ).rgb;
  float lumT = dot( tex, vec3( 0.2126, 0.7152, 0.0722 ) );
  // Détail de la texture autour de la pâleur de la palette : facteur borné (un mort reste pâle, B2.O3).
  float detail = clamp( lumT / max( uMeanLum, 1e-3 ), 0.55, 1.45 );
  vec3 base = mix( uGrey, uGreyLight, step( 0.5, vMarkD ) );
  vec3 grey = base * detail;
  // Passage au gris en 0,3 s (L4, « désaturé ») : la texture, exposée pour que sa luminance moyenne soit celle du
  // gris (la pâleur du cadavre), perd sa couleur. Dès le coup fatal, le corps a donc la luminance qu'il gardera et se
  // détache du sol (B2.O3, sans délai de grâce). Avant E4, il partait de la texture brute, deux à trois fois plus
  // sombre que le gris, et se fondait dans la boue pendant les premières images.
  vec3 start = tex * ( dot( base, vec3( 0.2126, 0.7152, 0.0722 ) ) / max( uMeanLum, 1e-3 ) );
  vec3 albedo = mix( start, grey, vInst.a );
  vec3 n = normalize( vNormalW );
  if ( ! gl_FrontFacing ) n = - n;
  float lum = uDeadAmbient * ( 0.6 + 0.4 * n.y ) + uMoonLum * max( dot( n, uMoonDir ), 0.0 );
  for ( int i = 0; i < ${MAX_FIXED_LIGHTS}; i ++ ) {
    if ( i >= uFixedCount ) break;
    vec3 d = uFixedPos[ i ].xyz - vWorld;
    float dist = length( d );
    float range = uFixedPos[ i ].w;
    float win = pow( clamp( 1.0 - pow( dist / range, 4.0 ), 0.0, 1.0 ), 2.0 );
    lum += uFixedLum[ i ] * win / max( dist * dist, 0.01 ) * max( dot( n, d / dist ), 0.0 );
  }
  if ( uLanternLum > 0.0 ) {
    vec3 d = uLantern.xyz - vWorld;
    float dist = length( d );
    float win = pow( clamp( 1.0 - pow( dist / uLantern.w, 4.0 ), 0.0, 1.0 ), 2.0 );
    lum += uLanternLum * win / max( dist * dist, 0.01 ) * max( dot( n, d / dist ), 0.0 );
  }
  vec3 c = albedo * lum * 0.3183099;
  float tau = e1FogDepth( uCamPosW, vWorld );
  float T = exp( - tau );
  float fogL = dot( uFogAmbient, vec3( 0.2126, 0.7152, 0.0722 ) );
  c = c * T + vec3( fogL ) * ( 1.0 - T ) * uFogScatter;
  c = e1Aces( c * uExposure );
  c = e1Grade( c, 1.0 );
  c *= e1VignetteAt( gl_FragCoord.xy / uResolution, uResolution );
  gl_FragColor = vec4( e1LinearToSrgb( c ), 1.0 );
}
`

export const deadMaterial = (map: Texture | null, meanLum: number): ShaderMaterial =>
  new ShaderMaterial({
    vertexShader: DEAD_VERT,
    fragmentShader: DEAD_FRAG,
    uniforms: {
      ...overlayUniforms,
      ...fixedLightUniforms,
      ...gradeUniforms,
      ...fogUniforms,
      uMap: { value: map },
      uMeanLum: { value: meanLum },
      uGrey: { value: new Color(PALETTE.gris.cadaverique) },
      uGreyLight: { value: new Color(PALETTE.gris.cadaveriqueClair) },
    },
    // Deux faces : le regroupement de sommets de la version allégée retourne parfois un triangle ; vu de dos, il
    // trouerait le corps (la normale est retournée dans le shader).
    side: DoubleSide,
  })

// Même test contre la profondeur de la scène que la matière couleur des morts (e1DepthTest, tolérance comprise).
const DEAD_ID_FRAG = /* glsl */ `
varying vec4 vInst;
${DEPTH_TEST_GLSL}
void main() {
  ${SCENE_DEPTH_CALL.signal}
  gl_FragColor = vec4( vInst.r, vInst.g, ${(1 / 255).toFixed(8)}, 1.0 );
}
`
const DEAD_ID_VERT = /* glsl */ `
#include <common>
#include <batching_pars_vertex>
varying vec4 vInst;
void main() {
  #include <batching_vertex>
  vInst = getBatchingColor( getIndirectIndex( gl_DrawID ) );
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * batchingMatrix * vec4( position, 1.0 );
}
`

export const deadIdMaterial = (): ShaderMaterial =>
  new ShaderMaterial({
    vertexShader: DEAD_ID_VERT,
    fragmentShader: DEAD_ID_FRAG,
    uniforms: { ...overlayUniforms },
    side: DoubleSide,
  })

function glslColor(hex: number): string {
  const c = new Color(hex)
  return `vec3( ${c.r.toFixed(5)}, ${c.g.toFixed(5)}, ${c.b.toFixed(5)} )`
}
