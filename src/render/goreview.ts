// Rendu du sang (E1, E7, §17.1) : décalques au sol (arcs, traînées, étoiles, gouttes, flaques, traces de reptation)
// dessinés par un shader de forme ; couche du sol qui absorbe le sang posé ; gouttelettes en vol ; brume rouge de la
// libération ; morceaux de chair et d'os. Tout se lit dans GoreMemory, en fonction de l'horloge de rendu t.
//
// Le sang frais (2 s) est rouge vif, mouillé, brillant sous les flammes ; puis il fonce vers le rouge brun et le
// noir, et sèche en perdant son brillant (couleur et rugosité selon l'âge, dans le shader). Le sang ancien n'est
// jamais rouge vif, même sous une flamme (§17.1, §30.10) : sa radiance est assombrie juste assez pour que sa couleur
// de sortie (exposition, courbe, étalonnage du décor, vignettage) reste à plus de OLD_BLOOD_DE du rouge vif.
//
// La couche du sol (BloodLayer) : une texture flottante qui couvre l'arène, où chaque décalque fini est tamponné une
// fois (couverture, tick de naissance, épaisseur), puis un seul plan transparent qui la lit. Son coût d'image ne
// dépend pas de la quantité de sang accumulée (§17.1).
import {
  AddEquation,
  Color,
  CustomBlending,
  DoubleSide,
  Euler,
  HalfFloatType,
  IcosahedronGeometry,
  LinearFilter,
  Matrix4,
  MaxEquation,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  OneFactor,
  OneMinusSrcAlphaFactor,
  OrthographicCamera,
  PlaneGeometry,
  Quaternion,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SrcAlphaFactor,
  Vector3,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
  WebGLRenderTarget,
  ZeroFactor,
} from 'three'
import { Batch } from './batch'
import { ballistic, type DecalKind, decalScale, type GoreMemory, isFresh } from './gore'
import { encodeId, instancedIdMaterial, ROLE } from './idpass'
import { PALETTE } from './palette'
import { gradeUniforms } from './post'
import { urlParam } from './quality'
import { GRADE_GLSL, GUARD_GLSL, NOISE_GLSL, TONEMAP_GLSL } from './shaders'

const KIND_CODE: Record<DecalKind, number> = {
  eclat: 0,
  trainee: 1,
  flaque: 2,
  trace: 3,
  arc: 4,
  etoile: 5,
  goutte: 6,
}

// Demi-côté (m) de la couche du sol : l'arène (TUNING.arenaHalf, 15 m) et les gerbes qui la débordent.
export const LAYER_HALF_M = 16.5
// Écart CIEDE2000 minimal entre la couleur de sortie prévue d'un sang ancien et le rouge vif (forme, E7) : l'audit lit
// « rouge vif » à 10 ou moins ; la marge couvre le brouillard et le grain, que la prévision ne compte pas.
export const OLD_BLOOD_DE = 14

// Kind et épaisseur d'un décalque, dans une seule composante : kind + épaisseur × 0,9.
const packKind = (kind: DecalKind, depth: number): number =>
  KIND_CODE[kind] + Math.min(1, Math.max(0, depth)) * 0.9

// Bruit, défini une fois même quand la forme et la couleur du sang sont dans le même shader.
const NOISE_ONCE = `#ifndef E7_NOISE
#define E7_NOISE
${NOISE_GLSL}
#endif`

