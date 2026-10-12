// Matières du moteur de présentation (E1) : PBR (albédo, normale, occlusion/rugosité/métal) chargées depuis
// public/textures (manifeste : scripts/fetch-textures.ts), teintées par la palette, et quelques retouches de shader :
// flaques de la boue (eau stagnante qui reflète les flammes), occlusion au pied des murs, découpe des murs entre la
// caméra et le joueur (§20), translucidité de la chair. La matière des morts et le test de profondeur de la couche
// des signaux sont ici aussi : un mort ne reçoit que la lumière fixe du lieu, en luminance, sans vacillement.
import {
  BackSide,
  Color,
  type DepthTexture,
  FrontSide,
  LoadingManager,
  type Material,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  ShaderMaterial,
  type Side,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  Vector2,
  Vector3,
  Vector4,
  type WebGLProgramParametersWithUniforms,
} from 'three'
import { PALETTE } from './palette'
import { fogUniforms, gradeUniforms } from './post'
import {
  CUT_GLSL,
  DEPTH_TEST_GLSL,
  FOG_GLSL,
  GRADE_GLSL,
  MAX_FIXED_LIGHTS,
  NOISE_GLSL,
  SCENE_DEPTH_CALL,
  TONEMAP_GLSL,
} from './shaders'

export type TextureSet = 'boue' | 'terre' | 'pierre' | 'bois' | 'fer' | 'cuir' | 'tissu'
export const TEXTURE_SETS: readonly TextureSet[] = ['boue', 'terre', 'pierre', 'bois', 'fer', 'cuir', 'tissu']

export interface SetMaps {
  readonly albedo: Texture
  readonly normal: Texture
  readonly arm: Texture // R occlusion, G rugosité, B métal
}

// Banque de textures : chargées une fois, partagées ; `ready` se résout quand tout est là (ou en erreur).
export class TextureBank {
  private readonly manager = new LoadingManager()
  private readonly loader = new TextureLoader(this.manager)
  private readonly sets = new Map<TextureSet, SetMaps>()
  private readonly gen = new Map<string, Texture>()
  readonly ready: Promise<void>
  errors: string[] = []

  constructor(private readonly base: string) {
    let resolve: () => void = () => {}
    this.ready = new Promise<void>((r) => {
      resolve = r
    })
    this.manager.onLoad = () => resolve()
    this.manager.onError = (url) => {
      this.errors.push(url)
    }
    for (const s of TEXTURE_SETS) this.set(s)
    for (const g of ['banniere-1', 'banniere-2']) this.generated(g)
  }

  private tex(path: string, srgb: boolean): Texture {
    const t = this.loader.load(`${this.base}textures/${path}`)
    t.wrapS = RepeatWrapping
    t.wrapT = RepeatWrapping
    t.anisotropy = 4
    if (srgb) t.colorSpace = SRGBColorSpace
    return t
  }

  set(s: TextureSet): SetMaps {
    let m = this.sets.get(s)
    if (!m) {
      m = {
        albedo: this.tex(`${s}/${s}_albedo.jpg`, true),
        normal: this.tex(`${s}/${s}_normal.jpg`, false),
        arm: this.tex(`${s}/${s}_arm.jpg`, false),
      }
      this.sets.set(s, m)
    }
    return m
  }

  generated(name: string): Texture {
    let t = this.gen.get(name)
    if (!t) {
      t = this.tex(`gen/${name}-alpha.png`, true)
      this.gen.set(name, t)
    }
    return t
  }

  // Une copie de la carte avec sa propre répétition (les cartes d'un jeu partagent l'image).
  repeated(s: TextureSet, rx: number, ry: number): SetMaps {
    const m = this.set(s)
    const c = (t: Texture): Texture => {
      const k = t.clone()
      k.repeat.set(rx, ry)
      k.wrapS = RepeatWrapping
      k.wrapT = RepeatWrapping
      return k
    }
    return { albedo: c(m.albedo), normal: c(m.normal), arm: c(m.arm) }
  }
}

