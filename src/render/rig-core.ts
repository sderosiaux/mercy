// Noyau du rig (E1, découpé de rig.ts) : types de segments, outils de cinématique, humanoïde générique,
// tremblement et marche. Pur : aucune dépendance au WebGL, testable sous Node.
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { TICK_HZ } from '../sim/index'
import type { Rim } from './look'

export type Shape = 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus'
export type Mat = 'lit' | 'flat' | 'glow'
export type Role = 'corps' | 'marque' | 'autre'
// Matière d'un segment éclairé (E1) : chair (peau humide, un peu translucide), tissu, cuir, fer rouillé, os, bois.
export type Matter = 'chair' | 'tissu' | 'cuir' | 'fer' | 'os' | 'bois'
export const MATTERS: readonly Matter[] = ['chair', 'tissu', 'cuir', 'fer', 'os', 'bois']

export interface Segment {
  readonly part: string
  readonly shape: Shape
  readonly mat: Mat
  readonly matter: Matter
  readonly role: Role
  readonly color: number
  readonly size: readonly [number, number, number]
  readonly frame: Matrix4 // transformation monde du segment, sans l'échelle de sa taille
  readonly hull: boolean // porte le liseré quand le corps est Abattu
}

export interface Body {
  readonly id: number
  readonly segments: readonly Segment[]
  readonly rim: Rim | null
}

export interface RigContext {
  readonly t: number // horloge de rendu, en ticks (tick + alpha)
  readonly groupPhase: number // phase partagée du groupe de Rituel, [0, 1)
  readonly speed: number // m/s, déduit de la position précédente
  readonly targeted: boolean // cible de Sentence sous le curseur (§21)
  readonly limbStage: number // stade du sac (Porteur)
  readonly prayerColor: number | null // halo en prière (Confesseur)
}

// ---------------------------------------------------------------------------------------------------------
// Outils de cinématique

export const TAU = Math.PI * 2
const _e = new Euler(0, 0, 0, 'XYZ')
const _q = new Quaternion()
const _p = new Vector3()
const ONE = new Vector3(1, 1, 1)

export const joint = (parent: Matrix4, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): Matrix4 => {
  _e.set(rx, ry, rz, 'XYZ')
  _q.setFromEuler(_e)
  _p.set(x, y, z)
  return new Matrix4().multiplyMatrices(parent, new Matrix4().compose(_p, _q, ONE))
}

// Phase pseudo-aléatoire stable d'une entité (aucun tirage, aucune horloge).
export const phaseOf = (id: number, k: number): number => {
  const s = Math.sin(id * 12.9898 + k * 78.233) * 43758.5453
  return (s - Math.floor(s)) * TAU
}

export const smooth = (a: number, b: number, x: number): number => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return u * u * (3 - 2 * u)
}

export class Builder {
  readonly segments: Segment[] = []
  constructor(private readonly grey: number) {}
  seg(
    parent: Matrix4,
    part: string,
    shape: Shape,
    size: readonly [number, number, number],
    offset: readonly [number, number, number],
    color: number,
    opts: {
      mat?: Mat
      matter?: Matter
      role?: Role
      hull?: boolean
      rot?: readonly [number, number, number]
    } = {},
  ): Matrix4 {
    const r = opts.rot ?? [0, 0, 0]
    const frame = joint(parent, offset[0], offset[1], offset[2], r[0], r[1], r[2])
    this.segments.push({
      part,
      shape,
      mat: opts.mat ?? 'lit',
      matter: opts.matter ?? 'chair',
      role: opts.role ?? 'corps',
      color,
      size,
      frame,
      hull: opts.hull ?? true,
    })
    return frame
  }
  get g(): number {
    return this.grey
  }
}

// ---------------------------------------------------------------------------------------------------------
// Humanoïde générique

export interface Dims {
  readonly thigh: number
  readonly shin: number
  readonly legT: number
  readonly hipW: number
  readonly torsoW: number
  readonly torsoH: number
  readonly torsoD: number
  readonly head: number
  readonly upperL: number
  readonly foreL: number
  readonly armTL: number
  readonly upperR: number
  readonly foreR: number
  readonly armTR: number
  readonly hand: number
}

