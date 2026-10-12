import type { Vec2 } from './types'

export const vec = (x: number, z: number): Vec2 => ({ x, z })
export const ZERO: Vec2 = vec(0, 0)
export const add = (a: Vec2, b: Vec2): Vec2 => vec(a.x + b.x, a.z + b.z)
export const sub = (a: Vec2, b: Vec2): Vec2 => vec(a.x - b.x, a.z - b.z)
export const scale = (a: Vec2, k: number): Vec2 => vec(a.x * k, a.z * k)
export const len = (a: Vec2): number => Math.hypot(a.x, a.z)
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z)
export const norm = (a: Vec2): Vec2 => {
  const l = len(a)
  return l === 0 ? ZERO : vec(a.x / l, a.z / l)
}
export const fromAngle = (a: number): Vec2 => vec(Math.cos(a), Math.sin(a))
export const angleOf = (from: Vec2, to: Vec2): number => Math.atan2(to.z - from.z, to.x - from.x)
// Écart angulaire absolu, dans [0, π].
export const angleDiff = (a: number, b: number): number => {
  const d = (((a - b) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)
  return Math.abs(d - Math.PI)
}
export const moveToward = (from: Vec2, to: Vec2, step: number): Vec2 => {
  const d = dist(from, to)
  if (d <= step || d === 0) return to
  return add(from, scale(sub(to, from), step / d))
}
// Rotation bornée de `from` vers `to` (radians), au plus `maxStep`.
export const turnToward = (from: number, to: number, maxStep: number): number => {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from))
  return Math.abs(delta) <= maxStep ? to : from + Math.sign(delta) * maxStep
}

export interface Cone {
  readonly origin: Vec2
  readonly facing: number
  readonly reach: number
  readonly arcDeg: number
}
// Un point est dans le cône si sa distance au bord ne dépasse pas la portée (rayon de la cible compris)
// et si son angle tient dans le demi-arc.
export const inCone = (cone: Cone, p: Vec2, targetRadius: number): boolean => {
  const d = dist(cone.origin, p)
  if (d > cone.reach + targetRadius) return false
  if (d < 1e-9) return true
  return angleDiff(angleOf(cone.origin, p), cone.facing) <= (cone.arcDeg * Math.PI) / 360 + 1e-12
}

// Distance d'un point au segment [a, b].
export const distToSegment = (p: Vec2, a: Vec2, b: Vec2): number => {
  const ab = sub(b, a)
  const l2 = ab.x * ab.x + ab.z * ab.z
  if (l2 === 0) return dist(p, a)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.z - a.z) * ab.z) / l2))
  return dist(p, add(a, scale(ab, t)))
}
