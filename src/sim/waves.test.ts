// Vagues V1 à V6 (prompt P0, §12) et scènes de B5 (B5.md §6).
import { describe, expect, it } from 'vitest'
import { FAMILIES } from './families/registry'
import { inPorteurRearArc } from './predicates'
import { TUNING } from './tuning'
import type { FamilyKind, World } from './types'
import { dist } from './vec'
import { SCENE_IDS, WAVE_IDS, WAVE_JITTER_M, WAVES, waveById } from './waves'
import { createWorld } from './world'

const SEEDS = Array.from({ length: 100 }, (_, i) => i + 1)
const make = (id: string, seed: number): World =>
  createWorld({ seed, wave: waveById(id), variant: 'A', families: FAMILIES })
const census = (id: string): Partial<Record<FamilyKind, number>> => {
  const out: Partial<Record<FamilyKind, number>> = {}
  for (const s of waveById(id).spawns) out[s.family] = (out[s.family] ?? 0) + 1
  return out
}
const SUPPORTS: readonly FamilyKind[] = ['porteur', 'confesseur', 'chirurgien']

describe('compositions (prompt P0, §12)', () => {
  it('V1 : deux groupes de 3 Souriants en Rituel, centres à 14 m', () => {
    expect(census('V1')).toEqual({ souriant: 6 })
    const g = (n: number) => WAVES.V1.spawns.filter((s) => s.group === n).map((s) => s.pos)
    const center = (ps: { x: number; z: number }[]) => ({
      x: ps.reduce((a, p) => a + p.x, 0) / ps.length,
      z: ps.reduce((a, p) => a + p.z, 0) / ps.length,
    })
    expect(g(1)).toHaveLength(3)
    expect(g(2)).toHaveLength(3)
    expect(dist(center(g(1)), center(g(2)))).toBeCloseTo(14, 9)
  })
  it('V2 : Souriants et Porteur ; V3 : Recousu, Chirurgien et Souriants ; V4 : 2 Confesseurs et 8 Souriants', () => {
    expect(census('V2')).toEqual({ souriant: 8, porteur: 1 })
    expect(census('V3')).toEqual({ souriant: 6, recousu: 1, chirurgien: 1 })
    expect(census('V4')).toEqual({ souriant: 8, confesseur: 2 })
  })
  it('V5 : les cinq familles ; V6 : 40 créatures', () => {
    expect(census('V5')).toEqual({ souriant: 6, recousu: 1, porteur: 1, chirurgien: 1, confesseur: 1 })
    expect(WAVES.V6.spawns).toHaveLength(40)
    expect(census('V6')).toEqual({ souriant: 36, porteur: 4 })
  })
  it('V2 à V6 contiennent au moins un support (hypothèse de B1 §5)', () => {
    for (const id of ['V2', 'V3', 'V4', 'V5', 'V6'])
      expect(WAVES[id as 'V2'].spawns.some((s) => SUPPORTS.includes(s.family))).toBe(true)
  })
  it('vagues jouées : test faux, tout en Rituel, décalage de 1 m et phase de Rituel tirés par la graine', () => {
    for (const id of WAVE_IDS) {
      const w = WAVES[id]
      expect(w.test).toBe(false)
      expect(w.jitter).toEqual({ posM: WAVE_JITTER_M, ritualPhase: true })
      expect(WAVE_JITTER_M).toBe(1)
      for (const s of w.spawns) expect(s.state ?? 'rituel').toBe('rituel')
    }
  })
  it('chaque Porteur commence de face au joueur, sac loin de lui (§8.10)', () => {
    for (const id of WAVE_IDS)
      for (const c of make(id, 1).creatures.filter((x) => x.family === 'porteur'))
        expect(inPorteurRearArc(c, WAVES[id].playerStart)).toBe(false)
  })
})

describe('graine (B1 §12.3, B3 I9)', () => {
  it('décale chaque départ dans un disque de 1 m et tire la phase de Rituel', () => {
    for (const id of WAVE_IDS) {
      const a = make(id, 1)
      const b = make(id, 2)
      WAVES[id].spawns.forEach((s, i) => {
        for (const w of [a, b])
          expect(dist((w.creatures[i] as World['creatures'][number]).pos, s.pos)).toBeLessThanOrEqual(1)
      })
      expect(a.creatures.map((c) => c.pos)).not.toEqual(b.creatures.map((c) => c.pos))
      expect(a.creatures.map((c) => c.ritualPhase)).not.toEqual(b.creatures.map((c) => c.ritualPhase))
    }
  })
  it('même graine, même monde', () => {
    for (const id of WAVE_IDS) expect(make(id, 7)).toEqual(make(id, 7))
  })
})

