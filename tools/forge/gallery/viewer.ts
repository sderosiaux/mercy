// Scène de jugement : le modèle dans la lumière de la DA (noir dominant, torche qui vacille, lune froide,
// brouillard, tonalité ACES, vignettage, grain) ou en lumière neutre, vu à la caméra du jeu (§20, la même
// fonction que le rendu) ou en tour de modèle. Les clips sont lus avec la recette de la validation, à pas fixe
// de 60 i/s comme la simulation ; « Frapper » et « Mourir » appliquent la recette d'interruption et de gel.
import {
  ACESFilmicToneMapping,
  type AnimationAction,
  type AnimationClip,
  AnimationMixer,
  Box3,
  CircleGeometry,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  NoToneMapping,
  type Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PointLight,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three'
import { cameraPose } from '../../../src/render/camera'
import { type ClipRecipe, FRAME_S, freeze, interrupt, playClip } from '../playback'
import { flicker, LIGHTS, SCENE } from './theme'

export type CameraMode = 'jeu' | 'tour'
export type LightMode = 'da' | 'neutre'

export interface ViewerState {
  readonly clip: string | null
  readonly time: number
  readonly duration: number
  readonly impactS: number | null
  readonly frozen: boolean
}

export interface ModelInput {
  readonly root: Object3D
  readonly clips: readonly AnimationClip[]
  readonly hauteurM: number | null
  readonly recipes: ReadonlyMap<string, ClipRecipe>
  readonly reaction: string | null
}

const recipeOr = (recipes: ReadonlyMap<string, ClipRecipe>, clip: AnimationClip): ClipRecipe =>
  recipes.get(clip.name) ?? { name: clip.name, boucle: true, startS: 0, rate: 1, impactS: null }

export class Viewer {
  private readonly renderer: WebGLRenderer
  private readonly scene = new Scene()
  private readonly camera = new PerspectiveCamera(30, 16 / 10, 0.1, 200)
  private readonly torch = new PointLight(SCENE.torche, LIGHTS.torche, 0, 2)
  private readonly torch2 = new PointLight(SCENE.torche, LIGHTS.torcheLointaine, 0, 2)
  private readonly moon = new DirectionalLight(SCENE.lune, LIGHTS.lune)
  private readonly ambient = new HemisphereLight(SCENE.lune, SCENE.fond, LIGHTS.ambianteDA)
  private readonly neutralSky = new HemisphereLight(SCENE.neutre, SCENE.neutre, LIGHTS.neutreCiel)
  private readonly neutralSun = new DirectionalLight(SCENE.neutre, LIGHTS.neutreSoleil)
  private readonly fog = new Fog(SCENE.fond, LIGHTS.brouillardDebut, LIGHTS.brouillardFin)
  private model: ModelInput | null = null
  private mixer: AnimationMixer | null = null
  private current: { action: AnimationAction; recipe: ClipRecipe; clip: AnimationClip } | null = null
  private frozen = false
  private cameraMode: CameraMode = 'tour'
  private height = 1.8
  private clock = 0
  private acc = 0
  private last = performance.now()
  private raf = 0
  private listeners: ((s: ViewerState) => void)[] = []

  constructor(private readonly stage: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = LIGHTS.exposition
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = PCFSoftShadowMap
    this.renderer.setClearColor(SCENE.fond)
    stage.prepend(this.renderer.domElement)

    const ground = new Mesh(
      new CircleGeometry(30, 64),
      new MeshStandardMaterial({ color: SCENE.sol, roughness: 0.42, metalness: 0 }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    this.scene.add(ground)

    this.torch.position.set(2.2, 2.1, 1.6)
    this.torch.castShadow = true
    this.torch.shadow.mapSize.set(1024, 1024)
    this.torch.shadow.bias = -0.002
    this.torch2.position.set(-3.5, 1.8, -2.5)
    this.moon.position.set(-6, 10, -8)
    this.neutralSun.position.set(4, 10, 6)
    this.scene.add(this.torch, this.torch2, this.moon, this.ambient, this.neutralSky, this.neutralSun)
    this.setLight('da')

    new ResizeObserver(() => this.resize()).observe(stage)
    this.resize()
    this.loop()
  }

  onState(cb: (s: ViewerState) => void): void {
    this.listeners.push(cb)
  }

  setModel(input: ModelInput | null): void {
    if (this.model) this.scene.remove(this.model.root)
    this.mixer?.stopAllAction()
    this.mixer = null
    this.current = null
    this.frozen = false
    this.model = input
    if (!input) return
    const root = input.root
    root.traverse((o) => {
      o.castShadow = true
      o.frustumCulled = false
    })
    root.updateMatrixWorld(true)
    const box = new Box3().setFromObject(root)
    const h = Math.max(1e-3, box.max.y - box.min.y)
    const k = input.hauteurM !== null ? input.hauteurM / h : 1
    root.scale.multiplyScalar(k)
    root.updateMatrixWorld(true)
    const b2 = new Box3().setFromObject(root)
    const c = b2.getCenter(new Vector3())
    root.position.x -= c.x
    root.position.z -= c.z
    root.position.y -= b2.min.y
    this.height = b2.max.y - b2.min.y || 1.8
    this.scene.add(root)
    this.mixer = new AnimationMixer(root)
  }

  play(name: string): void {
    const clip = this.model?.clips.find((c) => c.name === name)
    if (!clip || !this.mixer || !this.model) return
    this.mixer.stopAllAction()
    this.mixer.timeScale = 1
    this.frozen = false
    const recipe = recipeOr(this.model.recipes, clip)
    this.current = { action: playClip(this.mixer.clipAction(clip), recipe), recipe, clip }
    this.mixer.update(0)
  }

  // Un coup qui touche : la recette d'interruption bascule vers la réaction (2 images à 60 i/s).
  hit(): boolean {
    const m = this.model
    const reaction = m?.reaction ? m.clips.find((c) => c.name === m.reaction) : undefined
    if (!m || !reaction || !this.mixer || !this.current || this.frozen) return false
    const recipe = recipeOr(m.recipes, reaction)
    const action = interrupt(this.current.action, this.mixer.clipAction(reaction), recipe)
    this.current = { action, recipe, clip: reaction }
    return true
  }

  // La mort : la pose courante se fige (horloge du mélangeur gelée), sans clip.
  die(): void {
    if (!this.mixer) return
    freeze(this.mixer)
    this.frozen = true
  }

  setCamera(mode: CameraMode): void {
    this.cameraMode = mode
  }

  setLight(mode: LightMode): void {
    const da = mode === 'da'
    for (const l of [this.torch, this.torch2, this.moon, this.ambient]) l.visible = da
    this.neutralSky.visible = !da
    this.neutralSun.visible = !da
    this.scene.fog = da ? this.fog : null
    this.renderer.toneMapping = da ? ACESFilmicToneMapping : NoToneMapping
    this.stage.classList.toggle('neutre', !da)
  }

  dispose(): void {
    cancelAnimationFrame(this.raf)
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  private resize(): void {
    const w = this.stage.clientWidth
    const h = this.stage.clientHeight
    if (w === 0 || h === 0) return
    this.renderer.setPixelRatio(1)
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  private placeCamera(): void {
    if (this.cameraMode === 'jeu') {
      const pose = cameraPose({
        focus: { x: 0, z: 0 },
        aim: null,
        aspect: this.camera.aspect,
        sentence: 0,
        shake: { x: 0, z: 0 },
      })
      this.camera.fov = pose.fovDeg
      this.camera.position.set(...pose.position)
      this.camera.lookAt(...pose.target)
    } else {
      const r = Math.max(3, this.height * 2.7)
      const a = this.clock * 0.35
      this.camera.fov = 30
      this.camera.position.set(Math.sin(a) * r, this.height * 0.62, Math.cos(a) * r)
      this.camera.lookAt(0, this.height * 0.5, 0)
    }
    this.camera.updateProjectionMatrix()
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop)
    const now = performance.now()
    this.acc = Math.min(this.acc + (now - this.last) / 1000, 5 * FRAME_S)
    this.last = now
    while (this.acc >= FRAME_S) {
      this.acc -= FRAME_S
      this.clock += FRAME_S
      this.mixer?.update(FRAME_S)
    }
    const f = flicker(this.clock)
    this.torch.intensity = LIGHTS.torche * f
    this.torch2.intensity = LIGHTS.torcheLointaine * flicker(this.clock + 3.1)
    this.placeCamera()
    this.renderer.render(this.scene, this.camera)
    const c = this.current
    const state: ViewerState = {
      clip: c?.clip.name ?? null,
      time: c ? c.action.time : 0,
      duration: c?.clip.duration ?? 0,
      impactS: c?.recipe.impactS ?? null,
      frozen: this.frozen,
    }
    for (const l of this.listeners) l(state)
  }
}