// ---------------------------------------------------------------------------------------------------------
// Uniformes partagés des retouches

// Découpe des murs (§20) : sphère autour du joueur projetée vers la caméra.
export const cutUniforms = {
  uCutTarget: { value: new Vector3() },
  uCutCam: { value: new Vector3() },
  uCutRadius: { value: 2.6 },
}

// Couche des signaux : profondeur de la scène et caméra.
export const overlayUniforms = {
  uSceneDepth: { value: null as DepthTexture | null },
  uViewport: { value: new Vector2(1, 1) },
  uCamNear: { value: 1 },
  uCamFar: { value: 100 },
}

// Lumière fixe du lieu pour les morts : position + portée, luminance × intensité de base ; lune et ambiance.
export const fixedLightUniforms = {
  uFixedPos: { value: Array.from({ length: MAX_FIXED_LIGHTS }, () => new Vector4()) },
  uFixedLum: { value: new Array<number>(MAX_FIXED_LIGHTS).fill(0) },
  uFixedCount: { value: 0 },
  uMoonDir: { value: new Vector3(0, 1, 0) },
  uMoonLum: { value: 0 },
  uDeadAmbient: { value: 0.05 },
  uLantern: { value: new Vector4(0, 1, 0, 10) },
  uLanternLum: { value: 0 },
  uCamPosW: { value: new Vector3() },
}

type Patch = (shader: WebGLProgramParametersWithUniforms) => void

const applyPatches = (m: Material, key: string, patches: readonly Patch[]): void => {
  m.onBeforeCompile = (shader) => {
    for (const p of patches) p(shader)
  }
  m.customProgramCacheKey = () => key
}

const WORLD_POS_VERT: Patch = (s) => {
  s.vertexShader = s.vertexShader.replace('void main() {', 'varying vec3 vE1World;\nvoid main() {').replace(
    '#include <project_vertex>',
    `#include <project_vertex>
  {
    vec4 e1w = vec4( transformed, 1.0 );
    #ifdef USE_INSTANCING
      e1w = instanceMatrix * e1w;
    #endif
    vE1World = ( modelMatrix * e1w ).xyz;
  }`,
  )
  s.fragmentShader = s.fragmentShader.replace('void main() {', 'varying vec3 vE1World;\nvoid main() {')
}

// Découpe : un fragment entre la caméra et le joueur, près de l'axe, est écarté selon un tramage (fondu).
const CUT: Patch = (s) => {
  Object.assign(s.uniforms, cutUniforms)
  s.fragmentShader = s.fragmentShader.replace(
    'void main() {',
    `${CUT_GLSL}\nvoid main() {\n  e1Cut( vE1World );`,
  )
}

// Boue : flaques d'eau stagnante (masque de bruit dans le monde), plus sombres, lisses et à plat ; occlusion au pied
// des murs de la fosse (distance au carré arrondi du mur).
const GROUND: (wallHalf: number, wallRadius: number) => Patch = (wallHalf, wallRadius) => (s) => {
  s.uniforms.uPuddleTint = { value: new Color(PALETTE.matiere.flaque) }
  s.fragmentShader = s.fragmentShader
    .replace(
      'void main() {',
      `${NOISE_GLSL}
uniform vec3 uPuddleTint;
float e1Puddle( vec2 p ) {
  float n = e1Fbm( p * 0.23 ) * 0.75 + e1Fbm( p * 0.9 + 3.1 ) * 0.25;
  return smoothstep( 0.5, 0.6, n );
}
float e1WallDist( vec2 p ) {
  vec2 q = abs( p ) - vec2( ${(wallHalf - wallRadius).toFixed(3)} );
  return ${wallRadius.toFixed(3)} - ( length( max( q, 0.0 ) ) + min( max( q.x, q.y ), 0.0 ) );
}
void main() {
  float e1P = e1Puddle( vE1World.xz );
  float e1Ao = mix( 0.45, 1.0, smoothstep( 0.0, 3.0, e1WallDist( vE1World.xz ) ) );`,
    )
    .replace(
      '#include <map_fragment>',
      `#include <map_fragment>
  diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * 0.35 + uPuddleTint * 0.25, e1P );
  diffuseColor.rgb *= e1Ao;`,
    )
    .replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>
  roughnessFactor = mix( roughnessFactor, 0.3, e1P );`,
    )
    .replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
  normal = normalize( mix( normal, normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz ), e1P * 0.92 ) );`,
    )
    .replace(
      '#include <aomap_fragment>',
      `#include <aomap_fragment>
  reflectedLight.indirectSpecular *= e1Ao;`,
    )
}

