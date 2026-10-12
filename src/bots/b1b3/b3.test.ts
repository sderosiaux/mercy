// Politiques RET de B3 (B3.md §6) : prédicats ajoutés, R1 à R4, S3b, S5 réservée à frapper, ordre des règles.
import { describe, expect, it } from 'vitest'
import { inPorteurRearArc, type World } from '../../sim/index'
import { withCreature, withPlayer } from '../../sim/testing'
import { vec } from '../../sim/vec'
import { TRIEUR } from './b1'
import { RET_D, RET_U } from './b3'
import {
  abattuEn,
  auStade,
  commandes,
  enAction,
  hostileEn,
  membreDe,
  memesCommandes,
  monde,
  releveDans,
  rituelEn,
} from './fixtures'
import { dos, foule, stade } from './predicates'
import { type Doctrine, decide } from './skeleton'

const choix = (doc: Doctrine, w: World) => {
  const c = doc.choisir(w)
  return c === null ? null : { regle: c.regle, cible: c.cible.id, geste: c.geste }
}

// Le joueur est en (0 ; 0). Face au joueur : facing = −π/2 pour un Porteur placé en (0 ; z > 0).
const FACE = -Math.PI / 2
const DOS = Math.PI / 2

describe('prédicats ajoutés', () => {
  it('stade : clé absente → sac vide (0), sinon familyData.stade', () => {
    const w = monde(hostileEn('porteur', 0, 4))
    expect(stade(w.creatures[0] as World['creatures'][number])).toBe(0)
    expect(stade(auStade(w, 1, 2).creatures[0] as World['creatures'][number])).toBe(2)
  })
  it('dos : le prédicat de la simulation, inPorteurRearArc', () => {
    for (const facing of [FACE, DOS, 0, 2]) {
      const w = withCreature(monde(hostileEn('porteur', 0, 4)), 1, { facing })
      const q = w.creatures[0] as World['creatures'][number]
      expect(dos(w, q)).toBe(inPorteurRearArc(q, w.player.pos))
    }
    const face = withCreature(monde(hostileEn('porteur', 0, 4)), 1, { facing: FACE })
    const dans = withCreature(monde(hostileEn('porteur', 0, 4)), 1, { facing: DOS })
    expect(dos(face, face.creatures[0] as World['creatures'][number])).toBe(false)
    expect(dos(dans, dans.creatures[0] as World['creatures'][number])).toBe(true)
  })
  it('foule : petites créatures présentes, non Résistantes, autres que q, à 2 + stade m ou moins', () => {
    let w = monde(
      hostileEn('porteur', 0, 4),
      hostileEn('souriant', 3, 4), // à 3 m : dedans au stade 1
      rituelEn('souriant', -3, 4), // en Rituel : compte
      hostileEn('souriant', 0, 7.01), // à 3,01 m : dehors au stade 1
      abattuEn('souriant', 1, 4), // à terre : ne compte pas
      hostileEn('souriant', 0, 3, 3), // Résistant : ne compte pas
      hostileEn('recousu', 0, 5), // grand : ne compte pas
    )
    w = auStade(w, 1, 1)
    expect(foule(w, w.creatures[0] as World['creatures'][number])).toBe(2)
  })
})