export interface Angles {
  lean: number // tangage du buste (négatif : penché en avant)
  sway: number // roulis du buste
  twist: number
  headP: number
  headR: number
  headY: number
  shLp: number
  shLr: number
  shRp: number
  shRr: number
  elL: number
  elR: number
  hipLp: number
  hipLr: number
  hipRp: number
  hipRr: number
  knL: number
  knR: number
  drop: number // abaissement du bassin, m
}

export const rest = (): Angles => ({
  lean: 0,
  sway: 0,
  twist: 0,
  headP: 0,
  headR: 0,
  headY: 0,
  shLp: 0,
  shLr: -0.08,
  shRp: 0,
  shRr: 0.08,
  elL: 0.15,
  elR: 0.15,
  hipLp: 0,
  hipLr: 0,
  hipRp: 0,
  hipRr: 0,
  knL: 0,
  knR: 0,
  drop: 0,
})

export interface Paint {
  readonly skin: number
  readonly torso: number
  readonly legs: number
  readonly arms: number
  readonly head: number
  // Matières (chair par défaut) : un buste vêtu est du tissu, un bras ganté du cuir.
  readonly mTorso?: Matter
  readonly mLegs?: Matter
  readonly mArms?: Matter
  readonly mHead?: Matter
}

export interface Frames {
  readonly pelvis: Matrix4
  readonly torso: Matrix4
  readonly head: Matrix4
  readonly handL: Matrix4 | null
  readonly handR: Matrix4 | null
  readonly shoulderL: Matrix4
  readonly shoulderR: Matrix4
}

export type ArmState = 'ok' | 'severed' | 'broken'

export const humanoid = (
  b: Builder,
  root: Matrix4,
  d: Dims,
  a: Angles,
  paint: Paint,
  opts: { legs: boolean; armL: ArmState; armR: ArmState; headShape?: Shape },
): Frames => {
  const pelvis = joint(root, 0, -a.drop, 0)
  if (opts.legs) {
    for (const [side, hp, hr, kn] of [
      [-1, a.hipLp, a.hipLr, a.knL],
      [1, a.hipRp, a.hipRr, a.knR],
    ] as const) {
      const hip = joint(pelvis, 0, 0, side * d.hipW, hr, 0, hp)
      b.seg(
        hip,
        side < 0 ? 'cuisseG' : 'cuisseD',
        'box',
        [d.legT, d.thigh, d.legT],
        [0, -d.thigh / 2, 0],
        paint.legs,
        { matter: paint.mLegs ?? 'chair' },
      )
      const knee = joint(hip, 0, -d.thigh, 0, 0, 0, -kn)
      b.seg(
        knee,
        side < 0 ? 'jambeG' : 'jambeD',
        'box',
        [d.legT * 0.85, d.shin, d.legT * 0.85],
        [0, -d.shin / 2, 0],
        paint.legs,
        { matter: paint.mLegs ?? 'chair' },
      )
    }
  }
  const torso = joint(pelvis, 0, 0, 0, a.sway, a.twist, a.lean)
  b.seg(torso, 'buste', 'box', [d.torsoD, d.torsoH, d.torsoW], [0, d.torsoH / 2, 0], paint.torso, {
    matter: paint.mTorso ?? 'chair',
  })
  const neck = joint(torso, 0, d.torsoH, 0, a.headR, a.headY, a.headP)
  const head = b.seg(
    neck,
    'tete',
    opts.headShape ?? 'sphere',
    [d.head, d.head, d.head],
    [0, d.head / 2, 0],
    paint.head,
    { matter: paint.mHead ?? 'chair' },
  )
  const arm = (
    side: -1 | 1,
    p: number,
    r: number,
    el: number,
    state: ArmState,
  ): [Matrix4, Matrix4 | null] => {
    const up = side < 0 ? d.upperL : d.upperR
    const fo = side < 0 ? d.foreL : d.foreR
    const th = side < 0 ? d.armTL : d.armTR
    const shoulder = joint(torso, 0, d.torsoH - th * 0.6, side * (d.torsoW / 2 + th / 2), side * r, 0, p)
    if (state === 'severed') {
      b.seg(
        shoulder,
        side < 0 ? 'moignonG' : 'moignonD',
        'box',
        [th, th * 0.8, th],
        [0, -th * 0.4, 0],
        paint.arms,
        { matter: paint.mArms ?? 'chair' },
      )
      return [shoulder, null]
    }
    b.seg(shoulder, side < 0 ? 'brasG' : 'brasD', 'box', [th, up, th], [0, -up / 2, 0], paint.arms, {
      matter: paint.mArms ?? 'chair',
    })
    const elbow = joint(shoulder, 0, -up, 0, 0, 0, state === 'broken' ? 0.05 : el)
    b.seg(
      elbow,
      side < 0 ? 'avantBrasG' : 'avantBrasD',
      'box',
      [th * 0.9, fo, th * 0.9],
      [0, -fo / 2, 0],
      paint.arms,
      { matter: paint.mArms ?? 'chair' },
    )
    const hand = joint(elbow, 0, -fo, 0)
    b.seg(
      hand,
      side < 0 ? 'mainG' : 'mainD',
      'box',
      [d.hand, d.hand, d.hand * 0.6],
      [0, -d.hand / 2, 0],
      paint.skin,
      { matter: paint.mArms === 'cuir' ? 'cuir' : 'chair' },
    )
    return [shoulder, hand]
  }
  const broken = (s: ArmState) => s === 'broken'
  const [shoulderL, handL] = arm(
    -1,
    broken(opts.armL) ? 0.05 : a.shLp,
    broken(opts.armL) ? -0.05 : a.shLr,
    a.elL,
    opts.armL,
  )
  const [shoulderR, handR] = arm(
    1,
    broken(opts.armR) ? 0.05 : a.shRp,
    broken(opts.armR) ? 0.05 : a.shRr,
    a.elR,
    opts.armR,
  )
  return { pelvis, torso, head, handL, handR, shoulderL, shoulderR }
}