// Forme d'un décalque dans le quad (p ∈ [−1, 1]², x le long de la direction), alpha en sortie.
const DECAL_SHAPE = /* glsl */ `
${NOISE_ONCE}
float e1Disc( vec2 q, vec2 c, float r ) { return 1.0 - smoothstep( r * 0.7, r, length( q - c ) ); }
float e1DecalAlpha( vec2 p, float kind, float seed, float len ) {
  float a = 0.0;
  if ( kind < 0.5 ) {
    // Éclaboussure ronde et ses gouttes.
    float r = length( p );
    float ang = atan( p.y, p.x );
    float edge = 0.5 + 0.16 * e1Noise( vec2( ang * 2.0, seed ) ) + 0.1 * e1Noise( vec2( ang * 7.0, seed + 3.0 ) );
    a = 1.0 - smoothstep( edge - 0.06, edge, r );
    for ( int i = 0; i < 7; i ++ ) {
      float fi = float( i );
      float an = e1Hash( vec2( seed, fi ) ) * 6.2832;
      float rr = 0.62 + 0.32 * e1Hash( vec2( fi, seed ) );
      a = max( a, e1Disc( p, vec2( cos( an ), sin( an ) ) * rr, 0.04 + 0.06 * e1Hash( vec2( fi + 9.0, seed ) ) ) );
    }
  } else if ( kind < 1.5 ) {
    // Jet dans le sens du coup : un chapelet de taches qui rapetissent en s'éloignant, reliées par un filet, et des
    // gouttes au bout.
    vec2 q = vec2( p.x * len, p.y );
    float u = ( p.x + 1.0 ) * 0.5;
    float w = mix( 0.22, 0.04, u ) * ( 0.6 + 0.8 * e1Noise( vec2( p.x * 7.0, seed ) ) );
    a = ( 1.0 - smoothstep( w - 0.05, w, abs( p.y - 0.12 * sin( p.x * 2.3 + seed ) ) ) ) * smoothstep( -1.0, -0.9, p.x ) * ( 1.0 - smoothstep( 0.6, 0.85, p.x ) );
    for ( int i = 0; i < 10; i ++ ) {
      float fi = float( i );
      float t = fi / 9.0;
      float x = mix( -0.82, 0.78, t ) + ( e1Hash( vec2( seed, fi + 2.0 ) ) - 0.5 ) * 0.12;
      float y = ( e1Hash( vec2( fi, seed + 5.0 ) ) - 0.5 ) * mix( 0.25, 0.8, t );
      float r = mix( 0.62, 0.1, t ) * ( 0.55 + 0.7 * e1Hash( vec2( fi + 4.0, seed ) ) );
      if ( e1Hash( vec2( fi + 8.0, seed ) ) < 0.18 ) continue;
      a = max( a, e1Disc( q, vec2( x * len, y ), r ) );
    }
  } else if ( kind < 2.5 ) {
    // Flaque : bord irrégulier.
    float r = length( p );
    float ang = atan( p.y, p.x );
    float edge = 0.78 + 0.12 * e1Noise( vec2( ang * 1.6, seed ) ) + 0.05 * e1Noise( vec2( ang * 6.0, seed + 1.0 ) );
    a = 1.0 - smoothstep( edge - 0.05, edge, r );
  } else if ( kind < 3.5 ) {
    // Trace de reptation : sang frotté, strié.
    float streak = 0.55 + 0.45 * e1Noise( vec2( p.x * len * 2.5, p.y * 9.0 + seed ) );
    a = ( 1.0 - smoothstep( 0.3, 0.6, abs( p.y ) + 0.1 * e1Noise( vec2( p.x * 6.0, seed ) ) ) ) * streak;
    a *= smoothstep( -1.0, -0.7, p.x ) * ( 1.0 - smoothstep( 0.7, 1.0, p.x ) );
  } else if ( kind < 4.5 ) {
    // Arc du tranchant : la lame balaie et sème un croissant de taches en travers du coup, plus épais au milieu,
    // interrompu, effilé aux bouts.
    vec2 c = vec2( -0.85, 0.0 );
    vec2 d = p - c;
    float r = length( d );
    float ang = atan( d.y, d.x );
    float span = 1.0 + 0.3 * e1Hash( vec2( seed, 31.0 ) );
    float t = clamp( abs( ang ) / span, 0.0, 1.0 );
    float gap = smoothstep( 0.25, 0.45, e1Noise( vec2( ang * 5.0, seed + 7.0 ) ) );
    float w = 0.11 * ( 1.0 - t * t ) * ( 0.5 + 0.9 * e1Noise( vec2( ang * 9.0, seed ) ) ) * gap;
    a = ( 1.0 - smoothstep( w - 0.04, w, abs( r - 1.25 ) ) ) * ( 1.0 - smoothstep( 0.9, 1.0, t ) );
    for ( int i = 0; i < 12; i ++ ) {
      float fi = float( i );
      float an = ( e1Hash( vec2( seed, fi + 11.0 ) ) - 0.5 ) * 2.0 * span;
      float rr = 1.25 + ( e1Hash( vec2( fi + 3.0, seed ) ) - 0.3 ) * 0.5;
      float tt = abs( an ) / span;
      a = max( a, e1Disc( p, c + vec2( cos( an ), sin( an ) ) * rr, ( 0.025 + 0.06 * e1Hash( vec2( fi + 7.0, seed ) ) ) * ( 1.0 - 0.6 * tt ) ) );
    }
  } else if ( kind < 5.5 ) {
    // Étoile du contondant : le sang écrasé gicle en rayons, gouttes au bout des rayons.
    float r = length( p );
    float ang = atan( p.y, p.x );
    float edge = 0.3 + 0.06 * e1Noise( vec2( ang * 5.0, seed ) );
    for ( int i = 0; i < 9; i ++ ) {
      float fi = float( i );
      float ai = e1Hash( vec2( seed, fi + 21.0 ) ) * 6.2832;
      float li = 0.45 + 0.45 * e1Hash( vec2( fi + 13.0, seed ) );
      float da = abs( atan( sin( ang - ai ), cos( ang - ai ) ) );
      edge = max( edge, li * ( 1.0 - smoothstep( 0.0, 0.22 * ( 1.0 - 0.6 * r ), da ) ) );
      a = max( a, e1Disc( p, vec2( cos( ai ), sin( ai ) ) * min( 0.97, li + 0.08 ), 0.05 + 0.04 * e1Hash( vec2( fi, seed + 2.0 ) ) ) );
    }
    a = max( a, 1.0 - smoothstep( edge - 0.04, edge, r ) );
  } else {
    // Goutte retombée : ovale allongé dans le sens de sa course.
    float r = length( vec2( p.x * 0.95, p.y * 1.35 ) );
    a = 1.0 - smoothstep( 0.62, 0.8, r + 0.08 * e1Noise( vec2( atan( p.y, p.x ) * 3.0, seed ) ) );
  }
  return a;
}
`

