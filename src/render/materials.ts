// Matières du moteur de présentation (E1) : PBR (albédo, normale, occlusion/rugosité/métal) chargées depuis
// public/textures (manifeste : scripts/fetch-textures.ts), teintées par la palette, et quelques retouches de shader :
// flaques de la boue (eau stagnante qui reflète les flammes), occlusion au pied des murs, découpe des murs entre la
// caméra et le joueur (§20), translucidité de la chair. La matière des morts (segments du jalon 1) et le test de
// profondeur de la couche des signaux sont ici aussi : un mort est dans la scène éclairée, sous la lumière du lieu
// comme tout le reste (E8).
import {
  BackSide,
  Color,
  type DepthTexture,
  FrontSide,
  LoadingManager,
  type Material,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NoBlending,
  RepeatWrapping,
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
import { SCENE_TAG } from './post'
import { CUT_GLSL, DEPTH_TEST_GLSL, NOISE_GLSL, SCENE_DEPTH_CALL, type SceneDepth } from './shaders'

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

// Couche des signaux : profondeur de la scène, son alpha (masque des personnages et des morts, post.ts) et caméra.
export const overlayUniforms = {
  uSceneDepth: { value: null as DepthTexture | null },
  uSceneTag: { value: null as Texture | null },
  uViewport: { value: new Vector2(1, 1) },
  uCamNear: { value: 1 },
  uCamFar: { value: 100 },
}

// Chandelle du reliquaire (position, portée), pour la règle de l'arme (models/weapons.ts).
export const lanternUniforms = {
  uLantern: { value: new Vector4(0, -1000, 0, 0) },
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

const DEPTH_PATCH =
  (depth: SceneDepth): Patch =>
  (s) => {
    Object.assign(s.uniforms, overlayUniforms)
    s.fragmentShader = s.fragmentShader.replace(
      'void main() {',
      `${DEPTH_TEST_GLSL}\nvoid main() {\n  ${SCENE_DEPTH_CALL[depth]}`,
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
  sceneDepth?: 'signal' | 'télégraphe' // télégraphe : un mort ne le cache pas (shaders.ts)
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
  const depth = opts.sceneDepth ?? 'signal'
  const patches = opts.stripes ? [DEPTH_PATCH(depth), WORLD_POS_VERT, STRIPES] : [DEPTH_PATCH(depth)]
  applyPatches(
    m,
    `e1-signal-${opts.side === BackSide ? 'b' : 'f'}${opts.stripes ? '-h' : ''}-${depth === 'signal' ? 's' : 't'}`,
    patches,
  )
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

// Ordre de dessin des morts dans la scène (E8) : dans la liste transparente, après la brume de sang (goreview.ts, 3)
// et avant les flammes (decor.ts, 5), sans mélange et en écrivant la profondeur. Ainsi la brume rouge, voile sans
// profondeur, ne teint jamais un mort (§17.1 : « le corps d'un mort reste gris ; son sang, sous lui et autour de lui,
// ne l'est pas »), comme quand les morts étaient dans la couche des signaux ; une flamme devant un mort l'éclaire.
export const DEAD_RENDER_ORDER = 4

// Morts en segments (jalon 1, quand un modèle de la Forge manque) : dans la scène éclairée, comme les vivants (E8). La
// couleur de l'instance est le gris du corps (rig.ts, look.ts : la luminance de sa couleur vivante, sans
// éclaircissement) ; la lumière du lieu s'y applique comme au sol, chandelle du Bourreau comprise. Aucune émission :
// dans le noir, un mort se voit à peine. Alpha de la scène : SCENE_TAG.mort (grain immobile sur un mort, post.ts).
export const deadMaterial = (): MeshStandardMaterial => {
  const m = new MeshStandardMaterial({
    color: PALETTE.technique.neutre,
    roughness: 0.7,
    metalness: 0,
    envMapIntensity: 0.25,
    transparent: true, // liste transparente, après la brume (DEAD_RENDER_ORDER) ; aucun mélange
    blending: NoBlending,
  })
  m.forceSinglePass = true
  applyPatches(m, 'e8-mort-segments', [
    (s) => {
      s.fragmentShader = s.fragmentShader.replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>\n  gl_FragColor.a = ${SCENE_TAG.mort.toFixed(4)};`,
      )
    },
  ])
  return m
}

export const disposeAll = (ms: readonly Material[]): void => {
  for (const m of ms) m.dispose()
}