describe('R1 : interrompre', () => {
  it('Chirurgien qui opère depuis LATENCE ticks → frapper, avant la créature debout', () => {
    const w = (depuis: number) =>
      enAction(
        monde(hostileEn('chirurgien', 0, 9), hostileEn('souriant', 0, 1)),
        1,
        'assembler',
        depuis,
        180 - depuis,
      )
    expect(choix(RET_D, w(15))).toEqual({ regle: 'R1', cible: 1, geste: 'frapper' })
    expect(choix(RET_D, w(14))).toEqual({ regle: 'T5', cible: 2, geste: 'frapper' })
    expect(choix(TRIEUR, w(15))?.regle).toBe('T5')
  })
  it('Confesseur à terre qui prie (vivant) → R1, avant R3', () => {
    const w = enAction(monde(abattuEn('confesseur', 0, 9), hostileEn('souriant', 0, 1)), 1, 'priere', 20, 130)
    expect(choix(RET_D, w)).toEqual({ regle: 'R1', cible: 1, geste: 'frapper' })
  })
  it('frapper : S5 charge si 4 < d ≤ 7 et Ferveur ≥ 35', () => {
    const w = withPlayer(
      enAction(monde(hostileEn('confesseur', 0, 6), hostileEn('souriant', 0, 1)), 1, 'priere', 15, 135),
      { ferveur: 35 },
    )
    const r = decide(RET_D, w)
    expect(r.regle).toBe('S5')
    memesCommandes(r.commands, commandes({ aim: vec(0, 6), rite: 'charge' }))
  })
  it('T1 et T2 passent avant R1', () => {
    const op = (w: World) => enAction(w, 1, 'assembler', 30, 150)
    expect(
      choix(RET_D, op(monde(hostileEn('chirurgien', 0, 9), abattuEn('souriant', 0, 9.5, 3))))?.regle,
    ).toBe('T1')
    const blesse = withPlayer(op(monde(hostileEn('chirurgien', 0, 9), abattuEn('souriant', 0, 5))), {
      vie: 40,
    })
    expect(choix(RET_D, blesse)?.regle).toBe('T2')
  })
})

describe('R2 : Porteur chargé', () => {
  // Porteur (id 1) en (0 ; 4) face au joueur, stade 2 (éclatement de 4 m) ; foule de 3 Souriants debout.
  const charge = (patch: { facing?: number; ferveur?: number; joueurZ?: number } = {}) => {
    let w = monde(
      hostileEn('porteur', 0, 4),
      hostileEn('souriant', 1, 4),
      hostileEn('souriant', -1, 4),
      hostileEn('souriant', 0, 5.5),
    )
    w = auStade(withCreature(w, 1, { facing: patch.facing ?? FACE }), 1, 2)
    return withPlayer(w, { ferveur: patch.ferveur ?? 35, pos: vec(0, patch.joueurZ ?? 0) })
  }

  it('RET-U, toutes les conditions → utiliser, S3b : Charge qui vise 1 m derrière le Porteur', () => {
    expect(choix(RET_U, charge())).toEqual({ regle: 'R2', cible: 1, geste: 'utiliser' })
    const r = decide(RET_U, charge())
    expect(r.regle).toBe('S3b')
    memesCommandes(r.commands, commandes({ move: vec(0, 1), aim: vec(0, 5), rite: 'charge' }))
  })
  it('RET-U, bornes U_MIN et U_MAX incluses', () => {
    expect(choix(RET_U, charge({ joueurZ: 1.5 }))?.geste).toBe('utiliser')
    expect(choix(RET_U, charge({ joueurZ: -2 }))?.geste).toBe('utiliser')
  })
  it.each([
    ['joueur dans le dos', { facing: DOS }],
    ['d < U_MIN', { joueurZ: 1.6 }],
    ['d > U_MAX', { joueurZ: -2.1 }],
    ['Ferveur < COUT_CHARGE', { ferveur: 34.9 }],
  ])('RET-U, %s → desamorcer', (_nom, patch) => {
    expect(choix(RET_U, charge(patch))).toEqual({ regle: 'R2', cible: 1, geste: 'desamorcer' })
  })
  it('RET-U, foule < FOULE_MIN → desamorcer (un Souriant hors du rayon, ou Résistant)', () => {
    const avec = (s: Parameters<typeof monde>[0]) =>
      withPlayer(
        auStade(
          withCreature(
            monde(hostileEn('porteur', 0, 4), hostileEn('souriant', 1, 4), hostileEn('souriant', -1, 4), s),
            1,
            { facing: FACE },
          ),
          1,
          2,
        ),
        { ferveur: 35 },
      )
    expect(choix(RET_U, avec(hostileEn('souriant', 0, 8.1)))?.geste).toBe('desamorcer')
    expect(choix(RET_U, avec(hostileEn('souriant', 0, 5.5, 3)))?.geste).toBe('desamorcer')
  })
  it('RET-D désamorce toujours', () => {
    expect(choix(RET_D, charge())).toEqual({ regle: 'R2', cible: 1, geste: 'desamorcer' })
  })
  it('stade 0 → pas R2', () => {
    const w = withCreature(monde(hostileEn('porteur', 0, 4), hostileEn('souriant', 0, 1)), 1, {
      facing: FACE,
    })
    expect(choix(RET_D, w)?.regle).toBe('T5')
  })
  it('desamorcer : jamais de Charge (S5 réservée à frapper), le trieur chargerait', () => {
    const w = withPlayer(
      auStade(withCreature(monde(hostileEn('porteur', 0, 5)), 1, { facing: FACE }), 1, 1),
      {
        ferveur: 35,
      },
    )
    const r = decide(RET_D, w)
    expect([r.regle, r.choix?.geste]).toEqual(['S6', 'desamorcer'])
    memesCommandes(r.commands, commandes({ move: vec(0, 1), aim: vec(0, 5) }))
    expect(decide(TRIEUR, w).regle).toBe('S5')
  })
  it("desamorcer : S4 s'applique", () => {
    let w = monde(hostileEn('porteur', 0, 2), hostileEn('souriant', 1, 0), hostileEn('souriant', -1, 0))
    w = withPlayer(auStade(withCreature(w, 1, { facing: FACE }), 1, 1), { ferveur: 25 })
    const r = decide(RET_D, w)
    expect([r.regle, r.choix?.regle, r.choix?.geste]).toEqual(['S4', 'R2', 'desamorcer'])
    memesCommandes(r.commands, commandes({ aim: vec(0, 2), rite: 'balayage' }))
  })
  it('R1 passe avant R2', () => {
    let w = monde(hostileEn('porteur', 0, 4), hostileEn('chirurgien', 0, 9))
    w = enAction(auStade(withCreature(w, 1, { facing: FACE }), 1, 1), 2, 'recoudre', 20, 160)
    expect(choix(RET_D, w)?.regle).toBe('R1')
  })
})

