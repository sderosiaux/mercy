import { describe, expect, it } from 'vitest'
import type { Creature } from '../sim/index'
import { mannequin, scene } from '../sim/testing'
import { bodyClass, decalColor, greyMix, marksOf, pulse, rimOf, sacColor, telegraphColor, tone } from './look'
import { mixHex, PALETTE } from './palette'

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

  it('passe au gris en 0,3 s à partir du tick de la mort (L4), sauf un mort placé, déjà gris', () => {
    const killed = {
      ...c(2),
      state: { kind: 'mort', at: 200 },
      spawn: { ...(c(2).spawn as NonNullable<Creature['spawn']>) },
    } as Creature
    expect(greyMix(killed, 200)).toBe(0)
    expect(greyMix(killed, 209)).toBeCloseTo(0.5, 10)
    expect(greyMix(killed, 218)).toBe(1)
    expect(greyMix(killed, 900)).toBe(1)
    expect(greyMix(c(4), 0)).toBe(1)
    expect(greyMix(c(2), 50)).toBe(0)
  })

  it('ramène toute couleur vivante au gris cadavérique', () => {
    expect(tone(PALETTE.chair.souriant, 1)).toBe(PALETTE.gris.cadaverique)
    expect(tone(PALETTE.chair.souriantMasque, 1, 'clair')).toBe(PALETTE.gris.cadaveriqueClair)
    expect(tone(PALETTE.chair.souriant, 0)).toBe(PALETTE.chair.souriant)
  })

  it('dore les marques d’un Résistant vivant et les grise à sa mort (D13)', () => {
    expect(marksOf(c(3), 0)).toBe(PALETTE.or.base)
    expect(marksOf(c(3), 1)).toBe(PALETTE.gris.cadaverique)
    expect(marksOf(c(2), 0)).toBeNull()
  })
})

describe('couleur d’un télégraphe selon les ticks restants (§18)', () => {
  it('reste rouge brun jusqu’à 13 ticks de l’impact, rouge vif sur les 12 derniers', () => {
    expect(telegraphColor(54)).toBe(PALETTE.rougeBrun.telegraphe)
    expect(telegraphColor(13)).toBe(PALETTE.rougeBrun.telegraphe)
    expect(telegraphColor(12.5)).toBe(PALETTE.rougeBrun.telegraphe)
    expect(telegraphColor(12)).toBe(PALETTE.rougeVif)
    expect(telegraphColor(1)).toBe(PALETTE.rougeVif)
    expect(telegraphColor(0.2)).toBe(PALETTE.rougeVif)
  })
})

describe('autres couleurs porteuses de sens', () => {
  it('fait luire le sac selon son stade, rouge vif au stade 3', () => {
    expect(sacColor(0)).toBe(PALETTE.chair.sac)
    expect(sacColor(2)).toBe(PALETTE.chair.sacLueur)
    expect(sacColor(3)).toBe(PALETTE.rougeVif)
  })
  it('garde le sang frais rouge vif pendant 2 s, puis rouge brun', () => {
    expect(decalColor(0)).toBe(PALETTE.rougeVif)
    expect(decalColor(119)).toBe(PALETTE.rougeVif)
    expect(decalColor(120)).toBe(PALETTE.rougeBrun.sangAncien)
  })
})
