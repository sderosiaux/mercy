// Système de lumière (E1) : sources déclarées, vacillement borné et déterministe, budget continu, sources tirées
// des entités (jamais d'un mort).
import { describe, expect, it } from 'vitest'
import { type Creature, PORTEUR_STAGE_KEY, type World } from '../sim/index'
import { mannequin, poteau, scene, withCreature } from '../sim/testing'
import {
  entityLights,
  flameJitter,
  flickerAt,
  LIGHT_KINDS,
  type LightSource,
  lightScore,
  selectLights,
  source,
} from './lights'
import { PALETTE } from './palette'

const torches = (n: number, step: number): LightSource[] =>
  Array.from({ length: n }, (_, i) => source('torche', `torche:${i}`, i * step, 2.5, 0))

describe('vacillement', () => {
  it('reste dans ±flicker autour de 1 et ne dépend que de t', () => {
    const s = source('torche', 'torche:0', 0, 2, 0)
    for (let t = 0; t < 600; t += 7) {
      const f = flickerAt(s, t)
      expect(Math.abs(f - 1)).toBeLessThanOrEqual(LIGHT_KINDS.torche.flicker + 1e-9)
      expect(flickerAt(s, t)).toBe(f)
    }
    expect(flickerAt(source('lune', 'lune', 0, 30, 0), 123)).toBe(1)
  })

  it('bouge la flamme de 3 cm au plus', () => {
    const s = source('brasero', 'brasero:0', 0, 1, 0)
    for (let t = 0; t < 300; t += 3) {
      const j = flameJitter(s, t)
      expect(Math.hypot(j.x, j.z)).toBeLessThanOrEqual(0.03 * Math.SQRT2 + 1e-9)
    }
  })

  it('donne à chaque source sa propre phase', () => {
    const a = source('torche', 'torche:1', 0, 2, 0)
    const b = source('torche', 'torche:2', 0, 2, 0)
    expect(flickerAt(a, 40)).not.toBe(flickerAt(b, 40))
  })
})

describe('budget de lumières', () => {
  const focus = { x: 0, z: 0 }

  it('ne dépasse jamais le nombre de créneaux, ombres comprises', () => {
    const sel = selectLights(torches(30, 1.5), focus, { point: 6, shadow: 2 }, 12)
    expect(sel.shadowed.length).toBeLessThanOrEqual(2)
    expect(sel.point.length).toBeLessThanOrEqual(6)
  })

  it('donne les ombres aux sources les plus pertinentes, et une source ne dépasse jamais son intensité', () => {
    const srcs = torches(12, 2)
    const sel = selectLights(srcs, focus, { point: 4, shadow: 2 }, 12)
    expect(sel.shadowed.map((a) => a.src.key)).toEqual(['torche:0', 'torche:1'])
    const total = new Map<string, number>()
    for (const a of [...sel.shadowed, ...sel.point])
      total.set(a.src.key, (total.get(a.src.key) ?? 0) + a.weight)
    for (const w of total.values()) expect(w).toBeLessThanOrEqual(1 + 1e-9)
  })

  it('ignore une source dont la lumière ne peut pas atteindre la vue', () => {
    const far = source('torche', 'loin', 200, 2, 0)
    expect(lightScore(far, focus, 12)).toBe(0)
    expect(selectLights([far], focus, { point: 4, shadow: 1 }, 12).point.length).toBe(0)
  })

  it('fait varier les poids continûment quand la caméra glisse (aucun saut de lumière)', () => {
    const srcs = torches(20, 2.2)
    const weightOf = (fx: number): Map<string, number> => {
      const sel = selectLights(srcs, { x: fx, z: 0 }, { point: 5, shadow: 2 }, 10)
      const m = new Map<string, number>()
      for (const a of [...sel.shadowed, ...sel.point]) m.set(a.src.key, (m.get(a.src.key) ?? 0) + a.weight)
      return m
    }
    let prev = weightOf(0)
    for (let fx = 0.01; fx <= 20; fx += 0.01) {
      const cur = weightOf(fx)
      for (const s of srcs) {
        const d = Math.abs((cur.get(s.key) ?? 0) - (prev.get(s.key) ?? 0))
        expect(d).toBeLessThan(0.12)
      }
      prev = cur
    }
  })

  it('est une fonction pure de la position de la caméra', () => {
    const srcs = torches(15, 1.7)
    const a = selectLights(srcs, { x: 3, z: 1 }, { point: 5, shadow: 2 }, 12)
    const b = selectLights(srcs, { x: 3, z: 1 }, { point: 5, shadow: 2 }, 12)
    expect(b).toEqual(a)
  })
})

