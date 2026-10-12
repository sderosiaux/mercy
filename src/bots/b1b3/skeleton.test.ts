// Squelette S0 à S6 (B1.md §6) et S3b (B3.md §6) : une situation construite par règle, commande attendue.
import { describe, expect, it } from 'vitest'
import { IDLE_COMMANDS, sentenceTarget, TUNING } from '../../sim/index'
import { withPlayer } from '../../sim/testing'
import { vec } from '../../sim/vec'
import { DEBOUT, TRIEUR } from './b1'
import { abattuEn, commandes, enAction, hostileEn, memesCommandes, monde, mortEn, rituelEn } from './fixtures'
import { decide } from './skeleton'

describe('S0 : action en cours autre que la Frappe', () => {
  it.each(['esquive', 'sentence', 'balayage', 'charge'] as const)('%s → IDLE_COMMANDS', (kind) => {
    const w = withPlayer(monde(hostileEn('souriant', 0, 1)), { action: { kind, start: 0, end: 30 } })
    expect(decide(TRIEUR, w)).toEqual({ commands: IDLE_COMMANDS, regle: 'S0', choix: null })
  })
  it('pendant une Frappe, le squelette continue', () => {
    const w = withPlayer(monde(hostileEn('souriant', 0, 1)), {
      action: { kind: 'frappe', start: 0, end: 21, comboStep: 0 },
    })
    expect(decide(TRIEUR, w).regle).toBe('S6')
  })
})

describe('S1 : esquive', () => {
  // Souriant debout en (0 ; 2), morsure commencée il y a 15 ticks, impact dans 12.
  const base = (depuis = 15, impactDans = 12) =>
    enAction(monde(hostileEn('souriant', 0, 2)), 1, 'morsure', depuis, impactDans)

  it("menace : loin de l'attaquant, aim = P + dir, dodge", () => {
    const r = decide(TRIEUR, base())
    expect(r.regle).toBe('S1')
    memesCommandes(r.commands, commandes({ move: vec(0, -1), aim: vec(0, -1), dodge: true }))
  })
  it('LATENCE : t − début = 14 ne suffit pas', () => {
    expect(decide(TRIEUR, base(14, 12)).regle).not.toBe('S1')
  })
  it('AVANCE_ESQ : impact dans 13 ticks trop tôt, dans 0 tick trop tard, dans 1 tick encore valable', () => {
    expect(decide(TRIEUR, base(15, 13)).regle).not.toBe('S1')
    expect(decide(TRIEUR, base(30, 0)).regle).not.toBe('S1')
    expect(decide(TRIEUR, base(30, 1)).regle).toBe('S1')
  })
  it("aucune charge d'esquive → pas d'esquive", () => {
    expect(decide(TRIEUR, withPlayer(base(), { dodgeCharges: 0 })).regle).not.toBe('S1')
  })
  it('RAYON_ESQ : 3,5 m pour un petit attaquant, 6 m pour un grand', () => {
    const petit = (z: number) => enAction(monde(hostileEn('souriant', 0, z)), 1, 'morsure', 15, 12)
    expect(decide(TRIEUR, petit(3.5)).regle).toBe('S1')
    expect(decide(TRIEUR, petit(3.6)).regle).not.toBe('S1')
    const grand = (z: number) => enAction(monde(hostileEn('recousu', 0, z)), 1, 'marteau', 42, 12)
    expect(decide(TRIEUR, grand(6)).regle).toBe('S1')
    expect(decide(TRIEUR, grand(6.1)).regle).not.toBe('S1')
  })
  it("une canalisation n'est pas une attaque", () => {
    const w = enAction(monde(hostileEn('confesseur', 0, 2)), 1, 'priere', 140, 10)
    expect(decide(TRIEUR, w).regle).not.toBe('S1')
  })
  it('seul un attaquant debout menace', () => {
    const w = enAction(monde(rituelEn('souriant', 0, 2)), 1, 'morsure', 15, 12)
    expect(decide(TRIEUR, w).regle).not.toBe('S1')
  })
  it('proche(menaces) : plus petite distance, égalité → plus petit id', () => {
    let w = monde(hostileEn('souriant', 2, 0), hostileEn('souriant', 0, 2))
    w = enAction(enAction(w, 1, 'morsure', 15, 12), 2, 'morsure', 15, 12)
    memesCommandes(decide(TRIEUR, w).commands, commandes({ move: vec(-1, 0), aim: vec(-1, 0), dodge: true }))
    let v = monde(hostileEn('souriant', 3, 0), hostileEn('souriant', 0, 2))
    v = enAction(enAction(v, 1, 'morsure', 15, 12), 2, 'morsure', 15, 12)
    memesCommandes(decide(TRIEUR, v).commands, commandes({ move: vec(0, -1), aim: vec(0, -1), dodge: true }))
  })
  it('P = a.pos → dir = (1, 0)', () => {
    const w = enAction(monde(hostileEn('souriant', 0, 0)), 1, 'morsure', 15, 12)
    memesCommandes(decide(TRIEUR, w).commands, commandes({ move: vec(1, 0), aim: vec(1, 0), dodge: true }))
  })
  it("bord de l'arène : +90°, puis −90°, puis la direction d'origine", () => {
    const h = TUNING.arenaHalf
    const cas = (px: number, pz: number, ax: number, az: number) =>
      decide(
        TRIEUR,
        withPlayer(enAction(monde(hostileEn('souriant', ax, az)), 1, 'morsure', 15, 12), {
          pos: vec(px, pz),
        }),
      ).commands.move
    // (1, 0) sort ; tourné de +90° : (0, 1) reste dedans.
    const plus = cas(h - 0.5, 0, h - 1.5, 0)
    expect(plus.x).toBeCloseTo(0, 12)
    expect(plus.z).toBeCloseTo(1, 12)
    // Coin : (1, 0) et (0, 1) sortent ; (0, −1) reste dedans.
    const moins = cas(h - 0.5, h - 0.5, h - 1.5, h - 0.5)
    expect(moins.x).toBeCloseTo(0, 12)
    expect(moins.z).toBeCloseTo(-1, 12)
    // Coin, attaque en diagonale : les trois directions sortent → direction d'origine.
    const origine = cas(h - 0.5, h - 0.5, h - 1.5, h - 1.5)
    expect(origine.x).toBeCloseTo(Math.SQRT1_2, 12)
    expect(origine.z).toBeCloseTo(Math.SQRT1_2, 12)
  })
})

