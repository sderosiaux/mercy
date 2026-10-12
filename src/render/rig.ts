// Poses procédurales des créatures et du Bourreau : assemblages de segments rigides (§17), animés par
// l'horloge de rendu en ticks (§18). Pur : aucune dépendance au WebGL, testable sous Node.
// Deux règles de lecture (§18, §30.3) : tout ce qui vit tremble ; un mort ne bouge plus du tout. La pose d'un
// mort ne dépend que de sa position, de son orientation, de sa famille et du tick de sa mort.
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { actionPhase, type Creature, type Player, TICK_HZ, TUNING, type Vec2 } from '../sim/index'
import { greyMix, marksOf, type Rim, rimOf, sacColor, tone } from './look'
import { PALETTE } from './palette'

export type Shape = 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus'
export type Mat = 'lit' | 'flat' | 'glow'
export type Role = 'corps' | 'marque' | 'autre'

export interface Segment {
  readonly part: string
  readonly shape: Shape
  readonly mat: Mat
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

const TAU = Math.PI * 2
const _e = new Euler(0, 0, 0, 'XYZ')
const _q = new Quaternion()
const _p = new Vector3()
const ONE = new Vector3(1, 1, 1)

const joint = (parent: Matrix4, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): Matrix4 => {
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

const smooth = (a: number, b: number, x: number): number => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return u * u * (3 - 2 * u)
}

class Builder {
  readonly segments: Segment[] = []
  constructor(private readonly grey: number) {}
  seg(
    parent: Matrix4,
    part: string,
    shape: Shape,
    size: readonly [number, number, number],
    offset: readonly [number, number, number],
    color: number,
    opts: { mat?: Mat; role?: Role; hull?: boolean; rot?: readonly [number, number, number] } = {},
  ): Matrix4 {
    const r = opts.rot ?? [0, 0, 0]
    const frame = joint(parent, offset[0], offset[1], offset[2], r[0], r[1], r[2])
    this.segments.push({
      part,
      shape,
      mat: opts.mat ?? 'lit',
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

interface Dims {
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

interface Angles {
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

const rest = (): Angles => ({
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

interface Paint {
  readonly skin: number
  readonly torso: number
  readonly legs: number
  readonly arms: number
  readonly head: number
}

interface Frames {
  readonly pelvis: Matrix4
  readonly torso: Matrix4
  readonly head: Matrix4
  readonly handL: Matrix4 | null
  readonly handR: Matrix4 | null
  readonly shoulderL: Matrix4
  readonly shoulderR: Matrix4
}

type ArmState = 'ok' | 'severed' | 'broken'

const humanoid = (
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
      )
      const knee = joint(hip, 0, -d.thigh, 0, 0, 0, -kn)
      b.seg(
        knee,
        side < 0 ? 'jambeG' : 'jambeD',
        'box',
        [d.legT * 0.85, d.shin, d.legT * 0.85],
        [0, -d.shin / 2, 0],
        paint.legs,
      )
    }
  }
  const torso = joint(pelvis, 0, 0, 0, a.sway, a.twist, a.lean)
  b.seg(torso, 'buste', 'box', [d.torsoD, d.torsoH, d.torsoW], [0, d.torsoH / 2, 0], paint.torso)
  const neck = joint(torso, 0, d.torsoH, 0, a.headR, a.headY, a.headP)
  const head = b.seg(
    neck,
    'tete',
    opts.headShape ?? 'sphere',
    [d.head, d.head, d.head],
    [0, d.head / 2, 0],
    paint.head,
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
      )
      return [shoulder, null]
    }
    b.seg(shoulder, side < 0 ? 'brasG' : 'brasD', 'box', [th, up, th], [0, -up / 2, 0], paint.arms)
    const elbow = joint(shoulder, 0, -up, 0, 0, 0, state === 'broken' ? 0.05 : el)
    b.seg(
      elbow,
      side < 0 ? 'avantBrasG' : 'avantBrasD',
      'box',
      [th * 0.9, fo, th * 0.9],
      [0, -fo / 2, 0],
      paint.arms,
    )
    const hand = joint(elbow, 0, -fo, 0)
    b.seg(
      hand,
      side < 0 ? 'mainG' : 'mainD',
      'box',
      [d.hand, d.hand, d.hand * 0.6],
      [0, -d.hand / 2, 0],
      paint.skin,
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

// ---------------------------------------------------------------------------------------------------------
// Familles (silhouettes du §17)

interface Profile {
  readonly dims: Dims
  readonly legs: boolean
  readonly faceUp: boolean // à terre sur le dos (Souriant) ou sur le ventre
  readonly stepHz: number
  readonly paint: (g: number) => Paint
}

const PROFILES: Record<'souriant' | 'recousu' | 'porteur' | 'confesseur' | 'chirurgien', Profile> = {
  souriant: {
    dims: {
      thigh: 0.5,
      shin: 0.5,
      legT: 0.09,
      hipW: 0.08,
      torsoW: 0.28,
      torsoH: 0.52,
      torsoD: 0.18,
      head: 0.4,
      upperL: 0.32,
      foreL: 0.32,
      armTL: 0.075,
      upperR: 0.32,
      foreR: 0.32,
      armTR: 0.075,
      hand: 0.09,
    },
    legs: true,
    faceUp: true,
    stepHz: 3.4,
    paint: (g) => {
      const s = tone(PALETTE.chair.souriant, g)
      return { skin: s, torso: s, legs: s, arms: s, head: s }
    },
  },
  recousu: {
    dims: {
      thigh: 0.42,
      shin: 0.42,
      legT: 0.24,
      hipW: 0.2,
      torsoW: 0.8,
      torsoH: 0.78,
      torsoD: 0.52,
      head: 0.3,
      upperL: 0.44,
      foreL: 0.42,
      armTL: 0.17,
      upperR: 0.56,
      foreR: 0.6,
      armTR: 0.27,
      hand: 0.24,
    },
    legs: true,
    faceUp: false,
    stepHz: 1.1,
    paint: (g) => {
      const s = tone(PALETTE.chair.recousu, g)
      return { skin: s, torso: s, legs: s, arms: s, head: s }
    },
  },
  porteur: {
    dims: {
      thigh: 0.32,
      shin: 0.32,
      legT: 0.13,
      hipW: 0.12,
      torsoW: 0.46,
      torsoH: 0.46,
      torsoD: 0.36,
      head: 0.27,
      upperL: 0.28,
      foreL: 0.28,
      armTL: 0.1,
      upperR: 0.28,
      foreR: 0.28,
      armTR: 0.1,
      hand: 0.1,
    },
    legs: true,
    faceUp: false,
    stepHz: 1.5,
    paint: (g) => {
      const s = tone(PALETTE.chair.porteur, g)
      return { skin: s, torso: s, legs: s, arms: s, head: s }
    },
  },
  confesseur: {
    dims: {
      thigh: 0.4,
      shin: 0.4,
      legT: 0.1,
      hipW: 0.1,
      torsoW: 0.34,
      torsoH: 0.42,
      torsoD: 0.24,
      head: 0.25,
      upperL: 0.3,
      foreL: 0.3,
      armTL: 0.11,
      upperR: 0.3,
      foreR: 0.3,
      armTR: 0.11,
      hand: 0.08,
    },
    legs: false,
    faceUp: false,
    stepHz: 1.2,
    paint: (g) => {
      const robe = tone(PALETTE.chair.chasuble, g, 'sombre')
      const s = tone(PALETTE.chair.confesseur, g)
      return { skin: s, torso: robe, legs: robe, arms: robe, head: s }
    },
  },
  chirurgien: {
    dims: {
      thigh: 0.55,
      shin: 0.55,
      legT: 0.08,
      hipW: 0.09,
      torsoW: 0.3,
      torsoH: 0.66,
      torsoD: 0.18,
      head: 0.24,
      upperL: 0.55,
      foreL: 0.6,
      armTL: 0.06,
      upperR: 0.55,
      foreR: 0.6,
      armTR: 0.06,
      hand: 0.1,
    },
    legs: true,
    faceUp: false,
    stepHz: 1.9,
    paint: (g) => {
      const s = tone(PALETTE.chair.chirurgien, g)
      return { skin: s, torso: s, legs: s, arms: s, head: s }
    },
  },
}

const legLen = (d: Dims): number => d.thigh + d.shin

// ---------------------------------------------------------------------------------------------------------
// Animation : tout est fonction de t (ticks)

const sec = (t: number): number => t / TICK_HZ

// Micro-mouvement permanent du vivant (§18) : plusieurs fréquences, dont une ≥ 2 Hz, pour qu'aucune fenêtre
// de 0,5 s ne soit immobile.
const tremble = (a: Angles, t: number, id: number, gain: number): void => {
  const s = sec(t)
  a.headR +=
    gain * (0.1 * Math.sin(TAU * 2.3 * s + phaseOf(id, 1)) + 0.05 * Math.sin(TAU * 5.1 * s + phaseOf(id, 2)))
  a.headY += gain * 0.12 * Math.sin(TAU * 0.9 * s + phaseOf(id, 3))
  a.shLp += gain * 0.08 * Math.sin(TAU * 2.7 * s + phaseOf(id, 4))
  a.shRp += gain * 0.08 * Math.sin(TAU * 3.1 * s + phaseOf(id, 5))
  a.lean += gain * 0.025 * Math.sin(TAU * 0.45 * s + phaseOf(id, 6))
}

const gait = (a: Angles, t: number, id: number, hz: number, amp: number): void => {
  const ph = TAU * hz * sec(t) + phaseOf(id, 7)
  const s = Math.sin(ph)
  a.hipLp = amp * s
  a.hipRp = -amp * s
  a.knL = amp * 1.1 * Math.max(0, -Math.sin(ph - 0.6))
  a.knR = amp * 1.1 * Math.max(0, Math.sin(ph - 0.6))
  a.shLp += -0.6 * amp * s
  a.shRp += 0.6 * amp * s
}

type FamilyKey = keyof typeof PROFILES

const ritualPose = (f: FamilyKey, a: Angles, t: number, groupPhase: number): void => {
  const ph = TAU * (0.6 * sec(t) + groupPhase)
  const s = Math.sin(ph)
  switch (f) {
    case 'souriant': // danse en synchronie : bras levés, pas sur place, buste immobile
      a.shLp = 2.5 + 0.35 * s
      a.shRp = 2.5 - 0.35 * s
      a.shLr = -0.4
      a.shRr = 0.4
      a.hipLp = 0.45 * Math.max(0, s)
      a.knL = 0.9 * Math.max(0, s)
      a.hipRp = 0.45 * Math.max(0, -s)
      a.knR = 0.9 * Math.max(0, -s)
      a.headR = 0.35 * s
      break
    case 'recousu': // se balance, recoud sa propre peau
      a.sway = 0.14 * s
      a.shLp = 1.1 + 0.3 * Math.sin(2 * ph)
      a.shLr = -0.3
      a.elL = 1.4 + 0.4 * Math.sin(2 * ph)
      a.headP = -0.3
      break
    case 'porteur': // mange des corps
      a.lean = -0.55 - 0.35 * Math.max(0, s)
      a.shLp = 1.2 + 0.4 * s
      a.shRp = 1.2 + 0.4 * s
      a.elL = 1.6
      a.elR = 1.6
      a.drop = 0.12
      break
    case 'confesseur': // prie devant un autel
      a.lean = -0.2 - 0.2 * Math.max(0, s)
      a.shLp = 1.5 + 0.2 * s
      a.shRp = 1.5 + 0.2 * s
      a.shLr = 0.35
      a.shRr = -0.35
      a.elL = 0.9
      a.elR = 0.9
      a.headP = -0.3 - 0.15 * s
      break
    case 'chirurgien': // soigne des corps sur des lits
      a.lean = -0.75
      a.shLp = 0.9 + 0.25 * Math.sin(2 * ph)
      a.shRp = 0.9 - 0.25 * Math.sin(2 * ph)
      a.elL = 0.8 + 0.3 * s
      a.elR = 0.8 - 0.3 * s
      break
  }
}

const limbSide = (limb: string | null): 'L' | 'R' => (limb && /gauche/i.test(limb) ? 'L' : 'R')

// Télégraphe (§18) : pose « fausse » propre à chaque famille, puis frappe au tick actif et récupération.
const actionPose = (f: FamilyKey, a: Angles, c: Creature, t: number): void => {
  const act = c.action
  if (!act) return
  const tick = Math.floor(t)
  const phase = actionPhase(act, tick)
  if (phase === 'canalisation') {
    const s = sec(t)
    if (f === 'chirurgien') {
      a.lean = -0.9
      a.elL = 1.2 + 0.5 * Math.sin(TAU * 4 * s)
      a.elR = 1.2 - 0.5 * Math.sin(TAU * 4 * s)
      a.shLp = 1.0
      a.shRp = 1.0
    } else {
      a.shLp = 2.7 + 0.12 * Math.sin(TAU * 1.5 * s)
      a.shRp = 2.7 - 0.12 * Math.sin(TAU * 1.5 * s)
      a.shLr = -0.45
      a.shRr = 0.45
      a.headP = 0.45
      a.lean = 0.12
    }
    return
  }
  const side = limbSide(act.limb)
  const span = Math.max(1, act.activeAt - act.start)
  if (phase === 'telegraphe') {
    const p = (t - act.start) / span
    if (f === 'souriant') {
      a.headR = (Math.PI / 2) * smooth(0, 0.35, p) // la tête bascule à 90°
      a.lean = -0.25 * p
      a.drop = 0.12 * p
      return
    }
    const wind = f === 'recousu' ? -1.5 * smooth(0, 0.8, p) : -1.1 * smooth(0, 0.7, p) // le bras traîne
    if (side === 'R') {
      a.shRp = wind
      a.elR = 0.3
    } else {
      a.shLp = wind
      a.elL = 0.3
    }
    a.lean = 0.12 * p
    a.twist = (side === 'R' ? 0.35 : -0.35) * p
    return
  }
  const span2 = Math.max(1, act.end - act.activeAt)
  const q = (t - act.activeAt) / span2 // 0 au tick actif, 1 à la fin de la récupération
  const strike = 1.6 * (1 - smooth(0.15, 1, q))
  if (f === 'souriant') {
    a.lean = -0.5 * (1 - q)
    a.headR = (Math.PI / 2) * (1 - smooth(0, 0.5, q))
    return
  }
  if (side === 'R') a.shRp = strike
  else a.shLp = strike
  a.lean = -0.25 * (1 - q)
  a.twist = (side === 'R' ? -0.3 : 0.3) * (1 - q)
}

// Corps à terre : se tord, rampe, plante les mains avant le Relèvement (L1, L3, §18).
// Sur le dos (Souriant), les bras se tendent vers le ciel ; sur le ventre, ils balaient le sol devant la tête.
const downPose = (
  a: Angles,
  t: number,
  id: number,
  crawling: boolean,
  gain: number,
  faceUp: boolean,
): void => {
  const s = sec(t)
  const w1 = Math.sin(TAU * 1.3 * s + phaseOf(id, 11))
  const w2 = Math.sin(TAU * 2.9 * s + phaseOf(id, 12))
  const w3 = Math.sin(TAU * 0.8 * s + phaseOf(id, 13))
  if (faceUp) {
    a.shLp = 1.35 + gain * (0.5 * w1 + 0.12 * w2)
    a.shRp = 0.95 - gain * (0.5 * w3 + 0.12 * w2)
    a.shLr = -0.35 - gain * 0.2 * w2
    a.shRr = 0.35 + gain * 0.2 * w1
  } else {
    a.shLp = 2.7 + gain * 0.12 * w2
    a.shRp = 2.5 - gain * 0.12 * w2
    a.shLr = -0.55 - gain * 0.35 * w1
    a.shRr = 0.55 + gain * 0.35 * w3
  }
  a.elL = 0.8 + gain * 0.4 * w2
  a.elR = 0.9 + gain * 0.4 * w1
  a.hipLp = 0.15 + gain * 0.3 * w3
  a.hipRp = -0.1 - gain * 0.3 * w1
  a.knL = 0.6 + gain * 0.4 * Math.max(0, w2)
  a.knR = 0.4 + gain * 0.4 * Math.max(0, -w3)
  a.headR = gain * 0.35 * w3
  a.headY = gain * 0.3 * w1
  a.twist = gain * 0.1 * w2
  if (crawling) {
    const c = Math.sin(TAU * 1.6 * s)
    a.shLp = 1.9 + 0.7 * c
    a.shRp = 1.9 - 0.7 * c
    a.hipLp = 0.4 * c
    a.hipRp = -0.4 * c
  }
}

// ---------------------------------------------------------------------------------------------------------
// Rig d'une créature

const armStates = (c: Creature): { L: ArmState; R: ArmState } => {
  let L: ArmState = 'ok'
  let R: ArmState = 'ok'
  for (const l of c.limbs) {
    if (/gauche/i.test(l.id)) L = l.state
    else R = l.state
  }
  return { L, R }
}

const sizeMul = (c: Creature): number => TUNING.cicatriceSizeMul ** c.cicatrices

const scaleDims = (d: Dims, k: number): Dims =>
  Object.fromEntries(Object.entries(d).map(([key, v]) => [key, v * k])) as unknown as Dims

// Pose et segments d'une créature présente (non absorbée). Pour un mort, t est ignoré : la pose est celle du
// tick de sa mort, et elle ne change plus.
export const creatureBody = (c: Creature, pos: Vec2, facing: number, ctx: RigContext): Body => {
  const dead = c.state.kind === 'mort'
  const t = dead && c.state.kind === 'mort' ? c.state.at : ctx.t
  const grey = greyMix(c, ctx.t)
  const b = new Builder(grey)
  const rim = rimOf(c, ctx.t, ctx.targeted)
  if (c.family === 'membre') {
    membreBody(b, c, pos, facing, t)
    return { id: c.id, segments: b.segments, rim }
  }
  const prof = PROFILES[c.family]
  const k = sizeMul(c)
  const d = scaleDims(prof.dims, k)
  const a = rest()
  const down = c.state.kind === 'abattu' || dead
  const yaw = -facing
  let root: Matrix4
  if (!down) {
    if (c.state.kind === 'rituel') ritualPose(c.family, a, t, ctx.groupPhase)
    else if (ctx.speed > 0.15) gait(a, t, c.id, prof.stepHz, Math.min(0.6, 0.18 * ctx.speed))
    if (c.family === 'porteur' && c.state.kind !== 'rituel') a.lean = Math.min(a.lean, -0.35)
    if (c.family === 'chirurgien' && c.state.kind !== 'rituel') a.lean = Math.min(a.lean, -0.4)
    if (c.family === 'souriant' && c.state.kind === 'hostile') a.lean = 0 // buste immobile, jambes trop rapides
    actionPose(c.family, a, c, t)
    const stunned = c.stunnedUntil > t
    tremble(a, t, c.id, stunned ? 3 : 1)
    if (stunned) a.sway += 0.25 * Math.sin(TAU * 3 * sec(t))
    if (c.chair < c.chairMax * 0.5) a.knL += 0.35 // boitement (§21)
    const hipH = prof.legs ? legLen(d) : d.thigh + d.shin
    root = joint(new Matrix4(), pos.x, hipH, pos.z, 0, yaw, 0)
  } else {
    const st = c.state
    const since = st.kind === 'abattu' ? st.since : 0
    const placed = c.spawn?.state === 'abattu' && c.cicatrices === c.spawn.cicatrices
    const fall = dead || placed ? 1 : smooth(0, 12, t - since)
    downPose(a, t, c.id, !dead && ctx.speed > 0.1, 1, prof.faceUp)
    let raise = 0
    if (!dead && st.kind === 'abattu' && st.riseAt !== null) {
      const from = st.riseAt - TUNING.relevementTelegraph
      if (t >= from) {
        raise = smooth(from, st.riseAt, t) // mains plantées, le corps pousse
        a.shLp = 1.4 + 0.15 * Math.sin(TAU * 4 * sec(t))
        a.shRp = 1.4 - 0.15 * Math.sin(TAU * 4 * sec(t))
        a.elL = 0.2
        a.elR = 0.2
      }
    }
    const sign = prof.faceUp ? 1 : -1
    const angle = sign * (Math.PI / 2) * fall * (1 - 0.4 * raise)
    const lieH = d.torsoD / 2 + 0.02
    const standH = legLen(d)
    const h = standH + (lieH - standH) * fall + raise * d.torsoH * 0.35
    const shift = sign * ((legLen(d) - d.torsoH - d.head) / 2) * fall
    root = joint(joint(new Matrix4(), pos.x, h, pos.z, 0, yaw, 0), shift, 0, 0, 0, 0, angle)
    if (c.family === 'recousu' && !dead) a.lean += 0.15 // sur les coudes
  }
  const arms = armStates(c)
  const paint = prof.paint(grey)
  const fr = humanoid(b, root, d, a, paint, { legs: prof.legs, armL: arms.L, armR: arms.R })
  familyExtras(b, c, d, fr, ctx, grey, down)
  cicatriceMarks(b, c, d, fr, grey)
  return { id: c.id, segments: b.segments, rim }
}

const familyExtras = (
  b: Builder,
  c: Creature,
  d: Dims,
  fr: Frames,
  ctx: RigContext,
  grey: number,
  _down: boolean,
): void => {
  const alive = c.state.kind !== 'mort'
  switch (c.family) {
    case 'souriant':
      // Masque-sourire blanc (§17) : il le garde à terre, et il passe au gris à la mort.
      b.seg(
        fr.head,
        'masque',
        'box',
        [0.06, d.head * 0.6, d.head * 0.7],
        [d.head * 0.47, d.head / 2, 0],
        tone(PALETTE.chair.souriantMasque, grey, 'clair'),
        { hull: false },
      )
      b.seg(
        fr.head,
        'sourire',
        'box',
        [0.065, 0.025, d.head * 0.45],
        [d.head * 0.48, d.head * 0.36, 0],
        tone(PALETTE.noir, grey, 'sombre'),
        { hull: false, role: 'autre' },
      )
      break
    case 'recousu':
      // Coutures claires et épaule asymétrique (§17).
      for (let i = 0; i < 3; i++) {
        b.seg(
          fr.torso,
          `couture${i}`,
          'box',
          [d.torsoD + 0.02, 0.03, d.torsoW * (0.5 + 0.15 * i)],
          [0, d.torsoH * (0.25 + 0.22 * i), (i - 1) * 0.08],
          tone(PALETTE.chair.couture, grey, 'clair'),
          { hull: false, rot: [0.4 * (i - 1), 0, 0] },
        )
      }
      if (fr.handR) {
        b.seg(fr.handR, 'poing', 'box', [0.3, 0.3, 0.3], [0, -0.2, 0], tone(PALETTE.chair.recousu, grey))
      }
      break
    case 'porteur': {
      // Bosse dorsale translucide qui luit selon le stade (§17), toujours dans le dos.
      const stage = ctx.limbStage
      const r = d.torsoW * (1.2 + 0.25 * stage)
      const sac = alive ? sacColor(stage) : tone(PALETTE.chair.sac, grey, 'sombre')
      b.seg(
        fr.torso,
        'sac',
        'sphere',
        [r, r * 0.95, r],
        [-(d.torsoD / 2 + r * 0.38), d.torsoH * 0.6, 0],
        sac,
        {
          mat: alive ? 'glow' : 'lit',
        },
      )
      break
    }
    case 'confesseur': {
      // Triangle (chasuble) surmonté d'un halo (§17). En prière, le halo prend le vert maladif.
      b.seg(
        fr.pelvis,
        'chasuble',
        'cone',
        [d.torsoW * 2.2, d.thigh + d.shin + 0.05, d.torsoW * 2.2],
        [0, -(d.thigh + d.shin) / 2 + 0.02, 0],
        tone(PALETTE.chair.chasuble, grey, 'sombre'),
      )
      const halo = alive && ctx.prayerColor !== null ? ctx.prayerColor : tone(PALETTE.os, grey, 'clair')
      b.seg(fr.head, 'halo', 'torus', [d.head * 1.9, d.head * 1.9, 0.6], [0, d.head * 1.25, 0], halo, {
        mat: alive && ctx.prayerColor !== null ? 'glow' : 'lit',
        hull: false,
        rot: [Math.PI / 2, 0, 0.25],
      })
      break
    }
    case 'chirurgien':
      // Tablier sur le devant du buste et des cuisses.
      b.seg(
        fr.torso,
        'tablier',
        'box',
        [0.04, d.torsoH + d.thigh * 0.8, d.torsoW * 1.05],
        [d.torsoD / 2 + 0.03, (d.torsoH - d.thigh * 0.8) / 2, 0],
        tone(PALETTE.chair.tablier, grey),
        { hull: false },
      )
      break
  }
  // Plaie ouverte à 50 % de Chair, et sur tout corps à terre (§21, L1).
  if (c.chair < c.chairMax * 0.5 && c.state.kind !== 'mort') {
    b.seg(
      fr.torso,
      'plaie',
      'box',
      [0.04, d.torsoH * 0.28, d.torsoW * 0.35],
      [d.torsoD / 2 + 0.01, d.torsoH * 0.55, d.torsoW * 0.15],
      PALETTE.chair.plaie,
      { hull: false, rot: [0.5, 0, 0] },
    )
  }
}

// Cicatrices (L3) : une couture visible et un membre remis au mauvais endroit par Cicatrice ; marques dorées
// d'un Résistant (§13, §17).
const cicatriceMarks = (b: Builder, c: Creature, d: Dims, fr: Frames, grey: number): void => {
  const seam = tone(PALETTE.chair.couture, grey, 'clair')
  for (let i = 0; i < c.cicatrices; i++) {
    b.seg(
      fr.torso,
      `cicatrice${i}`,
      'box',
      [d.torsoD + 0.025, 0.025, d.torsoW * 0.9],
      [0, d.torsoH * (0.3 + 0.2 * i), 0],
      seam,
      { hull: false, rot: [0.6 - 0.5 * i, 0, 0] },
    )
  }
  const skin = PROFILES[c.family === 'membre' ? 'souriant' : c.family].paint(grey).skin
  if (c.cicatrices >= 1) {
    // Une main de trop, plantée dans le flanc gauche.
    b.seg(
      fr.torso,
      'membreDeplace1',
      'box',
      [d.armTL, d.foreL * 0.8, d.armTL],
      [0, d.torsoH * 0.45, -d.torsoW / 2 - 0.02],
      skin,
      {
        rot: [-1.1, 0, 0.4],
      },
    )
  }
  if (c.cicatrices >= 2) {
    // Un avant-bras recousu à l'envers sur l'épaule droite.
    b.seg(
      fr.shoulderR,
      'membreDeplace2',
      'box',
      [d.armTR * 0.9, d.foreR * 0.7, d.armTR * 0.9],
      [0, d.foreR * 0.35, 0.05],
      skin,
      {
        rot: [0.3, 0, -0.5],
      },
    )
  }
  const gold = marksOf(c, grey)
  if (gold !== null) {
    b.seg(
      fr.head,
      'couronne',
      'cylinder',
      [d.head * 1.05, 0.06, d.head * 1.05],
      [0, d.head * 0.72, 0],
      gold,
      {
        mat: grey > 0 ? 'lit' : 'flat',
        role: 'marque',
        hull: false,
      },
    )
    for (let i = 0; i < 2; i++) {
      b.seg(
        fr.torso,
        `marque${i}`,
        'box',
        [d.torsoD + 0.03, 0.05, d.torsoW + 0.03],
        [0, d.torsoH * (0.42 + 0.3 * i), 0],
        gold,
        { mat: grey > 0 ? 'lit' : 'flat', role: 'marque', hull: false },
      )
    }
  }
}

// Membre errant : un bras qui rampe (§8.4). Sa couleur suit son propriétaire, absent du monde ici : chair du
// Recousu, seule famille à membres en P0.
const membreBody = (b: Builder, c: Creature, pos: Vec2, facing: number, t: number): void => {
  const s = sec(t)
  const g = b.g
  const skin = tone(PALETTE.chair.recousu, g)
  const wig = Math.sin(TAU * 1.7 * s + phaseOf(c.id, 21))
  const root = joint(new Matrix4(), pos.x, 0.12, pos.z, 0, -facing, -Math.PI / 2)
  b.seg(root, 'bras', 'box', [0.2, 0.5, 0.2], [0, 0.25, 0], skin)
  const elbow = joint(root, 0, 0.5, 0, 0.35 * wig, 0, 0)
  b.seg(elbow, 'avantBras', 'box', [0.18, 0.5, 0.18], [0, 0.25, 0], skin)
  const hand = joint(elbow, 0, 0.5, 0, 0, 0, 0.5 * Math.sin(TAU * 3.3 * s + phaseOf(c.id, 22)))
  b.seg(hand, 'main', 'box', [0.2, 0.2, 0.12], [0, 0.1, 0], skin)
}

// ---------------------------------------------------------------------------------------------------------
// Le Bourreau

const BOURREAU: Dims = {
  thigh: 0.46,
  shin: 0.44,
  legT: 0.17,
  hipW: 0.13,
  torsoW: 0.56,
  torsoH: 0.66,
  torsoD: 0.34,
  head: 0.3,
  upperL: 0.34,
  foreL: 0.32,
  armTL: 0.13,
  upperR: 0.34,
  foreR: 0.32,
  armTR: 0.13,
  hand: 0.12,
}

export const PLAYER_ID = 0xffff

export const playerBody = (p: Player, pos: Vec2, facing: number, t: number, speed: number): Body => {
  const b = new Builder(0)
  const a = rest()
  const act = p.action
  let yawExtra = 0
  let rollPitch = 0
  let lift = 0
  if (speed > 0.15 && (!act || act.kind === 'frappe')) gait(a, t, PLAYER_ID, 1.8, 0.55)
  a.shRp = 0.5
  a.elR = 0.9
  if (act) {
    const span = Math.max(1, act.end - act.start)
    const q = Math.min(1, Math.max(0, (t - act.start) / span))
    switch (act.kind) {
      case 'frappe': {
        // L'impact a lieu au tick de départ (sim) : le geste part tout de suite, puis récupère.
        const swing = smooth(0, 0.25, q)
        const step = act.comboStep ?? 0
        if (step === 2) {
          a.shRp = 2.9 - 2.4 * swing
          a.shLp = 2.6 - 2.0 * swing
          a.lean = -0.35 * swing
          a.drop = 0.1 * swing
        } else {
          const dir = step === 0 ? 1 : -1
          a.twist = dir * (0.6 - 1.2 * swing)
          a.shRp = 1.4
          a.shRr = 0.3 + dir * (0.9 - 1.6 * swing)
          a.elR = 0.4
        }
        break
      }
      case 'esquive':
        rollPitch = -TAU * q
        a.drop = 0.35
        a.knL = 1.8
        a.knR = 1.8
        a.hipLp = 1.4
        a.hipRp = 1.4
        a.lean = -0.6
        lift = 0
        break
      case 'sentence': {
        const raise = smooth(0, 0.75, q)
        const fall = smooth(0.85, 1, q)
        a.shRp = 0.5 + 2.5 * raise - 2.6 * fall
        a.shLp = 0.3 + 2.4 * raise - 2.5 * fall
        a.lean = 0.15 * raise - 0.5 * fall
        a.drop = 0.12 * fall
        break
      }
      case 'balayage':
        yawExtra = -TAU * smooth(0, 0.5, q)
        a.shRp = 1.5
        a.shRr = 1.2
        a.elR = 0.1
        a.drop = 0.15
        break
      case 'charge':
        a.lean = -0.6
        a.shRp = 1.4
        a.elR = 0.2
        gait(a, t, PLAYER_ID, 4, 0.8)
        break
    }
  }
  tremble(a, t, PLAYER_ID, 0.5)
  const hipH = BOURREAU.thigh + BOURREAU.shin
  let root = joint(new Matrix4(), pos.x, hipH + lift, pos.z, 0, -facing + yawExtra, 0)
  if (rollPitch !== 0) root = joint(joint(root, 0, -0.45, 0, 0, 0, rollPitch), 0, 0.45, 0)
  const paint: Paint = {
    skin: PALETTE.bourreau.peau,
    torso: PALETTE.bourreau.cuir,
    legs: PALETTE.bourreau.cuir,
    arms: PALETTE.bourreau.cuir,
    head: PALETTE.bourreau.capuche,
  }
  const fr = humanoid(b, root, BOURREAU, a, paint, { legs: true, armL: 'ok', armR: 'ok', headShape: 'cone' })
  if (fr.handR) {
    const grip = joint(fr.handR, 0, -0.06, 0, 0, 0, Math.PI / 2)
    if (p.weapon === 'couperet') {
      b.seg(grip, 'manche', 'cylinder', [0.05, 0.42, 0.05], [0, 0.12, 0], PALETTE.bourreau.manche, {
        hull: false,
      })
      b.seg(grip, 'lame', 'box', [0.04, 0.42, 0.3], [0, 0.48, 0.1], PALETTE.bourreau.acier, {
        hull: false,
        role: 'autre',
      })
    } else {
      b.seg(grip, 'manche', 'cylinder', [0.06, 0.75, 0.06], [0, 0.28, 0], PALETTE.bourreau.manche, {
        hull: false,
      })
      b.seg(grip, 'tete', 'box', [0.26, 0.26, 0.26], [0, 0.72, 0], PALETTE.bourreau.acier, {
        hull: false,
        role: 'autre',
      })
    }
  }
  return { id: PLAYER_ID, segments: b.segments, rim: null }
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