describe('sources tirées des entités', () => {
  const prayer = (w: World, id: number): World =>
    withCreature(w, id, {
      action: {
        name: 'priere',
        kind: 'canalisation',
        start: 0,
        activeAt: 150,
        end: 150,
        target: null,
        limb: null,
      },
    })
  const families = {
    confesseur: { ...mannequin({ channel: true, support: true }), kind: 'confesseur' as const },
    porteur: { ...poteau, kind: 'porteur' as const },
  }

  it('porte la chandelle du reliquaire avec le joueur', () => {
    const w = scene([], {})
    const ls = entityLights(w, w, 1, 0)
    const r = ls.find((s) => s.kind === 'reliquaire')
    expect(r).toBeDefined()
    expect(Math.hypot((r?.x ?? 99) - w.player.pos.x, (r?.z ?? 99) - w.player.pos.z)).toBeLessThan(0.5)
  })

  it('allume le halo de prière en vert maladif, plus fort à mesure que la prière avance', () => {
    let w = scene([{ family: 'confesseur', pos: { x: 4, z: 0 }, state: 'hostile' }], { families })
    w = prayer(w, 1)
    const early = entityLights(w, w, 1, 10).find((s) => s.kind === 'priere')
    const late = entityLights(w, w, 1, 140).find((s) => s.kind === 'priere')
    expect(early?.color).toBe(PALETTE.vertMaladif)
    expect(late?.intensity ?? 0).toBeGreaterThan(early?.intensity ?? 0)
    expect(late?.fixed).toBe(false)
  })

  it('n’allume le sac qu’au stade 3, en rouge vif (§17, §30.10 : aux stades 0 à 2, sa lueur n’éclaire rien)', () => {
    const w = scene([{ family: 'porteur', pos: { x: 4, z: 0 }, state: 'hostile' }], { families })
    for (const stage of [0, 1, 2]) {
      const ws = withCreature(w, 1, { familyData: { [PORTEUR_STAGE_KEY]: stage } })
      expect(entityLights(ws, ws, 1, 0).some((s) => s.kind === 'sac')).toBe(false)
    }
    const w3 = withCreature(w, 1, { familyData: { [PORTEUR_STAGE_KEY]: 3 } })
    const sac = entityLights(w3, w3, 1, 0).find((s) => s.kind === 'sac')
    expect(sac?.color).toBe(PALETTE.rougeVif)
    // Stade 3 inchangé par E5 : 9 cd × (0,5 + 0,5 × 3), importance 8.
    expect(sac?.intensity).toBe(18)
    expect(sac?.importance).toBe(8)
  })

  it('n’allume rien pour un mort (un mort ne prie pas, son sac est éteint)', () => {
    let w = scene(
      [
        { family: 'confesseur', pos: { x: 4, z: 0 }, state: 'mort' },
        { family: 'porteur', pos: { x: -4, z: 0 }, state: 'mort' },
      ],
      { families },
    )
    w = prayer(w, 1)
    w = withCreature(w, 2, { familyData: { [PORTEUR_STAGE_KEY]: 3 } })
    const kinds = entityLights(w, w, 1, 20).map((s) => s.kind)
    expect(kinds).toEqual(['reliquaire'])
    const dead = w.creatures.filter((c: Creature) => c.state.kind === 'mort')
    expect(dead.length).toBe(2)
  })
})