// Chair : un peu de lumière qui traverse (fausse diffusion sous la surface), proportionnelle à la couleur de
// l'instance, pour que la peau ne tombe jamais au noir complet.
const SKIN: Patch = (s) => {
  s.fragmentShader = s.fragmentShader.replace(
    '#include <emissivemap_fragment>',
    `#include <emissivemap_fragment>
  totalEmissiveRadiance += diffuseColor.rgb * 0.07;`,
  )
}

// ---------------------------------------------------------------------------------------------------------
// Fabriques

export interface PbrOptions {
  readonly tint: number
  readonly roughness?: number
  readonly metalness?: number
  readonly normalScale?: number
  readonly envIntensity?: number
  readonly side?: Side
  readonly useArmMetal?: boolean
  readonly transparent?: boolean
  readonly alphaTest?: number
}

export const pbr = (maps: SetMaps | null, o: PbrOptions): MeshStandardMaterial => {
  const m = new MeshStandardMaterial({
    color: o.tint,
    roughness: o.roughness ?? 1,
    metalness: o.metalness ?? 0,
    side: o.side ?? FrontSide,
    envMapIntensity: o.envIntensity ?? 0.25,
  })
  if (maps) {
    m.map = maps.albedo
    m.normalMap = maps.normal
    m.normalScale.set(o.normalScale ?? 1, o.normalScale ?? 1)
    m.roughnessMap = maps.arm
    m.aoMap = maps.arm
    m.aoMapIntensity = 0.8
    if (o.useArmMetal) m.metalnessMap = maps.arm
  }
  return m
}

// Sol de la fosse.
export const groundMaterial = (maps: SetMaps, wallHalf: number, wallRadius: number): MeshStandardMaterial => {
  const m = pbr(maps, { tint: PALETTE.matiere.boue, roughness: 1, normalScale: 0.8, envIntensity: 0.35 })
  applyPatches(m, `e1-ground-${wallHalf}-${wallRadius}`, [WORLD_POS_VERT, GROUND(wallHalf, wallRadius)])
  return m
}

// Décor découpé près de l'axe caméra-joueur (murs, rebords, pieux, silhouettes du bord).
export const cutMaterial = (m: MeshStandardMaterial, key: string): MeshStandardMaterial => {
  applyPatches(m, `e1-cut-${key}`, [WORLD_POS_VERT, CUT])
  m.userData.cut = true // passe d'identification : même découpe (idpass.ts)
  return m
}

export const skinMaterial = (normal: Texture | null): MeshStandardMaterial => {
  const m = new MeshStandardMaterial({ color: PALETTE.technique.neutre, roughness: 0.58, metalness: 0 })
  if (normal) {
    m.normalMap = normal
    m.normalScale.set(0.45, 0.45)
  }
  applyPatches(m, 'e1-skin', [SKIN])
  return m
}

// ---------------------------------------------------------------------------------------------------------
// Couche des signaux

const DEPTH_PATCH: Patch = (s) => {
  Object.assign(s.uniforms, overlayUniforms)
  s.fragmentShader = s.fragmentShader.replace(
    'void main() {',
    `${DEPTH_TEST_GLSL}\nvoid main() {\n  ${SCENE_DEPTH_CALL.signal}`,
  )
}

