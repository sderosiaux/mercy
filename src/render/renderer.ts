// Moteur de présentation (E1) sur three : lit un World (et le précédent, avec alpha), ne l'écrit jamais. Toute
// animation est une fonction de l'horloge de rendu t = tick précédent + alpha (en ticks) : rendre deux fois la même
// paire de mondes donne la même image (B2 I2).
//
// Image : décor de La Fosse (decor.ts), créatures vivantes et mortes, éclairés par le système de lumière (lights.ts,
// lightrig.ts), rendus en HDR ; gore (goreview.ts) ; post-traitement (post.ts : brouillard éclairé, halo des
// flammes, ACES, étalonnage, vignettage, grain) ; puis la couche des signaux par-dessus (liseré, marques,
// télégraphes, sceau), hors de l'étalonnage, testée contre la profondeur de la scène. Instruments de B2 §12 : I1
// (idPass), I2 (debug : secousse, isoler, masquer, lecture des pixels du canvas sans le HUD DOM ; rendus de jugement,
// à lumière figée et sans lumière, amendement A11), I4 (poses).
import {
  CubeUVReflectionMapping,
  Group,
  LinearFilter,
  type Material,
  Matrix4,
  Mesh,
  NoToneMapping,
  type Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  type Texture,
  UnsignedByteType,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three'
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js'
import { type Creature, PORTEUR_STAGE_KEY, sentenceTarget, TUNING, type Vec2, type World } from '../sim/index'
import { type AnimFrame, agonyKind } from './anim/machine'
import { BodyLayer } from './bodies'
import { CAMERAS, type CameraPreset, cameraPose, isCameraPreset, shakeOffset } from './camera'
import { RENDER } from './constants'
import { buildDecor, WALL_HALF } from './decor'
import { GoreMemory, PLAYER_STAIN, SPARK_TICKS } from './gore'
import { GoreLayer } from './goreview'
import { idMaterialFor } from './idpass'
import { DEAD_PROXY_LAYER, LightRig } from './lightrig'
import { entityLights, type LightSource } from './lights'
import { cutUniforms, overlayUniforms, pbr, skinMaterial, TextureBank } from './materials'
import { ModelLayer, type ModelsInfo } from './models/layer'
import { PALETTE } from './palette'
import { gradeUniforms, PostPipeline, setImageLight } from './post'
import { type QualityLevel, type QualitySpec, qualityFrom, urlParam } from './quality'
import {
  type Body,
  creatureBody,
  type Matter,
  PLAYER_ID,
  playerBody,
  type RigContext,
  type Segment,
  segmentCorners,
} from './rig'

export interface RendererOptions {
  readonly antialias?: boolean // canvas seulement (couche des signaux) ; P0 : faux (B2, mesures au pixel)
  readonly shadows?: boolean
  readonly shake?: boolean
  readonly pixelRatio?: number
  readonly preserveDrawingBuffer?: boolean
  readonly quality?: QualityLevel // sinon paramètre d'URL `qualite`, sinon haute
  readonly camera?: CameraPreset // sinon paramètre d'URL `camera`, sinon §20
  readonly assetBase?: string // racine des textures (Vite : BASE_URL)
  readonly models?: boolean // modèles de la Forge (E2) ; sinon paramètre d'URL `modeles=0` (segments du jalon 1), vrai par défaut
}

export interface PixelImage {
  readonly width: number
  readonly height: number
  readonly data: Uint8Array // RGBA, ligne 0 en haut
}

export interface SegmentPose {
  readonly part: string
  readonly role: 'corps' | 'marque' | 'autre'
  readonly matrix: readonly number[] // transformation monde, colonne majeure, échelle de la taille comprise
  readonly corners: readonly (readonly [number, number])[] // 8 coins projetés, pixels du canvas, y vers le bas
}

export interface EntityPose {
  readonly id: number
  readonly segments: readonly SegmentPose[]
}

export interface RenderStats {
  readonly calls: number
  readonly triangles: number
  readonly instances: number
  readonly decals: number // décalques à part (sang frais, flaques qui s'étendent)
  readonly absorbed: number // décalques passés dans la couche du sol (E7)
  readonly droplets: number // gouttelettes en vol
  readonly bodies: number
  readonly cpuMs: number
  readonly lights: number // lumières actives (créneaux allumés)
  readonly shadowLights: number
  readonly quality: QualityLevel
  readonly camera: CameraPreset
}

// Éclairage d'une image (B2, amendement A11). Jeu : l'image que voit le joueur. Jugement : chaque source (lieu et
// chandelle du Bourreau), l'ambiance, l'environnement, le brouillard et les teintes d'étalonnage gardent position, portée
// et luminance, leur couleur passe au neutre ; seules les matières gardent leur couleur. Figée : le jeu, avec les
// sources (positions, couleurs, intensités, vacillement compris), les flammes vues et la dérive du brouillard de
// l'image où la lumière a été figée (freezeLights). Sans : sources, ambiance, environnement et brouillard coupés,
// étalonnage inchangé ; seul ce qui émet reste visible.
export type LightMode = 'jeu' | 'jugement' | 'figee' | 'sans'

export interface LightInfo {
  readonly key: string
  readonly kind: string
  readonly weight: number
  readonly shadow: boolean
}

export interface RenderDebug {
  setShake(on: boolean): void
  isolate(id: number | null): void // n'afficher que cette entité (null : toutes)
  hide(ids: readonly number[]): void // masquer ces entités
  readPixels(): PixelImage // rend la dernière paire de mondes et lit le canvas (sans le HUD)
  idPass(): PixelImage // même image, passe d'identification
  poses(): readonly EntityPose[] // I4, pour la dernière image rendue
  stats(): RenderStats
  addDecal(pos: Vec2, size: number, born: number): void
  clearGore(): void // oublie décalques, éclats et dernier coup (nouvelle partie)
  gpu(): string
  project(x: number, y: number, z: number): readonly [number, number] // point monde → pixels CSS du canvas
  setCamera(preset: CameraPreset): void
  lights(): readonly LightInfo[] // sources actives de la dernière image
  syncFrameMs(): number // rend la dernière image et attend la fin du travail du GPU (temps de frame complet)
  setLightMode(mode: LightMode): void // éclairage des images suivantes (B2 I2, amendement A11)
  lightMode(): LightMode
  // Lumière figée : vrai, l'état des sources est pris à l'image suivante et gardé pour le mode « figee » jusqu'à faux.
  freezeLights(on: boolean): void
  models(): ModelsInfo // modèles de la Forge : chargement, temps, personnages absents (rendus en segments)
  bloodLayer(): ReturnType<GoreLayer['layer']['inspect']> // couche du sol (E7)
  anim(id: number): AnimFrame | null // dernière pose d'un corps modélisé : clips, instants, poids (séquences)
  // Arme du Bourreau en main (E6) : prise, bout, tranchant en coordonnées monde, et orientation affichée.
  weapon(): {
    weapon: string | null
    grip: number[]
    tip: number[]
    edge: number[]
    facing: number | null
  } | null
}

export interface Renderer {
  render(world: World, prev: World, alpha: number): void
  observe(world: World): void // évènements d'un pas (décalques, éclats), à appeler après chaque step
  setAim(aim: Vec2 | null): void
  screenToGround(x: number, y: number): Vec2
  ready(): Promise<void> // textures chargées et environnement capturé : l'image est alors définitive
  readonly debug: RenderDebug
  dispose(): void
}

// ---------------------------------------------------------------------------------------------------------

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
const lerpAngle = (a: number, b: number, t: number): number => {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a))
  return d === 0 ? a : a + d * t
}

