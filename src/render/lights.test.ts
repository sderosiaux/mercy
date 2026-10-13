// Système de lumière (E1) : sources déclarées, vacillement borné et déterministe, budget continu, sources tirées
// des entités (jamais d'un mort). E8 : rayon de lumière du Bourreau, rendus de jugement et sans lumière.
import { Scene } from 'three'
import { describe, expect, it } from 'vitest'
import { type Creature, PORTEUR_STAGE_KEY, type World } from '../sim/index'
import { mannequin, poteau, scene, withCreature } from '../sim/testing'
import { LightRig } from './lightrig'
import {
  entityLights,
  flameJitter,
  flickerAt,
  judged,
  LIGHT_KINDS,
  type LightSource,
  lightScore,
  RAYON_BOURREAU_M,
  RELIQUAIRE_HEIGHT_M,
  relativeLuminance,
  selectLights,
  source,
} from './lights'
import { PALETTE } from './palette'
import { QUALITY } from './quality'

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
    expect(late?.owner).toBe(1)
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

// E8 : la chandelle du reliquaire est un rayon de lumière autour du Bourreau (RAYON_BOURREAU_M). Éclairement du sol
// selon la loi de three (getDistanceAttenuation : 1/d^decay, fenêtre lisse jusqu'à la portée), cosinus d'incidence.
describe('rayon de lumière du Bourreau', () => {
  const groundIrradiance = (r: number): number => {
    const s = LIGHT_KINDS.reliquaire
    const d = Math.hypot(r, RELIQUAIRE_HEIGHT_M)
    const win = Math.max(0, 1 - (d / s.range) ** 4) ** 2
    return ((s.intensity * (RELIQUAIRE_HEIGHT_M / d)) / Math.max(d ** s.decay, 0.01)) * win
  }

  it('prend un rayon dans la fourchette du concepteur (6 à 8 m)', () => {
    expect(RAYON_BOURREAU_M).toBeGreaterThanOrEqual(6)
    expect(RAYON_BOURREAU_M).toBeLessThanOrEqual(8)
  })

  it('éclaire encore là où il tue, décroît sans saut, s’éteint au rayon', () => {
    const e0 = groundIrradiance(0)
    expect(groundIrradiance(3) / e0).toBeGreaterThan(0.5) // portée de ses coups, et un peu plus
    // Sous ses pieds, pas plus que l'ancienne chandelle (14 cd à 2,8 m, en 1/d² : 1,75) : rien n'y brûle.
    expect(e0).toBeLessThanOrEqual(1.8)
    let prev = e0
    for (let r = 0.25; r <= RAYON_BOURREAU_M + 2; r += 0.25) {
      const e = groundIrradiance(r)
      expect(e).toBeLessThanOrEqual(prev + 1e-12)
      expect(prev - e).toBeLessThan(0.08 * e0)
      prev = e
    }
    expect(groundIrradiance(RAYON_BOURREAU_M)).toBe(0)
    expect(groundIrradiance(RAYON_BOURREAU_M - 1) / e0).toBeLessThan(0.1)
    expect(groundIrradiance(RAYON_BOURREAU_M - 0.5) / e0).toBeLessThan(0.03)
  })

  it('suit le Bourreau, en couleur de flamme de la palette', () => {
    let w = scene([], {})
    w = { ...w, player: { ...w.player, pos: { x: 3, z: -2 } } }
    const r = entityLights(w, w, 1, 0).find((s) => s.kind === 'reliquaire')
    expect([r?.x, r?.y, r?.z]).toEqual([3, RELIQUAIRE_HEIGHT_M, -2])
    expect(r?.color).toBe(PALETTE.lumiere.reliquaire)
  })
})

// B2, amendement A11 : rendu de jugement (sources neutres à luminance égale) et rendu sans lumière.
describe('rendus de jugement et sans lumière', () => {
  const kinds = ['torche', 'brasero', 'chandelle', 'lune', 'priere', 'sac', 'reliquaire'] as const

  it('jugement : position, portée, vacillement et luminance gardés ; couleur neutre', () => {
    for (const kind of kinds) {
      const s = source(kind, `${kind}:0`, 1, 2, 3)
      const j = judged(s)
      expect(j.color).toBe(PALETTE.lumiere.neutre)
      expect(j.intensity * relativeLuminance(j.color)).toBeCloseTo(
        s.intensity * relativeLuminance(s.color),
        10,
      )
      expect([j.x, j.y, j.z, j.range, j.flicker, j.seed, j.decay]).toEqual([
        s.x,
        s.y,
        s.z,
        s.range,
        s.flicker,
        s.seed,
        s.decay,
      ])
    }
  })

  it('le gréement : neutre en jugement, tout éteint sans lumière', () => {
    const srcs = [
      ...kinds.map((k, i) => source(k, `${k}:${i}`, i - 3, 2, 1)),
      source('lune', 'lune', 16, 30, 12),
    ]
    const lit = (sc: Scene): { r: number; g: number; b: number; i: number }[] => {
      const out: { r: number; g: number; b: number; i: number }[] = []
      sc.traverse((o) => {
        const l = o as unknown as {
          isLight?: boolean
          color?: { r: number; g: number; b: number }
          intensity: number
        }
        if (l.isLight && l.color && l.intensity > 0) out.push({ ...l.color, i: l.intensity })
      })
      return out
    }
    const sc = new Scene()
    const r2 = new LightRig(sc, QUALITY.haute, 14)
    r2.update(srcs, { x: 0, z: 0 }, 10, 12, 'jugement')
    const judgedLights = lit(sc)
    expect(judgedLights.length).toBeGreaterThan(3)
    for (const l of judgedLights) {
      expect(l.r).toBeCloseTo(l.g, 6)
      expect(l.g).toBeCloseTo(l.b, 6)
    }
    r2.update(srcs, { x: 0, z: 0 }, 10, 12, 'sans')
    expect(lit(sc)).toEqual([])
    r2.dispose()
  })
})
