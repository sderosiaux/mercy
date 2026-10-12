// Les deux règles de lecture du mouvement (§18, §30.3, B2.O5 et O6), vérifiées sur les poses elles-mêmes.
import type { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { type Creature, type FamilyKind, type FamilyModule, type SpawnDef, TUNING } from '../sim/index'
import { mannequin, poteau, scene } from '../sim/testing'
import { chroma, hexToLab } from './color-science'
import { PALETTE } from './palette'
import { type Body, creatureBody, playerBody, type RigContext, segmentCorners } from './rig'

const FAMILIES = {
  recousu: mannequin(),
  confesseur: poteau,
  porteur: { ...poteau, kind: 'porteur' } satisfies FamilyModule,
  chirurgien: { ...poteau, kind: 'chirurgien' } satisfies FamilyModule,
}
const KINDS: readonly FamilyKind[] = ['souriant', 'recousu', 'porteur', 'confesseur', 'chirurgien', 'membre']

const make = (spawn: Omit<SpawnDef, 'pos'>): Creature => {
  const w = scene([{ ...spawn, pos: { x: 2, z: -1 }, facing: 0.82 }], { families: FAMILIES })
  const c = w.creatures[0]
  if (!c) throw new Error('créature absente')
  return c
}

const ctx = (t: number, extra: Partial<RigContext> = {}): RigContext => ({
  t,
  groupPhase: 0.3,
  speed: 0,
  targeted: false,
  limbStage: 0,
  prayerColor: null,
  ...extra,
})

const body = (c: Creature, t: number): Body => creatureBody(c, c.pos, c.facing, ctx(t))

const corners = (b: Body): Vector3[] => b.segments.flatMap(segmentCorners)

// Plus grand déplacement d'un coin de segment sur une fenêtre, par rapport à sa première image.
const maxShift = (frames: Body[]): number => {
  const ref = corners(frames[0] as Body)
  let m = 0
  for (const f of frames.slice(1)) {
    const cs = corners(f)
    cs.forEach((p, i) => {
      m = Math.max(m, p.distanceTo(ref[i] as Vector3))
    })
  }
  return m
}

describe('un mort ne bouge plus du tout (L4, §18, B2.O5)', () => {
  for (const family of KINDS) {
    it(`${family} placé mort : pose identique au bit près sur 600 ticks`, () => {
      const c = make({ family, state: 'mort', cicatrices: family === 'souriant' ? 3 : 0 })
      const ref = body(c, 0)
      for (const t of [1, 2, 17, 18, 59, 60, 61, 333, 600]) {
        const b = body(c, t)
        expect(b.segments.length).toBe(ref.segments.length)
        b.segments.forEach((s, i) => {
          expect(Array.from(s.frame.elements)).toEqual(
            Array.from((ref.segments[i] as Body['segments'][0]).frame.elements),
          )
        })
      }
    })
  }

  it('un corps tué en jeu agonise (TUNING.agonie), puis se fige sur la pose de la fin de son agonie', () => {
    const alive = make({ family: 'souriant', state: 'abattu' })
    const dead: Creature = { ...alive, state: { kind: 'mort', at: 140 } }
    const A = TUNING.agonie
    const end = body(dead, 140 + A)
    const same = (t: number): boolean =>
      body(dead, t).segments.every(
        (s, i) =>
          JSON.stringify(Array.from(s.frame.elements)) ===
          JSON.stringify(Array.from((end.segments[i] as Body['segments'][0]).frame.elements)),
      )
    // Pendant l'agonie, le corps bouge (dernier spasme) ; ensuite, plus rien.
    expect(same(140 + A / 2)).toBe(false)
    for (const t of [140 + A, 141 + A, 400]) expect(same(t)).toBe(true)
  })

  it('un mort n’a ni liseré ni couleur vivante une fois gris (B2.O1, O4)', () => {
    for (const family of KINDS) {
      const c = make({ family, state: 'mort', cicatrices: family === 'membre' ? 0 : 3 })
      const b = body(c, 50)
      expect(b.rim).toBeNull()
      for (const s of b.segments) {
        expect(chroma(hexToLab(s.color))).toBeLessThanOrEqual(3)
        expect(s.mat).not.toBe('glow')
      }
    }
  })
})

describe('tout ce qui vit tremble (§18, B2.O6)', () => {
  const states: readonly Omit<SpawnDef, 'pos'>[] = KINDS.flatMap((family): Omit<SpawnDef, 'pos'>[] =>
    family === 'membre'
      ? [{ family, state: 'abattu' }]
      : [
          { family, state: 'hostile' },
          { family, state: 'rituel' },
          { family, state: 'abattu' },
          { family, state: 'abattu', cicatrices: 3 },
        ],
  )
  for (const s of states) {
    it(`${s.family} ${s.state}${s.cicatrices ? ' Résistant' : ''} : ≥ 5 cm de déplacement dans toute fenêtre de 30 ticks`, () => {
      const c = make(s)
      // Fenêtres de départ réparties sur 5 s, avant le télégraphe de Relèvement d'un ordinaire.
      for (let start = 0; start <= 260; start += 13) {
        const frames: Body[] = []
        for (let t = start; t < start + 30; t++) frames.push(body(c, t))
        expect(maxShift(frames)).toBeGreaterThanOrEqual(0.05)
      }
    })
  }

  it('le Bourreau immobile respire et bouge aussi', () => {
    const w = scene([])
    for (let start = 0; start <= 200; start += 17) {
      const frames: Body[] = []
      for (let t = start; t < start + 30; t++) frames.push(playerBody(w.player, w.player.pos, 0, t, 0))
      expect(maxShift(frames)).toBeGreaterThanOrEqual(0.03)
    }
  })
})

describe('le rendu lit le monde sans l’écrire', () => {
  const deepFreeze = <T>(o: T): T => {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
      Object.freeze(o)
      for (const v of Object.values(o)) deepFreeze(v)
    }
    return o
  }
  it('calcule les poses sur un monde gelé en profondeur', () => {
    const w = deepFreeze(
      scene(
        [
          { family: 'souriant', pos: { x: 1, z: 1 }, state: 'abattu', cicatrices: 3 },
          { family: 'recousu', pos: { x: 3, z: 1 }, state: 'hostile' },
          { family: 'porteur', pos: { x: 5, z: 1 }, state: 'mort' },
        ],
        { families: FAMILIES },
      ),
    )
    for (const c of w.creatures) expect(() => creatureBody(c, c.pos, c.facing, ctx(42))).not.toThrow()
    expect(() => playerBody(w.player, w.player.pos, w.player.facing, 42, 0)).not.toThrow()
  })
})

