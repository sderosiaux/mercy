// Instance animée : la pose d'une image ne dépend que des couches de clips et de l'horloge (rendre deux fois donne
// la même pose, tremblement compris : B2 I2) ; la pose figée cuite sur le CPU tombe là où le GPU la dessinerait.
import {
  AnimationClip,
  Bone,
  BoxGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  QuaternionKeyframeTrack,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
} from 'three'
import { describe, expect, it } from 'vitest'
import type { AnimFrame } from '../anim/machine'
import { ModelInstance } from './instance'
import type { ModelAsset } from './loader'

// Petit humanoïde : bassin, buste, tête, deux bras ; une boîte pondérée sur deux os.
const model = (): ModelAsset => {
  const names = ['Hips', 'Spine02', 'neck', 'Head', 'LeftArm', 'RightArm']
  const bones = names.map((n) => {
    const b = new Bone()
    b.name = n
    return b
  })
  const [hips, spine, neck, head, la, ra] = bones as [Bone, Bone, Bone, Bone, Bone, Bone]
  hips.position.set(0, 1, 0)
  spine.position.set(0, 0.3, 0)
  neck.position.set(0, 0.3, 0)
  head.position.set(0, 0.1, 0)
  la.position.set(0.2, 0.25, 0)
  ra.position.set(-0.2, 0.25, 0)
  hips.add(spine)
  spine.add(neck, la, ra)
  neck.add(head)
  const geo = new BoxGeometry(0.4, 1.6, 0.3, 2, 8, 2).translate(0, 1.2, 0)
  const n = geo.getAttribute('position').count
  const si: number[] = []
  const sw: number[] = []
  for (let i = 0; i < n; i++) {
    const y = geo.getAttribute('position').getY(i)
    si.push(0, 1, 3, 0)
    const w = Math.min(1, Math.max(0, (y - 1) / 0.8))
    sw.push(1 - w, w * 0.6, w * 0.4, 0)
  }
  geo.setAttribute('skinIndex', new Uint16BufferAttribute(si, 4))
  geo.setAttribute('skinWeight', new Float32BufferAttribute(sw, 4))
  const mesh = new SkinnedMesh(geo, new MeshBasicMaterial())
  mesh.name = 'corps'
  const root = new Group()
  root.add(mesh, hips)
  root.updateMatrixWorld(true)
  mesh.bind(new Skeleton(bones))
  const turn = (axis: Vector3, a: number) => new Quaternion().setFromAxisAngle(axis, a).toArray()
  const clip = new AnimationClip('balance', 2, [
    new QuaternionKeyframeTrack(
      'Spine02.quaternion',
      [0, 1, 2],
      [
        ...turn(new Vector3(0, 0, 1), 0),
        ...turn(new Vector3(0, 0, 1), 0.6),
        ...turn(new Vector3(0, 0, 1), 0),
      ],
    ),
    new QuaternionKeyframeTrack(
      'Head.quaternion',
      [0, 2],
      [...turn(new Vector3(1, 0, 0), 0), ...turn(new Vector3(1, 0, 0), 0.4)],
    ),
  ])
  return {
    id: 'test',
    template: root,
    meshName: 'corps',
    clips: new Map([['balance', clip]]),
    scale: 1,
    anchor: new Vector3(),
    boneNames: names,
    boxes: [],
    lod: geo,
  } as unknown as ModelAsset
}

const frame = (time: number, tremble = 1): AnimFrame => ({
  layers: [{ clip: 'balance', time, weight: 1 }],
  tremble,
  headYaw: 0.2,
})

const snapshot = (inst: ModelInstance): number[] => inst.bones.flatMap((b) => b.matrixWorld.toArray())

describe('pose d’une image', () => {
  it('rendre deux fois la même image donne la même pose, tremblement compris', () => {
    const inst = new ModelInstance(model())
    inst.place(1, 2, 0.5, 1)
    inst.pose(frame(0.7), 42, 3)
    const a = snapshot(inst)
    inst.pose(frame(0.7), 42, 3)
    inst.pose(frame(0.7), 42, 3)
    expect(snapshot(inst)).toEqual(a)
    // Une autre image puis retour : même pose (aucune mémoire dans les os).
    inst.pose(frame(1.3), 80, 3)
    inst.pose(frame(0.7), 42, 3)
    expect(snapshot(inst)).toEqual(a)
  })
  it('le vivant tremble : même instant du clip, horloges différentes, poses différentes', () => {
    const inst = new ModelInstance(model())
    inst.pose(frame(0.7), 42, 3)
    const a = snapshot(inst)
    inst.pose(frame(0.7), 47, 3)
    expect(snapshot(inst)).not.toEqual(a)
  })
})

describe('instance réutilisée (réservoir)', () => {
  it('une suite de poses quelconque finit sur la même pose qu’une instance neuve', () => {
    const asset = model()
    const used = new ModelInstance(asset)
    const seq: AnimFrame[] = [
      frame(1.9, 0),
      frame(1.9, 0),
      { layers: [], tremble: 0, headYaw: 0 },
      frame(0.3, 1),
      frame(1.2, 0),
    ]
    for (const [k, f] of seq.entries()) used.pose(f, 10 + k, 5)
    const fresh = new ModelInstance(asset)
    fresh.pose(frame(1.2, 0), 14, 5)
    expect(snapshot(used)).toEqual(snapshot(fresh))
  })
})

describe('pose figée cuite', () => {
  it('les sommets cuits sur le CPU sont ceux de la peau du GPU (positions monde)', () => {
    const asset = model()
    const inst = new ModelInstance(asset)
    inst.place(3, -1, 1.1, 1.08)
    inst.pose(frame(1.1, 0), 90, 7)
    const baked = inst.bake(asset.lod)
    const v = new Vector3()
    const m = inst.mesh
    for (let i = 0; i < 40; i++) {
      m.getVertexPosition(i, v)
      v.applyMatrix4(m.matrixWorld)
      expect(baked.positions[i * 3]).toBeCloseTo(v.x, 5)
      expect(baked.positions[i * 3 + 1]).toBeCloseTo(v.y, 5)
      expect(baked.positions[i * 3 + 2]).toBeCloseTo(v.z, 5)
    }
  })
  it('la cuisson ne dépend que de la pose (deux cuissons, mêmes sommets)', () => {
    const asset = model()
    const inst = new ModelInstance(asset)
    inst.pose(frame(0.4, 0), 10, 1)
    const a = inst.bake(asset.lod)
    inst.pose(frame(1.9, 1), 99, 1)
    inst.pose(frame(0.4, 0), 10, 1)
    expect(Array.from(inst.bake(asset.lod).positions)).toEqual(Array.from(a.positions))
    expect(new Matrix4().copy(inst.mesh.matrixWorld).determinant()).not.toBe(0)
  })
})
