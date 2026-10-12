// Fermeture de boucle, en deux temps.
//
// 1. Points de bouclage : on cherche dans le clip la portion [a ; b] (au moins la moitié du clip) qui demande la
//    plus petite correction par image : écart à la coupe ÷ longueur gardée. L'écart à la coupe compare les poses
//    sur ±2 images autour d'elle (pose et vitesse), avec la distance de la validation (déplacement maximal d'un
//    os). Un clip généré « qui boucle » contient souvent plusieurs cycles du geste : couper sur un cycle entier
//    évite de fondre une foulée dans une autre ; à correction égale, la portion la plus longue garde le plus du
//    geste.
// 2. Fondu de pose : l'écart de position restant est réparti linéairement sur toute la portion (chaque image n'en
//    reçoit que 1/L ; dernière image = première, exactement). L'écart de vitesse à la couture est corrigé à part,
//    sur LOOP_VELOCITY_S de chaque côté (bases d'Hermite à valeur nulle aux deux bouts) : la vitesse en sortie de
//    la dernière image devient celle d'entrée de la première, sans rebond. Réparti sur toute la boucle, cet écart
//    ferait une bosse de L·Δv/8 au milieu (13 cm sur la danse) ; confiné, elle reste sous 0,08·W·Δv.
//    Translation et échelle : la correction s'ajoute. Rotation : elle se compose à gauche (espace du parent),
//    écrite en vecteur de rotation.
import { Quaternion, Vector3 } from 'three'
import { maxDisplacement, type Pose } from '../validate/rig'
import { type ClipFrames, cloneFrames } from './frames'

export const LOOP_MIN_KEEP = 0.5 // part minimale du clip gardée
export const LOOP_WINDOW = 2 // images de part et d'autre de la coupe

export interface LoopCut {
  readonly a: number
  readonly b: number
  readonly cost: number // m, distance de pose et de vitesse à la coupe
}

const cutCost = (poses: readonly Pose[], a: number, b: number): number => {
  let worst = 0
  for (let j = -LOOP_WINDOW; j <= LOOP_WINDOW; j++) {
    const i = a + j
    const k = b + j
    if (i < 0 || k < 0 || i >= poses.length || k >= poses.length) continue
    worst = Math.max(worst, maxDisplacement(poses[i] as Pose, poses[k] as Pose))
  }
  return worst
}

export const findLoopCut = (poses: readonly Pose[]): LoopCut => {
  const last = poses.length - 1
  const minLen = Math.max(2, Math.ceil(LOOP_MIN_KEEP * last))
  let best: LoopCut = { a: 0, b: last, cost: cutCost(poses, 0, last) }
  let bestRate = best.cost / Math.max(1, last)
  for (let a = 0; a + minLen <= last; a++) {
    for (let b = a + minLen; b <= last; b++) {
      const cost = cutCost(poses, a, b)
      const rate = cost / (b - a)
      // strictement meilleure, ou égale et plus longue : le parcours est ordonné, le choix est déterministe
      if (rate < bestRate - 1e-12 || (Math.abs(rate - bestRate) <= 1e-12 && b - a > best.b - best.a)) {
        best = { a, b, cost }
        bestRate = rate
      }
    }
  }
  return best
}

export const LOOP_VELOCITY_S = 0.25

// Correction c(k), k = 0..L : c(0) = 0, c(L) = dp (linéaire), pente −dv/2 de plus en 0 et +dv/2 de plus en L,
// apportées par h10 et h11 sur W images et nulles au-delà. dv = vitesse d'entrée en 0 − vitesse de sortie en L.
// Sur la grille, le premier pas de h10 vaut (1 − 1/W)² de sa pente : on compense pour que les pas d'image de part et
// d'autre de la couture soient égaux exactement, pas seulement à la limite.
const correction = (k: number, L: number, W: number, dp: number, dv: number): number => {
  const half = dv / 2 / (1 - 1 / W) ** 2
  let c = (dp * k) / L
  if (k <= W) {
    const u = k / W
    c -= half * W * (u * (1 - u) * (1 - u)) // h10
  }
  if (k >= L - W) {
    const u = (k - (L - W)) / W
    c += half * W * (u * u * (u - 1)) // h11
  }
  return c
}