// Couleur et rugosité du sang selon son âge (s) et son épaisseur (0 à 1) : rouge vif et mouillé pendant 2 s, puis
// rouge brun qui fonce jusqu'au noir (d'autant plus vite qu'il est épais), et sèche (perd son brillant).
const BLOOD_GLSL = /* glsl */ `
${NOISE_ONCE}
uniform vec3 uBloodFresh;
uniform vec3 uBloodOld;
uniform vec3 uBloodBlack;
uniform float uOldDE;
uniform float uExposure;
vec3 e7BloodAlbedo( float age, float depth ) {
  if ( age < 1.5 ) return uBloodFresh;
  if ( age < 2.0 ) return mix( uBloodFresh, uBloodOld, smoothstep( 1.5, 2.0, age ) );
  return mix( uBloodOld, uBloodBlack, smoothstep( 2.0, 60.0, age ) * ( 0.25 + 0.6 * depth ) );
}
float e7BloodRoughness( float age, float depth ) {
  if ( age < 2.0 ) return 0.14;
  return mix( 0.22, 0.88, smoothstep( 2.0, 12.0 + 24.0 * depth, age ) );
}
float e7BloodEmissive( float age ) { return 0.04 * ( 1.0 - smoothstep( 1.5, 2.0, age ) ); }
// Variation de l'épaisseur du sang au sol, dans le repère du monde (la même avant et après l'absorption).
float e7BloodVar( vec2 xz ) { return 0.62 + 0.38 * e1Noise( xz * 3.1 ) * ( 0.7 + 0.3 * e1Noise( xz * 11.0 + 5.0 ) ); }
${TONEMAP_GLSL}
${GRADE_GLSL}
${GUARD_GLSL}
// Couleur de sortie prévue d'une radiance du décor (exposition, courbe ACES, étalonnage du décor, vignettage vig).
vec3 e7Predict( vec3 r, float vig ) { return e1GradeMix( e1Aces( r * uExposure ), 0.0, 0.0 ) * vig; }
bool e7OldSafe( vec3 r ) {
  // Plus sombre que le rouge vif d'au moins 1,25 × uOldDE en clarté : sûr (ΔE00 ≥ ΔL / SL, SL ≤ 1,13 à cet écart ;
  // le vignettage ne fait qu'assombrir).
  vec3 p = e7Predict( r, 1.0 );
  if ( uReservedLab.x - e7Lightness( p ) >= 1.25 * uOldDE ) return true;
  return e7De00( e7Lab( p ), uReservedLab ) >= uOldDE
    && e7De00( e7Lab( e7Predict( r, 0.5 ) ), uReservedLab ) >= uOldDE;
}
// Sang ancien : la radiance est assombrie juste assez pour rester hors du rouge vif (dichotomie ; le noir est sûr).
vec3 e7CapOld( vec3 r ) {
  if ( e7OldSafe( r ) ) return r;
  float lo = 0.0;
  float hi = 1.0;
  for ( int i = 0; i < 10; i ++ ) {
    float m = 0.5 * ( lo + hi );
    if ( e7OldSafe( r * m ) ) lo = m;
    else hi = m;
  }
  return r * lo;
}
`

