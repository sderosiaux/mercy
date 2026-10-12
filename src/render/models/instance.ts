// Une instance animée d'un modèle de la Forge : clone du squelette, mélangeur, pose d'une image (couches de clips de
// la machine d'états, puis tremblement et pivot de tête procéduraux). L'horloge du mélangeur n'avance jamais : le
// temps de chaque clip est posé à chaque image (fonction des ticks), puis évalué (mixer.update(0)).
import {
  type AnimationAction,
  AnimationMixer,
  type Bone,
  type BufferGeometry,
  LoopRepeat,
  type Material,
  Matrix4,
  Object3D,
  type Quaternion,
  SkinnedMesh,
  Vector3,
} from 'three'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { AnimFrame } from '../anim/machine'
import type { ModelAsset } from './loader'

const TAU = Math.PI * 2
// Os retouchés après le mélangeur (tremblement, pivot de tête).
const PROCEDURAL_BONES = ['Head', 'neck', 'LeftArm', 'RightArm', 'Spine02'] as const

const phaseOf = (id: number, k: number): number => {
  const s = Math.sin(id * 12.9898 + k * 78.233) * 43758.5453
  return (s - Math.floor(s)) * TAU
}

export class ModelInstance {
  readonly root = new Object3D() // position et cap de la simulation, échelle (hauteur, Cicatrices)
  readonly scene: Object3D
  readonly mesh: SkinnedMesh
  readonly bones: readonly Bone[]
  private readonly mixer: AnimationMixer
  private readonly actions = new Map<string, AnimationAction>()
  private readonly active = new Set<string>()
  private readonly byName = new Map<string, Bone>()
  private readonly clean = new Map<Bone, Quaternion>() // valeur des os retouchés, sans procédural

  constructor(readonly asset: ModelAsset) {
    this.scene = cloneSkeleton(asset.template)
    const anchor = new Object3D()
    anchor.position.copy(asset.anchor)
    anchor.add(this.scene)
    this.root.add(anchor)
    let mesh: SkinnedMesh | null = null
    this.scene.traverse((o) => {
      o.frustumCulled = false
      if (!mesh && (o as SkinnedMesh).isSkinnedMesh) mesh = o as SkinnedMesh
    })
    if (!mesh) throw new Error(`${asset.id} : clone sans maillage`)
    this.mesh = mesh
    this.bones = this.mesh.skeleton.bones
    for (const b of this.bones) this.byName.set(b.name, b)
    for (const name of PROCEDURAL_BONES) {
      const b = this.byName.get(name)
      if (b) this.clean.set(b, b.quaternion.clone())
    }
    this.mixer = new AnimationMixer(this.scene)
  }

  bone(name: string): Bone | undefined {
    return this.byName.get(name)
  }

  private action(name: string): AnimationAction | null {
    let a = this.actions.get(name)
    if (!a) {
      const clip = this.asset.clips.get(name)
      if (!clip) return null
      a = this.mixer.clipAction(clip)
      a.setLoop(LoopRepeat, Number.POSITIVE_INFINITY)
      this.actions.set(name, a)
    }
    return a
  }

  // Place la racine : position au sol (m), orientation de la simulation (0 = +x, vers +z), échelle.
  place(x: number, z: number, facing: number, scale: number, y = 0): void {
    this.root.position.set(x, y, z)
    // Le modèle regarde vers +Z dans son repère : cap = π/2 − orientation.
    this.root.rotation.set(0, Math.PI / 2 - facing, 0)
    this.root.scale.setScalar(this.asset.scale * scale)
  }

  // Pose d'une image : couches de clips, puis procédural. `t` : horloge (ticks) du tremblement.
  pose(frame: AnimFrame, t: number, id: number): void {
    const want = new Set<string>()
    for (const l of frame.layers) {
      const a = this.action(l.clip)
      if (!a) continue
      want.add(l.clip)
      if (!this.active.has(l.clip)) {
        a.play()
        this.active.add(l.clip)
      }
      a.enabled = true
      a.setEffectiveWeight(l.weight)
      a.time = l.time
    }
    for (const name of [...this.active]) {
      if (want.has(name)) continue
      this.actions.get(name)?.stop()
      this.active.delete(name)
    }
    // Le mélangeur n'écrit un os que si sa valeur change depuis l'évaluation précédente (PropertyMixer.apply) : on
    // rend d'abord aux os retouchés leur valeur propre (sans procédural), sinon une pose identique garderait le
    // procédural de l'image d'avant et le cumulerait (rendu non reproductible).
    for (const [b, q] of this.clean) b.quaternion.copy(q)
    this.mixer.update(0)
    for (const [b, q] of this.clean) q.copy(b.quaternion)
    if (frame.layers.length > 0) this.procedural(frame, t, id)
    this.root.updateMatrixWorld(true)
  }

