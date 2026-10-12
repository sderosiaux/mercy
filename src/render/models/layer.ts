// Couche des modèles de la Forge (E2) : remplace les créatures en segments par les personnages animés, dès que leur
// modèle est chargé ; un personnage absent du manifeste garde ses segments (jalon 1), signalé une fois en console et
// dans renderer.debug. Lit le monde, ne l'écrit jamais. La pose de chaque image est une fonction de la mémoire
// d'animation (évènements observés) et de l'horloge de rendu en ticks.
//
// - vivant : maillage à squelette éclairé (scène), liseré et marques dans la couche des signaux ;
// - mort : pose du tick de la mort, cuite une fois dans le lot des morts de son personnage (gris, lumière fixe) ;
// - Membre errant : le bras du propriétaire, découpé du modèle, qui vit à part (le bras disparaît du corps) ;
// - Bourreau : le modèle `bourreau` du manifeste, sinon ses segments.
import {
  BufferAttribute,
  BufferGeometry,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type MeshStandardMaterial,
  type Object3D,
  type ShaderMaterial,
  type SkinnedMesh,
  Sphere,
  type Texture,
  Vector3,
} from 'three'
import { type Creature, PORTEUR_STAGE_KEY, TUNING, type Vec2, type World } from '../../sim/index'
import { type AnimFrame, animate, deathFrame, type MachineInput, phase01 } from '../anim/machine'
import { AnimMemory, PLAYER_TRACK } from '../anim/memory'
import { encodeId, ROLE } from '../idpass'
import { DEAD_PROXY_LAYER } from '../lightrig'
import { greyMix, rimOf, sacColor } from '../look'
import { PALETTE } from '../palette'
import { urlParam } from '../quality'
import { type ClassShift, parseShiftOverride, shiftFor, withOverrides } from './classes'
import { type BakedCorpse, DeadBatch } from './dead'
import { ModelInstance } from './instance'
import { loadModels, type ModelAsset, type ModelLoad } from './loader'
import {
  bodyDepthMaterial,
  bodyMaterial,
  deadIdMaterial,
  deadMaterial,
  idMaterial,
  livingFloorUniform,
  type ModelUniforms,
  markMaterial,
  modelUniforms,
  NO_FLOOR,
  rimMaterial,
  setStencil,
  silhouetteMaterial,
} from './materials'
import { PART } from './regions'

export interface OverlayTargets {
  readonly scene: Object3D
  readonly dead: Object3D
  readonly signals: Object3D
}

export interface ModelDrawContext {
  readonly t: number
  readonly world: World
  readonly groupPhase: number
  readonly playerPos: Vec2
  readonly targeted: boolean
  readonly sink: number // m
  readonly visible: boolean
}

export interface ModelsInfo {
  readonly manifestError: string | null
  readonly totalMs: number | null
  readonly reports: readonly { id: string; ok: boolean; ms: number; bytes: number; error?: string }[]
  readonly notes: readonly string[]
  readonly assets: readonly {
    id: string
    scale: number
    triangles: number
    lodTriangles: number
    clips: string[]
    loadMs: number
    bytes: number
    texture: number[] | null
    meanLum: number
    regions: Readonly<Record<string, number>>
  }[]
  readonly living: number
  readonly corpses: number
}

export interface ModelSegment {
  readonly part: string
  readonly matrix: Matrix4 // os × boîte (échelle de la boîte comprise)
  readonly corners: readonly Vector3[]
}

const CORPSE_CLEARANCE_M = 0.01 // un mort repose à 1 cm au-dessus de la boue
const minY = (p: Float32Array): number => {
  let m = Number.POSITIVE_INFINITY
  for (let i = 1; i < p.length; i += 3) m = Math.min(m, p[i] as number)
  return Number.isFinite(m) ? m : 0
}
const liftY = (p: Float32Array, dy: number): void => {
  for (let i = 1; i < p.length; i += 3) p[i] = (p[i] as number) + dy
}
const RIM_M = 0.04 // liseré : même épaisseur que les segments du jalon 1 (C4)
const RIM_STRONG_M = 0.065 // liseré intensifié sous le curseur de Sentence (§21)
const SAC_SCALE_0 = 0.75 // sac vide : plus petit que la planche (pleine) ; +0,1 par corps avalé
const SAC_SCALE_STEP = 0.1
const SAC_GLOW = 0.5 // lueur du sac chargé (émissif, × teinte du stade ; celle du jalon 1)
const HALO_GLOW = 0.6 // halo en prière

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a))

