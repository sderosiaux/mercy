// Le décor n'entre jamais dans l'aire de jeu de la simulation (carré |x|, |z| ≤ arenaHalf).
import { describe, expect, it } from 'vitest'
import { TUNING } from '../sim/index'
import { roundedSquare, WALL_HALF, WALL_RADIUS } from './decor'
import { QUALITY } from './quality'

describe('mur de la fosse', () => {
  it('suit un carré arrondi qui contient tout le carré de jeu, coins compris', () => {
    const path = roundedSquare(WALL_HALF, WALL_RADIUS, 0.25)
    const A = TUNING.arenaHalf
    for (const p of path) {
      // Aucun point du mur dans l'aire de jeu (marge du rayon du joueur).
      const inside = Math.abs(p.x) < A + TUNING.playerRadius && Math.abs(p.z) < A + TUNING.playerRadius
      expect(inside).toBe(false)
      // Normale unitaire tournée vers l'extérieur.
      expect(Math.hypot(p.nx, p.nz)).toBeCloseTo(1, 9)
      expect(p.x * p.nx + p.z * p.nz).toBeGreaterThan(0)
    }
  })

  it('ferme le contour sans trou (pas régulier)', () => {
    const path = roundedSquare(WALL_HALF, WALL_RADIUS, 0.5)
    for (let i = 0; i < path.length; i++) {
      const a = path[i]
      const b = path[(i + 1) % path.length]
      if (!a || !b) throw new Error('contour')
      expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeLessThan(0.6)
    }
  })
})

describe('niveaux de qualité (§24)', () => {
  it('donnent un budget explicite de lumières et d’ombres, plus petit en basse', () => {
    expect(QUALITY.haute.pointLights + QUALITY.haute.shadowLights).toBeGreaterThan(
      QUALITY.basse.pointLights + QUALITY.basse.shadowLights,
    )
    expect(QUALITY.basse.shadowLights).toBeLessThanOrEqual(1)
    expect(QUALITY.haute.fogLights).toBeLessThanOrEqual(12)
  })
})
