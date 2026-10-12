// Jambes : cinématique inverse à deux os (cuisse, tibia) qui amène la cheville sur une cible, et deux usages.
//
// - Verrouillage des pieds (clips joués sur place) : pendant chaque appui (même définition que la validation :
//   pied à moins de 2 cm de son point le plus bas, 3 images au moins), la cheville est tenue sur un point fixe du
//   sol. Hauteur d'origine gardée image par image : seuls x et z bougent, donc les appuis restent les mêmes. Entre
//   deux appuis, la correction revient à zéro (ou passe d'un appui au suivant) en douceur sur FOOT_BLEND_S.
//   Point fixe : pour un clip qui ne boucle pas, un appui qui touche le début (ou la fin) est tenu là où le pied
//   est à la première (ou dernière) image, pour que les poses de raccord avec les autres clips ne changent pas ;
//   ailleurs, le barycentre de l'appui (la plus petite correction). Pour une boucle fermée, un appui à cheval sur
//   la couture est un seul appui, tenu en un seul point : la boucle reste fermée.
//   Ajustement du bassin : quand un point fixe est hors d'atteinte de la jambe (le corps s'en éloigne), le bassin
//   descend juste assez, en douceur (élargi puis lissé sur FOOT_BLEND_S), et toutes les jambes sont recalées pour
//   qu'aucun pied ne change de hauteur.
// - Foulée (locomotion lue hors des bornes de vitesse) : l'amplitude horizontale des pieds est mise à l'échelle
//   autour de leur position moyenne, ce qui allonge (ou raccourcit) la foulée au lieu d'accélérer le geste.
//
// Après la cuisse et le tibia, le pied retrouve son orientation d'origine dans le monde : il ne pivote pas.
import { type Object3D, Quaternion, Vector3 } from 'three'
import { type ContactRun, contactRuns } from '../validate/checks'
import { boneAt, type Pose, type Rig } from '../validate/rig'
import { type ClipFrames, cloneFrames, posesOf, rotationTrack, setFrame } from './frames'

export const FOOT_BLEND_S = 0.15 // fondu de la correction avant et après un appui
export const REACH_MARGIN = 1e-3 // part de la longueur de jambe jamais tendue complètement
export const PELVIS_MARGIN_M = 0.002 // le bassin descend 2 mm de plus que l'atteinte exacte

export interface Leg {
  readonly bone: number // indice de l'os du pied dans rig.bones (celui que mesure la validation)
  readonly foot: Object3D
  readonly shin: Object3D
  readonly thigh: Object3D
}

export const legOf = (rig: Rig, bone: number): Leg | null => {
  const foot = rig.bones[bone]
  const shin = foot?.parent
  const thigh = shin?.parent
  if (!foot || !shin || !thigh?.parent) return null
  return { bone, foot, shin, thigh }
}

const va = new Vector3()
const vb = new Vector3()
const vc = new Vector3()
const axis = new Vector3()
const q1 = new Quaternion()
const q2 = new Quaternion()
const qFoot = new Quaternion()

const setWorldRotation = (o: Object3D, world: Quaternion): void => {
  ;(o.parent as Object3D).getWorldQuaternion(q2)
  o.quaternion.copy(q2.invert().multiply(world)).normalize()
  o.updateMatrixWorld(true)
}

