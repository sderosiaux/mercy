// Politiques de B1 (B1.md §6) : debout D1 à D4, trieur T1 à T8, nettoyeur N3, prédicat imminent.
import { describe, expect, it } from 'vitest'
import type { World } from '../../sim/index'
import { withPlayer } from '../../sim/testing'
import { DEBOUT, NETTOYEUR, TRIEUR } from './b1'
import { abattuEn, hostileEn, membreDe, monde, releveDans, rituelEn } from './fixtures'
import type { Doctrine } from './skeleton'
import { decide } from './skeleton'

// Règle de choisir() qui a tranché, cible, geste.
const choix = (doc: Doctrine, w: World) => {
  const c = doc.choisir(w)
  return c === null ? null : { regle: c.regle, cible: c.cible.id, geste: c.geste }
}

describe('debout', () => {
  it('D1 : la créature debout la plus proche, même avec un corps plus près', () => {
    const w = monde(hostileEn('souriant', 0, 5), abattuEn('souriant', 0, 1))
    expect(choix(DEBOUT, w)).toEqual({ regle: 'D1', cible: 1, geste: 'frapper' })
  })
  it('D1 : un support debout se frappe comme une autre créature debout', () => {
    const w = monde(hostileEn('souriant', 0, 5), hostileEn('confesseur', 0, 3))
    expect(choix(DEBOUT, w)).toEqual({ regle: 'D1', cible: 2, geste: 'frapper' })
  })
  it('D1 : ne sentencie jamais un ordinaire, même blessé', () => {
    const w = withPlayer(monde(hostileEn('souriant', 0, 5), abattuEn('souriant', 0, 1)), { vie: 10 })
    expect(choix(DEBOUT, w)).toEqual({ regle: 'D1', cible: 1, geste: 'frapper' })
  })
  it("D2 : plus rien debout → le corps le plus proche, Sentence s'il est doré", () => {
    expect(choix(DEBOUT, monde(abattuEn('souriant', 0, 3), abattuEn('souriant', 0, 4, 3)))).toEqual({
      regle: 'D2',
      cible: 1,
      geste: 'frapper',
    })
    expect(choix(DEBOUT, monde(abattuEn('souriant', 0, 5), abattuEn('souriant', 0, 4, 3)))).toEqual({
      regle: 'D2',
      cible: 2,
      geste: 'sentencier',
    })
  })
  it('D3 : seulement des créatures en Rituel', () => {
    expect(choix(DEBOUT, monde(rituelEn('souriant', 0, 8)))).toEqual({
      regle: 'D3',
      cible: 1,
      geste: 'frapper',
    })
  })
  it('D4 : rien → ∅, IDLE_COMMANDS par S2', () => {
    expect(choix(DEBOUT, monde())).toBeNull()
    expect(decide(DEBOUT, monde()).regle).toBe('S2')
  })
})

