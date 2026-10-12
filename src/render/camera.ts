// Caméra isométrique fixe du §20 : focale longue, inclinaison et rotation fixes, champ horizontal constant
// autour du joueur, légère avance vers le curseur, poussée pendant une Sentence (§18), secousse optionnelle (§8.1).
// Pur : la pose est une fonction de l'état interpolé, de la visée et du tick de rendu.
import type { Vec2 } from '../sim/index'
import { RENDER } from './constants'

const DEG = Math.PI / 180
const YAW = RENDER.camera.yawDeg * DEG

// Directions au sol de l'écran : « haut » s'éloigne de la caméra, « droite » lui est perpendiculaire.
export const SCREEN_UP: Vec2 = { x: -Math.cos(YAW), z: -Math.sin(YAW) }
export const SCREEN_RIGHT: Vec2 = { x: -SCREEN_UP.z, z: SCREEN_UP.x }

// Coordonnées de scène de B2 (§5) : u vers la droite de l'écran, v vers le haut, en mètres.
export const uvToGround = (u: number, v: number): Vec2 => ({
  x: SCREEN_RIGHT.x * u + SCREEN_UP.x * v,
  z: SCREEN_RIGHT.z * u + SCREEN_UP.z * v,
})
export const groundToUv = (p: Vec2): { u: number; v: number } => ({
  u: p.x * SCREEN_RIGHT.x + p.z * SCREEN_RIGHT.z,
  v: p.x * SCREEN_UP.x + p.z * SCREEN_UP.z,
})

// Réglages de caméra : celui du §20 par défaut ; « proche » (environ 12 m de champ, plus inclinée) reste un réglage
// prêt à être choisi (décision humaine du 2026-10-12 : le §20 est gardé). Même rotation de 45° pour les deux, donc
// mêmes axes d'écran (SCREEN_UP, SCREEN_RIGHT).
export type CameraPreset = 'p20' | 'proche'
export interface CameraSpec {
  readonly champM: number
  readonly tiltDeg: number
  readonly fovDeg: number
}
export const CAMERAS: Readonly<Record<CameraPreset, CameraSpec>> = {
  p20: { champM: RENDER.camera.champM, tiltDeg: RENDER.camera.tiltDeg, fovDeg: RENDER.camera.fovDeg },
  proche: { champM: 12, tiltDeg: 60, fovDeg: RENDER.camera.fovDeg }, // forme (E1) : réglage proposé, non retenu
}
export const isCameraPreset = (s: string | null | undefined): s is CameraPreset =>
  s === 'p20' || s === 'proche'

export interface CameraInput {
  readonly focus: Vec2 // position interpolée du joueur
  readonly aim: Vec2 | null
  readonly aspect: number
  readonly sentence: number // 0 à 1 : avancement de la Sentence en cours (poussée de 10 %)
  readonly shake: Vec2 // décalage de secousse déjà calculé (0 si coupée)
  readonly preset?: CameraPreset // §20 si absent
}

export interface CameraPose {
  readonly position: readonly [number, number, number]
  readonly target: readonly [number, number, number]
  readonly fovDeg: number
  readonly distance: number
}

const LEAD_GAIN = 0.25 // forme (C4) : fraction de l'écart joueur-curseur reprise par l'avance
const TARGET_HEIGHT = 0.4 // forme (C4) : la caméra vise un peu au-dessus du sol, au niveau des corps

export const distanceFor = (aspect: number, preset: CameraPreset = 'p20'): number => {
  const c = CAMERAS[preset]
  return c.champM / 2 / (Math.tan((c.fovDeg * DEG) / 2) * aspect)
}

export const cameraPose = (i: CameraInput): CameraPose => {
  const spec = CAMERAS[i.preset ?? 'p20']
  const tilt = spec.tiltDeg * DEG
  let lx = 0
  let lz = 0
  if (i.aim) {
    lx = (i.aim.x - i.focus.x) * LEAD_GAIN
    lz = (i.aim.z - i.focus.z) * LEAD_GAIN
    const l = Math.hypot(lx, lz)
    const max = RENDER.camera.avanceMaxM
    if (l > max) {
      lx *= max / l
      lz *= max / l
    }
  }
  const tx = i.focus.x + lx + i.shake.x
  const tz = i.focus.z + lz + i.shake.z
  const ease = i.sentence <= 0 ? 0 : Math.sin(Math.min(1, i.sentence) * Math.PI) // pousse puis revient
  const dist = distanceFor(i.aspect, i.preset) * (1 - RENDER.camera.pousseeSentence * ease)
  const back = dist * Math.cos(tilt)
  return {
    position: [tx - SCREEN_UP.x * back, TARGET_HEIGHT + dist * Math.sin(tilt), tz - SCREEN_UP.z * back],
    target: [tx, TARGET_HEIGHT, tz],
    fovDeg: spec.fovDeg,
    distance: dist,
  }
}

// Secousse légère et brève après un coup qui touche (§8.1). Déterministe : fonction des ticks écoulés.
export const SHAKE_TICKS = 8
const SHAKE_M = 0.06 // forme (C4)
export const shakeOffset = (ticksSinceHit: number | null, t: number): Vec2 => {
  if (ticksSinceHit === null || ticksSinceHit < 0 || ticksSinceHit >= SHAKE_TICKS) return { x: 0, z: 0 }
  const k = SHAKE_M * (1 - ticksSinceHit / SHAKE_TICKS)
  return { x: k * Math.sin(t * 2.7), z: k * Math.cos(t * 3.9) }
}
