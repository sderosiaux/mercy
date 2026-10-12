// Racine neutralisée (requête F2-1) : le bassin ne quitte jamais sa place au sol ; le cap est ramené à celui de la
// simulation aux bouts debout d'un clip, sans saut ; les clips à terre gardent leur cap.
import { Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { headingOf, neutralizeRoot, rootClassOf } from './root'

const yawQ = (a: number, pitch = 0): number[] => {
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), a)
  q.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitch))
  return [q.x, q.y, q.z, q.w]
}

const headings = (values: Float32Array | null): number[] => {
  const out: number[] = []
  if (!values) return out
  for (let k = 0; k < values.length; k += 4)
    out.push(headingOf(values[k + 1] as number, values[k + 3] as number))
  return out
}

describe('classes de clips', () => {
  it('reconnaît chute, relèvement et clips à terre', () => {
    expect(rootClassOf('chute')).toBe('tombe')
    expect(rootClassOf('relevement')).toBe('releve')
    expect(rootClassOf('abattu.torsion')).toBe('aTerre')
    expect(rootClassOf('canalisation.priere-abattu')).toBe('aTerre')
    expect(rootClassOf('attaque.morsure')).toBe('debout')
  })
})

describe('translation', () => {
  it('le bassin garde son x, z de repos ; sa hauteur suit le clip', () => {
    const fix = neutralizeRoot({
      cls: 'tombe',
      duration: 2,
      bindX: 0.5,
      bindZ: -1,
      bindHeading: 0,
      positionTimes: [0, 1, 2],
      positionValues: [0, 104, 0, -20, 70, -60, -29, 36, -96],
      quaternionTimes: null,
      quaternionValues: null,
    })
    expect(Array.from(fix.positions ?? [])).toEqual([0.5, 104, -1, 0.5, 70, -1, 0.5, 36, -1])
  })
})

describe('cap', () => {
  it('un clip debout tourné (réaction à −59°) revient au cap de repos, partout', () => {
    const q = [...yawQ(-1.03), ...yawQ(-1.03, 0.3), ...yawQ(-1.03)]
    const fix = neutralizeRoot({
      cls: 'debout',
      duration: 2,
      bindX: 0,
      bindZ: 0,
      bindHeading: 0,
      positionTimes: null,
      positionValues: null,
      quaternionTimes: [0, 1, 2],
      quaternionValues: q,
    })
    for (const h of headings(fix.quaternions)) expect(h).toBeCloseTo(0, 6)
  })
  it('le relèvement en demi-tour : bout à terre intact, bout debout ramené au cap, sans saut', () => {
    const times = Array.from({ length: 11 }, (_, k) => k * 0.2)
    const q = times.flatMap((t) => yawQ(2.6 - 5.7 * (t / 2), 0))
    const fix = neutralizeRoot({
      cls: 'releve',
      duration: 2,
      bindX: 0,
      bindZ: 0,
      bindHeading: 0,
      positionTimes: null,
      positionValues: null,
      quaternionTimes: times,
      quaternionValues: q,
    })
    const h = headings(fix.quaternions)
    expect(h[0]).toBeCloseTo(2.6, 6) // à terre : cap du clip
    expect(h.at(-1)).toBeCloseTo(0, 6) // debout : cap de la simulation
    for (let k = 1; k < h.length; k++) {
      const d = Math.atan2(
        Math.sin((h[k] as number) - (h[k - 1] as number)),
        Math.cos((h[k] as number) - (h[k - 1] as number)),
      )
      expect(Math.abs(d)).toBeLessThan(0.8) // pas de saut entre deux clés
    }
  })
  it('un clip à terre n’est pas touché', () => {
    const fix = neutralizeRoot({
      cls: 'aTerre',
      duration: 1,
      bindX: 0,
      bindZ: 0,
      bindHeading: 0,
      positionTimes: null,
      positionValues: null,
      quaternionTimes: [0, 1],
      quaternionValues: [...yawQ(1.2, 1.5), ...yawQ(1.4, 1.5)],
    })
    expect(fix.quaternions).toBeNull()
  })
})
