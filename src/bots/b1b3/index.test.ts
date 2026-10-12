// Registre du lot C6b, IND = trieur, politiques pures et déterministes sur de vraies vagues, équivalences
// annoncées par les contrats (RET-U = RET-D sans Porteur, B3.md §5.1 ; RET = trieur sans support).
import { describe, expect, it } from 'vitest'
import { createWorld, FAMILIES, hashWorld, step, type World } from '../../sim/index'
import { waveById } from '../../sim/waves'
import { DEFAULT_SPEC, POLICIES, playRun } from '../harness'
import { policies } from './index'

const NOMS = ['trieur', 'debout', 'nettoyeur', 'IND', 'RET-D', 'RET-U', 'b3-ret-desamorce', 'b3-ret-utilise']

describe('registre', () => {
  it('les politiques de B1 et B3 sont dans le banc', () => {
    expect(Object.keys(policies).sort()).toEqual([...NOMS].sort())
    for (const n of NOMS) expect(POLICIES[n]).toBe(policies[n])
  })
  it('IND est le trieur lui-même ; les noms du §6 de B3 désignent RET-D et RET-U', () => {
    expect(policies.IND?.({})).toBe(policies.trieur?.({}))
    expect(policies['b3-ret-desamorce']?.({})).toBe(policies['RET-D']?.({}))
    expect(policies['b3-ret-utilise']?.({})).toBe(policies['RET-U']?.({}))
  })
  it('politiques gelées : aucun paramètre accepté', () => {
    expect(() => policies.trieur?.({ R_TRI: '8' })).toThrow(/paramètre refusé/)
  })
})

describe('pures et déterministes, sans mémoire', () => {
  it.each(NOMS.slice(0, 6))('%s : même monde → mêmes commandes, monde intact, mémoire null', (nom) => {
    const p = POLICIES[nom]?.({})
    if (!p) throw new Error(nom)
    let w: World = createWorld({ seed: 3, wave: waveById('V5'), variant: 'A', families: FAMILIES })
    expect(p.init(w)).toBeNull()
    for (let i = 0; i < 1500 && w.wave.endedAt === null; i++) {
      const avant = hashWorld(w)
      const [a, ma] = p.decide(w, null)
      const [b] = p.decide(w, 'ignorée')
      expect(b).toEqual(a)
      expect(ma).toBeNull()
      expect(hashWorld(w)).toBe(avant)
      expect(a.swapWeapon).toBe(false)
      w = step(w, a)
    }
  })
})

describe('équivalences annoncées par les contrats', () => {
  const partie = (wave: string, policy: string, seed: number) =>
    playRun({ ...DEFAULT_SPEC, wave, policy, seed }).result
  it('sans Porteur (V3, V4), RET-U joue exactement comme RET-D', () => {
    for (const wave of ['V3', 'V4']) {
      const d = partie(wave, 'RET-D', 1)
      const u = partie(wave, 'RET-U', 1)
      expect({ ...u, spec: null }).toEqual({ ...d, spec: null })
    }
  })
  it('sans aucun support (V1), RET-D joue exactement comme le trieur', () => {
    const t = partie('V1', 'trieur', 2)
    const r = partie('V1', 'RET-D', 2)
    expect({ ...r, spec: null }).toEqual({ ...t, spec: null })
  })
})