const linear = (hex: number): Color => new Color(hex) // three : converti en linéaire

const bloodUniforms = (): Record<string, { value: unknown }> => ({
  ...gradeUniforms,
  uBloodFresh: { value: linear(PALETTE.rougeVif) },
  uBloodOld: { value: linear(PALETTE.rougeBrun.sangAncien) },
  uBloodBlack: { value: linear(PALETTE.rougeBrun.sangNoir) },
  uOldDE: { value: OLD_BLOOD_DE },
  uReservedLab: { value: reservedLabValue() },
  uReservedDE: { value: OLD_BLOOD_DE },
})

function reservedLabValue(): Vector3 {
  // CIELAB (D65) du rouge vif de la palette, comme la garde de la composition (post.ts).
  const c = PALETTE.rougeVif
  const lin = (v: number): number => {
    const x = v / 255
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  }
  const r = lin((c >> 16) & 255)
  const g = lin((c >> 8) & 255)
  const b = lin(c & 255)
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116)
  const X = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047
  const Y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b
  const Z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883
  return new Vector3(116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z)))
}

// Mélange du sang sur le décor : la couleur se fond, l'alpha de la scène (masque des personnages, garde du rouge
// vif, post.ts) n'est pas touché.
const keepSceneAlpha = <T extends MeshStandardMaterial>(m: T): T => {
  m.blending = CustomBlending
  m.blendEquation = AddEquation
  m.blendSrc = SrcAlphaFactor
  m.blendDst = OneMinusSrcAlphaFactor
  m.blendEquationAlpha = AddEquation
  m.blendSrcAlpha = ZeroFactor
  m.blendDstAlpha = OneFactor
  return m
}

// Retouche commune du sang au sol : albédo, rugosité, émissif selon l'âge ; garde du sang ancien en sortie.
const bloodFragment = (
  s: WebGLProgramParametersWithUniforms,
  head: string,
  body: string,
  oldExpr: string,
): void => {
  s.fragmentShader = s.fragmentShader
    .replace('#include <common>', `#include <common>\n${BLOOD_GLSL}\n${head}`)
    .replace('#include <color_fragment>', `#include <color_fragment>\n${body}`)
    .replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>
  roughnessFactor = e7BloodRoughness( e7Age, e7Depth );`,
    )
    .replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
  totalEmissiveRadiance += diffuseColor.rgb * e7BloodEmissive( e7Age );`,
    )
    .replace(
      '#include <opaque_fragment>',
      `if ( ${oldExpr} ) outgoingLight = e7CapOld( outgoingLight );
  #include <opaque_fragment>`,
    )
}