describe('géométrie, graines 1 à 100', () => {
  it('toutes les créatures dans l’arène, hors de portée de proximité (2,5 m) du joueur au départ', () => {
    for (const id of WAVE_IDS)
      for (const seed of SEEDS) {
        const w = make(id, seed)
        for (const c of w.creatures) {
          expect(Math.abs(c.pos.x)).toBeLessThan(TUNING.arenaHalf - TUNING.radiusLarge)
          expect(Math.abs(c.pos.z)).toBeLessThan(TUNING.arenaHalf - TUNING.radiusLarge)
          expect(dist(c.pos, w.player.pos)).toBeGreaterThan(TUNING.alertProximity + 3)
        }
      }
  })
  it('V1 : le second groupe est toujours hors du rayon de cri du premier (§12, parcelle 1)', () => {
    for (const seed of SEEDS) {
      const w = make('V1', seed)
      const g1 = w.creatures.filter((c) => c.group === 1)
      const g2 = w.creatures.filter((c) => c.group === 2)
      const gap = Math.min(...g1.flatMap((a) => g2.map((b) => dist(a.pos, b.pos))))
      expect(gap).toBeGreaterThan(TUNING.criAlertRadius)
    }
  })
  it('V6 : chaque foule est à portée de cri d’une voisine, pour qu’une horde se forme (B4.O7)', () => {
    for (const seed of SEEDS) {
      const w = make('V6', seed)
      const groups = [1, 2, 3, 4].map((g) => w.creatures.filter((c) => c.group === g))
      for (const [i, g] of groups.entries()) {
        const nearest = Math.min(
          ...groups.flatMap((h, j) => (j === i ? [] : g.flatMap((a) => h.map((b) => dist(a.pos, b.pos))))),
        )
        expect(nearest).toBeLessThanOrEqual(TUNING.criAlertRadius)
      }
    }
  })
  it('les vagues jouées se créent avec le registre complet des familles', () => {
    for (const id of WAVE_IDS) expect(() => make(id, 3)).not.toThrow()
  })
})

describe('scènes de B5 (§6), test vrai, sans décalage', () => {
  it('S1 : un Souriant en Rituel à (+2 ; 0) du joueur', () => {
    const w = make('S1', 1)
    expect(WAVES.S1.test).toBe(true)
    expect(w.player.pos).toEqual({ x: 0, z: 0 })
    expect(w.creatures.map((c) => [c.family, c.pos, c.state.kind])).toEqual([
      ['souriant', { x: 2, z: 0 }, 'rituel'],
    ])
  })
  it('S-nappe : 6 Souriants en Rituel sur un cercle de 10 m, angles 0° à 300°, ids dans cet ordre', () => {
    const w = make('S-nappe', 1)
    expect(w.creatures).toHaveLength(6)
    w.creatures.forEach((c, k) => {
      expect(c.id).toBe(k + 1)
      expect(c.state.kind).toBe('rituel')
      expect(c.pos.x).toBeCloseTo(10 * Math.cos((k * Math.PI) / 3), 9)
      expect(c.pos.z).toBeCloseTo(10 * Math.sin((k * Math.PI) / 3), 9)
    })
  })
  it('S-sat : 36 Souriants Abattus en grille 6 × 6, fell au tick 0, aucun support à 12 m', () => {
    const w = make('S-sat', 1)
    expect(w.player.pos).toEqual({ x: 0, z: 0 })
    expect(w.creatures).toHaveLength(36)
    expect(w.creatures.every((c) => c.family === 'souriant' && c.state.kind === 'abattu')).toBe(true)
    expect(new Set(w.creatures.map((c) => c.pos.x))).toEqual(new Set([3.25, 4.75, 6.25, 7.75, 9.25, 10.75]))
    expect(new Set(w.creatures.map((c) => c.pos.z))).toEqual(new Set([-3.75, -2.25, -0.75, 0.75, 2.25, 3.75]))
    expect(w.events.filter((e) => e.type === 'fell' && e.tick === 0)).toHaveLength(36)
  })
  it('les scènes sont marquées test et sans tirage de position', () => {
    for (const id of SCENE_IDS) {
      expect(WAVES[id].test).toBe(true)
      expect(WAVES[id].jitter).toEqual({ posM: 0, ritualPhase: false })
      expect(make(id, 1).creatures.map((c) => c.pos)).toEqual(make(id, 2).creatures.map((c) => c.pos))
    }
  })
  it('vague inconnue : erreur explicite', () => {
    expect(() => waveById('V7')).toThrow(/vague inconnue/)
  })
})
