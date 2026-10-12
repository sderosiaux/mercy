import { PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { cameraPose, groundToUv, SCREEN_RIGHT, SCREEN_UP, shakeOffset, uvToGround } from './camera'

const project = (aspect: number, focus = { x: 0, z: 0 }, aim: { x: number; z: number } | null = null) => {
  const pose = cameraPose({ focus, aim, aspect, sentence: 0, shake: { x: 0, z: 0 } })
  const cam = new PerspectiveCamera(pose.fovDeg, aspect, 0.5, 200)
  cam.position.set(...pose.position)
  cam.lookAt(...pose.target)
  cam.updateMatrixWorld()
  cam.updateProjectionMatrix()
  return { pose, at: (x: number, y: number, z: number) => new Vector3(x, y, z).project(cam) }
}

describe('caméra du §20', () => {
  it('convertit (u, v) de B2 en (x, z) par une rotation de 45°, et retour', () => {
    expect(SCREEN_UP.x * SCREEN_RIGHT.x + SCREEN_UP.z * SCREEN_RIGHT.z).toBeCloseTo(0, 12)
    for (const [u, v] of [
      [-6, 4],
      [5.8, -0.6],
      [0, 5],
    ] as const) {
      const g = uvToGround(u, v)
      const back = groundToUv(g)
      expect(back.u).toBeCloseTo(u, 12)
      expect(back.v).toBeCloseTo(v, 12)
      expect(Math.hypot(g.x, g.z)).toBeCloseTo(Math.hypot(u, v), 12)
    }
  })

  it('place u vers la droite et v vers le haut de l’écran', () => {
    const { at } = project(1440 / 900)
    const r = uvToGround(3, 0)
    const up = uvToGround(0, 3)
    expect(at(r.x, 0.4, r.z).x).toBeGreaterThan(0.2)
    expect(Math.abs(at(r.x, 0.4, r.z).y)).toBeLessThan(0.02)
    expect(at(up.x, 0.4, up.z).y).toBeGreaterThan(0.1)
  })

  it('montre environ 18 m de champ horizontal autour du joueur, quel que soit le rapport d’image', () => {
    for (const aspect of [1440 / 900, 1024 / 768, 1920 / 1080]) {
      const { at } = project(aspect)
      const r = uvToGround(9, 0)
      expect(at(r.x, 0.4, r.z).x).toBeCloseTo(1, 2)
    }
  })

  it('incline à 55° et vise avec 30° de champ vertical', () => {
    const { pose } = project(1.6)
    const [px, py, pz] = pose.position
    const [tx, ty, tz] = pose.target
    const tilt = Math.atan2(py - ty, Math.hypot(px - tx, pz - tz))
    expect((tilt * 180) / Math.PI).toBeCloseTo(55, 6)
    expect(pose.fovDeg).toBe(30)
  })

  it('avance vers le curseur de 2 m au plus', () => {
    const near = cameraPose({
      focus: { x: 0, z: 0 },
      aim: { x: 4, z: 0 },
      aspect: 1.6,
      sentence: 0,
      shake: { x: 0, z: 0 },
    })
    expect(near.target[0]).toBeCloseTo(1, 6)
    const far = cameraPose({
      focus: { x: 0, z: 0 },
      aim: { x: 40, z: 0 },
      aspect: 1.6,
      sentence: 0,
      shake: { x: 0, z: 0 },
    })
    expect(Math.hypot(far.target[0], far.target[2])).toBeCloseTo(2, 6)
  })

  it('pousse de 10 % au plus fort de la Sentence (§18)', () => {
    const base = cameraPose({
      focus: { x: 0, z: 0 },
      aim: null,
      aspect: 1.6,
      sentence: 0,
      shake: { x: 0, z: 0 },
    })
    const mid = cameraPose({
      focus: { x: 0, z: 0 },
      aim: null,
      aspect: 1.6,
      sentence: 0.5,
      shake: { x: 0, z: 0 },
    })
    expect(mid.distance / base.distance).toBeCloseTo(0.9, 6)
  })

  it('ne secoue qu’après un coup, brièvement, et pas du tout sans coup', () => {
    expect(shakeOffset(null, 100)).toEqual({ x: 0, z: 0 })
    expect(shakeOffset(20, 100)).toEqual({ x: 0, z: 0 })
    const s = shakeOffset(1, 100)
    expect(Math.hypot(s.x, s.z)).toBeGreaterThan(0)
  })
})