const decalMaterial = (): MeshStandardMaterial => {
  const m = keepSceneAlpha(
    new MeshStandardMaterial({
      color: PALETTE.technique.neutre,
      roughness: 0.2,
      metalness: 0,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      envMapIntensity: 0.12,
    }),
  )
  const uniforms = bloodUniforms()
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms)
    s.vertexShader = s.vertexShader
      .replace(
        'void main() {',
        'attribute vec4 aDecal;\nvarying vec4 vDecal;\nvarying vec2 vDecalUv;\nvarying vec3 vE7World;\nvoid main() {\n  vDecal = aDecal;\n  vDecalUv = uv;',
      )
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\n  vE7World = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;',
      )
    bloodFragment(
      s,
      `varying vec4 vDecal;\nvarying vec2 vDecalUv;\nvarying vec3 vE7World;\n${DECAL_SHAPE}`,
      `vec2 e1p = vDecalUv * 2.0 - 1.0;
  float e7Kind = floor( vDecal.x + 1e-3 );
  float e7Depth = clamp( ( vDecal.x - e7Kind ) / 0.9, 0.0, 1.0 );
  float e1a = e1DecalAlpha( e1p, e7Kind, vDecal.y, max( 1.0, vDecal.z ) );
  if ( e1a < 0.03 ) discard;
  float e7Age = vDecal.w;
  diffuseColor.rgb = e7BloodAlbedo( e7Age, e7Depth ) * e7BloodVar( vE7World.xz );
  diffuseColor.a = clamp( e1a * 1.15, 0.0, 1.0 ) * ( e7Kind > 2.5 && e7Kind < 3.5 ? 0.85 : 0.97 );
  if ( e7Kind > 1.5 && e7Kind < 2.5 ) diffuseColor.rgb *= mix( 1.0, 0.6, 1.0 - smoothstep( 0.0, 0.7, length( e1p ) ) );`,
      'e7Age >= 2.0',
    )
  }
  m.customProgramCacheKey = () => 'e7-decal'
  return m
}

// Passe d'identification d'un décalque (B2 I1) : même forme que la passe couleur, rôle « décalque » là où il y a du
// sang, rien ailleurs (le sol garde son rôle).
const decalIdMaterial = (): ShaderMaterial =>
  new ShaderMaterial({
    vertexShader: /* glsl */ `
attribute vec3 aId;
attribute vec4 aDecal;
varying vec3 vId;
varying vec4 vDecal;
varying vec2 vDecalUv;
void main() {
  vId = aId;
  vDecal = aDecal;
  vDecalUv = uv;
  #include <begin_vertex>
  #include <project_vertex>
}`,
    fragmentShader: /* glsl */ `
varying vec3 vId;
varying vec4 vDecal;
varying vec2 vDecalUv;
${DECAL_SHAPE}
void main() {
  float kind = floor( vDecal.x + 1e-3 );
  if ( e1DecalAlpha( vDecalUv * 2.0 - 1.0, kind, vDecal.y, max( 1.0, vDecal.z ) ) < 0.03 ) discard;
  gl_FragColor = vec4( vId, 1.0 );
}`,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })

// ---------------------------------------------------------------------------------------------------------
// Couche du sol

// Tampon d'un décalque fini dans la couche : couverture (max), tick de naissance (max, là où la couverture est
// franche), épaisseur (somme). La position monde (x, z) devient la position dans la texture.
// Composantes de aDecal pour un tampon : (kind + épaisseur, graine, allongement, tick de naissance).
const STAMP_VERT = /* glsl */ `
attribute vec4 aDecal;
varying vec4 vDecal;
varying vec2 vDecalUv;
uniform float uHalf;
void main() {
  vDecal = aDecal;
  vDecalUv = uv;
  vec4 w = modelMatrix * instanceMatrix * vec4( position, 1.0 );
  gl_Position = vec4( w.x / uHalf, w.z / uHalf, 0.0, 1.0 );
}
`
const STAMP_FRAG = /* glsl */ `
varying vec4 vDecal;
varying vec2 vDecalUv;
${DECAL_SHAPE}
void main() {
  float kind = floor( vDecal.x + 1e-3 );
  float depth = clamp( ( vDecal.x - kind ) / 0.9, 0.0, 1.0 );
  float a = e1DecalAlpha( vDecalUv * 2.0 - 1.0, kind, vDecal.y, max( 1.0, vDecal.z ) );
  if ( a < 0.02 ) discard;
  a *= ( kind > 2.5 && kind < 3.5 ? 0.85 : 1.0 );
  gl_FragColor = vec4( a, a > 0.35 ? vDecal.w : 0.0, 0.0, a * depth );
}
`

const LAYER_TEXELS = { haute: 2048, basse: 1024 } as const
// Instrument (E7) : `couche=brut` montre le contenu de la couche (couverture, naissance, épaisseur) sur toute l'arène.
const RAW_LAYER = urlParam('couche') === 'brut'
// Instrument (E7, coût d'image) : `sang=0` ne dessine aucun sang (décalques, couche, gouttelettes, brume) ; la mémoire
// du sang, elle, continue (taches des corps comprises).
const NO_BLOOD = urlParam('sang') === '0'