// Amène la cheville de `leg` sur `target` (coordonnées monde de la scène). Rend la distance restante.
export const solveLeg = (leg: Leg, target: Vector3): number => {
  const { thigh, shin, foot } = leg
  foot.getWorldQuaternion(qFoot)
  thigh.getWorldPosition(va)
  shin.getWorldPosition(vb)
  foot.getWorldPosition(vc)
  const l1 = va.distanceTo(vb)
  const l2 = vb.distanceTo(vc)
  const reach = (l1 + l2) * (1 - REACH_MARGIN)
  const lat = Math.min(Math.max(va.distanceTo(target), Math.abs(l1 - l2) + 1e-6), reach)
  // genou : angle intérieur visé (loi des cosinus), rotation du tibia dans le plan de la jambe
  const ba = new Vector3().subVectors(va, vb)
  const bc = new Vector3().subVectors(vc, vb)
  const theta0 = ba.angleTo(bc)
  const theta1 = Math.acos(Math.min(1, Math.max(-1, (l1 * l1 + l2 * l2 - lat * lat) / (2 * l1 * l2))))
  axis.crossVectors(bc, ba)
  if (axis.lengthSq() < 1e-12) {
    // Jambe tendue, plan de flexion indéfini : on plie autour de l'axe horizontal perpendiculaire à l'avant du
    // bassin, dans le sens qui recule la cheville (le genou part alors vers l'avant quand la cuisse se réaligne).
    const forward = new Vector3(0, 0, 1).applyQuaternion((thigh.parent as Object3D).getWorldQuaternion(q1))
    axis.crossVectors(bc, forward)
    if (axis.lengthSq() < 1e-12) axis.set(1, 0, 0)
    axis.normalize()
    const moved = bc.clone().applyAxisAngle(axis, theta0 - theta1)
    if (moved.dot(forward) > bc.dot(forward)) axis.negate()
  }
  axis.normalize()
  if (Math.abs(theta0 - theta1) > 1e-9) {
    shin.getWorldQuaternion(q1)
    setWorldRotation(shin, q1.premultiply(new Quaternion().setFromAxisAngle(axis, theta0 - theta1)))
  }
  // cuisse : rotation minimale qui aligne hanche → cheville sur hanche → cible
  foot.getWorldPosition(vc)
  const from = new Vector3().subVectors(vc, va)
  const to = new Vector3().subVectors(target, va)
  if (from.lengthSq() > 1e-12 && to.lengthSq() > 1e-12) {
    const turn = new Quaternion().setFromUnitVectors(from.normalize(), to.normalize())
    thigh.getWorldQuaternion(q1)
    setWorldRotation(thigh, q1.premultiply(turn))
  }
  setWorldRotation(foot, qFoot)
  foot.getWorldPosition(vc)
  return vc.distanceTo(target)
}

// Cible horizontale (x, z en mètres de jeu) de la cheville, image par image ; null : rien à corriger.
export type FootPlan = (readonly [number, number] | null)[]

export interface LegResult {
  readonly frames: ClipFrames
  readonly maxErrorM: number // plus grand écart restant entre cheville et cible (jambe trop courte)
  readonly maxCorrectionM: number // plus grand déplacement horizontal imposé à une cheville
}

// Applique des cibles de cheville à toutes les images (positions en mètres de jeu, hauteur d'origine).
export const applyPlans = (
  rig: Rig,
  f: ClipFrames,
  plans: ReadonlyMap<Leg, FootPlan>,
  poses: readonly Pose[],
  force: (k: number) => boolean = () => false, // images où la jambe est recalée même sans déplacement voulu
): LegResult => {
  let out = cloneFrames(f)
  const writes = new Map<Object3D, Float64Array>()
  for (const leg of plans.keys()) {
    for (const o of [leg.thigh, leg.shin, leg.foot]) {
      const t = rotationTrack(rig, out, o)
      out = t.f
      writes.set(o, t.r)
    }
  }
  let maxErrorM = 0
  let maxCorrectionM = 0
  const target = new Vector3()
  for (let k = 0; k < out.times.length; k++) {
    let touched = false
    for (const [leg, plan] of plans) {
      const p = plan[k]
      if (!p) continue
      const here = boneAt(poses[k] as Pose, leg.bone)
      const move = Math.hypot(p[0] - here[0], p[1] - here[2])
      if (move < 1e-7 && !force(k)) continue
      if (!touched) {
        setFrame(rig, out, k)
        rig.root.updateMatrixWorld(true)
        touched = true
      }
      maxCorrectionM = Math.max(maxCorrectionM, move)
      target.set(p[0], here[1], p[1]).divideScalar(rig.scale)
      maxErrorM = Math.max(maxErrorM, solveLeg(leg, target) * rig.scale)
      for (const o of [leg.thigh, leg.shin, leg.foot])
        (writes.get(o) as Float64Array).set(o.quaternion.toArray(), 4 * k)
    }
  }
  return { frames: out, maxErrorM, maxCorrectionM }
}

