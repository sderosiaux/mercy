// Clips de la figurine de banc, écrits comme fonctions du temps : des bons (boucle sans couture, pieds plantés,
// coup avec repère) et des défauts connus (couture, pieds qui glissent, dérive de racine). Les tests vérifient que
// chaque contrôle sépare les uns des autres ; la galerie les montre au banc d'essai.
import type { ClipSpec } from '../schema'
import type { ClipDef } from './build'

const TAU = Math.PI * 2

export const mercyExtras = (
  etat: string,
  type: ClipSpec['type'],
  boucle: boolean,
  extra: { impactS?: number; debutS?: number } = {},
): Record<string, unknown> => ({ mercy: { etat, type, boucle, ...extra } })

// Respiration et balancement : périodique sur sa durée, donc sans couture. Amplitude du buste ~3 cm.
export const idle = (name = 'rituel', duration = 2, phaseEnd = 1): ClipDef => ({
  name,
  duration,
  extras: mercyExtras(name, 'boucle', true),
  pose: (t) => {
    const s = Math.sin((TAU * t * phaseEnd) / duration)
    return {
      spine: { rot: [0.06 * s, 0, 0.02 * s] },
      head: { rot: [-0.05 * s, 0.08 * s, 0] },
      upperArmL: { rot: [0.05 * s, 0, 0.12] },
      upperArmR: { rot: [-0.05 * s, 0, -0.12] },
    }
  },
})

// Même boucle arrêtée aux 3/4 de sa période : la dernière image ne rejoint pas la première.
export const idleWithSeam = (name = 'rituel'): ClipDef => idle(name, 2, 0.75)

// Le bassin glisse de 5 cm d'un côté à l'autre : les pieds en appui glissent avec lui.
export const slidingIdle = (name = 'rituel'): ClipDef => ({
  name,
  duration: 2,
  extras: mercyExtras(name, 'boucle', true),
  pose: (t) => ({
    hips: { move: [0.05 * Math.sin((TAU * t) / 2), 0, 0] },
    spine: { rot: [0.03 * Math.sin((TAU * t) / 2), 0, 0] },
  }),
})

// Marche sur place : cuisses en opposition de phase, genou plié pendant le retour. Période `period` s.
export const walkInPlace = (name = 'marche', period = 1, amplitude = 0.45): ClipDef => ({
  name,
  duration: period,
  extras: mercyExtras(name, 'boucle', true),
  pose: (t) => {
    const ph = (TAU * t) / period
    const s = Math.sin(ph)
    const bendL = Math.max(0, Math.cos(ph)) * 0.9
    const bendR = Math.max(0, -Math.cos(ph)) * 0.9
    return {
      thighL: { rot: [-amplitude * s, 0, 0] },
      shinL: { rot: [bendL, 0, 0] },
      thighR: { rot: [amplitude * s, 0, 0] },
      shinR: { rot: [bendR, 0, 0] },
      upperArmL: { rot: [0.3 * s, 0, 0.1] },
      upperArmR: { rot: [-0.3 * s, 0, -0.1] },
    }
  },
})

// Même marche, genoux pliés (cuisses en avant, tibias en arrière) : les jambes ont de la marge pour allonger le pas.
export const crouchWalk = (name = 'marche', period = 1, amplitude = 0.45): ClipDef => {
  const base = walkInPlace(name, period, amplitude)
  const x = (v?: { readonly rot?: readonly [number, number, number] }): number => v?.rot?.[0] ?? 0
  return {
    ...base,
    pose: (t) => {
      const p = base.pose(t)
      return {
        ...p,
        thighL: { rot: [x(p.thighL) - 0.5, 0, 0] },
        shinL: { rot: [x(p.shinL) + 1.0, 0, 0] },
        thighR: { rot: [x(p.thighR) - 0.5, 0, 0] },
        shinR: { rot: [x(p.shinR) + 1.0, 0, 0] },
      }
    },
  }
}

// Marche qui avance d'elle-même : le bassin part de 0 et finit à `drift` m devant.
export const walkWithRootMotion = (name = 'marche', drift = 1.2): ClipDef => {
  const base = walkInPlace(name)
  return { ...base, pose: (t) => ({ ...base.pose(t), hips: { move: [0, 0, drift * t] } }) }
}

const smooth = (x: number): number => {
  const c = Math.min(1, Math.max(0, x))
  return c * c * (3 - 2 * c)
}

// Coup du bras droit : armé en arrière jusqu'à 0,4 s, frappe devant à `impactAt`, retour au repos à la fin.
// Rotation autour de X : un angle positif porte le bras vers -Z (arrière), négatif vers +Z (avant).
export const strike = (
  name = 'attaque',
  duration = 1,
  impactAt = 0.55,
  impactS: number | null = impactAt,
): ClipDef => ({
  name,
  duration,
  extras: mercyExtras(name, 'attaque', false, impactS === null ? {} : { impactS }),
  pose: (t) => {
    const back = 1.6 * smooth(t / 0.4)
    const fwd = -2.9 * smooth((t - 0.4) / (impactAt - 0.4))
    const ret = 1.3 * smooth((t - impactAt) / (duration - impactAt))
    const ang = t < 0.4 ? back : t < impactAt ? back + fwd : back + fwd + ret
    return {
      upperArmR: { rot: [ang, 0, 0] },
      foreArmR: {
        rot: [t < impactAt ? -0.6 * smooth(t / 0.4) : -0.6 + 0.6 * smooth((t - impactAt) / 0.2), 0, 0],
      },
      spine: { rot: [0.15 * Math.sin((Math.PI * t) / duration), 0, 0] },
    }
  },
})

// Réaction : le buste part en arrière dès la première image, revient en 0,5 s.
export const hit = (name = 'reaction', duration = 0.5): ClipDef => ({
  name,
  duration,
  extras: mercyExtras(name, 'reaction', false),
  pose: (t) => ({
    spine: { rot: [-0.45 * Math.sin((Math.PI * t) / duration), 0, 0] },
    head: { rot: [-0.3 * Math.sin((Math.PI * t) / duration), 0, 0] },
    upperArmL: { rot: [0, 0, 0.5 * Math.sin((Math.PI * t) / duration)] },
    upperArmR: { rot: [0, 0, -0.5 * Math.sin((Math.PI * t) / duration)] },
  }),
})

// Relèvement : à genoux, mains au sol, puis debout en `duration` s.
export const rise = (name = 'relevement', duration = 1.5): ClipDef => ({
  name,
  duration,
  extras: mercyExtras(name, 'transition', false),
  pose: (t) => {
    const u = smooth(t / duration)
    return {
      hips: { move: [0, -0.5 * (1 - u), 0] },
      spine: { rot: [0.9 * (1 - u), 0, 0] },
      thighL: { rot: [-1.3 * (1 - u), 0, 0] },
      shinL: { rot: [2.2 * (1 - u), 0, 0] },
      thighR: { rot: [-1.3 * (1 - u), 0, 0] },
      shinR: { rot: [2.2 * (1 - u), 0, 0] },
      upperArmL: { rot: [-1.0 * (1 - u), 0, 0] },
      upperArmR: { rot: [-1.0 * (1 - u), 0, 0] },
    }
  },
})