// Lecture de la couche : couverture franche (seuil doux), âge depuis le sang le plus récent, épaisseur cumulée.
const LAYER_READ = /* glsl */ `
uniform sampler2D uBloodMap;
uniform float uHalf;
uniform float uTick;
varying vec3 vE7World;
float e7LayerAlpha( vec4 m ) { return smoothstep( 0.06, 0.42, m.r ); }
`

class BloodLayer {
  readonly target: WebGLRenderTarget
  private readonly stampScene = new Scene()
  private readonly stamps: Batch
  private readonly cam = new OrthographicCamera(-1, 1, 1, -1, -1, 1)
  private generation = -1
  private stamped = 0
  readonly mesh: Mesh
  private readonly material: MeshStandardMaterial
  private readonly tick = { value: 0 }

  constructor(parent: Object3D, low: boolean) {
    const n = low ? LAYER_TEXELS.basse : LAYER_TEXELS.haute
    this.target = new WebGLRenderTarget(n, n, {
      type: HalfFloatType,
      format: RGBAFormat,
      depthBuffer: false,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
    })
    const stampMat = new ShaderMaterial({
      vertexShader: STAMP_VERT,
      fragmentShader: STAMP_FRAG,
      uniforms: { uHalf: { value: LAYER_HALF_M } },
      depthTest: false,
      depthWrite: false,
      side: DoubleSide, // la projection (x, z) → (x, y) retourne le sens des faces
      blending: CustomBlending,
      blendEquation: MaxEquation,
      blendEquationAlpha: AddEquation,
      blendSrcAlpha: OneFactor,
      blendDstAlpha: OneFactor,
    })
    this.stamps = new Batch(this.stampScene, {
      geometry: () => {
        const g = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
        return g
      },
      material: stampMat,
      idMaterial: null,
      capacity: 512,
      cast: false,
      receive: false,
      extra: { name: 'aDecal', size: 4 },
    })
    this.material = keepSceneAlpha(
      new MeshStandardMaterial({
        color: PALETTE.technique.neutre,
        roughness: 0.5,
        metalness: 0,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
        envMapIntensity: 0.12,
      }),
    )
    const uniforms = {
      ...bloodUniforms(),
      uBloodMap: { value: this.target.texture },
      uHalf: { value: LAYER_HALF_M },
      uTick: this.tick,
    }
    this.material.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, uniforms)
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vE7World;')
        .replace(
          '#include <project_vertex>',
          '#include <project_vertex>\n  vE7World = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;',
        )
      bloodFragment(
        s,
        LAYER_READ,
        `vec4 e7M = texture2D( uBloodMap, vE7World.xz / uHalf * 0.5 + 0.5 );
  float e7A = e7LayerAlpha( e7M );
  ${RAW_LAYER ? 'e7A = 1.0;' : ''}
  if ( e7A < 0.03 ) discard;
  float e7Age = max( 2.0, ( uTick - e7M.g ) / 60.0 );
  float e7Depth = clamp( e7M.a / 1.5, 0.0, 1.0 );
  diffuseColor.rgb = e7BloodAlbedo( e7Age, e7Depth ) * e7BloodVar( vE7World.xz );
  diffuseColor.a = e7A * 0.97;
  ${RAW_LAYER ? 'diffuseColor = vec4( e7M.r, clamp( e7M.g / 600.0, 0.0, 1.0 ), clamp( e7M.a, 0.0, 1.0 ), 1.0 );' : ''}`,
        'true',
      )
    }
    this.material.customProgramCacheKey = () => 'e7-layer'
    const idMat = new ShaderMaterial({
      vertexShader: /* glsl */ `
varying vec3 vE7World;
void main() {
  #include <begin_vertex>
  #include <project_vertex>
  vE7World = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
}`,
      fragmentShader: /* glsl */ `
${LAYER_READ}
uniform vec3 uId;
void main() {
  if ( e7LayerAlpha( texture2D( uBloodMap, vE7World.xz / uHalf * 0.5 + 0.5 ) ) < 0.03 ) discard;
  gl_FragColor = vec4( uId, 1.0 );
}`,
      uniforms: {
        uBloodMap: { value: this.target.texture },
        uHalf: { value: LAYER_HALF_M },
        uTick: this.tick,
        uId: { value: idVec(0, ROLE.decalque) },
      },
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })
    this.mesh = new Mesh(
      new PlaneGeometry(2 * LAYER_HALF_M, 2 * LAYER_HALF_M).rotateX(-Math.PI / 2),
      this.material,
    )
    this.mesh.position.y = 0.003
    this.mesh.receiveShadow = true
    this.mesh.renderOrder = 0.5
    this.mesh.userData.idMaterial = idMat
    this.mesh.visible = false
    parent.add(this.mesh)
  }

  // Tamponne les décalques absorbés depuis la dernière image ; repart de zéro à une nouvelle partie.
  stamp(gl: WebGLRenderer, gore: GoreMemory, t: number): number {
    this.tick.value = t
    const list = gore.absorbed
    if (gore.generation !== this.generation) {
      this.generation = gore.generation
      this.stamped = 0
      const prev = gl.getRenderTarget()
      gl.setRenderTarget(this.target)
      gl.setClearColor(0x000000, 0)
      gl.clear(true, false, false)
      gl.setRenderTarget(prev)
    }
    this.mesh.visible = list.length > 0 && !NO_BLOOD
    if (this.stamped >= list.length) return 0
    const n = list.length - this.stamped
    this.stamps.begin()
    for (let i = this.stamped; i < list.length; i++) {
      const a = list[i]
      if (!a) continue
      const d = a.decal
      tmpQ2.setFromEuler(tmpE.set(0, -d.rot, 0))
      tmp.compose(
        tmpP.set(d.x, 0, d.z),
        tmpQ2,
        tmpS.set(d.size * 2 * a.scale * d.len, 1, d.size * 2 * a.scale),
      )
      this.stamps.push(tmp, PALETTE.technique.neutre, 0, 0, [
        packKind(d.kind, d.depth),
        d.seed,
        d.len,
        d.born,
      ])
    }
    this.stamps.end()
    const prev = gl.getRenderTarget()
    const auto = gl.autoClear
    gl.autoClear = false
    gl.setRenderTarget(this.target)
    gl.render(this.stampScene, this.cam)
    gl.setRenderTarget(prev)
    gl.autoClear = auto
    this.stamped = list.length
    return n
  }

  // Instrument (E7) : tampons posés, texels couverts (couverture > 0,06) et naissance la plus récente lue dans la couche.
  inspect(gl: WebGLRenderer): {
    stamped: number
    texels: number
    covered: number
    maxBorn: number
    visible: boolean
    programs: string[]
  } {
    const n = this.target.width
    const buf = new Uint16Array(n * n * 4)
    gl.readRenderTargetPixels(this.target, 0, 0, n, n, buf)
    let covered = 0
    let maxBorn = 0
    for (let i = 0; i < buf.length; i += 4) {
      const r = fromHalf(buf[i] ?? 0)
      if (r > 0.06) covered++
      maxBorn = Math.max(maxBorn, fromHalf(buf[i + 1] ?? 0))
    }
    const programs = (gl.info.programs ?? []).map((p) => `${p.name}:${p.cacheKey.slice(0, 40)}`)
    return { stamped: this.stamped, texels: n * n, covered, maxBorn, visible: this.mesh.visible, programs }
  }

  dispose(): void {
    this.stamps.dispose()
    this.target.dispose()
    this.mesh.geometry.dispose()
    this.material.dispose()
  }
}

