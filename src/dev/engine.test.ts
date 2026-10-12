import { describe, expect, it } from 'vitest'
import { compareEngines, engineFingerprint, mathProbe } from './engine'

describe('empreinte du moteur JS', () => {
  it('même moteur : mêmes hashes, même sonde', () => {
    const o = {
      waves: ['V1'],
      seeds: [1, 2],
      variants: ['A', 'B'] as const,
      policy: 'ref-frappeur',
      maxTicks: 900,
    }
    const a = { rows: engineFingerprint(o), math: mathProbe() }
    const b = { rows: engineFingerprint(o), math: mathProbe() }
    expect(a.rows).toHaveLength(4)
    expect(compareEngines(a, b)).toMatchObject({ parties: 4, monde0Differents: 0, finDifferente: 0 })
  })

  it('compte les parties et les valeurs qui diffèrent', () => {
    const row = { wave: 'V6', seed: 1, variant: 'A' as const, hash0: 'a', hashFin: 'b', tickFin: 10 }
    const c = compareEngines(
      { rows: [row], math: { cos: ['00', '01'] } },
      { rows: [{ ...row, hash0: 'x', hashFin: 'y' }], math: { cos: ['00', '02'] } },
    )
    expect(c).toMatchObject({ parties: 1, monde0Differents: 1, finDifferente: 1, math: { cos: 1 } })
    expect(c.ecarts).toEqual([{ wave: 'V6', seed: 1, variant: 'A' }])
  })
})