describe('R3 : supports à terre', () => {
  it('Porteur à terre → frapper, avant la créature debout ; le trieur frappe le debout', () => {
    const w = monde(abattuEn('porteur', 0, 5), hostileEn('souriant', 0, 1))
    expect(choix(RET_D, w)).toEqual({ regle: 'R3', cible: 1, geste: 'frapper' })
    expect(choix(TRIEUR, w)?.regle).toBe('T5')
  })
  it('R3 passe avant T3 et T4', () => {
    const w = releveDans(monde(abattuEn('confesseur', 0, 5), abattuEn('souriant', 0, 2)), 2, 30)
    expect(choix(RET_D, w)).toEqual({ regle: 'R3', cible: 1, geste: 'frapper' })
    expect(choix(TRIEUR, w)?.regle).toBe('T3')
  })
  it('R2 passe avant R3', () => {
    let w = monde(hostileEn('porteur', 0, 8), abattuEn('confesseur', 0, 5))
    w = auStade(withCreature(w, 1, { facing: FACE }), 1, 1)
    expect(choix(RET_D, w)?.regle).toBe('R2')
  })
})

describe('T3 et T4 passent avant R4', () => {
  it('corps au télégraphe, corps à portée', () => {
    const t3 = releveDans(monde(hostileEn('confesseur', 0, 9), abattuEn('souriant', 0, 3)), 2, 60)
    expect(choix(RET_D, t3)?.regle).toBe('T3')
    expect(choix(RET_D, monde(hostileEn('confesseur', 0, 9), abattuEn('souriant', 0, 2)))?.regle).toBe('T4')
  })
})

