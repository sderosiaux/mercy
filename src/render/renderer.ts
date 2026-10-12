// Rendu three de P0 : lit un World (et le précédent, avec alpha), ne l'écrit jamais. Toute animation est une
// fonction de l'horloge de rendu t = tick précédent + alpha (en ticks, soit t / 60 s) : rendre deux fois la même
// paire de mondes donne la même image. Instruments de B2 §12 : I1 (idPass), I2 (debug : secousse, isoler,
// masquer, lecture des pixels du canvas sans le HUD DOM), I4 (poses).
import {
  BackSide,
  BoxGeometry,
  type BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Euler,
  HemisphereLight,
  InstancedBufferAttribute,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  RGBAFormat,
  RingGeometry,
  Scene,
  type ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  UnsignedByteType,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three'
import {
  actionPhase,
  type Creature,
  PORTEUR_STAGE_KEY,
  sentenceTarget,
  TUNING,
  type Vec2,
  type World,
} from '../sim/index'
import { cameraPose, shakeOffset } from './camera'
import { RENDER } from './constants'
import { GoreMemory, SPARK_TICKS } from './gore'
import { encodeId, instancedIdMaterial, ROLE, uniformIdMaterial } from './idpass'
import { decalColor, telegraphColor } from './look'
import { PALETTE } from './palette'
import {
  type Body,
  creatureBody,
  PLAYER_ID,
  playerBody,
  type RigContext,
  type Segment,
  type Shape,
  segmentCorners,
} from './rig'

export interface RendererOptions {
  readonly antialias?: boolean
  readonly shadows?: boolean
  readonly shake?: boolean
  readonly pixelRatio?: number
  readonly preserveDrawingBuffer?: boolean
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
  readonly decals: number
  readonly bodies: number
  readonly cpuMs: number
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
}

export interface Renderer {
  render(world: World, prev: World, alpha: number): void
  observe(world: World): void // évènements d'un pas (décalques, éclats), à appeler après chaque step
  setAim(aim: Vec2 | null): void
  screenToGround(x: number, y: number): Vec2
  readonly debug: RenderDebug
  dispose(): void
}

// ---------------------------------------------------------------------------------------------------------
// Lots instanciés : une forme × une matière. Chaque lot a sa géométrie, donc son attribut d'identification.

const RIM_M = 0.04 // forme (C4) : épaisseur du liseré, m
const RIM_STRONG_M = 0.065 // liseré intensifié sous le curseur de Sentence (§21)

const unitGeometry = (s: Shape): BufferGeometry => {
  switch (s) {
    case 'box':
      return new BoxGeometry(1, 1, 1)
    case 'sphere':
      return new SphereGeometry(0.5, 18, 12)
    case 'cylinder':
      return new CylinderGeometry(0.5, 0.5, 1, 16)
    case 'cone':
      return new ConeGeometry(0.5, 1, 18)
    case 'torus':
      return new TorusGeometry(0.45, 0.05, 8, 28)
  }
}

type Kind = 'lit' | 'flat' | 'glow' | 'rim'

interface BatchSpec {
  readonly geometry: () => BufferGeometry
  readonly material: Material
  readonly idMaterial: ShaderMaterial
  readonly capacity: number
  readonly cast: boolean
  readonly receive: boolean
  readonly renderOrder?: number
}

class Batch {
  mesh: InstancedMesh
  private ids: InstancedBufferAttribute
  count = 0
  private capacity: number
  private readonly color = new Color()

  constructor(
    private readonly scene: Scene,
    private readonly spec: BatchSpec,
  ) {
    this.capacity = spec.capacity
    const built = this.build(this.capacity)
    this.mesh = built.mesh
    this.ids = built.ids
  }

  private build(capacity: number): { mesh: InstancedMesh; ids: InstancedBufferAttribute } {
    const geo = this.spec.geometry()
    const ids = new InstancedBufferAttribute(new Uint8Array(capacity * 3), 3, true)
    geo.setAttribute('aId', ids)
    const mesh = new InstancedMesh(geo, this.spec.material, capacity)
    mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
    mesh.frustumCulled = false
    mesh.count = 0
    mesh.castShadow = this.spec.cast
    mesh.receiveShadow = this.spec.receive
    mesh.renderOrder = this.spec.renderOrder ?? 0
    mesh.userData.idMaterial = this.spec.idMaterial
    this.scene.add(mesh)
    return { mesh, ids }
  }

  begin(): void {
    this.count = 0
  }

  push(m: Matrix4, hex: number, id: number, role: number): void {
    if (this.count >= this.capacity) this.grow()
    const i = this.count++
    this.mesh.setMatrixAt(i, m)
    this.mesh.setColorAt(i, this.color.setHex(hex))
    const [r, g, b] = encodeId(id, role)
    const a = this.ids.array as Uint8Array
    a[i * 3] = r
    a[i * 3 + 1] = g
    a[i * 3 + 2] = b
  }

  private grow(): void {
    const old = this.mesh
    const oldIds = this.ids
    const n = this.count
    this.capacity *= 2
    const built = this.build(this.capacity)
    built.mesh.instanceMatrix.array.set(old.instanceMatrix.array.subarray(0, n * 16))
    const oc = old.instanceColor
    if (oc && built.mesh.instanceColor) built.mesh.instanceColor.array.set(oc.array.subarray(0, n * 3))
    ;(built.ids.array as Uint8Array).set((oldIds.array as Uint8Array).subarray(0, n * 3))
    this.scene.remove(old)
    old.geometry.dispose()
    old.dispose()
    this.mesh = built.mesh
    this.ids = built.ids
  }

  end(): void {
    this.mesh.count = this.count
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
    this.ids.needsUpdate = true
  }

  dispose(): void {
    this.scene.remove(this.mesh)
    this.mesh.geometry.dispose()
    this.mesh.dispose()
  }
}

// ---------------------------------------------------------------------------------------------------------
// Objets au sol réutilisés d'une image à l'autre (télégraphes, halos de prière, sceau)

class Pool {
  private readonly items: Mesh[] = []
  private used = 0
  constructor(
    private readonly scene: Scene,
    private readonly make: () => Mesh,
  ) {}
  begin(): void {
    this.used = 0
  }
  next(): Mesh {
    let m = this.items[this.used]
    if (!m) {
      m = this.make()
      this.items.push(m)
      this.scene.add(m)
    }
    this.used++
    m.visible = true
    return m
  }
  end(): void {
    for (let i = this.used; i < this.items.length; i++) {
      const m = this.items[i]
      if (m) m.visible = false
    }
  }
  dispose(): void {
    for (const m of this.items) {
      this.scene.remove(m)
      ;(m.material as Material).dispose()
    }
  }
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

export const createRenderer = (canvas: HTMLCanvasElement, options: RendererOptions = {}): Renderer => {
  const shadows = options.shadows ?? true
  let shake = options.shake ?? true
  const gl = new WebGLRenderer({
    canvas,
    antialias: options.antialias ?? true,
    preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
    powerPreference: 'high-performance',
  })
  gl.outputColorSpace = SRGBColorSpace
  gl.setPixelRatio(options.pixelRatio ?? 1)
  gl.shadowMap.enabled = shadows
  gl.shadowMap.type = PCFShadowMap

  const scene = new Scene()
  scene.background = new Color(PALETTE.noir)
  const camera = new PerspectiveCamera(RENDER.camera.fovDeg, 1, 1, 120)

  // Une source dominante, ombres franches (§17) ; lumière neutre pour ne pas teinter les morts (B2.O1).
  scene.add(new HemisphereLight(PALETTE.lumiere.ciel, PALETTE.lumiere.sol, 1.15))
  const sun = new DirectionalLight(PALETTE.lumiere.soleil, 2.2)
  sun.position.set(-6, 14, 4)
  sun.target.position.set(0, 0, 0)
  sun.castShadow = shadows
  const half = TUNING.arenaHalf + 2
  sun.shadow.camera.left = -half
  sun.shadow.camera.right = half
  sun.shadow.camera.top = half
  sun.shadow.camera.bottom = -half
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 40
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.bias = -0.0006
  sun.shadow.normalBias = 0.02
  scene.add(sun)
  scene.add(sun.target)

  // Sol de l'arène : dalles de pierre grise, joints sombres, bordure noire.
  const size = TUNING.arenaHalf * 2
  const ground = new Mesh(
    new PlaneGeometry(size, size),
    new MeshStandardMaterial({ color: PALETTE.gris.pierre, roughness: 0.95 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = shadows
  ground.userData.idMaterial = uniformIdMaterial(0, ROLE.sol)
  scene.add(ground)
  const curbMat = new MeshStandardMaterial({ color: PALETTE.noir, roughness: 1 })
  const curbs: Mesh[] = []
  for (const [x, z, w, d] of [
    [0, -TUNING.arenaHalf - 0.25, size + 1, 0.5],
    [0, TUNING.arenaHalf + 0.25, size + 1, 0.5],
    [-TUNING.arenaHalf - 0.25, 0, 0.5, size],
    [TUNING.arenaHalf + 0.25, 0, 0.5, size],
  ] as const) {
    const m = new Mesh(new BoxGeometry(w, 0.3, d), curbMat)
    m.position.set(x, 0.15, z)
    m.userData.idMaterial = uniformIdMaterial(0, ROLE.autre)
    scene.add(m)
    curbs.push(m)
  }
  const joints = new Batch(scene, {
    geometry: () => new BoxGeometry(1, 0.002, 1),
    material: new MeshStandardMaterial({ color: PALETTE.gris.pierreJoint, roughness: 1 }),
    idMaterial: instancedIdMaterial(),
    capacity: 64,
    cast: false,
    receive: shadows,
  })
  {
    const m = new Matrix4()
    const q = new Quaternion()
    joints.begin()
    for (let k = -TUNING.arenaHalf + 2; k < TUNING.arenaHalf; k += 2) {
      joints.push(
        m.compose(new Vector3(k, 0.001, 0), q, new Vector3(0.03, 1, size)),
        PALETTE.technique.neutre,
        0,
        ROLE.sol,
      )
      joints.push(
        m.compose(new Vector3(0, 0.001, k), q, new Vector3(size, 1, 0.03)),
        PALETTE.technique.neutre,
        0,
        ROLE.sol,
      )
    }
    joints.end()
  }

  // Corps : une matière éclairée (chair humide, spéculaire), une plate (marques dorées), une lumineuse (sac,
  // halo en prière), une pour le liseré (coque inversée, couleur exacte de la palette).
  const litMat = new MeshStandardMaterial({ color: PALETTE.technique.neutre, roughness: 0.5, metalness: 0 })
  const flatMat = new MeshBasicMaterial({ color: PALETTE.technique.neutre })
  const glowMat = new MeshBasicMaterial({ color: PALETTE.technique.neutre, transparent: true, opacity: 0.88 })
  const rimMat = new MeshBasicMaterial({ color: PALETTE.technique.neutre, side: BackSide })
  const idFront = instancedIdMaterial()
  const idBack = instancedIdMaterial(BackSide)
  const SHAPES: readonly Shape[] = ['box', 'sphere', 'cylinder', 'cone', 'torus']
  const batches = new Map<string, Batch>()
  for (const s of SHAPES) {
    const geometry = () => unitGeometry(s)
    const big = s === 'box'
    batches.set(
      `lit:${s}`,
      new Batch(scene, {
        geometry,
        material: litMat,
        idMaterial: idFront,
        capacity: big ? 4096 : 512,
        cast: shadows,
        receive: shadows,
      }),
    )
    batches.set(
      `flat:${s}`,
      new Batch(scene, {
        geometry,
        material: flatMat,
        idMaterial: idFront,
        capacity: 256,
        cast: shadows,
        receive: false,
      }),
    )
    batches.set(
      `glow:${s}`,
      new Batch(scene, {
        geometry,
        material: glowMat,
        idMaterial: idFront,
        capacity: 64,
        cast: false,
        receive: false,
      }),
    )
    batches.set(
      `rim:${s}`,
      new Batch(scene, {
        geometry,
        material: rimMat,
        idMaterial: idBack,
        capacity: big ? 2048 : 256,
        cast: false,
        receive: false,
      }),
    )
  }
  const batch = (kind: Kind, s: Shape): Batch => {
    const b = batches.get(`${kind}:${s}`)
    if (!b) throw new Error(`lot absent ${kind}:${s}`)
    return b
  }

  // Décalques de sang : éclaboussures au sol, sous les télégraphes (§18).
  const splat = (): BufferGeometry => {
    const g = new CircleGeometry(0.5, 14)
    const p = g.getAttribute('position')
    for (let i = 1; i < p.count; i++) {
      const k = 0.75 + 0.35 * Math.abs(Math.sin(i * 2.3))
      p.setXY(i, p.getX(i) * k, p.getY(i) * k)
    }
    return g
  }
  const decals = new Batch(scene, {
    geometry: splat,
    material: new MeshStandardMaterial({
      color: PALETTE.technique.neutre,
      roughness: 0.35,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      depthWrite: false,
    }),
    idMaterial: instancedIdMaterial(undefined, false),
    capacity: 512,
    cast: false,
    receive: shadows,
    renderOrder: 1,
  })

  // Télégraphes, halos de prière, sceau : objets au sol, toujours au-dessus des décalques (§18, §30.13).
  const sectorCache = new Map<string, BufferGeometry>()
  const sector = (arcDeg: number, inner: number): BufferGeometry => {
    const key = `${arcDeg}:${inner}`
    let g = sectorCache.get(key)
    if (!g) {
      const th = (arcDeg * Math.PI) / 180
      const segs = Math.max(8, Math.round(arcDeg / 6))
      g =
        inner > 0
          ? new RingGeometry(inner, 1, segs, 1, -th / 2, th)
          : new CircleGeometry(1, segs, -th / 2, th)
      g.rotateX(-Math.PI / 2)
      sectorCache.set(key, g)
    }
    return g
  }
  const lane = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0.5, 0, 0)
  const makeGroundMesh = (opacity: number, order: number) => (): Mesh => {
    const m = new Mesh(
      lane,
      new MeshBasicMaterial({
        color: PALETTE.rougeBrun.telegraphe,
        transparent: opacity < 1,
        opacity,
        depthWrite: false,
        side: DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2 - order,
        polygonOffsetUnits: -2 - order,
      }),
    )
    m.renderOrder = 2 + order
    m.userData.idMaterial = uniformIdMaterial(0, ROLE.autre, false)
    return m
  }
  const telBorder = new Pool(scene, makeGroundMesh(0.85, 0))
  const telFill = new Pool(scene, makeGroundMesh(0.32, 1))
  const telProgress = new Pool(scene, makeGroundMesh(0.5, 2))
  const telEdge = new Pool(scene, makeGroundMesh(1, 3))
  const halos = new Pool(scene, makeGroundMesh(0.22, 0))
  const haloEdges = new Pool(scene, makeGroundMesh(0.9, 1))
  const seals = new Pool(scene, makeGroundMesh(1, 3))
  const pools = [telBorder, telFill, telProgress, telEdge, halos, haloEdges, seals]

  const gore = new GoreMemory()
  let aim: Vec2 | null = null
  let isolated: number | null = null
  let hidden = new Set<number>()
  let last: { world: World; prev: World; alpha: number } | null = null
  let lastBodies: Body[] = []
  let lastCpu = 0
  const deadCache = new Map<number, { key: string; body: Body }>()
  const tmp = new Matrix4()
  const tmpS = new Matrix4()
  const tmpQ = new Quaternion()
  const tmpE = new Euler()
  const tmpP = new Vector3()
  const tmpV = new Vector3()

  const visible = (id: number): boolean => (isolated === null ? !hidden.has(id) : id === isolated)

  const resize = (): void => {
    const w = Math.max(1, canvas.clientWidth || canvas.width)
    const h = Math.max(1, canvas.clientHeight || canvas.height)
    const pr = gl.getPixelRatio()
    if (canvas.width !== Math.floor(w * pr) || canvas.height !== Math.floor(h * pr)) gl.setSize(w, h, false)
    camera.aspect = w / h
  }

  const pushBody = (body: Body, sink: number): void => {
    for (const s of body.segments) {
      tmpS.makeScale(s.size[0], s.size[1], s.size[2])
      tmp.multiplyMatrices(s.frame, tmpS)
      if (sink !== 0) tmp.elements[13] = (tmp.elements[13] ?? 0) - sink
      const role = s.role === 'marque' ? ROLE.marque : s.role === 'autre' ? ROLE.autre : ROLE.corps
      batch(s.mat, s.shape).push(tmp, s.color, body.id, role)
      if (body.rim && s.hull) {
        const d = 2 * (body.rim.strong ? RIM_STRONG_M : RIM_M)
        tmpS.makeScale(s.size[0] + d, s.size[1] + d, s.size[2] + d)
        tmp.multiplyMatrices(s.frame, tmpS)
        batch('rim', s.shape).push(tmp, body.rim.color, body.id, ROLE.lisere)
      }
    }
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
    }
  }

  const place = (
    m: Mesh,
    geo: BufferGeometry,
    pos: Vec2,
    yaw: number,
    sx: number,
    sz: number,
    y: number,
    hex: number,
  ): void => {
    m.geometry = geo
    m.position.set(pos.x, y, pos.z)
    m.rotation.set(0, yaw, 0)
    m.scale.set(Math.max(1e-4, sx), 1, Math.max(1e-4, sz))
    ;(m.material as MeshBasicMaterial).color.setHex(hex)
  }

  // Télégraphe au sol de l'attaque en cours, halo de prière, sceau de Sentence.
  const groundEffects = (
    c: Creature,
    pos: Vec2,
    facing: number,
    t: number,
    w: World,
    target: number | null,
  ) => {
    const a = c.action
    const yaw = -facing
    if (a && (c.state.kind === 'hostile' || c.state.kind === 'rituel') && a.kind === 'attaque') {
      const def = w.families[c.family]?.actions[a.name]
      if (def && actionPhase(a, Math.floor(t)) === 'telegraphe') {
        const col = telegraphColor(a.activeAt - t)
        const p = Math.min(1, Math.max(0, (t - a.start) / Math.max(1, a.activeAt - a.start)))
        const r = def.reach + (c.size === 'large' ? TUNING.radiusLarge : TUNING.radiusSmall) * 0.5
        if (def.arcDeg !== undefined) {
          place(telBorder.next(), sector(def.arcDeg, 0.9), pos, yaw, r + 0.08, r + 0.08, 0.008, PALETTE.noir)
          place(telFill.next(), sector(def.arcDeg, 0), pos, yaw, r, r, 0.01, col)
          place(telProgress.next(), sector(def.arcDeg, 0), pos, yaw, r * p, r * p, 0.012, col)
          place(telEdge.next(), sector(def.arcDeg, 0.93), pos, yaw, r, r, 0.014, col)
        } else {
          const wd = c.size === 'large' ? 1.2 : 0.7
          place(telBorder.next(), lane, pos, yaw, r + 0.1, wd + 0.16, 0.008, PALETTE.noir)
          place(telFill.next(), lane, pos, yaw, r, wd, 0.01, col)
          place(telProgress.next(), lane, pos, yaw, r * p, wd, 0.012, col)
        }
      }
    }
    if (a && c.family === 'confesseur' && a.kind === 'canalisation' && c.state.kind !== 'mort') {
      const R = w.families[c.family]?.actions[a.name]?.reach ?? TUNING.confesseur.prayerRadius
      const p = Math.min(1, Math.max(0, (t - a.start) / Math.max(1, a.activeAt - a.start)))
      place(halos.next(), sector(360, 0), pos, 0, R * p, R * p, 0.006, PALETTE.vertMaladif)
      place(haloEdges.next(), sector(360, 0.95), pos, 0, R * p, R * p, 0.007, PALETTE.vertMaladif)
    }
    if (target === c.id && c.state.kind === 'abattu') {
      const col = c.resistant ? PALETTE.or.base : PALETTE.ivoire.base
      place(seals.next(), sector(360, 0.82), pos, 0, 0.95, 0.95, 0.009, col)
      place(seals.next(), sector(360, 0.9), pos, 0, 0.6, 0.6, 0.009, col)
    }
  }

  const draw = (world: World, prev: World, alpha: number): void => {
    const t0 = performance.now()
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
    const cam = cameraPose({ focus: ppos, aim, aspect: camera.aspect, sentence, shake: sh })
    camera.position.set(cam.position[0], cam.position[1], cam.position[2])
    camera.lookAt(cam.target[0], cam.target[1], cam.target[2])
    camera.fov = cam.fovDeg
    camera.near = Math.max(1, cam.distance - 30)
    camera.far = cam.distance + 40
    camera.updateProjectionMatrix()

    for (const b of batches.values()) b.begin()
    decals.begin()
    for (const p of pools) p.begin()

    const target = aim ? sentenceTarget(world, aim) : null
    const phases = groupPhases(world)
    const sinks = sinkDepths(world, t)
    const bodies: Body[] = []
    for (const c of world.creatures) {
      if (insideHost(c) || !visible(c.id)) continue
      const sinkK = sinks.get(c.id) ?? 0
      if (sinkK >= 1) continue
      const pc = prevById.get(c.id) ?? c
      const pos = { x: lerp(pc.pos.x, c.pos.x, alpha), z: lerp(pc.pos.z, c.pos.z, alpha) }
      const facing = lerpAngle(pc.facing, c.facing, alpha)
      let body: Body
      if (c.state.kind === 'mort' && (c.spawn?.state === 'mort' || t - c.state.at >= RENDER.grisTicks)) {
        // Un mort entièrement gris ne change plus : sa pose est mise en cache.
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
      bodies.push(body)
      pushBody(body, sinkK * 0.6)
      groundEffects(c, pos, facing, t, world, target)
    }
    if (visible(PLAYER_ID)) {
      const speed = (Math.hypot(pp.pos.x - ppPrev.pos.x, pp.pos.z - ppPrev.pos.z) * 60) / dt
      const pb = playerBody(pp, ppos, lerpAngle(ppPrev.facing, pp.facing, alpha), t, speed)
      bodies.push(pb)
      pushBody(pb, 0)
    }
    // Éclats dorés d'un coup sur un Résistant à terre (L4).
    for (const s of gore.sparks) {
      const age = t - s.born
      if (age < 0 || age >= SPARK_TICKS || !visible(s.id)) continue
      for (let k = 0; k < 6; k++) {
        const ang = k * 1.047 + s.born
        const r = 0.15 + age * 0.05
        tmpP.set(s.x + Math.cos(ang) * r, 0.3 + age * 0.03 - age * age * 0.002, s.z + Math.sin(ang) * r)
        tmp.compose(tmpP, camera.quaternion, tmpV.set(0.06, 0.06, 0.06))
        batch('flat', 'box').push(tmp, PALETTE.or.crete, 0, ROLE.autre)
      }
    }
    // Décalques : rouge vif pendant 2 s, puis rouge brun (§17).
    for (const d of gore.decals) {
      if (d.born > t) continue
      tmpQ.setFromEuler(tmpE.set(-Math.PI / 2, 0, d.rot, 'XYZ'))
      tmp.compose(tmpP.set(d.x, 0.003, d.z), tmpQ, tmpV.set(d.size * 2, d.size * 2, 1))
      decals.push(tmp, decalColor(t - d.born), 0, ROLE.decalque)
    }
    for (const b of batches.values()) b.end()
    decals.end()
    for (const p of pools) p.end()
    lastBodies = bodies
    gl.setRenderTarget(null)
    gl.render(scene, camera)
    lastCpu = performance.now() - t0
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
      idTarget = new WebGLRenderTarget(w, h, { format: RGBAFormat, type: UnsignedByteType, samples: 0 })
    }
    const swapped: { o: Mesh; m: Material | Material[] }[] = []
    scene.traverse((o) => {
      const idm = o.userData.idMaterial as ShaderMaterial | undefined
      if (idm && o instanceof Mesh) {
        swapped.push({ o, m: o.material })
        // Même résolution de profondeur que la passe couleur (décalques et objets au sol décalés).
        const src = o.material as Material
        idm.polygonOffset = src.polygonOffset
        idm.polygonOffsetFactor = src.polygonOffsetFactor
        idm.polygonOffsetUnits = src.polygonOffsetUnits
        idm.depthWrite = src.depthWrite
        idm.depthTest = src.depthTest
        idm.side = src.side
        o.material = idm
      }
    })
    const bg = scene.background
    scene.background = new Color(PALETTE.technique.fondId)
    const auto = gl.shadowMap.autoUpdate
    gl.shadowMap.autoUpdate = false
    gl.setRenderTarget(idTarget)
    gl.clear()
    gl.render(scene, camera)
    const buf = new Uint8Array(w * h * 4)
    gl.readRenderTargetPixels(idTarget, 0, 0, w, h, buf)
    gl.setRenderTarget(null)
    gl.shadowMap.autoUpdate = auto
    scene.background = bg
    for (const s of swapped) s.o.material = s.m
    return { width: w, height: h, data: flip(w, h, buf) }
  }

  const project = (v: Vector3): [number, number] => {
    const ctx = gl.getContext()
    const p = v.clone().project(camera)
    return [((p.x + 1) / 2) * ctx.drawingBufferWidth, ((1 - p.y) / 2) * ctx.drawingBufferHeight]
  }

  const poses = (): EntityPose[] =>
    lastBodies.map((b) => ({
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
    }))

  const screenToGround = (x: number, y: number): Vec2 => {
    const w = Math.max(1, canvas.clientWidth || canvas.width)
    const h = Math.max(1, canvas.clientHeight || canvas.height)
    const v = new Vector3((x / w) * 2 - 1, 1 - (y / h) * 2, 0.5).unproject(camera)
    const dir = v.sub(camera.position).normalize()
    if (Math.abs(dir.y) < 1e-6) return { x: camera.position.x, z: camera.position.z }
    const k = -camera.position.y / dir.y
    return { x: camera.position.x + dir.x * k, z: camera.position.z + dir.z * k }
  }

  return {
    render(world, prev, alpha) {
      last = { world, prev, alpha }
      draw(world, prev, alpha)
    },
    observe(world) {
      gore.ingest(world)
    },
    setAim(p) {
      aim = p
    },
    screenToGround,
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
        instances: [...batches.values()].reduce((n, b) => n + b.count, 0),
        decals: gore.decals.length,
        bodies: lastBodies.length,
        cpuMs: lastCpu,
      }),
      clearGore() {
        gore.clear()
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
    },
    dispose() {
      for (const b of batches.values()) b.dispose()
      decals.dispose()
      joints.dispose()
      for (const p of pools) p.dispose()
      for (const g of sectorCache.values()) g.dispose()
      lane.dispose()
      idTarget?.dispose()
      ground.geometry.dispose()
      for (const m of curbs) m.geometry.dispose()
      gl.dispose()
    },
  }
}
