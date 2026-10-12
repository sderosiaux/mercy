import { describe, expect, it } from 'vitest'
import { freeStart, parseDevParams, sameStart, searchOf, startOfParams } from './url'

const host = { wave: 'V1', seed: 1, variant: 'A' } as const

describe('paramètres d’URL (B5 I5, B2 I3)', () => {
  it('bot dans le navigateur : wave, seed, variant, policy', () => {
    const p = parseDevParams('?wave=V3&seed=7&variant=B&policy=ref-frappeur')
    expect(p).toMatchObject({ wave: 'V3', seed: 7, variant: 'B', policy: 'ref-frappeur', errors: [] })
    expect(startOfParams(p, host)).toEqual({ wave: 'V3', seed: 7, variant: 'B' })
  })

  it('scene l’emporte sur wave ; les paramètres de politique passent tels quels', () => {
    const p = parseDevParams('?wave=V1&scene=S-sat&policy=b5:D=60&until=265')
    expect(startOfParams(p, host)).toEqual({ wave: 'S-sat', seed: 1, variant: 'A' })
    expect(p.policy).toBe('b5:D=60')
    expect(p.until).toBe(265)
  })

  it('valeurs invalides : ignorées et signalées', () => {
    const p = parseDevParams('?wave=V9&scene=nulle&variant=C&seed=-1&until=0&aveugle=x')
    expect(p.wave).toBeNull()
    expect(p.scene).toBeNull()
    expect(p.variant).toBeNull()
    expect(p.seed).toBeNull()
    expect(p.until).toBeNull()
    expect(p.aveugle).toBeNull()
    expect(p.errors).toHaveLength(6)
  })

  it('mode aveugle et panneau masqué', () => {
    expect(parseDevParams('?aveugle=3&panel=0')).toMatchObject({ aveugle: 3, panel: false })
    expect(parseDevParams('').panel).toBe(true)
  })

  it('URL d’une partie libre, jamais de politique vide', () => {
    expect(searchOf(host, null)).toBe('?wave=V1&seed=1&variant=A')
    expect(searchOf(host, 'b5:D=60')).toBe('?wave=V1&seed=1&variant=A&policy=b5%3AD%3D60')
    expect(sameStart(host, { ...host })).toBe(true)
    expect(sameStart(host, { ...host, seed: 2 })).toBe(false)
  })
})

// Décision du concepteur (2026-10-12) : variante B retenue. Une partie libre lancée sans variante (panneau,
// window.__mercy.restart) prend celle du jeu ; A reste disponible sur demande.
describe('partie libre (restartFree)', () => {
  it('sans variante : B ; graine 1 par défaut ; A sur demande', () => {
    expect(freeStart({ wave: 'V1' })).toEqual({ wave: 'V1', seed: 1, variant: 'B' })
    expect(freeStart({ wave: 'S-sat', seed: 4, variant: 'A' })).toEqual({
      wave: 'S-sat',
      seed: 4,
      variant: 'A',
    })
    expect(freeStart({ wave: 'V2', variant: 'B' }).variant).toBe('B')
  })

  it('vague inconnue ou graine invalide : refusées', () => {
    expect(() => freeStart({ wave: 'V9' })).toThrow('vague ou scène inconnue : V9')
    expect(() => freeStart({ wave: 'V1', seed: -1 })).toThrow('graine invalide : -1')
    expect(() => freeStart({ wave: 'V1', seed: 1.5 })).toThrow('graine invalide : 1.5')
  })
})