// Plancher de la chair (E4) : les créatures et les Membres errants ; pas le Bourreau.
const floorOf = (assetId: string): { value: number } =>
  assetId === 'bourreau' ? NO_FLOOR : livingFloorUniform

const idVec = (u: { value: Vector3 }, id: number, role: number): void => {
  const [r, g, b] = encodeId(id, role)
  u.value.set(r / 255, g / 255, b / 255)
}

// Liseré d'un corps : masque de sa silhouette (gabarit) puis coque, dessinés l'un après l'autre.
export interface Rim {
  readonly mask: Mesh
  readonly hull: Mesh
  readonly materials: ShaderMaterial[] // ceux dont la valeur de gabarit change à chaque image
}

interface Living {
  readonly inst: ModelInstance
  readonly u: ModelUniforms
  readonly rim: Rim
  readonly marks: SkinnedMesh
  readonly shadow: SkinnedMesh | null // doublure d'ombre (caméras d'ombre seulement)
  readonly materials: Material[]
}

interface ArmPiece {
  readonly geometry: BufferGeometry // bras au repos, centré, posé au sol (m)
  readonly box: { min: Vector3; max: Vector3 }
}

interface Membre {
  readonly mesh: Mesh
  readonly rim: Rim
  readonly u: ModelUniforms
  readonly materials: Material[]
  key: string
}

export const makeRim = (u: ModelUniforms, build: (m: Material, id: Material) => Mesh): Rim => {
  const sil = silhouetteMaterial(u)
  const hullM = rimMaterial(u)
  const hullId = idMaterial(u, 'rim')
  // Le masque est sa propre matière d'identification : il n'écrit que le gabarit, dans les deux passes.
  const mask = build(sil, sil)
  return { mask, hull: build(hullM, hullId), materials: [sil, hullM, hullId] }
}

interface Corpse {
  readonly batch: DeadBatch
  readonly segments: ModelSegment[]
}

export class ModelLayer {
  readonly memory = new AnimMemory()
  readonly load: ModelLoad
  private readonly living = new Map<number, Living>()
  private readonly pool = new Map<string, Living[]>()
  private readonly membres = new Map<number, Membre>()
  private readonly corpses = new Map<number, Corpse>()
  private readonly batches = new Map<string, DeadBatch>()
  private readonly arms = new Map<string, ArmPiece>()
  private readonly used = new Set<number>()
  private readonly usedMembres = new Set<number>()
  private readonly seenCorpses = new Set<number>()
  private readonly warned = new Set<string>()
  private readonly segs = new Map<number, ModelSegment[]>()
  private readonly frames = new Map<number, AnimFrame>() // dernière pose calculée (instrument)
  private env: Texture | null = null
  private stencil = 1
  // Matière des doublures d'ombre dans la passe principale : ni couleur ni profondeur.
  private readonly invisible = new MeshBasicMaterial({ colorWrite: false, depthWrite: false })
  // Instruments (captures avant / après, réglage) : forces imposées au décalage des classes (`decalage`, puis `gris`
  // et `jaune`), sinon celles de classes.ts.
  private readonly shiftOverride = parseShiftOverride(urlParam('decalage'))
  private readonly grisOverride = parseShiftOverride(urlParam('gris'))
  private readonly jauneOverride = parseShiftOverride(urlParam('jaune'))
  private shift(id: string): ClassShift {
    return withOverrides(shiftFor(id, this.shiftOverride(id)), {
      gris: this.grisOverride(id),
      jaune: this.jauneOverride(id),
    })
  }
  readonly notes: string[] = []

  constructor(
    private readonly layers: OverlayTargets,
    base: string,
    lowTextures: boolean,
    private readonly shadows: boolean,
    enabled = true,
  ) {
    this.load = loadModels(
      base,
      lowTextures,
      () => {},
      enabled,
      (urlParam('sansmodele') ?? '').split(',').filter(Boolean),
    )
    void this.load.done.then(() => {
      if (this.load.manifestError) this.warn(`manifeste illisible (${this.load.manifestError})`)
      for (const id of this.load.missing)
        this.warn(`${id} : modèle absent ou injouable — rendu en segments (jalon 1)`)
      for (const r of this.load.reports) if (!r.ok) this.warn(`${r.id} : chargement en échec (${r.error})`)
    })
  }

