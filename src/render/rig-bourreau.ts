// Le Bourreau (planche bourreau-sheet) : capuche, masque de fer, tablier taché, chaînes, reliquaire à la ceinture,
// Couperet ou masse à pointes. Sombre ; son tablier et son arme accrochent la lumière (ART_DIRECTION).
// Pur : la pose est une fonction de l'action, du tick de rendu et de la vitesse.
import { Matrix4 } from 'three'
import type { Player, Vec2 } from '../sim/index'
import { PALETTE } from './palette'
import {
  type Body,
  Builder,
  type Dims,
  gait,
  humanoid,
  joint,
  type Paint,
  rest,
  smooth,
  TAU,
  tremble,
} from './rig-core'

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
  const H = PALETTE.habit
  const paint: Paint = {
    skin: PALETTE.bourreau.peau,
    torso: H.capuche,
    legs: H.capuche,
    arms: PALETTE.matiere.cuir,
    head: H.capuche,
    mTorso: 'tissu',
    mLegs: 'tissu',
    mArms: 'cuir',
    mHead: 'tissu',
  }
  const d = BOURREAU
  const fr = humanoid(b, root, d, a, paint, { legs: true, armL: 'ok', armR: 'ok', headShape: 'cone' })
  // Masque de fer sous la capuche, tablier taché, ceinture, chaînes en bandoulière, reliquaire au flanc gauche.
  b.seg(
    fr.head,
    'masque',
    'box',
    [0.06, d.head * 0.55, d.head * 0.5],
    [d.head * 0.36, d.head * 0.42, 0],
    H.masqueFer,
    {
      matter: 'fer',
      hull: false,
      role: 'autre',
    },
  )
  b.seg(
    fr.torso,
    'tablier',
    'box',
    [0.035, d.torsoH * 1.55, d.torsoW * 0.78],
    [d.torsoD / 2 + 0.03, d.torsoH * 0.12, 0],
    H.tablierBourreau,
    {
      matter: 'cuir',
      hull: false,
    },
  )
  b.seg(
    fr.torso,
    'ceinture',
    'box',
    [d.torsoD + 0.05, 0.07, d.torsoW + 0.04],
    [0, 0.04, 0],
    PALETTE.matiere.cuir,
    {
      matter: 'cuir',
      hull: false,
    },
  )
  b.seg(
    fr.pelvis,
    'robe',
    'cone',
    [d.torsoW * 1.45, d.thigh + d.shin * 0.6, d.torsoW * 1.25],
    [0, -(d.thigh + d.shin * 0.6) / 2 + 0.05, 0],
    H.capuche,
    {
      matter: 'tissu',
      hull: false,
      rot: [0, 0, Math.PI],
    },
  )
  for (let i = 0; i < 3; i++) {
    b.seg(
      fr.torso,
      `chaine${i}`,
      'torus',
      [0.13, 0.13, 0.6],
      [d.torsoD / 2 + 0.02 - i * 0.12, d.torsoH * (0.82 - i * 0.22), d.torsoW * (0.32 - i * 0.22)],
      PALETTE.matiere.fer,
      {
        matter: 'fer',
        hull: false,
        role: 'autre',
        rot: [0.6, 0, 0],
      },
    )
  }
  const lantern = b.seg(
    fr.pelvis,
    'reliquaire',
    'box',
    [0.13, 0.2, 0.13],
    [0.06, -0.08, -d.torsoW / 2 - 0.08],
    PALETTE.matiere.fer,
    {
      matter: 'fer',
      hull: false,
      role: 'autre',
    },
  )
  b.seg(lantern, 'flammeReliquaire', 'sphere', [0.06, 0.08, 0.06], [0, 0, 0], PALETTE.lumiere.reliquaire, {
    mat: 'glow',
    hull: false,
    role: 'autre',
  })
  if (fr.handR) {
    const grip = joint(fr.handR, 0, -0.06, 0, 0, 0, Math.PI / 2)
    if (p.weapon === 'couperet') {
      b.seg(grip, 'manche', 'cylinder', [0.05, 0.42, 0.05], [0, 0.12, 0], PALETTE.bourreau.manche, {
        matter: 'bois',
        hull: false,
      })
      b.seg(grip, 'lame', 'box', [0.04, 0.46, 0.34], [0, 0.5, 0.11], PALETTE.bourreau.acier, {
        matter: 'fer',
        hull: false,
        role: 'autre',
      })
    } else {
      b.seg(grip, 'manche', 'cylinder', [0.06, 0.75, 0.06], [0, 0.28, 0], PALETTE.bourreau.manche, {
        matter: 'bois',
        hull: false,
      })
      const head = b.seg(grip, 'tete', 'cylinder', [0.24, 0.3, 0.24], [0, 0.72, 0], PALETTE.bourreau.acier, {
        matter: 'fer',
        hull: false,
        role: 'autre',
      })
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * TAU
        b.seg(
          head,
          `pointe${i}`,
          'cone',
          [0.06, 0.16, 0.06],
          [Math.cos(ang) * 0.14, (i % 2) * 0.08 - 0.04, Math.sin(ang) * 0.14],
          PALETTE.bourreau.acier,
          {
            matter: 'fer',
            hull: false,
            role: 'autre',
            rot: [Math.sin(ang) * (Math.PI / 2), 0, -Math.cos(ang) * (Math.PI / 2)],
          },
        )
      }
    }
  }
  return { id: PLAYER_ID, segments: b.segments, rim: null }
}
