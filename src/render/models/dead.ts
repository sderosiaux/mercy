// Les morts d'un personnage (E2) : pose figée à la mort, cuite une fois (version allégée, coordonnées monde) dans un
// lot BatchedMesh de la scène éclairée (E8 : la lumière du lieu, ombres reçues comprises), plus une doublure de
// positions seules pour les ombres portées (caméras d'ombre seulement, comme les vivants). Un mort coûte un appel de
// dessin par personnage, pas par corps, et aucun squelette animé (§24 : 250 morts).
import {
  BatchedMesh,
  BufferAttribute,
  BufferGeometry,
  type Material,
  Matrix4,
  MeshBasicMaterial,
  type Object3D,
  Vector4,
} from 'three'
import { encodeId } from '../idpass'
import { DEAD_PROXY_LAYER } from '../lightrig'
import { DEAD_RENDER_ORDER } from '../materials'

export interface BakedCorpse {
  readonly positions: Float32Array
  readonly normals: Float32Array
  readonly uv: Float32Array
  readonly mark: Float32Array
  readonly index: Uint32Array
  // Doublure d'ombre : une version plus grossière (une ombre portée au sol ne montre pas le détail).
  readonly shadowPositions: Float32Array
  readonly shadowIndex: Uint32Array
}

interface Slot {
  readonly geo: number
  readonly inst: number
  readonly proxyGeo: number
  readonly proxyInst: number
}

const START_INSTANCES = 32

export class DeadBatch {
  private mesh: BatchedMesh
  private proxy: BatchedMesh
  private readonly slots = new Map<number, Slot>()
  private capacity: number
  private readonly perCorpseVerts: number
  private readonly perCorpseIndex: number
  private readonly proxyVerts: number
  private readonly proxyIndex: number
  private readonly proxyMat = new MeshBasicMaterial({ colorWrite: false, depthWrite: false })
  private readonly tmpM = new Matrix4()
  private readonly tmpC = new Vector4()

  constructor(
    private readonly scene: Object3D,
    private readonly material: Material,
    private readonly idMaterial: Material,
    lodVerts: number,
    lodIndex: number,
    private readonly shadows: boolean,
    shadowVerts: number,
    shadowIndex: number,
  ) {
    this.perCorpseVerts = lodVerts
    this.perCorpseIndex = lodIndex
    this.proxyVerts = shadowVerts
    this.proxyIndex = shadowIndex
    this.capacity = START_INSTANCES
    this.mesh = this.make(false, this.capacity)
    this.proxy = this.make(true, this.capacity)
  }

  private make(proxy: boolean, n: number): BatchedMesh {
    const m = new BatchedMesh(
      n,
      n * (proxy ? this.proxyVerts : this.perCorpseVerts),
      n * (proxy ? this.proxyIndex : this.perCorpseIndex),
      proxy ? this.proxyMat : this.material,
    )
    m.frustumCulled = false
    m.perObjectFrustumCulled = !proxy
    m.sortObjects = false // ordre fixe : même image pour la même paire de mondes
    if (proxy) {
      m.castShadow = this.shadows
      m.layers.set(DEAD_PROXY_LAYER)
      m.userData.noId = true
      this.scene.add(m)
    } else {
      m.renderOrder = DEAD_RENDER_ORDER // après la brume de sang (materials.ts)
      m.receiveShadow = this.shadows
      m.userData.idMaterial = this.idMaterial
      this.scene.add(m)
    }
    return m
  }

  has(id: number): boolean {
    return this.slots.has(id)
  }

  get size(): number {
    return this.slots.size
  }

