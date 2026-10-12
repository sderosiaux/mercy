// La palette porte les écarts que B2 exige à l'écran (O1 à O4). Ces tests vérifient les couleurs source ;
// les mesures sur pixels rendus (lumière, anticrénelage) restent celles du laboratoire et des vérificateurs.
import { describe, expect, it } from 'vitest'
import { chroma, deltaE00, hexToLab } from './color-science'
import { mixHex, PALETTE } from './palette'

const lab = hexToLab
const IVOIRE = lab(PALETTE.ivoire.base)
const OR = lab(PALETTE.or.base)
const GRIS = lab(PALETTE.gris.cadaverique)

describe('colorimétrie', () => {
  it('reproduit les paires de référence de Sharma (2005)', () => {
    expect(deltaE00({ L: 50, a: 2.6772, b: -79.7751 }, { L: 50, a: 0, b: -82.7485 })).toBeCloseTo(2.0425, 4)
    expect(deltaE00({ L: 50, a: 2.5, b: 0 }, { L: 56, a: -27, b: -3 })).toBeCloseTo(31.903, 3)
    expect(
      deltaE00({ L: 60.2574, a: -34.0099, b: 36.2677 }, { L: 60.4626, a: -34.1751, b: 39.4387 }),
    ).toBeCloseTo(1.2644, 4)
    expect(deltaE00({ L: 2.0776, a: 0.0795, b: -1.135 }, { L: 0.9033, a: -0.0636, b: -0.5514 })).toBeCloseTo(
      0.9082,
      4,
    )
  })
  it('donne L* = 100 et une chroma nulle pour le blanc sRGB', () => {
    const w = lab(0xffffff)
    expect(w.L).toBeCloseTo(100, 2)
    expect(chroma(w)).toBeLessThan(0.01)
  })
})

describe('palette du §17 et seuils de B2', () => {
  it('sépare ivoire, or et gris au-delà des seuils de B2.O2 (20 et 25), avec de la marge', () => {
    expect(deltaE00(IVOIRE, OR)).toBeGreaterThanOrEqual(25)
    expect(deltaE00(IVOIRE, GRIS)).toBeGreaterThanOrEqual(30)
    expect(deltaE00(OR, GRIS)).toBeGreaterThanOrEqual(25)
  })

  it('garde chaque instant du battement dans sa classe (B2.O2 : écart + 5 ≤ écart aux autres)', () => {
    for (let k = 0; k <= 10; k++) {
      const iv = lab(mixHex(PALETTE.ivoire.creux, PALETTE.ivoire.crete, k / 10))
      expect(deltaE00(iv, IVOIRE)).toBeLessThanOrEqual(10)
      expect(deltaE00(iv, IVOIRE) + 5).toBeLessThanOrEqual(Math.min(deltaE00(iv, OR), deltaE00(iv, GRIS)))
      const au = lab(mixHex(PALETTE.or.creux, PALETTE.or.crete, k / 10))
      expect(deltaE00(au, OR)).toBeLessThanOrEqual(10)
      expect(deltaE00(au, OR) + 5).toBeLessThanOrEqual(Math.min(deltaE00(au, IVOIRE), deltaE00(au, GRIS)))
    }
  })

  it('fait battre le liseré d’au moins 14 de L* entre creux et crête (B2.O6.3 en demande 10 sur les pixels)', () => {
    expect(lab(PALETTE.ivoire.crete).L - lab(PALETTE.ivoire.creux).L).toBeGreaterThanOrEqual(14)
    expect(lab(PALETTE.or.crete).L - lab(PALETTE.or.creux).L).toBeGreaterThanOrEqual(10)
  })

  it('n’a aucune chroma dans les gris de la mort (B2.O1 : C* ≤ 6)', () => {
    for (const g of [
      PALETTE.gris.cadaverique,
      PALETTE.gris.cadaveriqueClair,
      PALETTE.gris.cadaveriqueSombre,
    ]) {
      expect(chroma(lab(g))).toBeLessThanOrEqual(3)
      // Un mort ne montre ni ivoire ni or (B2.O4).
      expect(deltaE00(lab(g), IVOIRE)).toBeGreaterThan(15)
      expect(deltaE00(lab(g), OR)).toBeGreaterThan(15)
    }
  })

  it('détache le mort de la pierre du sol (B2.O3 : ΔE00 ≥ 10)', () => {
    expect(deltaE00(GRIS, lab(PALETTE.gris.pierre))).toBeGreaterThanOrEqual(15)
  })

  it('sature la chair vivante (B2.O1 : C* ≥ 15 sous la lumière) et la tient loin de l’ivoire et de l’or', () => {
    const { souriant, recousu, porteur, confesseur, chasuble, chirurgien, tablier } = PALETTE.chair
    for (const c of [souriant, recousu, porteur, confesseur, chasuble, chirurgien, tablier]) {
      expect(chroma(lab(c))).toBeGreaterThanOrEqual(20)
      expect(deltaE00(lab(c), OR)).toBeGreaterThan(15)
      expect(deltaE00(lab(c), IVOIRE)).toBeGreaterThan(15)
      expect(deltaE00(lab(c), GRIS)).toBeGreaterThan(10)
    }
  })

  it('tient la lueur du sac loin de l’or (B2.O4 : sac d’un Porteur à terre)', () => {
    expect(deltaE00(lab(PALETTE.chair.sacLueur), OR)).toBeGreaterThan(20)
    expect(deltaE00(lab(PALETTE.chair.sac), OR)).toBeGreaterThan(20)
  })

  it('choisit un marqueur de sonde absent de la palette du §17', () => {
    const m = lab(PALETTE.mesure.marqueur)
    for (const c of [PALETTE.ivoire.base, PALETTE.or.base, PALETTE.gris.cadaverique, PALETTE.rougeVif]) {
      expect(deltaE00(m, lab(c))).toBeGreaterThan(30)
    }
  })
})