  // Tout ce qui vit tremble (§18) : micro-rotations à plusieurs fréquences, dont une ≥ 2 Hz (aucune fenêtre de 0,5 s
  // immobile, B2.O6) ; pivot de tête de l'alerte (L7).
  private procedural(frame: AnimFrame, t: number, id: number): void {
    const g = frame.tremble
    const s = t / 60
    const head = this.byName.get('Head')
    const neck = this.byName.get('neck')
    if (g > 0) {
      head?.rotateZ(
        g *
          (0.08 * Math.sin(TAU * 2.3 * s + phaseOf(id, 1)) + 0.04 * Math.sin(TAU * 5.1 * s + phaseOf(id, 2))),
      )
      head?.rotateX(g * 0.06 * Math.sin(TAU * 0.9 * s + phaseOf(id, 3)))
      this.byName.get('LeftArm')?.rotateZ(g * 0.06 * Math.sin(TAU * 2.7 * s + phaseOf(id, 4)))
      this.byName.get('RightArm')?.rotateZ(g * 0.06 * Math.sin(TAU * 3.1 * s + phaseOf(id, 5)))
      this.byName.get('Spine02')?.rotateX(g * 0.02 * Math.sin(TAU * 0.45 * s + phaseOf(id, 6)))
    }
    if (frame.headYaw !== 0) {
      neck?.rotateY(frame.headYaw * 0.4)
      head?.rotateY(frame.headYaw * 0.6)
    }
  }

  // Matrices monde des os (I4 : un os est un segment).
  boneMatrices(): Matrix4[] {
    return this.bones.map((b) => b.matrixWorld.clone())
  }

  // Doublure du corps dans une autre scène (liseré, marques) : même géométrie, même squelette. Le maillage reste à
  // l'origine : la peau donne directement les positions monde (liaison attachée, inverse de liaison = identité).
  overlay(material: Material, idMaterial: Material): SkinnedMesh {
    const m = new SkinnedMesh(this.mesh.geometry, material)
    m.bind(this.mesh.skeleton, this.mesh.bindMatrix)
    m.frustumCulled = false
    m.matrixAutoUpdate = false
    m.userData.idMaterial = idMaterial
    return m
  }

  // Doublure d'ombre : la version grossière du corps, sur le même squelette, vue des seules caméras d'ombre (une
  // ombre portée au sol n'a pas besoin des 10 000 à 25 000 triangles du corps, et il y a jusqu'à quatre passes).
  shadowProxy(
    geometry: BufferGeometry,
    depthMaterial: Material,
    layer: number,
    invisible: Material,
  ): SkinnedMesh {
    const m = new SkinnedMesh(geometry, invisible)
    m.bind(this.mesh.skeleton, this.mesh.bindMatrix)
    m.frustumCulled = true // sphère englobante posée à chaque image par la couche (repère monde)
    m.matrixAutoUpdate = false
    m.castShadow = true
    m.customDepthMaterial = depthMaterial
    m.layers.set(layer)
    m.userData.noId = true
    return m
  }

  // Pose figée d'un mort, cuite sur le CPU : sommets de la version allégée (positions et normales monde).
  bake(lod: BufferGeometry): { positions: Float32Array; normals: Float32Array } {
    const skel = this.mesh.skeleton
    const mats = this.bones.map((b, i) =>
      new Matrix4()
        .multiplyMatrices(b.matrixWorld, skel.boneInverses[i] as Matrix4)
        .multiply(this.mesh.bindMatrix),
    )
    const pos = lod.getAttribute('position')
    const nor = lod.getAttribute('normal')
    const si = lod.getAttribute('skinIndex')
    const sw = lod.getAttribute('skinWeight')
    const n = pos.count
    const positions = new Float32Array(n * 3)
    const normals = new Float32Array(n * 3)
    const p = new Vector3()
    const q = new Vector3()
    const accP = new Vector3()
    const accN = new Vector3()
    for (let i = 0; i < n; i++) {
      accP.set(0, 0, 0)
      accN.set(0, 0, 0)
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(i, k)
        if (w === 0) continue
        const m = mats[si.getComponent(i, k)] as Matrix4
        accP.addScaledVector(p.fromBufferAttribute(pos, i).applyMatrix4(m), w)
        accN.addScaledVector(q.fromBufferAttribute(nor, i).transformDirection(m), w)
      }
      accN.normalize()
      positions.set([accP.x, accP.y, accP.z], i * 3)
      normals.set([accN.x, accN.y, accN.z], i * 3)
    }
    return { positions, normals }
  }

  dispose(): void {
    this.mixer.stopAllAction()
    this.mixer.uncacheRoot(this.scene)
  }
}