// ---------------------------------------------------------------- verrouillage des pieds

interface Pin {
  readonly frames: readonly number[] // images de l'appui, dans l'ordre
  readonly target: readonly [number, number]
}

const centroid = (poses: readonly Pose[], bone: number, frames: readonly number[]): [number, number] => {
  let x = 0
  let z = 0
  for (const k of frames) {
    const p = boneAt(poses[k] as Pose, bone)
    x += p[0]
    z += p[2]
  }
  return [x / frames.length, z / frames.length]
}

const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i)

const smooth = (u: number): number => {
  const c = Math.min(1, Math.max(0, u))
  return c * c * (3 - 2 * c)
}

// Un appui commence et finit entre deux images : la cheville est tenue aussi sur l'image qui précède et celle qui
// suit, pour qu'un pied qui touche le sol entre deux clés y soit déjà immobile (le jeu lit les clips à d'autres
// instants que 60 i/s pile). Une image libre entre deux appuis reste au fondu.
const widen = (runs: readonly ContactRun[], last: number): ContactRun[] =>
  runs.map((r, i) => {
    const prev = runs[i - 1]
    const next = runs[i + 1]
    const from = r.from > 0 && (!prev || r.from - 1 - prev.to > 1) ? r.from - 1 : r.from
    const to = r.to < last && (!next || next.from - (r.to + 1) > 1) ? r.to + 1 : r.to
    return { from, to }
  })

// Appuis d'un pied et leur point fixe. `cyclic` : la dernière image est la première (boucle fermée).
export const footPins = (poses: readonly Pose[], bone: number, cyclic: boolean): Pin[] => {
  const last = poses.length - 1
  const runs: ContactRun[] = widen(contactRuns(poses, bone), last)
  if (runs.length === 0) return []
  const first = runs[0] as ContactRun
  const end = runs[runs.length - 1] as ContactRun
  if (cyclic) {
    const wraps = runs.length > 1 && first.from === 0 && end.to === last
    const merged: number[][] = runs.map((r) => range(r.from, r.to))
    if (wraps) {
      const tail = merged.pop() as number[]
      merged[0] = [...tail, ...(merged[0] as number[])]
    }
    return merged.map((frames) => {
      const unique = frames.filter((k) => k !== last) // l'image finale est la première
      return { frames, target: centroid(poses, bone, unique.length > 0 ? unique : frames) }
    })
  }
  return runs.map((r) => {
    const frames = range(r.from, r.to)
    const at = (k: number): [number, number] => {
      const p = boneAt(poses[k] as Pose, bone)
      return [p[0], p[2]]
    }
    return { frames, target: r.from === 0 ? at(0) : r.to === last ? at(last) : centroid(poses, bone, frames) }
  })
}

