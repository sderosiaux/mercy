// Lots instanciés (une géométrie × une matière, une couleur et un id par instance) et objets réutilisés d'une image à
// l'autre. Chaque lot porte sa matière d'identification (B2 I1 : id et rôle par instance).
import {
  type BufferGeometry,
  Color,
  InstancedBufferAttribute,
  InstancedMesh,
  type Material,
  type Matrix4,
  type Mesh,
  type Object3D,
  type ShaderMaterial,
} from 'three'
import { encodeId } from './idpass'

export interface BatchSpec {
  readonly geometry: () => BufferGeometry
  readonly material: Material
  readonly idMaterial: ShaderMaterial | null // null : invisible pour la passe d'identification
  readonly capacity: number
  readonly cast: boolean
  readonly receive: boolean
  readonly renderOrder?: number
  readonly layer?: number // couche unique (ombres des morts : caméras d'ombre seulement)
  readonly colorScale?: number // couleurs au-delà de 1 (émissif HDR)
  readonly extra?: { readonly name: string; readonly size: number } // attribut d'instance supplémentaire
}

export class Batch {
  mesh: InstancedMesh
  private ids: InstancedBufferAttribute
  private extraAttr: InstancedBufferAttribute | null = null
  count = 0
  private capacity: number
  private readonly color = new Color()

  constructor(
    private readonly parent: Object3D,
    private readonly spec: BatchSpec,
  ) {
    this.capacity = spec.capacity
    const built = this.build(this.capacity)
    this.mesh = built.mesh
    this.ids = built.ids
    this.extraAttr = built.extra
  }

  private build(capacity: number): {
    mesh: InstancedMesh
    ids: InstancedBufferAttribute
    extra: InstancedBufferAttribute | null
  } {
    const geo = this.spec.geometry()
    const ids = new InstancedBufferAttribute(new Uint8Array(capacity * 3), 3, true)
    geo.setAttribute('aId', ids)
    let extra: InstancedBufferAttribute | null = null
    if (this.spec.extra) {
      extra = new InstancedBufferAttribute(
        new Float32Array(capacity * this.spec.extra.size),
        this.spec.extra.size,
      )
      geo.setAttribute(this.spec.extra.name, extra)
    }
    const mesh = new InstancedMesh(geo, this.spec.material, capacity)
    mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
    mesh.frustumCulled = false
    mesh.count = 0
    mesh.visible = false
    mesh.castShadow = this.spec.cast
    mesh.receiveShadow = this.spec.receive
    mesh.renderOrder = this.spec.renderOrder ?? 0
    if (this.spec.layer !== undefined) mesh.layers.set(this.spec.layer)
    if (this.spec.idMaterial) mesh.userData.idMaterial = this.spec.idMaterial
    else mesh.userData.noId = true
    this.parent.add(mesh)
    return { mesh, ids, extra }
  }

  begin(): void {
    this.count = 0
  }

  push(m: Matrix4, hex: number, id: number, role: number, extra?: readonly number[]): void {
    if (this.count >= this.capacity) this.grow()
    const i = this.count++
    this.mesh.setMatrixAt(i, m)
    this.color.setHex(hex)
    if (this.spec.colorScale) this.color.multiplyScalar(this.spec.colorScale)
    this.mesh.setColorAt(i, this.color)
    const [r, g, b] = encodeId(id, role)
    const a = this.ids.array as Uint8Array
    a[i * 3] = r
    a[i * 3 + 1] = g
    a[i * 3 + 2] = b
    if (extra && this.extraAttr) {
      const n = this.extraAttr.itemSize
      const arr = this.extraAttr.array as Float32Array
      for (let k = 0; k < n; k++) arr[i * n + k] = extra[k] ?? 0
    }
  }

  private grow(): void {
    const old = this.mesh
    const oldIds = this.ids
    const oldExtra = this.extraAttr
    const n = this.count
    this.capacity *= 2
    const built = this.build(this.capacity)
    built.mesh.instanceMatrix.array.set(old.instanceMatrix.array.subarray(0, n * 16))
    const oc = old.instanceColor
    if (oc && built.mesh.instanceColor) built.mesh.instanceColor.array.set(oc.array.subarray(0, n * 3))
    ;(built.ids.array as Uint8Array).set((oldIds.array as Uint8Array).subarray(0, n * 3))
    if (oldExtra && built.extra) {
      const s = oldExtra.itemSize
      ;(built.extra.array as Float32Array).set((oldExtra.array as Float32Array).subarray(0, n * s))
    }
    this.parent.remove(old)
    old.geometry.dispose()
    old.dispose()
    this.mesh = built.mesh
    this.ids = built.ids
    this.extraAttr = built.extra
  }

  end(): void {
    this.mesh.count = this.count
    this.mesh.visible = this.count > 0
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
    this.ids.needsUpdate = true
    if (this.extraAttr) this.extraAttr.needsUpdate = true
  }

  dispose(): void {
    this.parent.remove(this.mesh)
    this.mesh.geometry.dispose()
    this.mesh.dispose()
  }
}

// Objets au sol réutilisés d'une image à l'autre (télégraphes, halos de prière, sceau).
export class Pool {
  private readonly items: Mesh[] = []
  private used = 0
  constructor(
    private readonly parent: Object3D,
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
      this.parent.add(m)
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
      this.parent.remove(m)
      ;(m.material as Material).dispose()
    }
  }
}