describe('S2 : aucune cible', () => {
  it('arène vide ou morts seulement → IDLE_COMMANDS', () => {
    expect(decide(TRIEUR, monde())).toEqual({ commands: IDLE_COMMANDS, regle: 'S2', choix: null })
    expect(decide(TRIEUR, monde(mortEn('souriant', 0, 1)))).toEqual({
      commands: IDLE_COMMANDS,
      regle: 'S2',
      choix: null,
    })
  })
})

describe('S3 : sentencier', () => {
  it('d ≤ ARRET_F → sentence, et la Sentence de la simulation vise bien ce corps', () => {
    for (const z of [1.5, 2.0]) {
      const w = monde(abattuEn('souriant', 0, z, 3))
      const r = decide(TRIEUR, w)
      expect(r.regle).toBe('S3')
      memesCommandes(r.commands, commandes({ aim: vec(0, z), sentence: true }))
      expect(sentenceTarget(w, r.commands.aim)).toBe(1)
    }
  })
  it('d > ARRET_F → marche vers le corps', () => {
    const r = decide(TRIEUR, monde(abattuEn('souriant', 0, 2.1, 3)))
    expect(r.regle).toBe('S3')
    memesCommandes(r.commands, commandes({ move: vec(0, 1), aim: vec(0, 2.1) }))
  })
})

describe('S4 : Balayage', () => {
  const trois = () =>
    monde(hostileEn('souriant', 0, 1), hostileEn('souriant', 2, 0), hostileEn('souriant', -4, 0))
  it("Ferveur ≥ 25 et 3 créatures d'intérêt à 4 m ou moins", () => {
    const r = decide(TRIEUR, withPlayer(trois(), { ferveur: 25 }))
    expect(r.regle).toBe('S4')
    memesCommandes(r.commands, commandes({ aim: vec(0, 1), rite: 'balayage' }))
  })
  it('Ferveur 24,9 → S6', () => {
    expect(decide(TRIEUR, withPlayer(trois(), { ferveur: 24.9 })).regle).toBe('S6')
  })
  it('troisième créature à 4,01 m → S6', () => {
    const w = monde(hostileEn('souriant', 0, 1), hostileEn('souriant', 2, 0), hostileEn('souriant', -4.01, 0))
    expect(decide(TRIEUR, withPlayer(w, { ferveur: 25 })).regle).toBe('S6')
  })
  it('interet() : le trieur compte les corps ordinaires, debout non', () => {
    const w = withPlayer(
      monde(hostileEn('souriant', 0, 1), abattuEn('souriant', 1, 0), abattuEn('souriant', -1, 0)),
      { ferveur: 25 },
    )
    const t = decide(TRIEUR, w)
    expect([t.regle, t.choix?.regle]).toEqual(['S4', 'T4'])
    const d = decide(DEBOUT, w)
    expect([d.regle, d.choix?.regle]).toEqual(['S6', 'D1'])
  })
})

describe('S5 : Charge', () => {
  const cible = (z: number, ferveur = 35) => withPlayer(monde(hostileEn('souriant', 0, z)), { ferveur })
  it('Ferveur ≥ 35 et 4 < d ≤ 7', () => {
    for (const z of [4.01, 7]) {
      const r = decide(TRIEUR, cible(z))
      expect(r.regle).toBe('S5')
      memesCommandes(r.commands, commandes({ aim: vec(0, z), rite: 'charge' }))
    }
  })
  it('d = 4, d = 7,01 ou Ferveur 34 → S6', () => {
    expect(decide(TRIEUR, cible(4)).regle).toBe('S6')
    expect(decide(TRIEUR, cible(7.01)).regle).toBe('S6')
    expect(decide(TRIEUR, cible(5, 34)).regle).toBe('S6')
  })
})

describe('S6 : approche et Frappe', () => {
  const at = (z: number) => decide(TRIEUR, monde(hostileEn('souriant', 0, z))).commands
  it('d ≤ ARRET : immobile, frappe', () => {
    memesCommandes(at(1.5), commandes({ aim: vec(0, 1.5), strike: true }))
    memesCommandes(at(1.7), commandes({ aim: vec(0, 1.7), strike: true }))
  })
  it('ARRET < d ≤ PORTEE : avance et frappe', () => {
    memesCommandes(at(2.0), commandes({ move: vec(0, 1), aim: vec(0, 2), strike: true }))
    memesCommandes(at(2.2), commandes({ move: vec(0, 1), aim: vec(0, 2.2), strike: true }))
  })
  it('d > PORTEE : avance sans frapper', () => {
    memesCommandes(at(3), commandes({ move: vec(0, 1), aim: vec(0, 3) }))
  })
})