export const legLen = (d: Dims): number => d.thigh + d.shin

// ---------------------------------------------------------------------------------------------------------
// Animation : tout est fonction de t (ticks)

export const sec = (t: number): number => t / TICK_HZ

// Micro-mouvement permanent du vivant (§18) : plusieurs fréquences, dont une ≥ 2 Hz, pour qu'aucune fenêtre
// de 0,5 s ne soit immobile.
export const tremble = (a: Angles, t: number, id: number, gain: number): void => {
  const s = sec(t)
  a.headR +=
    gain * (0.1 * Math.sin(TAU * 2.3 * s + phaseOf(id, 1)) + 0.05 * Math.sin(TAU * 5.1 * s + phaseOf(id, 2)))
  a.headY += gain * 0.12 * Math.sin(TAU * 0.9 * s + phaseOf(id, 3))
  a.shLp += gain * 0.08 * Math.sin(TAU * 2.7 * s + phaseOf(id, 4))
  a.shRp += gain * 0.08 * Math.sin(TAU * 3.1 * s + phaseOf(id, 5))
  a.lean += gain * 0.025 * Math.sin(TAU * 0.45 * s + phaseOf(id, 6))
}

export const gait = (a: Angles, t: number, id: number, hz: number, amp: number): void => {
  const ph = TAU * hz * sec(t) + phaseOf(id, 7)
  const s = Math.sin(ph)
  a.hipLp = amp * s
  a.hipRp = -amp * s
  a.knL = amp * 1.1 * Math.max(0, -Math.sin(ph - 0.6))
  a.knR = amp * 1.1 * Math.max(0, Math.sin(ph - 0.6))
  a.shLp += -0.6 * amp * s
  a.shRp += 0.6 * amp * s
}
// Coins de la boîte englobante d'un segment, en coordonnées monde (I4).
export const segmentCorners = (s: Segment): Vector3[] => {
  const [w, h, dd] = s.size
  const out: Vector3[] = []
  for (const x of [-0.5, 0.5])
    for (const y of [-0.5, 0.5])
      for (const z of [-0.5, 0.5]) out.push(new Vector3(x * w, y * h, z * dd).applyMatrix4(s.frame))
  return out
}