const rotVec = (q: Quaternion, out: Vector3): Vector3 => {
  const w = Math.min(1, Math.max(-1, q.w))
  const sign = w < 0 ? -1 : 1
  const s = Math.sqrt(Math.max(0, 1 - w * w))
  const angle = 2 * Math.atan2(s, Math.abs(w))
  if (s < 1e-12) return out.set(0, 0, 0)
  return out.set(q.x, q.y, q.z).multiplyScalar((sign * angle) / s)
}

const fromRotVec = (v: Vector3, out: Quaternion): Quaternion => {
  const angle = v.length()
  if (angle < 1e-12) return out.set(0, 0, 0, 1)
  return out.setFromAxisAngle(v.clone().divideScalar(angle), angle)
}

const qAt = (r: Float64Array, k: number, out: Quaternion): Quaternion => out.fromArray(r, 4 * k)
// rotation qui mène de q(j) à q(i), dans l'espace du parent : q(i) · q(j)⁻¹
const rel = (r: Float64Array, i: number, j: number, out: Vector3): Vector3 => {
  const qi = qAt(r, i, new Quaternion())
  const qj = qAt(r, j, new Quaternion()).invert()
  return rotVec(qi.multiply(qj), out)
}

// Garde les images [a ; b] (temps ramenés à 0) et ferme la boucle en position et en vitesse.
export const closeLoop = (f: ClipFrames, a: number, b: number): ClipFrames => {
  if (b - a < 2) throw new Error(`boucle ${f.name} : portion trop courte`)
  const n = b - a + 1
  const L = n - 1
  const t0 = f.times[a] as number
  const times = Float64Array.from({ length: n }, (_, k) => (f.times[a + k] as number) - t0)
  const out = cloneFrames(f, times)
  const W = Math.max(1, Math.min(Math.round(LOOP_VELOCITY_S * 60), Math.floor(L / 2)))
  const tracks = out.tracks.map((tr) => {
    const slice = (v: Float64Array | null, w: number): Float64Array | null =>
      v ? v.slice(a * w, (b + 1) * w) : null
    const t = slice(tr.t, 3)
    const r = slice(tr.r, 4)
    const s = slice(tr.s, 3)
    for (const v of [t, s]) {
      if (!v) continue
      for (let c = 0; c < 3; c++) {
        const x = (k: number): number => v[3 * k + c] as number
        const dp = x(0) - x(L)
        const dv = x(1) - x(0) - (x(L) - x(L - 1))
        const corr = Array.from({ length: n }, (_, k) => correction(k, L, W, dp, dv))
        for (let k = 0; k < n; k++) v[3 * k + c] = x(k) + (corr[k] as number)
        v[3 * L + c] = v[c] as number // exactement la première image
      }
    }
    if (r) {
      const dRho = rel(r, 0, L, new Vector3())
      const dOmega = rel(r, 1, 0, new Vector3()).sub(rel(r, L, L - 1, new Vector3()))
      const rho = new Vector3()
      const corr = new Quaternion()
      const q = new Quaternion()
      const fixed: number[] = []
      for (let k = 0; k < n; k++) {
        rho.set(
          ...([0, 1, 2].map((c) => correction(k, L, W, dRho.getComponent(c), dOmega.getComponent(c))) as [
            number,
            number,
            number,
          ]),
        )
        qAt(r, k, q).premultiply(fromRotVec(rho, corr)).normalize()
        fixed.push(...q.toArray())
      }
      r.set(fixed)
      for (let c = 0; c < 4; c++) r[4 * L + c] = r[c] as number // exactement la première image
      for (let i = 4; i < r.length; i += 4) {
        let dot = 0
        for (let c = 0; c < 4; c++) dot += (r[i + c] as number) * (r[i - 4 + c] as number)
        if (dot < 0) for (let c = 0; c < 4; c++) r[i + c] = -(r[i + c] as number)
      }
    }
    return { ...tr, t, r, s }
  })
  return { ...out, tracks }
}