  // Ajoute un corps. Plein : on double la capacité (les corps déjà cuits sont recopiés).
  add(id: number, c: BakedCorpse): void {
    if (this.slots.has(id)) return
    // Plein (corps, ou place laissée par des corps retirés) : on recopie, en doublant si les corps remplissent le lot.
    if (
      this.slots.size >= this.capacity ||
      this.mesh.unusedVertexCount < this.perCorpseVerts ||
      this.mesh.unusedIndexCount < this.perCorpseIndex ||
      this.proxy.unusedVertexCount < this.proxyVerts ||
      this.proxy.unusedIndexCount < this.proxyIndex
    )
      this.grow(this.slots.size >= this.capacity * 0.75 ? this.capacity * 2 : this.capacity)
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(c.positions, 3))
    g.setAttribute('normal', new BufferAttribute(c.normals, 3))
    g.setAttribute('uv', new BufferAttribute(c.uv, 2))
    g.setAttribute('aMark', new BufferAttribute(c.mark, 1))
    g.setIndex(new BufferAttribute(c.index, 1))
    const pg = new BufferGeometry()
    pg.setAttribute('position', new BufferAttribute(c.shadowPositions, 3))
    pg.setIndex(new BufferAttribute(c.shadowIndex, 1))
    const geo = this.mesh.addGeometry(g, this.perCorpseVerts, this.perCorpseIndex)
    const inst = this.mesh.addInstance(geo)
    const proxyGeo = this.proxy.addGeometry(pg, this.proxyVerts, this.proxyIndex)
    const proxyInst = this.proxy.addInstance(proxyGeo)
    this.slots.set(id, { geo, inst, proxyGeo, proxyInst })
    this.saved.set(id, c)
    this.setState(id, 0, 0, true)
  }

  private readonly saved = new Map<number, BakedCorpse>()

  private grow(capacity: number): void {
    const old = [...this.saved.entries()]
    const state = new Map(
      [...this.slots.entries()].map(([id, s]) => {
        this.mesh.getColorAt(s.inst, this.tmpC)
        this.mesh.getMatrixAt(s.inst, this.tmpM)
        return [
          id,
          { grey: this.tmpC.w, y: this.tmpM.elements[13] ?? 0, visible: this.mesh.getVisibleAt(s.inst) },
        ]
      }),
    )
    this.disposeMeshes()
    this.slots.clear()
    this.saved.clear()
    this.capacity = capacity
    this.mesh = this.make(false, this.capacity)
    this.proxy = this.make(true, this.capacity)
    for (const [id, c] of old) {
      this.add(id, c)
      const s = state.get(id)
      if (s) this.setState(id, s.grey, s.y, s.visible)
    }
  }

  // Passage au gris (0 → 1), enfoncement (m, au-delà de 250 morts) et visibilité (instrument I2).
  setState(id: number, grey: number, sinkY: number, visible: boolean): void {
    const s = this.slots.get(id)
    if (!s) return
    const [r, g] = encodeId(id, 0)
    this.tmpC.set(r / 255, g / 255, 0, grey)
    this.mesh.setColorAt(s.inst, this.tmpC)
    this.tmpM.makeTranslation(0, sinkY, 0)
    this.mesh.setMatrixAt(s.inst, this.tmpM)
    this.proxy.setMatrixAt(s.proxyInst, this.tmpM)
    if (this.mesh.getVisibleAt(s.inst) !== visible) {
      this.mesh.setVisibleAt(s.inst, visible)
      this.proxy.setVisibleAt(s.proxyInst, visible)
    }
  }

  remove(id: number): void {
    const s = this.slots.get(id)
    if (!s) return
    this.mesh.deleteInstance(s.inst)
    this.mesh.deleteGeometry(s.geo)
    this.proxy.deleteInstance(s.proxyInst)
    this.proxy.deleteGeometry(s.proxyGeo)
    this.slots.delete(id)
    this.saved.delete(id)
  }

  ids(): number[] {
    return [...this.slots.keys()]
  }

  clear(): void {
    this.disposeMeshes()
    this.slots.clear()
    this.saved.clear()
    this.capacity = START_INSTANCES
    this.mesh = this.make(false, this.capacity)
    this.proxy = this.make(true, this.capacity)
  }

  private disposeMeshes(): void {
    this.scene.remove(this.mesh)
    this.scene.remove(this.proxy)
    this.mesh.dispose()
    this.proxy.dispose()
  }

  dispose(): void {
    this.disposeMeshes()
    this.proxyMat.dispose()
  }
}
