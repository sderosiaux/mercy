import { describe, expect, it } from 'vitest'
import { type Creature, TUNING } from '../sim/index'
import { mannequin, scene } from '../sim/testing'
import { chroma, deltaE00, hexToLab, type Lab, srgbToLab } from './color-science'
import {
  bodyClass,
  decalColor,
  greyMix,
  marksOf,
  pallor,
  pulse,
  rimOf,
  sacCastsLight,
  sacColor,
  sacLuminanceOnly,
  tone,
} from './look'
import { mixHex, PALETTE } from './palette'
import { LOOK } from './post'

// Chaîne de tons d'un pixel de personnage, recopiée de shaders.ts (TONEMAP_GLSL, e1GradeMix avec model = 1, sans
// brouillard, vignettage ni grain) : radiance de scène linéaire → sRGB 8 bits → CIELAB.
type Rgb = readonly [number, number, number]
const toLinear = (c8: number): number => {
  const c = c8 / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const scaled = (hex: number, k: number): Rgb => [
  k * toLinear((hex >> 16) & 255),
  k * toLinear((hex >> 8) & 255),
  k * toLinear(hex & 255),
]
const mat = (m: readonly Rgb[], v: Rgb): Rgb => [
  (m[0] as Rgb)[0] * v[0] + (m[0] as Rgb)[1] * v[1] + (m[0] as Rgb)[2] * v[2],
  (m[1] as Rgb)[0] * v[0] + (m[1] as Rgb)[1] * v[1] + (m[1] as Rgb)[2] * v[2],
  (m[2] as Rgb)[0] * v[0] + (m[2] as Rgb)[1] * v[1] + (m[2] as Rgb)[2] * v[2],
]
const ACES_IN: readonly Rgb[] = [
  [0.59719, 0.35458, 0.04823],
  [0.076, 0.90834, 0.01566],
  [0.0284, 0.13383, 0.83777],
]
const ACES_OUT: readonly Rgb[] = [
  [1.60475, -0.53108, -0.07367],
  [-0.10208, 1.10813, -0.00605],
  [-0.00327, -0.07276, 1.07602],
]
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))
const shown = (radiance: Rgb): Lab => {
  const fit = (x: number): number =>
    (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.432951) + 0.238081)
  const a = mat(ACES_IN, radiance.map((x) => x * LOOK.exposure) as unknown as Rgb)
  const c = mat(ACES_OUT, a.map(fit) as unknown as Rgb).map(clamp01)
  const [r, g, b] = c as unknown as Rgb
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const mx = Math.max(r, g, b)
  const keep = ((t: number) => t * t * (3 - 2 * t))(
    clamp01(((mx - Math.min(r, g, b)) / Math.max(mx, 1e-4) - 0.3) / 0.35),
  )
  const sat = LOOK.modelSaturation + (1 - LOOK.modelSaturation) * keep
  const lc = clamp01(0.18 * (Math.max(l, 0) / 0.18) ** LOOK.contrast)
  const k = l > 1e-5 ? lc / l : 1
  const graded = [r, g, b].map((x) => clamp01((l + (x - l) * sat) * k)) // teinte des personnages : LOOK.modelTint = 0
  const s8 = graded.map((x) =>
    Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055)),
  )
  return srgbToLab(s8[0] as number, s8[1] as number, s8[2] as number)
}

const recousu = mannequin()
const world = scene(
  [
    { family: 'souriant', pos: { x: 0, z: 3 }, state: 'hostile' },
    { family: 'souriant', pos: { x: 3, z: 3 }, state: 'abattu' },
    { family: 'souriant', pos: { x: 6, z: 3 }, state: 'abattu', cicatrices: 3 },
    { family: 'souriant', pos: { x: 9, z: 3 }, state: 'mort' },
    { family: 'recousu', pos: { x: 9, z: -3 }, state: 'rituel' },
  ],
  { families: { recousu } },
)
const c = (id: number): Creature => {
  const x = world.creatures.find((k) => k.id === id)
  if (!x) throw new Error(`créature ${id}`)
  return x
}