  private warn(line: string): void {
    if (this.warned.has(line)) return
    this.warned.add(line)
    this.notes.push(line)
    console.warn(`[rendu] ${line}`)
  }

  setEnvironment(env: Texture | null): void {
    this.env = env
    for (const l of this.living.values()) this.applyEnv(l.inst.mesh.material as MeshStandardMaterial)
    for (const list of this.pool.values())
      for (const l of list) this.applyEnv(l.inst.mesh.material as MeshStandardMaterial)
  }

  private applyEnv(m: MeshStandardMaterial): void {
    if (m.envMap !== this.env) {
      m.envMap = this.env
      m.needsUpdate = true
    }
  }

  asset(family: string): ModelAsset | undefined {
    const a = this.load.assets.get(family)
    if (
      !a &&
      this.load.enabled &&
      this.load.finishedAt !== null &&
      !this.load.manifestError &&
      !this.load.missing.includes(family)
    )
      this.warn(`${family} : absent du manifeste — rendu en segments (jalon 1)`)
    return a
  }

  observe(w: World): void {
    const before = this.memory.lastTick
    this.memory.observe(w)
    // Nouvelle partie ou rembobinage : les morts de l'ancienne ligne de temps disparaissent.
    if (w.tick <= before) this.clearCorpses()
  }

  clear(): void {
    this.memory.clear()
    this.clearCorpses()
  }

  private clearCorpses(): void {
    for (const b of this.batches.values()) b.clear()
    this.corpses.clear()
  }

  begin(): void {
    this.stencil = 1
    this.used.clear()
    this.usedMembres.clear()
    this.seenCorpses.clear()
    this.segs.clear()
  }

  // ---------------------------------------------------------------------------------------------------------
  // Instances vivantes

  private createLiving(asset: ModelAsset): Living {
    const inst = new ModelInstance(asset)
    const u = modelUniforms(asset.regions.sacCenter)
    const body = bodyMaterial(
      asset.map,
      asset.roughness,
      u,
      this.shift(asset.id),
      asset.meanLum,
      floorOf(asset.id),
    )
    this.applyEnv(body)
    inst.mesh.material = body
    // L'ombre portée vient de la doublure grossière ; le corps reçoit les ombres.
    inst.mesh.castShadow = false
    inst.mesh.receiveShadow = this.shadows
    const depth = bodyDepthMaterial(u)
    const shadow =
      this.shadows && urlParam('ombresmodeles') !== '0'
        ? inst.shadowProxy(asset.lodShadow, depth, DEAD_PROXY_LAYER, this.invisible)
        : null
    const bodyId = idMaterial(u, 'body')
    inst.mesh.userData.idMaterial = bodyId
    const markM = markMaterial(u)
    const markId = idMaterial(u, 'mark')
    const rim = makeRim(u, (m, id) => inst.overlay(m, id))
    const marks = inst.overlay(markM, markId)
    return {
      inst,
      u,
      rim,
      marks,
      shadow,
      materials: [body, depth, bodyId, markM, markId, ...rim.materials],
    }
  }

  // Sphère englobante de la doublure d'ombre (repère monde : la peau donne des positions monde) : chaque caméra
  // d'ombre ne dessine que les corps qu'elle voit.
  private boundShadow(l: Living, pos: Vec2, height: number, scale: number): void {
    if (!l.shadow) return
    const h = height * scale
    if (!l.shadow.boundingSphere) l.shadow.boundingSphere = new Sphere()
    l.shadow.boundingSphere.center.set(pos.x, h / 2, pos.z)
    l.shadow.boundingSphere.radius = h * 0.8 + 0.4
  }

  // Liseré visible ou non ; valeur de gabarit propre au corps pour l'image, masque juste avant la coque.
  private showRim(rim: Rim, on: boolean): void {
    this.show(rim.mask, this.layers.signals, on)
    this.show(rim.hull, this.layers.signals, on)
    if (!on) return
    const k = this.stencil
    this.stencil = this.stencil >= 255 ? 1 : this.stencil + 1
    setStencil(k, ...rim.materials)
    rim.mask.renderOrder = 100 + 2 * k
    rim.hull.renderOrder = 101 + 2 * k
  }

  private acquire(id: number, asset: ModelAsset): Living {
    let l = this.living.get(id)
    if (l && l.inst.asset !== asset) {
      this.release(id, l)
      l = undefined
    }
    if (!l) {
      l = this.pool.get(asset.id)?.pop() ?? this.createLiving(asset)
      this.living.set(id, l)
      this.layers.scene.add(l.inst.root)
      if (l.shadow) this.layers.scene.add(l.shadow)
    }
    this.used.add(id)
    return l
  }

