// Chaîne de post-traitement (E1) : scène rendue en HDR (demi-flottants) avec une texture de profondeur, halo des
// flammes (bloom, seuil haut : seules les flammes, le halo de prière et la lueur du sac le dépassent), puis une
// passe de composition : brouillard bas éclairé par la lune et par les lumières actives, exposition, courbe ACES,
// étalonnage froid et désaturé, vignettage, grain. Le résultat va au canvas ; la couche des signaux (liserés,
// marques, morts, télégraphes) se dessine ensuite par-dessus, hors de cette chaîne.
import {
  Color,
  DepthTexture,
  FloatType,
  HalfFloatType,
  LinearFilter,
  Matrix4,
  NearestFilter,
  type PerspectiveCamera,
  RGBAFormat,
  type Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  type WebGLRenderer,
  WebGLRenderTarget,
} from 'three'
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { PALETTE } from './palette'
import type { QualitySpec } from './quality'
import { FOG_GLSL, GRADE_GLSL, MAX_FOG_LIGHTS, NOISE_GLSL, TONEMAP_GLSL } from './shaders'

// Réglages de l'image (forme, E1). Partagés avec la matière des morts par `gradeUniforms`.
export const LOOK = {
  exposure: 2.8,
  saturation: 0.72,
  contrast: 1.12,
  tintAmount: 0.5,
  vignette: 0.5,
  grain: 0.035,
  fogDensity: 0.09, // /m au niveau du sol
  fogFalloff: 0.85, // /m : le brouillard tombe de e à chaque 1,2 m de hauteur
  fogScatter: 0.35,
  bloomStrength: 0.28,
  bloomRadius: 0.45,
  bloomThreshold: 2.2, // luminance scène : au-dessus des surfaces éclairées, sous les flammes
} as const

const linear = (hex: number): Vector3 => {
  const c = new Color(hex) // converti en linéaire (gestion des couleurs de three)
  return new Vector3(c.r, c.g, c.b)
}

// Teinte d'étalonnage : la couleur de la palette ramenée à une luminance de 1, adoucie (multiplicateur proche de 1).
const tintOf = (hex: number, softness: number): Vector3 => {
  const c = linear(hex)
  const l = 0.2126 * c.x + 0.7152 * c.y + 0.0722 * c.z
  return new Vector3((c.x / l) ** softness, (c.y / l) ** softness, (c.z / l) ** softness)
}

// Uniformes d'étalonnage et de brouillard partagés (mêmes objets dans toutes les matières qui les lisent).
export const gradeUniforms = {
  uExposure: { value: LOOK.exposure as number },
  uSaturation: { value: LOOK.saturation as number },
  uContrast: { value: LOOK.contrast as number },
  uShadowTint: { value: tintOf(PALETTE.etalonnage.ombres, 0.4) },
  uHighlightTint: { value: tintOf(PALETTE.etalonnage.lumieres, 0.4) },
  uTintAmount: { value: LOOK.tintAmount as number },
  uVignette: { value: LOOK.vignette as number },
  uResolution: { value: new Vector2(1, 1) },
}

export const fogUniforms = {
  uFogDensity: { value: LOOK.fogDensity as number },
  uFogFalloff: { value: LOOK.fogFalloff as number },
  uFogAmbient: { value: linear(PALETTE.brouillard.ambiant) },
  uFogScatter: { value: LOOK.fogScatter as number },
}

export interface FogLight {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly range: number
  readonly r: number // couleur × intensité, linéaire
  readonly g: number
  readonly b: number
}