// Correction horizontale (cible − position) image par image : tenue pendant les appuis, fondue entre eux.
export const footPlan = (
  poses: readonly Pose[],
  bone: number,
  pins: readonly Pin[],
  cyclic: boolean,
): FootPlan => {
  const n = poses.length
  const last = n - 1
  const blend = Math.max(1, Math.round(FOOT_BLEND_S * 60))
  const offset: ([number, number] | null)[] = Array.from({ length: n }, () => null)
  const here = (k: number): [number, number] => {
    const p = boneAt(poses[k] as Pose, bone)
    return [p[0], p[2]]
  }
  for (const pin of pins) {
    for (const k of pin.frames) {
      const h = here(k)
      offset[k] = [pin.target[0] - h[0], pin.target[1] - h[1]]
    }
  }
  // Trous entre appuis (en boucle : modulo la période, l'image finale suivant la première)
  const period = cyclic ? last : n
  const inRun = (k: number): boolean => offset[k] !== null
  const edges = (): { start: number; end: number }[] => {
    const gaps: { start: number; end: number }[] = []
    let k = 0
    while (k < period) {
      if (inRun(k)) {
        k++
        continue
      }
      const start = k
      while (k < period && !inRun(k)) k++
      gaps.push({ start, end: k - 1 })
    }
    if (cyclic && gaps.length > 1) {
      const a = gaps[0] as { start: number; end: number }
      const b = gaps[gaps.length - 1] as { start: number; end: number }
      if (a.start === 0 && b.end === period - 1) {
        gaps.pop()
        gaps[0] = { start: b.start, end: a.end + period }
      }
    }
    return gaps
  }
  if (pins.length === 0) return offset.map(() => null)
  const filled = offset.map((o) => (o ? ([...o] as [number, number]) : null))
  for (const gap of edges()) {
    const idx = (k: number): number => (cyclic ? ((k % period) + period) % period : k)
    const before = gap.start - 1
    const after = gap.end + 1
    const oBefore = cyclic || before >= 0 ? offset[idx(before)] : null
    const oAfter = cyclic || after < period ? offset[idx(after)] : null
    const len = gap.end - gap.start + 1
    for (let i = 0; i < len; i++) {
      const k = idx(gap.start + i)
      let x = 0
      let z = 0
      if (oBefore && oAfter) {
        // entre deux appuis : le pied va d'un point fixe au suivant sur tout le trou, avec la forme de son geste
        const w = smooth((i + 1) / (len + 1))
        x = oBefore[0] * (1 - w) + oAfter[0] * w
        z = oBefore[1] * (1 - w) + oAfter[1] * w
      } else if (oBefore) {
        // après le dernier appui d'un clip qui ne boucle pas : retour au geste d'origine
        const w = 1 - smooth((i + 1) / (Math.min(blend, len) + 1))
        x = oBefore[0] * w
        z = oBefore[1] * w
      } else if (oAfter) {
        // avant le premier appui
        const lead = Math.min(blend, len)
        const w = smooth((i - (len - lead) + 1) / (lead + 1))
        x = oAfter[0] * w
        z = oAfter[1] * w
      }
      filled[k] = [x, z]
    }
  }
  if (cyclic) filled[last] = filled[0] ?? null
  return filled.map((o, k) => {
    if (!o) return null
    const h = here(k)
    return [h[0] + o[0], h[1] + o[1]] as const
  })
}

export interface LockReport extends LegResult {
  readonly appuis: number
  readonly bassinM: number // plus grand abaissement du bassin (0 : aucun)
}

// Abaissement du bassin (m) qui met chaque cible de cheville à portée, image par image.
const pelvisNeed = (
  rig: Rig,
  f: ClipFrames,
  plans: ReadonlyMap<Leg, FootPlan>,
  poses: readonly Pose[],
): number[] => {
  const a = new Vector3()
  const b = new Vector3()
  const c = new Vector3()
  return Array.from({ length: f.times.length }, (_, k) => {
    let need = 0
    let posed = false
    for (const [leg, plan] of plans) {
      const p = plan[k]
      if (!p) continue
      if (!posed) {
        setFrame(rig, f, k)
        rig.root.updateMatrixWorld(true)
        posed = true
      }
      leg.thigh.getWorldPosition(a)
      leg.shin.getWorldPosition(b)
      leg.foot.getWorldPosition(c)
      const reach = (a.distanceTo(b) + b.distanceTo(c)) * (1 - REACH_MARGIN) * rig.scale
      const h = Math.hypot(p[0] - a.x * rig.scale, p[1] - a.z * rig.scale)
      if (h >= reach) continue // trop loin à l'horizontale : baisser le bassin n'y change rien
      const v = a.y * rig.scale - boneAt(poses[k] as Pose, leg.bone)[1]
      need = Math.max(need, v - Math.sqrt(reach * reach - h * h))
    }
    return need > 0 ? need + PELVIS_MARGIN_M : 0
  })
}