  private release(id: number, l: Living): void {
    this.layers.scene.remove(l.inst.root)
    if (l.shadow) this.layers.scene.remove(l.shadow)
    this.showRim(l.rim, false)
    this.layers.signals.remove(l.marks)
    this.living.delete(id)
    const list = this.pool.get(l.inst.asset.id) ?? []
    list.push(l)
    this.pool.set(l.inst.asset.id, list)
  }

  private show(o: Object3D, parent: Object3D, on: boolean): void {
    if (on && o.parent !== parent) parent.add(o)
    else if (!on && o.parent === parent) parent.remove(o)
  }

  private machineInput(
    c: Creature,
    asset: ModelAsset,
    pos: Vec2,
    facing: number,
    ctx: ModelDrawContext,
  ): MachineInput {
    return {
      family: c.family,
      id: c.id,
      catalog: asset.catalog,
      track: this.memory.track(c.id),
      t: ctx.t,
      groupPhase: ctx.groupPhase,
      group: c.group,
      alertedAt: c.state.kind === 'hostile' ? c.state.alertedAt : null,
      toPlayer: wrap(Math.atan2(ctx.playerPos.z - pos.z, ctx.playerPos.x - pos.x) - facing),
    }
  }

  // Une créature présente. Renvoie faux si son modèle n'est pas prêt (le rendu garde ses segments).
  creature(c: Creature, pos: Vec2, facing: number, ctx: ModelDrawContext): boolean {
    if (c.family === 'membre') return this.membre(c, pos, facing, ctx)
    const asset = this.asset(c.family)
    if (!asset) return false
    if (c.state.kind === 'mort') return this.corpse(c, asset, pos, facing, ctx)
    if (!ctx.visible) return true
    const l = this.acquire(c.id, asset)
    const { inst, u } = l
    const k = TUNING.cicatriceSizeMul ** c.cicatrices
    inst.place(pos.x, pos.z, facing, k)
    this.boundShadow(l, pos, asset.entry.hauteurM ?? 2, k)
    const frame = animate(this.machineInput(c, asset, pos, facing, ctx))
    this.frames.set(c.id, frame)
    inst.pose(frame, ctx.t, c.id)
    // Membres sectionnés : le bras disparaît du corps (il vit à part, Membre errant).
    let hideL = 0
    let hideR = 0
    for (const limb of c.limbs) {
      if (limb.state !== 'severed') continue
      if (/gauche/i.test(limb.id)) hideL = 1
      else hideR = 1
    }
    u.uHideArms.value.set(hideL, hideR)
    // Sac du Porteur : taille et lueur du stade (§8.10, §17) ; rouge vif au stade 3.
    const stage = c.family === 'porteur' ? (c.familyData[PORTEUR_STAGE_KEY] ?? 0) : 0
    u.uSacScale.value = SAC_SCALE_0 + SAC_SCALE_STEP * stage
    u.uSacTint.value.setHex(sacColor(stage))
    u.uSacGlow.value = stage >= 1 ? SAC_GLOW : 0
    // Halo du Confesseur : vert maladif en prière seulement (requête E1 R1), fer sombre sinon.
    const praying = c.family === 'confesseur' && c.action?.kind === 'canalisation'
    u.uHaloTint.value.setHex(praying ? PALETTE.vertMaladif : PALETTE.habit.haloConfesseur)
    u.uHaloGlow.value = praying ? HALO_GLOW : 0
    u.uSeams.value = c.cicatrices
    // Liseré (Abattu) et marques dorées (Résistant).
    const rim = rimOf(c, ctx.t, ctx.targeted)
    if (rim) {
      u.uRimColor.value.setHex(rim.color)
      u.uExtrude.value = rim.strong ? RIM_STRONG_M : RIM_M
    }
    this.showRim(l.rim, rim !== null)
    this.show(l.marks, this.layers.signals, c.resistant)
    u.uMarkColor.value.setHex(PALETTE.or.base)
    idVec(u.uIdBody, c.id, ROLE.corps)
    idVec(u.uIdRim, c.id, ROLE.lisere)
    idVec(u.uIdMark, c.id, ROLE.marque)
    this.segs.set(c.id, this.boneSegments(inst))
    return true
  }