// Un corps absorbé (sac du Porteur, Recousu assemblé) est dans son hôte ; mort avec lui (L5), il y reste.
const insideHost = (c: Creature): boolean =>
  c.state.kind === 'absorbe' || (c.state.kind === 'mort' && c.unionOf !== null && c.family !== 'membre')

const assetBaseDefault = (): string => {
  const env = (import.meta as unknown as { env?: { BASE_URL?: string } }).env
  return env?.BASE_URL ?? '/'
}

// Instrument (E5, attribuer une couleur à une lumière) : `sanslumiere=reliquaire,sac,priere` éteint ces sources
// d'entité (éclairage et brouillard). Lu au chargement du module : les outils de dev réécrivent l'URL au redémarrage.
const SANS_LUMIERE = new Set((urlParam('sanslumiere') ?? '').split(',').filter(Boolean))

export const createRenderer = (canvas: HTMLCanvasElement, options: RendererOptions = {}): Renderer => {
  const q: QualitySpec = qualityFrom(options.quality)
  const shadows = options.shadows ?? true
  let shake = options.shake ?? true
  const urlCam = urlParam('camera')
  let preset: CameraPreset = options.camera ?? (isCameraPreset(urlCam) ? urlCam : 'p20')
  const gl = new WebGLRenderer({
    canvas,
    antialias: options.antialias ?? false,
    preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
    powerPreference: 'high-performance',
    stencil: true, // liseré des modèles : masque de la silhouette de chaque corps (E2)
  })
  gl.outputColorSpace = SRGBColorSpace
  gl.toneMapping = NoToneMapping // la courbe de tons est dans la composition (post.ts)
  gl.setPixelRatio(options.pixelRatio ?? 1)
  gl.shadowMap.enabled = shadows
  gl.shadowMap.type = PCFShadowMap
  gl.info.autoReset = false

  const scene = new Scene()
  // Couche des signaux, en deux passes (bodies.ts) : sol, signaux des corps.
  const overlays = [new Scene(), new Scene()] as const
  const dynamic = new Group() // créatures (vivantes et mortes) et gore : masqués pendant la capture de l'environnement
  scene.add(dynamic)
  const camera = new PerspectiveCamera(RENDER.camera.fovDeg, 1, 1, 120)
  // three (r186) filtre les objets des passes d'ombre par les couches de la caméra principale, pas par celles des
  // caméras d'ombre : sans cette couche, les doublures d'ombre (morts, modèles) ne portaient aucune ombre. Elles sont
  // invisibles dans la passe principale (ni couleur ni profondeur).
  camera.layers.enable(DEAD_PROXY_LAYER)
  const bank = new TextureBank(options.assetBase ?? assetBaseDefault())
  const decor = buildDecor(bank, shadows ? q : { ...q, shadowLights: 0, moonShadow: false })
  scene.add(decor.group)
  const rig = new LightRig(scene, shadows ? q : { ...q, shadowLights: 0, moonShadow: false }, WALL_HALF)

  // Matières des segments vivants.
  const tissu = bank.set('tissu')
  const cuir = bank.set('cuir')
  const fer = bank.set('fer')
  const bois = bank.set('bois')
  const desat = (m: ReturnType<typeof pbr>, key: string): ReturnType<typeof pbr> => {
    // L'albédo du jeu de textures ne donne que la luminance ; la couleur vient de la palette (instance).
    m.onBeforeCompile = (s) => {
      s.fragmentShader = s.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
  diffuseColor.rgb = vec3( dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) ) * 2.2;`,
      )
    }
    m.customProgramCacheKey = () => `e1-desat-${key}`
    return m
  }
  const matterMaterials: Record<Matter, Material> = {
    chair: skinMaterial(cuir.normal),
    tissu: desat(
      pbr(tissu, { tint: PALETTE.technique.neutre, normalScale: 1.2, envIntensity: 0.05 }),
      'tissu',
    ),
    cuir: desat(
      pbr(cuir, { tint: PALETTE.technique.neutre, normalScale: 1, roughness: 0.8, envIntensity: 0.3 }),
      'cuir',
    ),
    fer: pbr(fer, { tint: PALETTE.technique.neutre, useArmMetal: true, envIntensity: 0.5 }),
    os: pbr(null, { tint: PALETTE.technique.neutre, roughness: 0.65 }),
    bois: pbr(bois, { tint: PALETTE.technique.neutre, normalScale: 1 }),
  }
  const bodies = new BodyLayer(
    { scene: dynamic, ground: overlays[0], signals: overlays[1] },
    matterMaterials,
    shadows,
  )
  const goreLayer = new GoreLayer(dynamic, q.level === 'basse')
  const models = new ModelLayer(
    { scene: dynamic, signals: overlays[1] },
    options.assetBase ?? assetBaseDefault(),
    q.level === 'basse',
    shadows,
    options.models ?? urlParam('modeles') !== '0',
    { fer, bois, cuir }, // armes du Bourreau en main (E6)
    PLAYER_ID,
  )

  let post: PostPipeline | null = null
  const gore = new GoreMemory()
  let aim: Vec2 | null = null
  let isolated: number | null = null
  let hidden = new Set<number>()
  let last: { world: World; prev: World; alpha: number } | null = null
  let lastBodies: Body[] = []
  let lastCpu = 0
  let lastLights: LightInfo[] = []
  let lastPlayerFacing: number | null = null // orientation affichée du Bourreau (instrument)
  let texturesLoaded = false
  let envCaptured = false
  let envTexture: Texture | null = null
  // Environnement des rendus de jugement (luminance) et sans lumière (noir), tirés de la capture (B2, A11).
  let envJudge: WebGLRenderTarget | null = null
  let envDark: WebGLRenderTarget | null = null
  let envShown: Texture | null = null
  let lightMode: LightMode = 'jeu'
  let frozen: { sources: LightSource[]; focus: Vec2; t: number } | null = null
  let freezeNext = false
  const deadCache = new Map<number, { key: string; body: Body }>()

  const visible = (id: number): boolean => (isolated === null ? !hidden.has(id) : id === isolated)

  const resize = (): void => {
    const w = Math.max(1, canvas.clientWidth || canvas.width)
    const h = Math.max(1, canvas.clientHeight || canvas.height)
    const pr = gl.getPixelRatio()
    if (canvas.width !== Math.floor(w * pr) || canvas.height !== Math.floor(h * pr)) gl.setSize(w, h, false)
    camera.aspect = w / h
    const ctx = gl.getContext()
    const bw = ctx.drawingBufferWidth
    const bh = ctx.drawingBufferHeight
    // La scène peut être rendue en dessous de la résolution du canvas (qualité basse) ; la couche des signaux, elle,
    // reste à pleine résolution et lit la profondeur de la scène en coordonnées normalisées.
    const sw = Math.max(1, Math.round(bw * q.renderScale))
    const sh = Math.max(1, Math.round(bh * q.renderScale))
    if (!post) post = new PostPipeline(q, sw, sh)
    post.setSize(sw, sh)
    overlayUniforms.uViewport.value.set(bw, bh)
    gradeUniforms.uResolution.value.set(bw, bh)
    overlayUniforms.uSceneDepth.value = post.depthTexture
    overlayUniforms.uSceneTag.value = post.sceneTarget.texture // alpha : morts (télégraphes par-dessus, shaders.ts)
  }

  // Phase partagée d'un groupe de Rituel : celle du plus petit id du groupe, qui ne quitte jamais le monde.
  const groupPhases = (w: World): Map<number, number> => {
    const m = new Map<number, number>()
    for (const c of w.creatures) if (c.group !== null && !m.has(c.group)) m.set(c.group, c.ritualPhase)
    return m
  }

  // Au-delà de 250 morts, les plus anciens s'enfoncent dans le sol en 3 s (§26).
  const sinkDepths = (w: World, t: number): Map<number, number> => {
    const at = (c: Creature): number => (c.state.kind === 'mort' ? c.state.at : 0)
    const dead = w.creatures.filter((c) => c.state.kind === 'mort' && !insideHost(c))
    const out = new Map<number, number>()
    if (dead.length <= RENDER.mortsMax) return out
    dead.sort((a, b) => at(a) - at(b) || a.id - b.id)
    for (let i = 0; i < dead.length - RENDER.mortsMax; i++) {
      const c = dead[i] as Creature
      const pusher = dead[i + RENDER.mortsMax] as Creature
      out.set(c.id, Math.min(1, Math.max(0, (t - at(pusher)) / RENDER.enfoncementTicks)))
    }
    return out
  }

  const ctxFor = (
    c: Creature,
    pc: Creature,
    t: number,
    dt: number,
    phases: Map<number, number>,
    target: number | null,
  ): RigContext => {
    const praying = c.family === 'confesseur' && c.action?.kind === 'canalisation'
    return {
      t,
      groupPhase: c.group !== null ? (phases.get(c.group) ?? c.ritualPhase) : c.ritualPhase,
      speed: (Math.hypot(c.pos.x - pc.pos.x, c.pos.z - pc.pos.z) * 60) / dt,
      targeted: target === c.id,
      limbStage: c.familyData[PORTEUR_STAGE_KEY] ?? 0,
      prayerColor: praying ? PALETTE.vertMaladif : null,
      diedStanding:
        c.state.kind === 'mort' && agonyKind(models.memory.track(c.id), c.state.at) === 'effondrement',
    }
  }

  // Environnement des reflets (boue mouillée, fer, sang frais) : capturé une fois, depuis le centre de la fosse,
  // à t = 0 (même image quel que soit le tick du premier rendu).
  const captureEnvironment = (): void => {
    if (!q.reflections) {
      envCaptured = true
      return
    }
    rig.update(decor.lights, { x: 0, z: 0 }, 0, 30)
    setImageLight('jeu')
    decor.update(0)
    dynamic.visible = false
    const pm = new PMREMGenerator(gl)
    const rt = pm.fromScene(scene, 0.02, 0.1, 90, { size: 256, position: new Vector3(0, 1.6, 0) })
    pm.dispose()
    dynamic.visible = true
    envTexture = rt.texture
    scene.traverse((o) => {
      if (o instanceof Mesh) {
        const m = o.material as Material & { envMap?: Texture | null }
        if (
          'envMap' in m &&
          m.envMap === null &&
          (m as { isMeshStandardMaterial?: boolean }).isMeshStandardMaterial
        ) {
          m.envMap = envTexture
          m.needsUpdate = true
        }
      }
    })
    models.setEnvironment(envTexture)
    envShown = envTexture
    envJudge = envVariant(rt, 'luminance')
    envDark = envVariant(rt, 'noir')
    envCaptured = true
  }

  // Copie de l'environnement capturé (même atlas cubique, même taille) : en luminance (jugement) ou noire (sans lumière).
  const envVariant = (src: WebGLRenderTarget, kind: 'luminance' | 'noir'): WebGLRenderTarget => {
    const rt = new WebGLRenderTarget(src.width, src.height, {
      type: src.texture.type,
      format: RGBAFormat,
      depthBuffer: false,
      generateMipmaps: false,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
    })
    rt.texture.mapping = CubeUVReflectionMapping
    const mat = new ShaderMaterial({
      uniforms: { tSrc: { value: src.texture }, uSize: { value: [src.width, src.height] } },
      vertexShader: 'void main() { gl_Position = vec4( position.xy, 0.0, 1.0 ); }',
      fragmentShader: `uniform sampler2D tSrc;
uniform vec2 uSize;
void main() {
  vec4 c = texture2D( tSrc, gl_FragCoord.xy / uSize );
  float y = dot( c.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
  gl_FragColor = vec4( vec3( ${kind === 'noir' ? '0.0' : 'y'} ), c.a );
}`,
      depthTest: false,
      depthWrite: false,
    })
    const quad = new FullScreenQuad(mat)
    const prev = gl.getRenderTarget()
    gl.setRenderTarget(rt)
    quad.render(gl)
    gl.setRenderTarget(prev)
    quad.dispose()
    mat.dispose()
    return rt
  }

  // Environnement montré par les matières : celui du jeu, sa luminance (jugement) ou rien (sans lumière).
  const showEnvironment = (tex: Texture | null): void => {
    if (!envCaptured || !tex || tex === envShown) return
    const known = new Set([envTexture, envJudge?.texture, envDark?.texture])
    scene.traverse((o) => {
      if (!(o instanceof Mesh)) return
      const m = o.material as Material & { envMap?: Texture | null }
      if ('envMap' in m && known.has(m.envMap ?? null)) m.envMap = tex
    })
    models.setEnvironment(tex)
    envShown = tex
  }

  const draw = (world: World, prev: World, alpha: number): void => {
    const t0 = performance.now()
    gl.info.reset() // compteurs de toute l’image : passes d’ombre, scène, post-traitement, couche des signaux
    gore.ingest(prev)
    gore.ingest(world)
    resize()
    const t = prev.tick + (world.tick - prev.tick) * alpha
    const dt = Math.max(1, world.tick - prev.tick)
    const prevById = new Map(prev.creatures.map((c) => [c.id, c]))
    const pp = world.player
    const ppPrev = prev.player
    const ppos = { x: lerp(ppPrev.pos.x, pp.pos.x, alpha), z: lerp(ppPrev.pos.z, pp.pos.z, alpha) }
    const act = pp.action
    const sentence = act?.kind === 'sentence' ? (t - act.start) / Math.max(1, act.end - act.start) : 0
    const sh = shake ? shakeOffset(gore.lastHit === null ? null : t - gore.lastHit, t) : { x: 0, z: 0 }
    const cam = cameraPose({ focus: ppos, aim, aspect: camera.aspect, sentence, shake: sh, preset })
    camera.position.set(cam.position[0], cam.position[1], cam.position[2])
    camera.lookAt(cam.target[0], cam.target[1], cam.target[2])
    camera.fov = cam.fovDeg
    camera.near = Math.max(1, cam.distance - 30)
    camera.far = cam.distance + 60
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld()

    bodies.begin()
    models.begin()
    const target = aim ? sentenceTarget(world, aim) : null
    const phases = groupPhases(world)
    const sinks = sinkDepths(world, t)
    const list: Body[] = []
    for (const c of world.creatures) {
      if (insideHost(c)) continue
      const sinkK = sinks.get(c.id) ?? 0
      if (sinkK >= 1) continue
      const shown = visible(c.id)
      const pc = prevById.get(c.id) ?? c
      const pos = { x: lerp(pc.pos.x, c.pos.x, alpha), z: lerp(pc.pos.z, c.pos.z, alpha) }
      const facing = lerpAngle(pc.facing, c.facing, alpha)
      const groupPhase = c.group !== null ? (phases.get(c.group) ?? c.ritualPhase) : c.ritualPhase
      // Modèle de la Forge s'il est prêt (un mort masqué reste dans son lot, invisible), sinon segments (E1).
      const modelCtx = {
        t,
        world,
        groupPhase,
        playerPos: ppos,
        targeted: target === c.id,
        sink: sinkK * 0.6,
        visible: shown,
        stain: gore.stain(c.id, t),
      }
      if (models.creature(c, pos, facing, modelCtx)) {
        if (shown) bodies.ground(c, pos, facing, t, world, target)
        continue
      }
      if (!shown) continue
      let body: Body
      if (c.state.kind === 'mort' && (c.spawn?.state === 'mort' || t - c.state.at >= TUNING.agonie)) {
        // Un mort dont l'agonie est finie ne change plus : sa pose est mise en cache.
        const key = `${c.state.at}|${pos.x}|${pos.z}|${facing}|${c.cicatrices}|${c.family}`
        const hit = deadCache.get(c.id)
        if (hit && hit.key === key) body = hit.body
        else {
          body = creatureBody(c, pos, facing, ctxFor(c, pc, t, dt, phases, target))
          deadCache.set(c.id, { key, body })
        }
      } else {
        body = creatureBody(c, pos, facing, ctxFor(c, pc, t, dt, phases, target))
      }
      list.push(body)
      bodies.push(body, c.state.kind === 'mort', sinkK * 0.6)
      bodies.ground(c, pos, facing, t, world, target)
    }
    if (visible(PLAYER_ID)) {
      // Orientation affichée (E6, anim/facing.ts) : virage court et lissé vers celle de la simulation, fini au tick du
      // coup ; à défaut de mondes observés, celle de la simulation interpolée.
      const pfacing = models.memory.playerFacing.at(t) ?? lerpAngle(ppPrev.facing, pp.facing, alpha)
      lastPlayerFacing = pfacing
      if (!models.player(ppos, pfacing, t, PLAYER_ID, pp.weapon, gore.stain(PLAYER_STAIN, t))) {
        const speed = (Math.hypot(pp.pos.x - ppPrev.pos.x, pp.pos.z - ppPrev.pos.z) * 60) / dt
        const pb = playerBody(pp, ppos, pfacing, t, speed)
        list.push(pb)
        bodies.push(pb, false, 0)
      }
    }
    models.end()
    for (const s of gore.sparks) {
      const age = t - s.born
      if (age < 0 || age >= SPARK_TICKS || !visible(s.id)) continue
      bodies.spark(s.x, s.z, s.born, age, camera.quaternion)
    }
    bodies.end()
    goreLayer.update(gore, t, camera.quaternion)
    lastBodies = list

    // Lumières : sources du décor et sources des entités visibles (une entité masquée emporte sa lumière). Lumière
    // figée : les sources, le point de vue de la sélection et l'instant de l'image où elle a été figée.
    const ents = entityLights(world, prev, alpha, t).filter(
      (s: LightSource) =>
        (s.owner === undefined || visible(s.owner < 0 ? PLAYER_ID : s.owner)) && !SANS_LUMIERE.has(s.kind),
    )
    const live = { sources: [...decor.lights, ...ents], focus: { x: cam.target[0], z: cam.target[2] }, t }
    if (freezeNext || (lightMode === 'figee' && !frozen)) {
      frozen = live
      freezeNext = false
    }
    const L = lightMode === 'figee' && frozen ? frozen : live
    rig.setLantern(L.sources.find((s) => s.kind === 'reliquaire') ?? null)
    if (texturesLoaded && !envCaptured) captureEnvironment()
    const viewRadius = CAMERAS[preset].champM * 0.72
    const look = lightMode === 'jugement' ? 'jugement' : lightMode === 'sans' ? 'sans' : 'jeu'
    setImageLight(look)
    showEnvironment(
      look === 'jugement'
        ? (envJudge?.texture ?? null)
        : look === 'sans'
          ? (envDark?.texture ?? null)
          : envTexture,
    )
    const frame = rig.update(L.sources, L.focus, L.t, viewRadius, look)
    lastLights = [
      ...frame.selection.shadowed.map((a) => ({
        key: a.src.key,
        kind: a.src.kind,
        weight: a.weight,
        shadow: true,
      })),
      ...frame.selection.point.map((a) => ({
        key: a.src.key,
        kind: a.src.kind,
        weight: a.weight,
        shadow: false,
      })),
    ]
    decor.update(t, L.t)
    cutUniforms.uCutTarget.value.set(ppos.x, 1.0, ppos.z)
    cutUniforms.uCutCam.value.copy(camera.position)
    overlayUniforms.uCamNear.value = camera.near
    overlayUniforms.uCamFar.value = camera.far

    const p = post as PostPipeline
    goreLayer.stamp(gl, gore, t) // couche du sol : le sang absorbé depuis l'image précédente
    p.renderScene(gl, scene, camera)
    p.compose(gl, camera, t, frame.fog, true, L.t)
    drawOverlays()
    lastCpu = performance.now() - t0
  }

  // Couche des signaux, par-dessus la scène, dans la cible courante : profondeur et gabarit effacés (chaque objet se
  // teste contre la profondeur de la scène dans son shader), puis sol, morts, télégraphes, signaux des corps. La
  // passe couleur et la passe d'identification passent toutes deux par ici (B2 I1 : même ordre, même profondeur).
  const drawOverlays = (): void => {
    gl.autoClear = false
    gl.clearDepth()
    gl.clearStencil()
    for (const o of overlays) gl.render(o, camera)
    gl.autoClear = true
  }

  // Lecture et passe d'identification ---------------------------------------------------------------------

  const flip = (w: number, h: number, src: Uint8Array): Uint8Array => {
    const out = new Uint8Array(w * h * 4)
    const row = w * 4
    for (let y = 0; y < h; y++) out.set(src.subarray((h - 1 - y) * row, (h - y) * row), y * row)
    return out
  }

  const readPixels = (): PixelImage => {
    if (last) draw(last.world, last.prev, last.alpha)
    const ctx = gl.getContext()
    const w = ctx.drawingBufferWidth
    const h = ctx.drawingBufferHeight
    const buf = new Uint8Array(w * h * 4)
    ctx.readPixels(0, 0, w, h, ctx.RGBA, ctx.UNSIGNED_BYTE, buf)
    return { width: w, height: h, data: flip(w, h, buf) }
  }

  let idTarget: WebGLRenderTarget | null = null
  const idPass = (): PixelImage => {
    if (last) draw(last.world, last.prev, last.alpha)
    const ctx = gl.getContext()
    const w = ctx.drawingBufferWidth
    const h = ctx.drawingBufferHeight
    if (!idTarget || idTarget.width !== w || idTarget.height !== h) {
      idTarget?.dispose()
      idTarget = new WebGLRenderTarget(w, h, {
        format: RGBAFormat,
        type: UnsignedByteType,
        samples: 0,
        stencilBuffer: true,
      })
    }
    const swapped: { o: Mesh; m: Material | Material[] }[] = []
    const hiddenObjs: Object3D[] = []
    const swap = (root: Object3D): void =>
      root.traverse((o) => {
        if (!(o instanceof Mesh) || !o.visible) return
        const idm = idMaterialFor(o)
        if (!idm) {
          o.visible = false
          hiddenObjs.push(o)
          return
        }
        swapped.push({ o, m: o.material })
        o.material = idm
      })
    swap(scene)
    for (const o of overlays) swap(o)
    const auto = gl.shadowMap.autoUpdate
    gl.shadowMap.autoUpdate = false
    // Même ordre que la passe couleur : la scène, puis la couche des signaux, qui se teste contre la profondeur de la
    // scène de l'image qu'on vient de rendre (uSceneDepth), pas contre celle de cette cible.
    gl.setRenderTarget(idTarget)
    gl.setClearColor(PALETTE.technique.fondId, 1)
    gl.clear(true, true, true)
    gl.autoClear = false
    gl.render(scene, camera)
    drawOverlays()
    const buf = new Uint8Array(w * h * 4)
    gl.readRenderTargetPixels(idTarget, 0, 0, w, h, buf)
    gl.setRenderTarget(null)
    gl.shadowMap.autoUpdate = auto
    for (const s of swapped) s.o.material = s.m
    for (const o of hiddenObjs) o.visible = true
    return { width: w, height: h, data: flip(w, h, buf) }
  }

  const project = (v: Vector3): [number, number] => {
    const ctx = gl.getContext()
    const p = v.clone().project(camera)
    return [((p.x + 1) / 2) * ctx.drawingBufferWidth, ((1 - p.y) / 2) * ctx.drawingBufferHeight]
  }

  const poses = (): EntityPose[] => [
    ...lastBodies.map((b) => ({
      id: b.id,
      segments: b.segments.map((s: Segment) => {
        const m = new Matrix4().multiplyMatrices(
          s.frame,
          new Matrix4().makeScale(s.size[0], s.size[1], s.size[2]),
        )
        return {
          part: s.part,
          role: s.role,
          matrix: Array.from(m.elements),
          corners: segmentCorners(s).map(project),
        }
      }),
    })),
    // Modèles de la Forge : un segment par os (boîte de ses sommets), Membre errant : un segment.
    ...[...models.segments()].map(([id, segs]) => ({
      id,
      segments: segs.map((s) => ({
        part: s.part,
        role: 'corps' as const,
        matrix: Array.from(s.matrix.elements),
        corners: s.corners.map(project),
      })),
    })),
  ]

  const screenToGround = (x: number, y: number): Vec2 => {
    const w = Math.max(1, canvas.clientWidth || canvas.width)
    const h = Math.max(1, canvas.clientHeight || canvas.height)
    const v = new Vector3((x / w) * 2 - 1, 1 - (y / h) * 2, 0.5).unproject(camera)
    const dir = v.sub(camera.position).normalize()
    if (Math.abs(dir.y) < 1e-6) return { x: camera.position.x, z: camera.position.z }
    const k = -camera.position.y / dir.y
    return { x: camera.position.x + dir.x * k, z: camera.position.z + dir.z * k }
  }

  // Prêt : textures chargées, environnement capturé, modèles de la Forge chargés (ou écartés).
  const readyPromise = Promise.all([
    bank.ready.then(() => {
      texturesLoaded = true
      if (last) draw(last.world, last.prev, last.alpha)
    }),
    models.load.done,
  ]).then(() => {
    if (last) draw(last.world, last.prev, last.alpha)
  })

  return {
    render(world, prev, alpha) {
      last = { world, prev, alpha }
      draw(world, prev, alpha)
    },
    observe(world) {
      gore.ingest(world)
      models.observe(world)
    },
    setAim(p) {
      aim = p
    },
    screenToGround,
    ready: () => readyPromise,
    debug: {
      setShake(on) {
        shake = on
      },
      isolate(id) {
        isolated = id
      },
      hide(ids) {
        hidden = new Set(ids)
      },
      readPixels,
      idPass,
      poses,
      stats: () => ({
        calls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        instances: bodies.instances,
        decals: gore.decals.length,
        absorbed: gore.absorbed.length,
        droplets: gore.droplets.length,
        bodies: lastBodies.length + models.count,
        cpuMs: lastCpu,
        lights: lastLights.filter((l) => l.weight > 0).length,
        shadowLights: lastLights.filter((l) => l.shadow && l.weight > 0).length,
        quality: q.level,
        camera: preset,
      }),
      clearGore() {
        gore.clear()
        models.clear()
      },
      addDecal(pos, s, born) {
        gore.add(pos, s, born)
      },
      project(x, y, z) {
        const p = new Vector3(x, y, z).project(camera)
        const w = Math.max(1, canvas.clientWidth || canvas.width)
        const h = Math.max(1, canvas.clientHeight || canvas.height)
        return [((p.x + 1) / 2) * w, ((1 - p.y) / 2) * h] as const
      },
      gpu() {
        const ctx = gl.getContext()
        const ext = ctx.getExtension('WEBGL_debug_renderer_info')
        return ext ? String(ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'inconnu'
      },
      setCamera(p) {
        preset = p
      },
      lights: () => lastLights,
      models: () => models.info(),
      bloodLayer: () => goreLayer.layer.inspect(gl),
      anim: (id) => models.frame(id),
      weapon: () => {
        const w = models.weaponPose()
        return w ? { ...w, facing: lastPlayerFacing } : null
      },
      setLightMode(mode) {
        lightMode = mode
      },
      lightMode: () => lightMode,
      freezeLights(on) {
        frozen = null
        freezeNext = on
      },
      syncFrameMs() {
        const t1 = performance.now()
        if (last) draw(last.world, last.prev, last.alpha)
        const ctx = gl.getContext()
        const px = new Uint8Array(4)
        ctx.readPixels(0, 0, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px)
        return performance.now() - t1
      },
    },
    dispose() {
      bodies.dispose()
      models.dispose()
      goreLayer.dispose()
      decor.dispose()
      rig.dispose()
      post?.dispose()
      idTarget?.dispose()
      envTexture?.dispose()
      envJudge?.dispose()
      envDark?.dispose()
      for (const m of Object.values(matterMaterials)) m.dispose()
      gl.dispose()
    },
  }
}
