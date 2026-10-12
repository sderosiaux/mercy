// Dérive de racine d'un clip joué sur place : le bassin finit ailleurs qu'il n'a commencé (une réaction qui recule
// de 80 cm). La simulation ne déplace pas la créature pendant ce clip : à la fin, le corps sauterait d'un coup à
// sa place. Même critère que le contrôle « sur-place » de la validation (déplacement net du bassin ÷ durée, au-delà
// de ROOT_DRIFT_MAX_MPS) ; même correction que l'assemblage pour `retirerDerive` : on retire la tendance
// linéaire du déplacement horizontal, le balancement et l'élan du geste restent. Les pieds sont ensuite tenus au
// sol par le verrouillage (legs.ts).
import { type Object3D, Vector3 } from 'three'
import { boneAt, type Pose, type Rig } from '../validate/rig'
import { type ClipFrames, cloneFrames, setFrame } from './frames'

export const rootDrift = (poses: readonly Pose[], hips: number, durationS: number): number => {
  const a = boneAt(poses[0] as Pose, hips)
  const b = boneAt(poses[poses.length - 1] as Pose, hips)
  return Math.hypot(b[0] - a[0], b[2] - a[2]) / Math.max(durationS, 1e-6)
}

// Retire la dérive horizontale nette du nœud `hips` (piste de translation, dans l'espace de son parent).
export const stripDrift = (
  rig: Rig,
  f: ClipFrames,
  hipsObject: Object3D,
  poses: readonly Pose[],
  hips: number,
): ClipFrames => {
  const out = cloneFrames(f)
  const track = out.tracks.find((tr) => tr.object === hipsObject)
  if (!track?.t) throw new Error(`dérive : ${f.name} n'anime pas la translation du bassin`)
  const parent = hipsObject.parent as Object3D
  const a = boneAt(poses[0] as Pose, hips)
  const b = boneAt(poses[poses.length - 1] as Pose, hips)
  setFrame(rig, out, 0)
  rig.root.updateMatrixWorld(true)
  const p0 = new Vector3(a[0], a[1], a[2]).divideScalar(rig.scale)
  const p1 = new Vector3(b[0], a[1], b[2]).divideScalar(rig.scale) // horizontal seulement
  const local = parent.worldToLocal(p1.clone()).sub(parent.worldToLocal(p0.clone()))
  const n = out.times.length
  const span = (out.times[n - 1] as number) - (out.times[0] as number)
  for (let k = 0; k < n; k++) {
    const u = ((out.times[k] as number) - (out.times[0] as number)) / span
    track.t[3 * k] = (track.t[3 * k] as number) - local.x * u
    track.t[3 * k + 1] = (track.t[3 * k + 1] as number) - local.y * u
    track.t[3 * k + 2] = (track.t[3 * k + 2] as number) - local.z * u
  }
  return out
}