function fromHalf(h: number): number {
  const s = h & 0x8000 ? -1 : 1
  const e = (h >> 10) & 0x1f
  const f = h & 0x3ff
  if (e === 0) return s * 2 ** -14 * (f / 1024)
  if (e === 31) return f ? Number.NaN : s * Number.POSITIVE_INFINITY
  return s * 2 ** (e - 15) * (1 + f / 1024)
}

function idVec(id: number, role: number): Vector3 {
  const [r, g, b] = encodeId(id, role)
  return new Vector3(r / 255, g / 255, b / 255)
}

// ---------------------------------------------------------------------------------------------------------
const tmp = new Matrix4()
const tmpQ2 = new Quaternion()
const tmpE = new Euler()
const tmpP = new Vector3()
const tmpS = new Vector3()
const tmpV = new Vector3()
const UP = new Vector3(0, 1, 0)

export class GoreLayer {
  private readonly decals: Batch
  private readonly drops: Batch
  private readonly chunks: Batch
  readonly layer: BloodLayer
  lastStamped = 0

  constructor(parent: Object3D, low = false) {
    this.layer = new BloodLayer(parent, low)
    this.decals = new Batch(parent, {
      geometry: () => new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      material: decalMaterial(),
      idMaterial: decalIdMaterial(),
      capacity: 512,
      cast: false,
      receive: true,
      renderOrder: 1,
      extra: { name: 'aDecal', size: 4 },
    })
    this.drops = new Batch(parent, {
      geometry: () => new SphereGeometry(0.5, 6, 4),
      material: new MeshStandardMaterial({
        color: PALETTE.technique.neutre,
        roughness: 0.15,
        emissive: 0x000000,
      }),
      // Opaques : une gouttelette qui passe devant un corps le cache à l'écran, donc aussi dans I1 (rôle « autre »).
      idMaterial: instancedIdMaterial(),
      capacity: 512,
      cast: false,
      receive: false,
    })
    this.chunks = new Batch(parent, {
      geometry: () => new IcosahedronGeometry(0.5, 0),
      material: new MeshStandardMaterial({
        color: PALETTE.technique.neutre,
        roughness: 0.35,
        flatShading: true,
      }),
      idMaterial: instancedIdMaterial(),
      capacity: 256,
      cast: true,
      receive: true,
    })
  }