  player(pos: Vec2, facing: number, t: number, id: number): boolean {
    const asset = this.asset('bourreau')
    if (!asset) return false
    const l = this.acquire(id, asset)
    const frame = animate({
      family: 'bourreau',
      id: PLAYER_TRACK,
      catalog: asset.catalog,
      track: this.memory.track(PLAYER_TRACK),
      t,
      groupPhase: 0,
      group: null,
      alertedAt: null,
      toPlayer: 0,
    })
    l.inst.place(pos.x, pos.z, facing, 1)
    this.boundShadow(l, pos, asset.entry.hauteurM ?? 2, 1)
    this.frames.set(id, frame)
    l.inst.pose(frame, t, id)
    this.showRim(l.rim, false)
    this.show(l.marks, this.layers.signals, false)
    idVec(l.u.uIdBody, id, ROLE.corps)
    this.segs.set(id, this.boneSegments(l.inst))
    return true
  }

  // I4 : un os est un segment ; sa boîte est celle des sommets dont il est l'os dominant.
  private boneSegments(inst: ModelInstance, mats?: readonly Matrix4[], sinkY = 0): ModelSegment[] {
    const out: ModelSegment[] = []
    const sink = new Matrix4().makeTranslation(0, sinkY, 0)
    for (const b of inst.asset.boxes) {
      const bm = mats
        ? (mats[b.bone] as Matrix4)
        : (inst.bones[b.bone] as { matrixWorld: Matrix4 }).matrixWorld
      const w = new Matrix4().multiplyMatrices(sink, bm)
      const size = new Vector3(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2])
      const center = new Vector3(
        (b.max[0] + b.min[0]) / 2,
        (b.max[1] + b.min[1]) / 2,
        (b.max[2] + b.min[2]) / 2,
      )
      const matrix = w.clone().multiply(new Matrix4().makeTranslation(center.x, center.y, center.z))
      matrix.multiply(
        new Matrix4().makeScale(Math.max(size.x, 1e-6), Math.max(size.y, 1e-6), Math.max(size.z, 1e-6)),
      )
      const corners: Vector3[] = []
      for (const x of [b.min[0], b.max[0]])
        for (const y of [b.min[1], b.max[1]])
          for (const z of [b.min[2], b.max[2]]) corners.push(new Vector3(x, y, z).applyMatrix4(w))
      out.push({ part: inst.asset.boneNames[b.bone] ?? String(b.bone), matrix, corners })
    }
    return out
  }

  // ---------------------------------------------------------------------------------------------------------
  // Morts

  private batch(
    key: string,
    asset: ModelAsset,
    verts: number,
    index: number,
    shadowVerts: number,
    shadowIndex: number,
  ): DeadBatch {
    let b = this.batches.get(key)
    if (!b) {
      b = new DeadBatch(
        this.layers.dead,
        this.layers.scene,
        deadMaterial(asset.map, asset.meanLum),
        deadIdMaterial(),
        verts,
        index,
        this.shadows,
        shadowVerts,
        shadowIndex,
      )
      this.batches.set(key, b)
    }
    return b
  }

  private corpse(c: Creature, asset: ModelAsset, pos: Vec2, facing: number, ctx: ModelDrawContext): boolean {
    let corpse = this.corpses.get(c.id)
    if (!corpse) {
      const deathTick = c.state.kind === 'mort' ? c.state.at : ctx.t
      // La pose du tick de la mort, sur une instance de passage (celle du vivant si elle existe).
      const l = this.living.get(c.id) ?? this.pool.get(asset.id)?.pop() ?? this.createLiving(asset)
      if (this.living.get(c.id) === l) this.living.delete(c.id)
      const inp = this.machineInput(c, asset, pos, facing, { ...ctx, t: deathTick })
      l.inst.place(pos.x, pos.z, facing, TUNING.cicatriceSizeMul ** c.cicatrices)
      const df = deathFrame(inp, this.memory.track(c.id)?.deathTick ?? deathTick)
      this.frames.set(c.id, df)
      l.inst.pose(df, deathTick, c.id)
      const baked = l.inst.bake(asset.lod)
      const shadow = l.inst.bake(asset.lodShadow)
      // Un mort repose sur le sol : la pose figée est posée à 1 cm au-dessus de la boue (une pose couchée de la Forge
      // passe parfois sous le sol, qui la trouerait ; un corps figé en l'air retombe au contact).
      const settle = CORPSE_CLEARANCE_M - minY(baked.positions)
      liftY(baked.positions, settle)
      liftY(shadow.positions, settle)
      const lod = asset.lod
      const sIndex = asset.lodShadow.getIndex() as BufferAttribute
      const corpseData: BakedCorpse = {
        positions: baked.positions,
        normals: baked.normals,
        uv: Float32Array.from(lod.getAttribute('uv').array),
        mark: c.resistant
          ? Float32Array.from(lod.getAttribute('aMark').array)
          : new Float32Array(lod.getAttribute('position').count),
        index: Uint32Array.from((lod.getIndex() as BufferAttribute).array),
        shadowPositions: shadow.positions,
        shadowIndex: Uint32Array.from(sIndex.array),
      }
      const b = this.batch(
        asset.id,
        asset,
        lod.getAttribute('position').count,
        (lod.getIndex() as BufferAttribute).count,
        asset.lodShadow.getAttribute('position').count,
        sIndex.count,
      )
      b.add(c.id, corpseData)
      corpse = { batch: b, segments: this.boneSegments(l.inst, l.inst.boneMatrices(), settle) }
      this.corpses.set(c.id, corpse)
      // L'instance retourne au réservoir.
      this.layers.scene.remove(l.inst.root)
      if (l.shadow) this.layers.scene.remove(l.shadow)
      this.showRim(l.rim, false)
      this.layers.signals.remove(l.marks)
      const list = this.pool.get(asset.id) ?? []
      list.push(l)
      this.pool.set(asset.id, list)
    }
    this.seenCorpses.add(c.id)
    corpse.batch.setState(c.id, greyMix(c, ctx.t), -ctx.sink, ctx.visible)
    if (ctx.visible)
      this.segs.set(
        c.id,
        corpse.segments.map((s) => {
          if (ctx.sink === 0) return s
          const d = new Matrix4().makeTranslation(0, -ctx.sink, 0)
          return {
            part: s.part,
            matrix: d.clone().multiply(s.matrix),
            corners: s.corners.map((p) => p.clone().applyMatrix4(d)),
          }
        }),
      )
    return true
  }

  // ---------------------------------------------------------------------------------------------------------
  // Membres errants

  private armPiece(asset: ModelAsset, side: 'G' | 'D'): ArmPiece | null {
    const key = `${asset.id}:${side}`
    const hit = this.arms.get(key)
    if (hit) return hit
    const tmpl = asset.template.getObjectByName(asset.meshName) as SkinnedMesh | undefined
    if (!tmpl) return null
    const g = tmpl.geometry
    const part = g.getAttribute('aPart')
    const index = g.getIndex()
    if (!index) return null
    const want = side === 'G' ? PART.brasG : PART.brasD
    const keep: number[] = []
    for (let t = 0; t < index.count; t += 3) {
      const a = index.getX(t)
      const b = index.getX(t + 1)
      const c = index.getX(t + 2)
      if (part.getX(a) === want && part.getX(b) === want && part.getX(c) === want) keep.push(a, b, c)
    }
    if (keep.length === 0) return null
    const verts = [...new Set(keep)].sort((p, q) => p - q)
    const remap = new Map(verts.map((v, i) => [v, i]))
    const v = new Vector3()
    const pos = new Float32Array(verts.length * 3)
    tmpl.updateMatrixWorld(true)
    verts.forEach((src, i) => {
      tmpl.getVertexPosition(src, v)
      v.applyMatrix4(tmpl.matrixWorld)
      pos.set([v.x, v.y, v.z], i * 3)
    })
    // Centré, posé au sol.
    const min = new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)
    const max = new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY)
    for (let i = 0; i < pos.length; i += 3) {
      min.min(v.set(pos[i] as number, pos[i + 1] as number, pos[i + 2] as number))
      max.max(v)
    }
    const cx = (min.x + max.x) / 2
    const cz = (min.z + max.z) / 2
    for (let i = 0; i < pos.length; i += 3) {
      pos[i] = (pos[i] as number) - cx
      pos[i + 1] = (pos[i + 1] as number) - min.y
      pos[i + 2] = (pos[i + 2] as number) - cz
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(pos, 3))
    const copy = (name: string, size: number): void => {
      const a = g.getAttribute(name)
      if (!a) return
      const arr = new Float32Array(verts.length * size)
      verts.forEach((src, i) => {
        for (let k = 0; k < size; k++) arr[i * size + k] = a.getComponent(src, k)
      })
      geo.setAttribute(name, new BufferAttribute(arr, size))
    }
    copy('normal', 3)
    copy('uv', 2)
    copy('aOutline', 3)
    geo.setAttribute('aPart', new BufferAttribute(new Float32Array(verts.length), 1))
    geo.setAttribute('aMark', new BufferAttribute(new Float32Array(verts.length), 1))
    geo.setAttribute('aSeams', new BufferAttribute(new Float32Array(verts.length * 3), 3))
    geo.setIndex(keep.map((k) => remap.get(k) as number))
    const piece = {
      geometry: geo,
      box: {
        min: new Vector3(min.x - cx, 0, min.z - cz),
        max: new Vector3(max.x - cx, max.y - min.y, max.z - cz),
      },
    }
    this.arms.set(key, piece)
    return piece
  }

  private membre(c: Creature, pos: Vec2, facing: number, ctx: ModelDrawContext): boolean {
    const owner = c.unionOf === null ? undefined : ctx.world.creatures.find((o) => o.id === c.unionOf)
    const family = owner?.family ?? 'recousu'
    const asset = this.asset(family)
    if (!asset) return false
    const limbIndex = c.familyData.limbIndex ?? -1
    const limbId = owner?.limbs[limbIndex]?.id ?? 'brasDroit'
    const side = /gauche/i.test(limbId) ? 'G' : 'D'
    const piece = this.armPiece(asset, side)
    if (!piece) return false
    const key = `${asset.id}:${side}`
    const dead = c.state.kind === 'mort'
    // Pose : le bras rampe (L1, §8.4) ; mort, il se fige au tick de sa mort.
    const t = dead && c.state.kind === 'mort' ? c.state.at : ctx.t
    const s = t / 60
    const wig = 0.25 * Math.sin(Math.PI * 2 * 1.7 * s + phase01(c.id, 21) * 6.28)
    const roll = 0.12 * Math.sin(Math.PI * 2 * 3.3 * s + phase01(c.id, 22) * 6.28)
    const m = new Matrix4()
      .makeTranslation(pos.x, -ctx.sink, pos.z)
      .multiply(new Matrix4().makeRotationY(Math.PI / 2 - facing + wig))
      .multiply(new Matrix4().makeRotationX(roll))
    if (dead) {
      if (!this.corpses.has(c.id)) {
        const p = piece.geometry.getAttribute('position')
        const nrm = piece.geometry.getAttribute('normal')
        const positions = new Float32Array(p.count * 3)
        const normals = new Float32Array(p.count * 3)
        const v = new Vector3()
        for (let i = 0; i < p.count; i++) {
          v.fromBufferAttribute(p, i).applyMatrix4(m)
          positions.set([v.x, v.y + ctx.sink, v.z], i * 3)
          v.fromBufferAttribute(nrm, i).transformDirection(m)
          normals.set([v.x, v.y, v.z], i * 3)
        }
        const idx = piece.geometry.getIndex() as BufferAttribute
        const b = this.batch(`membre:${key}`, asset, p.count, idx.count, p.count, idx.count)
        const index = Uint32Array.from(idx.array)
        b.add(c.id, {
          positions,
          normals,
          uv: Float32Array.from(piece.geometry.getAttribute('uv').array),
          mark: new Float32Array(p.count),
          index,
          shadowPositions: positions,
          shadowIndex: index,
        })
        this.corpses.set(c.id, { batch: b, segments: [this.pieceSegment(piece, m)] })
      }
      const corpse = this.corpses.get(c.id) as Corpse
      this.seenCorpses.add(c.id)
      corpse.batch.setState(c.id, greyMix(c, ctx.t), -ctx.sink, ctx.visible)
      if (ctx.visible) this.segs.set(c.id, corpse.segments)
      return true
    }
    if (!ctx.visible) return true
    let mb = this.membres.get(c.id)
    if (!mb || mb.key !== key) {
      if (mb) this.dropMembre(c.id, mb)
      const u = modelUniforms(new Vector3())
      const body = bodyMaterial(
        asset.map,
        asset.roughness,
        u,
        this.shift(asset.id),
        asset.meanLum,
        floorOf(asset.id),
      )
      this.applyEnv(body)
      const bodyId = idMaterial(u, 'body')
      const piece3 = (mat: Material, id: Material): Mesh => {
        const o = new Mesh(piece.geometry, mat)
        o.matrixAutoUpdate = false
        o.frustumCulled = false
        o.userData.idMaterial = id
        return o
      }
      const mesh = piece3(body, bodyId)
      mesh.castShadow = this.shadows
      mesh.receiveShadow = this.shadows
      const rim = makeRim(u, piece3)
      mb = { mesh, rim, u, materials: [body, bodyId, ...rim.materials], key }
      this.membres.set(c.id, mb)
      this.layers.scene.add(mesh)
    }
    this.usedMembres.add(c.id)
    for (const o of [mb.mesh, mb.rim.mask, mb.rim.hull]) {
      o.matrix.copy(m)
      o.matrixWorldNeedsUpdate = true
    }
    const rim = rimOf(c, ctx.t, ctx.targeted)
    if (rim) {
      mb.u.uRimColor.value.setHex(rim.color)
      mb.u.uExtrude.value = rim.strong ? RIM_STRONG_M : RIM_M
    }
    this.showRim(mb.rim, rim !== null)
    idVec(mb.u.uIdBody, c.id, ROLE.corps)
    idVec(mb.u.uIdRim, c.id, ROLE.lisere)
    this.segs.set(c.id, [this.pieceSegment(piece, m)])
    return true
  }

  private pieceSegment(piece: ArmPiece, m: Matrix4): ModelSegment {
    const { min, max } = piece.box
    const size = new Vector3().subVectors(max, min)
    const center = new Vector3().addVectors(max, min).multiplyScalar(0.5)
    const matrix = m
      .clone()
      .multiply(new Matrix4().makeTranslation(center.x, center.y, center.z))
      .multiply(new Matrix4().makeScale(size.x, Math.max(size.y, 1e-6), size.z))
    const corners: Vector3[] = []
    for (const x of [min.x, max.x])
      for (const y of [min.y, max.y])
        for (const z of [min.z, max.z]) corners.push(new Vector3(x, y, z).applyMatrix4(m))
    return { part: 'membre', matrix, corners }
  }

  private dropMembre(id: number, mb: Membre): void {
    this.layers.scene.remove(mb.mesh)
    this.showRim(mb.rim, false)
    for (const m of mb.materials) m.dispose()
    this.membres.delete(id)
  }

  end(): void {
    for (const [id, l] of [...this.living]) if (!this.used.has(id)) this.release(id, l)
    for (const [id, mb] of [...this.membres]) if (!this.usedMembres.has(id)) this.dropMembre(id, mb)
    // Un mort qui n'est plus dans le monde (enfoncé au-delà de 250, rembobinage) quitte son lot.
    for (const [id, corpse] of [...this.corpses]) {
      if (this.seenCorpses.has(id)) continue
      corpse.batch.remove(id)
      this.corpses.delete(id)
    }
  }

  // Dernière pose calculée d'un corps (couches de clips) : instrument des séquences image par image.
  frame(id: number): AnimFrame | null {
    return this.frames.get(id) ?? null
  }

  // Segments (I4) de chaque corps modélisé de la dernière image.
  segments(): ReadonlyMap<number, readonly ModelSegment[]> {
    return this.segs
  }

  get count(): number {
    return this.used.size + this.usedMembres.size + this.seenCorpses.size
  }

  info(): ModelsInfo {
    const l = this.load
    return {
      manifestError: l.manifestError,
      totalMs: l.finishedAt === null ? null : l.finishedAt - l.startedAt,
      reports: l.reports,
      notes: this.notes,
      assets: [...l.assets.values()].map((a) => ({
        id: a.id,
        scale: a.scale,
        triangles: a.triangles,
        lodTriangles: (a.lod.getIndex()?.count ?? 0) / 3,
        clips: [...a.catalog.keys()],
        loadMs: a.loadMs,
        bytes: a.bytes,
        texture: a.map
          ? [(a.map.image as { width: number }).width, (a.map.image as { height: number }).height]
          : null,
        meanLum: a.meanLum,
        regions: a.regions.counts,
      })),
      living: this.used.size,
      corpses: this.corpses.size,
    }
  }

  dispose(): void {
    for (const [id, l] of [...this.living]) this.release(id, l)
    for (const list of this.pool.values())
      for (const l of list) {
        for (const m of l.materials) m.dispose()
        l.inst.dispose()
      }
    for (const [id, mb] of [...this.membres]) this.dropMembre(id, mb)
    for (const b of this.batches.values()) b.dispose()
  }
}