// Liseré, marques dorées, éclats : couleur exacte de la palette (aucune lumière, aucun étalonnage), testée contre
// la profondeur de la scène.
export const signalMaterial = (opts: {
  side?: Side
  transparent?: boolean
  opacity?: number
  depthWrite?: boolean
  depthTest?: boolean // faux : ignore la profondeur de la couche (télégraphes au-dessus des morts)
  polygonOffset?: number
  stripes?: boolean // hachures diagonales (remplissage des télégraphes : une forme que le sang n'a jamais)
}): MeshBasicMaterial => {
  const m = new MeshBasicMaterial({
    color: PALETTE.technique.neutre,
    side: opts.side ?? FrontSide,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    depthWrite: opts.depthWrite ?? true,
    depthTest: opts.depthTest ?? true,
  })
  if (opts.polygonOffset !== undefined) {
    m.polygonOffset = true
    m.polygonOffsetFactor = opts.polygonOffset
    m.polygonOffsetUnits = opts.polygonOffset
  }
  const patches = opts.stripes ? [DEPTH_PATCH, WORLD_POS_VERT, STRIPES] : [DEPTH_PATCH]
  applyPatches(m, `e1-signal-${opts.side === BackSide ? 'b' : 'f'}${opts.stripes ? '-h' : ''}`, patches)
  return m
}

const STRIPES: Patch = (s) => {
  s.fragmentShader = s.fragmentShader.replace(
    '#include <alphatest_fragment>',
    `float e1s = step( 0.5, fract( ( vE1World.x - vE1World.z ) * 2.4 ) );
  // Hatching: a colour band, then a near-black, more opaque band (black stands out on blood,
  // red stands out on mud).
  diffuseColor.rgb *= mix( 0.06, 1.0, e1s );
  diffuseColor.a = mix( max( diffuseColor.a, 0.62 ), diffuseColor.a, e1s );
  #include <alphatest_fragment>`,
  )
}

const DEAD_VERT = /* glsl */ `
varying vec3 vColor;
varying vec3 vNormalW;
varying vec3 vWorld;
void main() {
  vColor = instanceColor;
  vec4 w = modelMatrix * instanceMatrix * vec4( position, 1.0 );
  vWorld = w.xyz;
  mat3 nm = mat3( modelMatrix * instanceMatrix );
  vNormalW = normalize( nm * normal );
  gl_Position = projectionMatrix * viewMatrix * w;
}
`

const DEAD_FRAG = /* glsl */ `
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
varying vec3 vColor;
varying vec3 vNormalW;
varying vec3 vWorld;
${DEPTH_TEST_GLSL}
${TONEMAP_GLSL}
${GRADE_GLSL}
${FOG_GLSL}
void main() {
  ${SCENE_DEPTH_CALL.signal}
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
  // Lantern of the reliquary at base intensity (moves only with the player, and then the camera moves too).
  if ( uLanternLum > 0.0 ) {
    vec3 d = uLantern.xyz - vWorld;
    float dist = length( d );
    float win = pow( clamp( 1.0 - pow( dist / uLantern.w, 4.0 ), 0.0, 1.0 ), 2.0 );
    lum += uLanternLum * win / max( dist * dist, 0.01 ) * max( dot( n, d / dist ), 0.0 );
  }
  // Lambert: albedo / pi, as in three.
  vec3 c = vColor * lum * 0.3183099;
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

// Matière des morts (couche des signaux) : immobile au pixel près. Ni vacillement, ni lumière d'entité, ni grain ;
// un gris reste un gris (courbe de luminance seule).
export const deadMaterial = (): ShaderMaterial =>
  new ShaderMaterial({
    vertexShader: DEAD_VERT,
    fragmentShader: DEAD_FRAG,
    uniforms: { ...overlayUniforms, ...fixedLightUniforms, ...gradeUniforms, ...fogUniforms },
    side: FrontSide,
  })

export const disposeAll = (ms: readonly Material[]): void => {
  for (const m of ms) m.dispose()
}