describe('trieur', () => {
  it('T1 : doré à R_DORE ou moins → Sentence, avant tout le reste', () => {
    const w = withPlayer(
      monde(abattuEn('souriant', 0, 10, 3), hostileEn('souriant', 0, 1), abattuEn('souriant', 1, 0)),
      {
        vie: 10,
      },
    )
    expect(choix(TRIEUR, w)).toEqual({ regle: 'T1', cible: 1, geste: 'sentencier' })
  })
  it('T1 : doré à 10,5 m → pas T1', () => {
    const w = monde(abattuEn('souriant', 0, 10.5, 3), hostileEn('souriant', 0, 1))
    expect(choix(TRIEUR, w)?.regle).toBe('T5')
  })
  it("T2 : Vie < 50 → Sentence sur l'ordinaire le plus proche à R_TRI ou moins", () => {
    const scene = monde(abattuEn('souriant', 0, 6), hostileEn('souriant', 0, 1))
    expect(choix(TRIEUR, withPlayer(scene, { vie: 49 }))).toEqual({
      regle: 'T2',
      cible: 1,
      geste: 'sentencier',
    })
    expect(choix(TRIEUR, withPlayer(scene, { vie: 50 }))?.regle).toBe('T5')
    const loin = monde(abattuEn('souriant', 0, 6.1), hostileEn('souriant', 0, 1))
    expect(choix(TRIEUR, withPlayer(loin, { vie: 49 }))?.regle).toBe('T5')
  })
  it('T3 : corps au télégraphe de Relèvement (riseAt − t ≤ 90) à R_TRI ou moins → frapper', () => {
    const w = (dans: number, z = 5) =>
      releveDans(monde(abattuEn('souriant', 0, z), hostileEn('souriant', 0, 1)), 1, dans)
    expect(choix(TRIEUR, w(90))).toEqual({ regle: 'T3', cible: 1, geste: 'frapper' })
    expect(choix(TRIEUR, w(91))?.regle).toBe('T5')
    expect(choix(TRIEUR, w(90, 6.1))?.regle).toBe('T5')
  })
  it('T3 : riseAt nul (ne se relève pas seul) → pas imminent', () => {
    expect(
      choix(TRIEUR, releveDans(monde(abattuEn('souriant', 0, 5), hostileEn('souriant', 0, 1)), 1, null))
        ?.regle,
    ).toBe('T5')
  })
  it('T3 : Membre errant à 3 m ou moins de son propriétaire → imminent', () => {
    // Membre (id 1) en (0 ; 4), propriétaire Recousu (id 2), Souriant debout (id 3) en (0 ; 1).
    const w = (ownerZ: number) =>
      membreDe(
        monde(abattuEn('membre', 0, 4), hostileEn('recousu', 0, ownerZ), hostileEn('souriant', 0, 1)),
        1,
        2,
      )
    expect(choix(TRIEUR, w(7))).toEqual({ regle: 'T3', cible: 1, geste: 'frapper' })
    expect(choix(TRIEUR, w(7.1))?.regle).toBe('T5')
  })
  it('T4 : ordinaire à PORTEE ou moins → frapper, avant la créature debout', () => {
    expect(choix(TRIEUR, monde(abattuEn('souriant', 0, 2.2), hostileEn('souriant', 0, 1)))).toEqual({
      regle: 'T4',
      cible: 1,
      geste: 'frapper',
    })
    expect(choix(TRIEUR, monde(abattuEn('souriant', 0, 2.3), hostileEn('souriant', 0, 1)))?.regle).toBe('T5')
  })
  it('T5 : la créature debout la plus proche, égalité → plus petit id', () => {
    expect(choix(TRIEUR, monde(hostileEn('souriant', 3, 0), hostileEn('souriant', 0, 3)))).toEqual({
      regle: 'T5',
      cible: 1,
      geste: 'frapper',
    })
    expect(choix(TRIEUR, monde(hostileEn('souriant', 3, 0), hostileEn('souriant', 0, 2.9)))?.cible).toBe(2)
  })
  it("T6 : plus rien debout → le corps le plus proche, à toute distance ; Sentence s'il est doré", () => {
    expect(choix(TRIEUR, monde(abattuEn('souriant', 0, 12)))).toEqual({
      regle: 'T6',
      cible: 1,
      geste: 'frapper',
    })
    expect(choix(TRIEUR, monde(abattuEn('souriant', 0, 12, 3)))).toEqual({
      regle: 'T6',
      cible: 1,
      geste: 'sentencier',
    })
  })
  it('T7 : seulement des créatures en Rituel', () => {
    expect(choix(TRIEUR, monde(rituelEn('souriant', 0, 8)))).toEqual({
      regle: 'T7',
      cible: 1,
      geste: 'frapper',
    })
  })
  it('T8 : rien → ∅', () => {
    expect(choix(TRIEUR, monde())).toBeNull()
  })
  it('aucune priorité de support : un support à terre est un corps, debout une créature debout', () => {
    const w = monde(abattuEn('porteur', 0, 5), hostileEn('confesseur', 0, 9), hostileEn('souriant', 0, 3))
    expect(choix(TRIEUR, w)).toEqual({ regle: 'T5', cible: 3, geste: 'frapper' })
  })
})

describe('nettoyeur', () => {
  it("N3 : l'ordinaire le plus proche, à toute distance, avant la créature debout", () => {
    const w = monde(abattuEn('souriant', 0, 12), hostileEn('souriant', 0, 1))
    expect(choix(NETTOYEUR, w)).toEqual({ regle: 'N3', cible: 1, geste: 'frapper' })
    expect(choix(TRIEUR, w)?.regle).toBe('T5')
  })
  it('N3 vient après T1 et T2', () => {
    expect(choix(NETTOYEUR, monde(abattuEn('souriant', 0, 1), abattuEn('souriant', 0, 9, 3)))?.regle).toBe(
      'T1',
    )
    expect(choix(NETTOYEUR, withPlayer(monde(abattuEn('souriant', 0, 5)), { vie: 40 }))?.regle).toBe('T2')
  })
  it('T5 à T8 inchangées', () => {
    expect(choix(NETTOYEUR, monde(hostileEn('souriant', 0, 3)))?.regle).toBe('T5')
    expect(choix(NETTOYEUR, monde(abattuEn('souriant', 0, 12, 3), hostileEn('souriant', 14, 0)))?.regle).toBe(
      'T5',
    )
    expect(choix(NETTOYEUR, monde(abattuEn('souriant', 0, 12, 3)))?.regle).toBe('T6')
    expect(choix(NETTOYEUR, monde(rituelEn('souriant', 0, 3)))?.regle).toBe('T7')
    expect(choix(NETTOYEUR, monde())).toBeNull()
  })
})