describe('R4 : munitions et Confesseurs', () => {
  const S = hostileEn('souriant', 0, -2.5) // créature debout la plus proche, cible de T5 sans R4

  it("corps à R_PRIERE ou moins d'un Confesseur vivant → ce corps, plus proche que le Confesseur", () => {
    const w = monde(hostileEn('confesseur', 0, 10), abattuEn('souriant', 0, 3), S)
    expect(choix(RET_D, w)).toEqual({ regle: 'R4', cible: 2, geste: 'frapper' })
    expect(choix(RET_U, w)).toEqual({ regle: 'R4', cible: 2, geste: 'frapper' })
    expect(choix(TRIEUR, w)).toEqual({ regle: 'T5', cible: 3, geste: 'frapper' })
    expect(choix(RET_D, monde(hostileEn('confesseur', 0, 10), abattuEn('souriant', 0, 2.3), S))?.cible).toBe(
      2,
    ) // 7,7 m
  })
  it('corps à plus de R_PRIERE → pas une munition ; C retient le Confesseur', () => {
    const w = monde(hostileEn('confesseur', 0, 10), abattuEn('souriant', 0, -3), S)
    expect(choix(RET_D, w)).toEqual({ regle: 'R4', cible: 1, geste: 'frapper' })
  })
  it('C : Confesseur debout ou en Rituel → frapper, avant la créature debout plus proche', () => {
    expect(choix(RET_D, monde(hostileEn('confesseur', 0, 9), S))).toEqual({
      regle: 'R4',
      cible: 1,
      geste: 'frapper',
    })
    expect(choix(RET_D, monde(rituelEn('confesseur', 0, 9), S))).toEqual({
      regle: 'R4',
      cible: 1,
      geste: 'frapper',
    })
  })
  it("Chirurgien présent : deux corps à R_ASSEMBLAGE ou moins l'un de l'autre", () => {
    const avec = (x2: number) =>
      monde(rituelEn('chirurgien', 10, 10), abattuEn('souriant', 0, 3), abattuEn('souriant', x2, 3), S)
    expect(choix(RET_D, avec(2))).toEqual({ regle: 'R4', cible: 2, geste: 'frapper' })
    expect(choix(RET_U, avec(2))?.regle).toBe('R4')
    expect(choix(RET_D, avec(2.1))?.regle).toBe('T5')
    expect(choix(RET_D, monde(abattuEn('souriant', 0, 3), abattuEn('souriant', 1.5, 3), S))?.regle).toBe('T5')
  })
  it('Chirurgien présent : Recousu à terre ou Membre errant', () => {
    const recousu = monde(rituelEn('chirurgien', 10, 10), abattuEn('recousu', 0, 4), S)
    expect(choix(RET_D, recousu)).toEqual({ regle: 'R4', cible: 2, geste: 'frapper' })
    expect(choix(RET_D, monde(abattuEn('recousu', 0, 4), S))?.regle).toBe('T5')
    const membre = membreDe(
      monde(rituelEn('chirurgien', 10, 10), abattuEn('membre', 0, 4), hostileEn('recousu', 8, 8), S),
      2,
      3,
    )
    expect(choix(RET_D, membre)).toEqual({ regle: 'R4', cible: 2, geste: 'frapper' })
  })
  it("RET-D seulement : corps à R_ABSORPTION ou moins d'un Porteur de stade < 3", () => {
    const w = (z: number) =>
      withCreature(monde(hostileEn('porteur', 0, 8), abattuEn('souriant', 0, z), S), 1, { facing: FACE })
    expect(choix(RET_D, w(3.9))).toEqual({ regle: 'R4', cible: 2, geste: 'frapper' })
    expect(choix(RET_U, w(3.9))).toEqual({ regle: 'T5', cible: 3, geste: 'frapper' })
    expect(choix(RET_D, w(3.7))?.regle).toBe('T5')
  })
  it('proche(M ∪ C) : à égale distance, le plus petit id, même quand M précède C', () => {
    // Confesseur (id 1) et corps (id 2) tous deux à 5 m ; le corps est à 7,07 m du Confesseur.
    const w = monde(hostileEn('confesseur', 0, 5), abattuEn('souriant', 5, 0), S)
    expect(choix(RET_D, w)).toEqual({ regle: 'R4', cible: 1, geste: 'frapper' })
  })
  it('M ∪ C vide → T5 à T8 du trieur', () => {
    expect(choix(RET_D, monde(S))).toEqual({ regle: 'T5', cible: 1, geste: 'frapper' })
    expect(choix(RET_D, monde(abattuEn('souriant', 0, 12)))?.regle).toBe('T6')
    expect(choix(RET_D, monde(rituelEn('souriant', 0, 12)))?.regle).toBe('T7')
    expect(choix(RET_D, monde())).toBeNull()
  })
})