// Élargi (maximum glissant) puis lissé (cosinus) sur ±W images : jamais sous le besoin, sans à-coup.
const smoothNeed = (need: readonly number[], W: number, cyclic: boolean): number[] => {
  const n = need.length
  const period = cyclic ? n - 1 : n
  const at = (xs: readonly number[], k: number): number =>
    xs[cyclic ? ((k % period) + period) % period : Math.min(n - 1, Math.max(0, k))] as number
  const wide = need.map((_, k) => {
    let m = 0
    for (let j = -W; j <= W; j++) m = Math.max(m, at(need, k + j))
    return m
  })
  const out = need.map((_, k) => {
    let sum = 0
    let weight = 0
    for (let j = -W; j <= W; j++) {
      const w = 0.5 + 0.5 * Math.cos((Math.PI * j) / (W + 1))
      sum += w * at(wide, k + j)
      weight += w
    }
    return sum / weight
  })
  if (cyclic) out[n - 1] = out[0] as number
  return out
}

// Descend le nœud du bassin de `drop[k]` mètres (monde) à l'image k.
const lowerPelvis = (rig: Rig, f: ClipFrames, hips: Object3D, drop: readonly number[]): ClipFrames => {
  const out = cloneFrames(f)
  const track = out.tracks.find((tr) => tr.object === hips)
  if (!track?.t) throw new Error(`${f.name} : le bassin n'a pas de piste de translation`)
  setFrame(rig, out, 0)
  rig.root.updateMatrixWorld(true)
  const parent = hips.parent as Object3D
  const origin = new Vector3()
  const unit = parent
    .worldToLocal(new Vector3(0, -1 / rig.scale, 0))
    .sub(parent.worldToLocal(origin.set(0, 0, 0)))
  drop.forEach((d, k) => {
    if (d <= 0) return
    for (let c = 0; c < 3; c++)
      (track.t as Float64Array)[3 * k + c] =
        ((track.t as Float64Array)[3 * k + c] as number) + unit.getComponent(c) * d
  })
  return out
}

export const lockFeet = (rig: Rig, f: ClipFrames, legs: readonly Leg[], cyclic: boolean): LockReport => {
  const poses = posesOf(rig, f)
  const plans = new Map<Leg, FootPlan>()
  let appuis = 0
  for (const leg of legs) {
    const pins = footPins(poses, leg.bone, cyclic)
    appuis += pins.length
    plans.set(leg, footPlan(poses, leg.bone, pins, cyclic))
  }
  const need = pelvisNeed(rig, f, plans, poses)
  const hips = legs[0]?.thigh.parent
  if (!hips || need.every((d) => d <= 0)) return { ...applyPlans(rig, f, plans, poses), appuis, bassinM: 0 }
  const drop = smoothNeed(need, Math.max(1, Math.round(FOOT_BLEND_S * 60)), cyclic)
  const lowered = lowerPelvis(rig, f, hips, drop)
  // bassin baissé : toutes les jambes sont recalées sur ces images, les pieds libres là où ils étaient
  const all = new Map<Leg, FootPlan>(
    legs.map((leg) => [
      leg,
      (plans.get(leg) ?? []).map((p, k) => {
        if (p || (drop[k] as number) <= 0) return p
        const at = boneAt(poses[k] as Pose, leg.bone)
        return [at[0], at[2]] as const
      }),
    ]),
  )
  return {
    ...applyPlans(rig, lowered, all, poses, (k) => (drop[k] as number) > 0),
    appuis,
    bassinM: Math.max(...drop),
  }
}

// ---------------------------------------------------------------- foulée

// Met à l'échelle `factor` le chemin horizontal de chaque pied autour de sa position moyenne.
export const scaleStride = (rig: Rig, f: ClipFrames, legs: readonly Leg[], factor: number): LegResult => {
  const poses = posesOf(rig, f)
  const plans = new Map<Leg, FootPlan>()
  for (const leg of legs) {
    const all = range(0, poses.length - 1)
    const [cx, cz] = centroid(poses, leg.bone, all)
    plans.set(
      leg,
      all.map((k) => {
        const p = boneAt(poses[k] as Pose, leg.bone)
        return [cx + (p[0] - cx) * factor, cz + (p[2] - cz) * factor] as const
      }),
    )
  }
  return applyPlans(rig, f, plans, poses)
}