describe('couleur d’un corps selon son état', () => {
  it('classe debout, Abattu, Résistant, mort', () => {
    expect(bodyClass(c(1))).toBe('debout')
    expect(bodyClass(c(5))).toBe('debout')
    expect(bodyClass(c(2))).toBe('abattu')
    expect(bodyClass(c(3))).toBe('resistant')
    expect(bodyClass(c(4))).toBe('mort')
  })

  it('ne met un liseré qu’aux Abattus : ivoire pour un ordinaire, or pour un Résistant', () => {
    expect(rimOf(c(1), 10, false)).toBeNull()
    expect(rimOf(c(4), 10, false)).toBeNull()
    const iv = rimOf(c(2), 0, false)
    expect(iv?.color).toBe(PALETTE.ivoire.creux)
    expect(rimOf(c(2), 30, false)?.color).toBe(PALETTE.ivoire.crete)
    expect(rimOf(c(3), 30, false)?.color).toBe(PALETTE.or.crete)
    expect(rimOf(c(3), 15, false)?.color).toBe(mixHex(PALETTE.or.creux, PALETTE.or.crete, pulse(15, 0)))
  })

  it('intensifie le liseré de la cible de Sentence (§21)', () => {
    expect(rimOf(c(2), 0, true)).toEqual({ color: PALETTE.ivoire.crete, strong: true })
    expect(rimOf(c(3), 0, true)).toEqual({ color: PALETTE.or.crete, strong: true })
  })

  it('bat à 1 Hz : creux à la chute, crête 30 ticks plus tard, creux à 60 (D13)', () => {
    expect(pulse(100, 100)).toBeCloseTo(0, 10)
    expect(pulse(130, 100)).toBeCloseTo(1, 10)
    expect(pulse(160, 100)).toBeCloseTo(0, 10)
  })

  it('passe au gris pendant l’agonie (L4, TUNING.agonie), sauf un mort placé, déjà gris', () => {
    const killed = {
      ...c(2),
      state: { kind: 'mort', at: 200 },
      spawn: { ...(c(2).spawn as NonNullable<Creature['spawn']>) },
    } as Creature
    const A = TUNING.agonie
    expect(A).toBe(24) // 0,4 s (réglage du spec), lu dans la simulation
    expect(greyMix(killed, 200)).toBe(0)
    expect(greyMix(killed, 200 + A / 2)).toBeCloseTo(0.5, 10)
    expect(greyMix(killed, 200 + A - 1)).toBeLessThan(1)
    expect(greyMix(killed, 200 + A)).toBe(1)
    expect(greyMix(killed, 900)).toBe(1)
    expect(greyMix(c(4), 0)).toBe(1)
    expect(greyMix(c(2), 50)).toBe(0)
  })

  it('ramène toute couleur vivante à sa pâleur de cadavre : gris, à luminance égale, sans éclaircissement (E8)', () => {
    const living = [
      PALETTE.chair.souriant,
      PALETTE.chair.souriantMasque,
      PALETTE.habit.haillon,
      PALETTE.chair.chasuble,
      PALETTE.matiere.fer,
    ]
    for (const hex of living) {
      for (const gt of ['normal', 'clair', 'sombre'] as const) {
        const dead = tone(hex, 1, gt)
        expect(dead).toBe(pallor(hex, gt))
        // Gris : C* au plus 3, la moitié du plafond d'un gris de B2.O1 (6), arrondi 8 bits compris.
        expect(chroma(hexToLab(dead))).toBeLessThanOrEqual(3)
        // Luminance de la couleur vivante, à l'arrondi 8 bits près : ni éclaircie, ni assombrie.
        expect(Math.abs(hexToLab(dead).L - hexToLab(hex).L)).toBeLessThan(1)
      }
    }
    expect(tone(PALETTE.chair.souriant, 0)).toBe(PALETTE.chair.souriant)
  })

  it('dore les marques d’un Résistant vivant et les grise à sa mort (D13)', () => {
    expect(marksOf(c(3), 0)).toBe(PALETTE.or.base)
    expect(marksOf(c(3), 1)).toBe(pallor(PALETTE.or.base))
    expect(marksOf(c(2), 0)).toBeNull()
  })
})

describe('autres couleurs porteuses de sens', () => {
  it('fait luire le sac selon son stade, rouge vif au stade 3', () => {
    expect(sacColor(0)).toBe(PALETTE.chair.sac)
    expect(sacColor(2)).toBe(PALETTE.chair.sacLueur)
    expect(sacColor(3)).toBe(PALETTE.rougeVif)
  })
  it('ne laisse la lumière teinter le sac, et le sac éclairer, qu’au stade 3', () => {
    expect([0, 1, 2, 3].map(sacLuminanceOnly)).toEqual([true, true, true, false])
    expect([0, 1, 2, 3].map(sacCastsLight)).toEqual([false, false, false, true])
  })
  it('tient la couleur du sac aux stades 0 à 2 loin du rouge vif à toute luminance (exposition, ACES, étalonnage)', () => {
    // Sous une lumière qui ne change que sa luminance (sacLuminanceOnly), le sac affiche k × sa couleur : quel que
    // soit k, il reste à au moins 13 de ΔE00 du rouge vif (seuil de E5, audit du §30). Le stade 3, lui, l'atteint.
    expect(LOOK.modelTint).toBe(0) // la recopie de l'étalonnage ci-dessus suppose des personnages sans teinte froide
    const rv = hexToLab(PALETTE.rougeVif)
    const closest = (hex: number): number => {
      let m = Number.POSITIVE_INFINITY
      for (let e = -3; e <= 2; e += 0.01) m = Math.min(m, deltaE00(shown(scaled(hex, 10 ** e)), rv))
      return m
    }
    expect(closest(sacColor(0))).toBeGreaterThan(13)
    expect(closest(sacColor(1))).toBeGreaterThan(13)
    expect(closest(sacColor(2))).toBeGreaterThan(13)
    expect(closest(sacColor(3))).toBeLessThan(10)
  })
  it('garde le sang frais rouge vif pendant 2 s, puis rouge brun', () => {
    expect(decalColor(0)).toBe(PALETTE.rougeVif)
    expect(decalColor(119)).toBe(PALETTE.rougeVif)
    expect(decalColor(120)).toBe(PALETTE.rougeBrun.sangAncien)
  })
})