  // Couche du sol : à appeler avant le rendu de la scène (tamponne le sang absorbé depuis l'image précédente).
  stamp(gl: WebGLRenderer, gore: GoreMemory, t: number): void {
    this.lastStamped = this.layer.stamp(gl, gore, t)
  }

  update(gore: GoreMemory, t: number): void {
    this.decals.begin()
    for (const d of NO_BLOOD ? [] : gore.decals) {
      if (d.born > t) continue
      const k = decalScale(d, t)
      tmpQ2.setFromEuler(tmpE.set(0, -d.rot, 0))
      tmp.compose(tmpP.set(d.x, 0.004, d.z), tmpQ2, tmpS.set(d.size * 2 * k * d.len, 1, d.size * 2 * k))
      const age = (t - d.born) / 60
      this.decals.push(tmp, PALETTE.technique.neutre, 0, ROLE.decalque, [
        packKind(d.kind, d.depth),
        d.seed,
        d.len,
        Math.min(600, age),
      ])
    }
    this.decals.end()

    this.drops.begin()
    for (const p of NO_BLOOD ? [] : gore.droplets) {
      const age = t - p.born
      if (age < 0) continue
      const b = ballistic(p, t)
      if (b.landed) continue
      const a = age / 60
      const vy = p.vy - 9.8 * a
      const v = tmpP.set(p.vx, vy, p.vz)
      const speed = v.length()
      tmpQ2.setFromUnitVectors(UP, v.normalize())
      tmp.compose(tmpV.set(b.x, b.y, b.z), tmpQ2, tmpS.set(p.size, p.size * (1 + speed * 0.3), p.size))
      this.drops.push(tmp, isFresh(p, t) ? PALETTE.rougeVif : PALETTE.rougeBrun.sangAncien, 0, ROLE.autre)
    }
    this.drops.end()

    this.chunks.begin()
    for (const c of gore.chunks) {
      if (c.born > t) continue
      const b = ballistic(c, t)
      const spin = b.landed ? c.seed * 6.28 : c.seed * 6.28 + ((t - c.born) / 60) * 9
      tmpQ2.setFromEuler(tmpE.set(spin, c.seed * 3.1, spin * 0.7))
      tmp.compose(
        tmpV.set(b.x, Math.max(c.size * 0.35, b.y), b.z),
        tmpQ2,
        tmpS.set(c.size, c.size * 0.7, c.size * 1.2),
      )
      this.chunks.push(tmp, c.kind === 'os' ? PALETTE.gore.os : PALETTE.gore.chair, 0, ROLE.autre)
    }
    this.chunks.end()
  }

  dispose(): void {
    this.layer.dispose()
    this.decals.dispose()
    this.drops.dispose()
    this.chunks.dispose()
  }
}
