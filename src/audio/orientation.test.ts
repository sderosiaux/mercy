import { describe, expect, it } from 'vitest'
import { listenerAxes } from './orientation'

describe("orientation de l'auditeur (requête C5 R1)", () => {
  it("garde l'orientation par défaut de Web Audio quand la droite de l'écran est +x", () => {
    const a = listenerAxes({ x: 1, z: 0 })
    expect(a.forward).toEqual([0, 0, -1])
    expect(a.up).toEqual([0, 1, 0])
  })

  it("fait regarder l'auditeur vers le haut de l'écran : la droite de l'écran sonne à droite", () => {
    const up = { x: -Math.SQRT1_2, z: -Math.SQRT1_2 }
    const right = { x: -up.z, z: up.x }
    const a = listenerAxes(right)
    expect(a.forward[0]).toBeCloseTo(up.x, 12)
    expect(a.forward[1]).toBe(0)
    expect(a.forward[2]).toBeCloseTo(up.z, 12)
  })
})
