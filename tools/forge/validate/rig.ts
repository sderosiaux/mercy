// Chargement d'un GLB en scène three (sans WebGL) et échantillonnage des poses : positions de tous les os dans
// l'espace du modèle, ramenées en mètres de jeu. Toutes les mesures de mouvement partent d'ici.
import {
  type AnimationClip,
  AnimationMixer,
  type Bone,
  Box3,
  LoopOnce,
  type Object3D,
  type SkinnedMesh,
  Vector3,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { type Glb, parseGlb, writeGlb } from '../gltf/glb'
import { blockingExtensions, stripTextures } from '../gltf/inspect'
import { FRAME_S } from '../playback'
import type { Effecteur } from '../schema'

export interface Rig {
  readonly root: Object3D
  readonly bones: readonly Bone[]
  readonly skinned: readonly SkinnedMesh[]
  readonly clips: readonly AnimationClip[]
  readonly restHeight: number // unités du modèle
  readonly scale: number // mètres de jeu par unité du modèle
  readonly nodes: ReadonlyMap<number, Object3D> // nœud glTF → objet de la scène (post-traitements)
}

export type Pose = Float64Array // x, y, z par os, en mètres de jeu

export const loadRig = async (
  glb: Glb,
  opts: { hauteurM: number | null; stripTextures: boolean },
): Promise<Rig> => {
  const blocking = blockingExtensions(glb)
  if (blocking.length > 0)
    throw new Error(`extensions requises non gérées par la mesure : ${blocking.join(', ')}`)
  const bytes = writeGlb(opts.stripTextures ? stripTextures(glb) : glb)
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const gltf = await new GLTFLoader().parseAsync(buffer, '')
  const root = gltf.scene
  root.updateMatrixWorld(true)
  const skinned: SkinnedMesh[] = []
  root.traverse((o) => {
    if ((o as SkinnedMesh).isSkinnedMesh) skinned.push(o as SkinnedMesh)
  })
  const bones = [...new Set(skinned.flatMap((s) => s.skeleton.bones))]
  const box = new Box3().setFromObject(root)
  const restHeight = box.isEmpty() ? 0 : box.max.y - box.min.y
  const scale = opts.hauteurM !== null && restHeight > 0 ? opts.hauteurM / restHeight : 1
  const nodes = new Map<number, Object3D>()
  for (const [object, ref] of gltf.parser.associations) {
    const index = (ref as { nodes?: number }).nodes
    if (index !== undefined && (object as Object3D).isObject3D) nodes.set(index, object as Object3D)
  }
  return { root, bones, skinned, clips: gltf.animations, restHeight, scale, nodes }
}

export const loadRigBytes = (bytes: Uint8Array, opts: { hauteurM: number | null; stripTextures: boolean }) =>
  loadRig(parseGlb(bytes), opts)

const tmp = new Vector3()

export const readPose = (rig: Rig): Pose => {
  rig.root.updateMatrixWorld(true)
  const out = new Float64Array(rig.bones.length * 3)
  rig.bones.forEach((b, i) => {
    b.getWorldPosition(tmp)
    out[i * 3] = tmp.x * rig.scale
    out[i * 3 + 1] = tmp.y * rig.scale
    out[i * 3 + 2] = tmp.z * rig.scale
  })
  return out
}

export const boneAt = (pose: Pose, i: number): [number, number, number] => [
  pose[i * 3] as number,
  pose[i * 3 + 1] as number,
  pose[i * 3 + 2] as number,
]

// Déplacement maximal d'un os entre deux poses.
export const maxDisplacement = (a: Pose, b: Pose): number => {
  let m = 0
  for (let i = 0; i < a.length; i += 3) {
    const d = Math.hypot(
      (a[i] as number) - (b[i] as number),
      (a[i + 1] as number) - (b[i + 1] as number),
      (a[i + 2] as number) - (b[i + 2] as number),
    )
    if (d > m) m = d
  }
  return m
}

// Instants d'échantillonnage à 60 i/s de `from` à `to` compris.
export const frameTimes = (from: number, to: number): number[] => {
  const out: number[] = []
  for (let k = 0; from + k * FRAME_S < to - 1e-9; k++) out.push(from + k * FRAME_S)
  out.push(to)
  return out
}

// Poses d'un clip joué seul, aux instants donnés (temps du clip). Le clip est lu une fois et tenu sur sa dernière
// image : l'instant `duration` donne bien la dernière image, pas la première d'un tour suivant.
export const sampleClip = (rig: Rig, clip: AnimationClip, times: readonly number[]): Pose[] => {
  const mixer = new AnimationMixer(rig.root)
  const action = mixer.clipAction(clip)
  action.setLoop(LoopOnce, 1)
  action.clampWhenFinished = true
  action.play()
  const poses = times.map((t) => {
    action.reset() // une lecture finie et tenue est en pause : sans remise à zéro, l'instant suivant serait ignoré
    mixer.setTime(t)
    return readPose(rig)
  })
  mixer.stopAllAction()
  mixer.uncacheRoot(rig.root)
  rig.root.updateMatrixWorld(true)
  return poses
}

// ---------------------------------------------------------------- os nommés

const tokens = (name: string): string[] =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)

const FINGERS = [
  'thumb',
  'index',
  'middle',
  'ring',
  'pinky',
  'little',
  'finger',
  'end',
  'top',
  'toe',
  'twist',
  'nub',
]
const LEFT = ['left', 'l']
const RIGHT = ['right', 'r']

const matches = (t: string[], effecteur: Effecteur): boolean => {
  if (t.some((x) => FINGERS.includes(x))) return false
  const left = t.some((x) => LEFT.includes(x))
  const right = t.some((x) => RIGHT.includes(x))
  const foot = t.includes('foot') || t.includes('ankle')
  const hand = t.includes('hand') || t.includes('wrist')
  switch (effecteur) {
    case 'tete':
      return t.includes('head') && !left && !right
    case 'mainGauche':
      return hand && left && !right
    case 'mainDroite':
      return hand && right && !left
    case 'piedGauche':
      return foot && left && !right
    case 'piedDroit':
      return foot && right && !left
  }
}

// Os d'un effecteur : nom imposé par la fiche, sinon reconnaissance par le nom (LeftFoot, foot.L, Bip01 R Hand…).
export const findBone = (
  rig: Pick<Rig, 'bones'>,
  effecteur: Effecteur,
  override?: Readonly<Partial<Record<Effecteur, string>>>,
): number => {
  const wanted = override?.[effecteur]
  if (wanted !== undefined) return rig.bones.findIndex((b) => b.name === wanted)
  let best = -1
  let bestLen = Number.POSITIVE_INFINITY
  rig.bones.forEach((b, i) => {
    const t = tokens(b.name)
    if (matches(t, effecteur) && t.length < bestLen) {
      best = i
      bestLen = t.length
    }
  })
  return best
}

export const findHips = (rig: Rig): number => {
  const named = rig.bones.findIndex((b) => {
    const t = tokens(b.name)
    return t.includes('hips') || t.includes('pelvis')
  })
  if (named >= 0) return named
  return rig.bones.findIndex((b) => !(b.parent as Bone | null)?.isBone)
}