describe('signaux portés par le corps', () => {
  it('liseré ivoire pour un Abattu, or pour un Résistant, aucun debout', () => {
    expect(body(make({ family: 'souriant', state: 'abattu' }), 5).rim?.color).toBeDefined()
    expect(body(make({ family: 'souriant', state: 'hostile' }), 5).rim).toBeNull()
    const res = body(make({ family: 'recousu', state: 'abattu', cicatrices: 3 }), 30).rim
    expect(res?.color).toBe(PALETTE.or.crete)
  })

  it('pose des marques dorées sur un Résistant, debout comme à terre', () => {
    for (const state of ['hostile', 'abattu'] as const) {
      const b = body(make({ family: 'souriant', state, cicatrices: 3 }), 10)
      const marks = b.segments.filter((s) => s.role === 'marque')
      expect(marks.length).toBeGreaterThan(0)
      for (const m of marks) expect(m.color).toBe(PALETTE.or.base)
    }
    expect(
      body(make({ family: 'souriant', state: 'abattu', cicatrices: 2 }), 10).segments.some(
        (s) => s.role === 'marque',
      ),
    ).toBe(false)
  })

  it('grandit de 8 % par Cicatrice et ajoute coutures et membres déplacés (L3)', () => {
    const torso = (cic: 0 | 1 | 2 | 3) =>
      body(make({ family: 'recousu', state: 'hostile', cicatrices: cic }), 0).segments.find(
        (s) => s.part === 'buste',
      )
    expect((torso(3)?.size[1] ?? 0) / (torso(0)?.size[1] ?? 1)).toBeCloseTo(1.08 ** 3, 6)
    const parts = (cic: 0 | 1 | 2 | 3) =>
      body(make({ family: 'souriant', state: 'hostile', cicatrices: cic }), 0).segments.map((s) => s.part)
    expect(parts(0)).not.toContain('cicatrice0')
    expect(parts(1)).toContain('cicatrice0')
    expect(parts(1)).toContain('membreDeplace1')
    expect(parts(2)).toContain('membreDeplace2')
  })

  it('bascule la tête du Souriant à 90° pendant le télégraphe de la Morsure (§18)', () => {
    const c = make({ family: 'souriant', state: 'hostile' })
    const biting: Creature = {
      ...c,
      action: {
        name: 'morsure',
        kind: 'attaque',
        start: 100,
        activeAt: 124,
        end: 154,
        target: null,
        limb: null,
      },
    }
    const up = (b: Body, part: string) => {
      const s = b.segments.find((x) => x.part === part)
      if (!s) throw new Error(part)
      const e = s.frame.elements
      return [e[4] ?? 0, e[5] ?? 0, e[6] ?? 0] as const
    }
    const b = body(biting, 120)
    const h = up(b, 'tete')
    const t = up(b, 'buste')
    const cos = h[0] * t[0] + h[1] * t[1] + h[2] * t[2]
    expect(Math.abs(cos)).toBeLessThan(0.35) // ≈ 90°, au tremblement près
  })

  it('fait luire le sac du Porteur et le halo du Confesseur en prière', () => {
    const p = make({ family: 'porteur', state: 'hostile' })
    const sac = creatureBody(p, p.pos, p.facing, ctx(10, { limbStage: 3 })).segments.find(
      (s) => s.part === 'sac',
    )
    expect(sac?.color).toBe(PALETTE.rougeVif)
    expect(sac?.mat).toBe('glow')
    const cf = make({ family: 'confesseur', state: 'hostile' })
    const halo = creatureBody(
      cf,
      cf.pos,
      cf.facing,
      ctx(10, { prayerColor: PALETTE.vertMaladif }),
    ).segments.find((s) => s.part === 'halo')
    expect(halo?.color).toBe(PALETTE.vertMaladif)
  })
})