const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform mat4 uProjInv;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform float uExposure;
uniform vec2 uResolution;
uniform float uGrain;
uniform float uFrame;
uniform float uTime;
uniform vec4 uFogLightPos[ ${MAX_FOG_LIGHTS} ];
uniform vec3 uFogLightColor[ ${MAX_FOG_LIGHTS} ];
uniform int uFogLightCount;
varying vec2 vUv;
${TONEMAP_GLSL}
${GRADE_GLSL}
${FOG_GLSL}
${NOISE_GLSL}
void main() {
  vec3 c = texture2D( tScene, vUv ).rgb;
  float depth = texture2D( tDepth, vUv ).x;
  vec4 ndc = vec4( vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0 );
  vec4 view = uProjInv * ndc;
  view /= view.w;
  vec3 world = ( uCamWorld * view ).xyz;
  if ( depth < 1.0 ) {
    // Slowly drifting mist patches: density varies over the ground plane.
    float patchy = 0.55 + 0.9 * e1Fbm( world.xz * 0.11 + vec2( uTime * 0.012, uTime * 0.007 ) );
    float tau = e1FogDepth( uCamPos, world ) * patchy;
    float T = exp( - tau );
    vec3 inscatter = uFogAmbient * ( 1.0 - T );
    for ( int i = 0; i < ${MAX_FOG_LIGHTS}; i ++ ) {
      if ( i >= uFogLightCount ) break;
      inscatter += e1Airlight( uCamPos, world, uFogLightPos[ i ].xyz, uFogLightColor[ i ], uFogLightPos[ i ].w ) * patchy;
    }
    c = c * T + inscatter * uFogScatter;
  }
  c = e1Aces( c * uExposure );
  c = e1Grade( c, 0.0 );
  c *= e1VignetteAt( vUv, uResolution );
  // Grain: deterministic noise (pixel, frame), stronger in the midtones.
  vec2 gp = gl_FragCoord.xy + vec2( mod( uFrame, 97.0 ) * 13.17, mod( uFrame, 89.0 ) * 7.31 );
  float n = fract( sin( dot( gp, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) - 0.5;
  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  c += n * uGrain * ( 0.35 + 0.65 * smoothstep( 0.0, 0.25, l ) * ( 1.0 - smoothstep( 0.5, 1.0, l ) ) );
  gl_FragColor = vec4( e1LinearToSrgb( clamp( c, 0.0, 1.0 ) ), 1.0 );
}
`

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }
`

export class PostPipeline {
  readonly sceneTarget: WebGLRenderTarget
  private readonly bloom: UnrealBloomPass | null
  private readonly composite: ShaderMaterial
  private readonly quad: FullScreenQuad
  private readonly fogPos: Vector4[]
  private readonly fogCol: Vector3[]
  private readonly projInv = new Matrix4()
  private readonly camWorld = new Matrix4()
  private readonly camPos = new Vector3()

  constructor(
    private readonly quality: QualitySpec,
    width: number,
    height: number,
  ) {
    const depthTexture = new DepthTexture(width, height, FloatType)
    depthTexture.minFilter = NearestFilter
    depthTexture.magFilter = NearestFilter
    this.sceneTarget = new WebGLRenderTarget(width, height, {
      type: HalfFloatType,
      format: RGBAFormat,
      depthBuffer: true,
      depthTexture,
      samples: 0, // P0 : pas de MSAA (mesures de B2 au pixel)
      minFilter: LinearFilter,
      magFilter: LinearFilter,
    })
    this.bloom = quality.bloom
      ? new UnrealBloomPass(
          new Vector2(width, height),
          LOOK.bloomStrength,
          LOOK.bloomRadius,
          LOOK.bloomThreshold,
        )
      : null
    this.fogPos = Array.from({ length: MAX_FOG_LIGHTS }, () => new Vector4())
    this.fogCol = Array.from({ length: MAX_FOG_LIGHTS }, () => new Vector3())
    this.composite = new ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: COMPOSITE_FRAG,
      uniforms: {
        tScene: { value: this.sceneTarget.texture },
        tDepth: { value: depthTexture },
        uProjInv: { value: this.projInv },
        uCamWorld: { value: this.camWorld },
        uCamPos: { value: this.camPos },
        uGrain: { value: quality.grain ? LOOK.grain : 0 },
        uFrame: { value: 0 },
        uTime: { value: 0 },
        uFogLightPos: { value: this.fogPos },
        uFogLightColor: { value: this.fogCol },
        uFogLightCount: { value: 0 },
        ...gradeUniforms,
        ...fogUniforms,
      },
      depthTest: false,
      depthWrite: false,
    })
    this.quad = new FullScreenQuad(this.composite)
  }

  get depthTexture(): DepthTexture {
    return this.sceneTarget.depthTexture as DepthTexture
  }

  setSize(width: number, height: number): void {
    if (this.sceneTarget.width === width && this.sceneTarget.height === height) return
    this.sceneTarget.setSize(width, height)
    this.bloom?.setSize(width, height)
  }

  // Rend la scène dans la cible HDR (à appeler avant compose).
  renderScene(gl: WebGLRenderer, scene: Scene, camera: PerspectiveCamera): void {
    gl.setRenderTarget(this.sceneTarget)
    gl.setClearColor(PALETTE.noir, 1)
    gl.clear(true, true, true)
    gl.render(scene, camera)
  }

  // Halo des flammes, brouillard, tons, étalonnage, vignettage, grain → canvas.
  compose(
    gl: WebGLRenderer,
    camera: PerspectiveCamera,
    t: number,
    fogLights: readonly FogLight[],
    grain: boolean,
  ): void {
    if (this.bloom) this.bloom.render(gl, null as unknown as WebGLRenderTarget, this.sceneTarget, 0, false)
    const u = this.composite.uniforms
    this.projInv.copy(camera.projectionMatrixInverse)
    this.camWorld.copy(camera.matrixWorld)
    this.camPos.copy(camera.position)
    if (u.uFrame) u.uFrame.value = Math.floor(t)
    if (u.uTime) u.uTime.value = t / 60
    if (u.uGrain) u.uGrain.value = grain && this.quality.grain ? LOOK.grain : 0
    const n = Math.min(MAX_FOG_LIGHTS, fogLights.length)
    for (let i = 0; i < n; i++) {
      const f = fogLights[i] as FogLight
      ;(this.fogPos[i] as Vector4).set(f.x, f.y, f.z, f.range)
      ;(this.fogCol[i] as Vector3).set(f.r, f.g, f.b)
    }
    if (u.uFogLightCount) u.uFogLightCount.value = n
    gl.setRenderTarget(null)
    this.quad.render(gl)
  }

  dispose(): void {
    this.sceneTarget.depthTexture?.dispose()
    this.sceneTarget.dispose()
    this.bloom?.dispose()
    this.composite.dispose()
    this.quad.dispose()
  }
}
