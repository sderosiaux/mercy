// B3 : monde, joueur, armes, Ferveur, Esquive (§6, §8.1, §8.3, §8.5).
import { describe, expect, it } from 'vitest'
import { cmd, creature, ofType, poteau, run, scene, withPlayer } from './testing'
import { TUNING } from './tuning'
import { vec } from './vec'

const strike = cmd({ strike: true, aim: vec(5, 0) })

describe('Frappe et armes', () => {
  it('Couperet : coups à 0, 21 et 42 ticks, dégâts 12, 12, 18', () => {
    const w = scene([{ family: 'confesseur', pos: vec(1.5, 0), state: 'rituel' }], {
      families: { confesseur: poteau },
    })
    const big = { ...w, creatures: w.creatures.map((c) => ({ ...c, chair: 500, chairMax: 500 })) }
    const { events } = run(big, 43, strike)
    const hits = ofType(events, 'hit').filter((e) => e.by === 'player')
    expect(hits.map((h) => h.tick - (hits[0]?.tick ?? 0))).toEqual([0, 21, 42])
    expect(hits.map((h) => h.amount)).toEqual([12, 12, 18])
    expect(hits.every((h) => h.damageType === 'tranchant')).toBe(true)
  })

  it('Masse : coups à 0, 33 et 66 ticks, dégâts 20, 20, 30, recul de 3 m au 3e', () => {
    const w0 = scene([{ family: 'confesseur', pos: vec(1.5, 0), state: 'rituel' }], {
      families: { confesseur: poteau },
    })
    const w = withPlayer(
      { ...w0, creatures: w0.creatures.map((c) => ({ ...c, chair: 500, chairMax: 500 })) },
      { weapon: 'masse' },
    )
    const before = run(w, 66, strike)
    const after = run(w, 67, strike)
    const hits = ofType(after.events, 'hit').filter((e) => e.by === 'player')
    expect(hits.map((h) => h.tick - (hits[0]?.tick ?? 0))).toEqual([0, 33, 66])
    expect(hits.map((h) => h.amount)).toEqual([20, 20, 30])
    const xBefore = creature(before.world, 1).pos.x
    expect(creature(after.world, 1).pos.x - xBefore).toBeCloseTo(3, 5)
  })

  it("touche dans l'arc et la portée, pas au-delà", () => {
    const w = scene([
      { family: 'souriant', pos: vec(2.1, 0), state: 'rituel' },
      { family: 'souriant', pos: vec(2.7, 0), state: 'rituel' },
      { family: 'souriant', pos: vec(0, -2), state: 'rituel' },
    ])
    const { events } = run(w, 1, strike)
    const touched = ofType(events, 'hit').map((h) => h.target)
    expect(touched).toEqual([1])
  })

  it('la combinaison repart à zéro si on relâche la frappe', () => {
    const w0 = scene([{ family: 'confesseur', pos: vec(1.5, 0), state: 'rituel' }], {
      families: { confesseur: poteau },
    })
    const w = { ...w0, creatures: w0.creatures.map((c) => ({ ...c, chair: 500, chairMax: 500 })) }
    const first = run(w, 22, strike) // deux coups : étapes 0 et 1
    const pause = run(first.world, 30, cmd({ aim: vec(5, 0) }))
    const again = run(pause.world, 1, strike)
    expect(ofType(again.events, 'hit')[0]?.amount).toBe(12)
    expect(again.world.player.action?.comboStep).toBe(0)
  })
})

describe('Ferveur', () => {
  it('+2 par créature touchée, plafond +6 par coup', () => {
    const spawns = [0, 1, 2, 3].map((i) => ({
      family: 'souriant' as const,
      pos: vec(1.2, -0.6 + i * 0.4),
      state: 'rituel' as const,
      cicatrices: 3 as const,
    }))
    const w0 = scene(spawns)
    const w = { ...w0, creatures: w0.creatures.map((c) => ({ ...c, chair: 500, chairMax: 500 })) }
    const { world } = run(w, 1, strike)
    expect(world.player.ferveur).toBe(6)
  })

  it('ne baisse pas pendant 4 s, puis perd 10 par seconde', () => {
    const w = withPlayer(scene([]), { ferveur: 50, lastFerveurGain: 0 })
    expect(run(w, TUNING.ferveur.decayDelay, cmd()).world.player.ferveur).toBe(50)
    expect(run(w, TUNING.ferveur.decayDelay + 60, cmd()).world.player.ferveur).toBeCloseTo(40, 5)
  })
})

describe('Esquive', () => {
  it('parcourt 4 m, invulnérable 18 ticks, 2 charges, recharge de 90 ticks par charge', () => {
    const w = scene([])
    const d1 = run(w, 1, cmd({ dodge: true, move: vec(1, 0) }))
    expect(d1.world.player.dodgeCharges).toBe(1)
    expect(d1.world.player.invulnerableUntil).toBe(d1.world.tick + TUNING.dodge.iframes)
    const done = run(d1.world, TUNING.dodge.duration, cmd({ move: vec(1, 0) }))
    expect(done.world.player.pos.x).toBeCloseTo(4 + TUNING.playerSpeed / 60, 5)
    const d2 = run(done.world, 1, cmd({ dodge: true, move: vec(0, 1) }))
    expect(d2.world.player.dodgeCharges).toBe(0)
    const d3 = run(d2.world, 1, cmd({ dodge: true, move: vec(0, 1) }))
    expect(ofType(d3.events, 'player-dodge')).toHaveLength(0)
    const recharged = run(d1.world, TUNING.dodge.recharge, cmd())
    expect(recharged.world.player.dodgeCharges).toBe(2)
  })

  it('esquive parfaite : une attaque qui aurait touché dans les 12 premiers ticks donne +10 Ferveur', async () => {
    const { mannequin } = await import('./testing')
    const w = scene([{ family: 'recousu', pos: vec(2, 0), state: 'hostile' }], {
      families: { recousu: mannequin() },
    })
    // Un Hostile placé décide après le pivot de 24 ticks, puis télégraphie 54 ticks : impact au tick 24 + 54.
    const impactTick = 24 + 54
    const until = run(w, impactTick - 7, cmd())
    const dodged = run(until.world, 1, cmd({ dodge: true, move: vec(0, 1) }))
    const rest = run(dodged.world, 10, cmd())
    const all = [...dodged.events, ...rest.events]
    expect(ofType(all, 'player-perfect-dodge')).toHaveLength(1)
    expect(ofType(all, 'hit').filter((h) => h.target === 'player')).toHaveLength(0)
    expect(rest.world.player.ferveur).toBe(10)
  })
})

describe('Rites', () => {
  it('Balayage : refusé sous 25 de Ferveur ; sinon 360°, 4 m, 25 dégâts, coût 25', () => {
    const spawns = [vec(3.5, 0), vec(-3.5, 0), vec(0, 4.5)].map((pos) => ({
      family: 'souriant' as const,
      pos,
      state: 'rituel' as const,
    }))
    const poor = withPlayer(scene(spawns), { ferveur: 24 })
    expect(ofType(run(poor, 1, cmd({ rite: 'balayage' })).events, 'player-rite')).toHaveLength(0)
    const rich = withPlayer(scene(spawns), { ferveur: 30 })
    const r = run(rich, 1, cmd({ rite: 'balayage' }))
    expect(ofType(r.events, 'player-rite')[0]?.rite).toBe('balayage')
    const hits = ofType(r.events, 'hit')
    expect(hits.map((h) => h.target).sort()).toEqual([1, 2])
    expect(hits.every((h) => h.amount === 25)).toBe(true)
    expect(r.world.player.ferveur).toBe(30 - 25) // §8.3 : le +2 par créature ne vaut que pour la Frappe
  })

  it('Charge : 7 m en 21 ticks, 30 dégâts sur la ligne, poussée latérale de 2 m, traverse', () => {
    const w = withPlayer(
      scene([
        { family: 'souriant', pos: vec(3, 0.3), state: 'rituel', cicatrices: 3 },
        { family: 'souriant', pos: vec(5, 3), state: 'rituel' },
      ]),
      { ferveur: 40 },
    )
    const big = {
      ...w,
      creatures: w.creatures.map((c) => (c.id === 1 ? { ...c, chair: 500, chairMax: 500 } : c)),
    }
    const r = run(big, 21, cmd({ rite: 'charge', aim: vec(10, 0) }))
    expect(r.world.player.pos.x).toBeCloseTo(7, 5)
    const hits = ofType(r.events, 'hit')
    expect(hits.map((h) => [h.target, h.amount])).toEqual([[1, 30]])
    expect(creature(r.world, 1).pos.z).toBeCloseTo(0.3 + 2, 5)
    expect(r.world.player.ferveur).toBe(40 - 35)
  })
})

describe("Changement d'arme", () => {
  it('refusé si une créature Hostile est à moins de 15 m', () => {
    const near = scene([{ family: 'souriant', pos: vec(14, 0), state: 'hostile' }])
    expect(run(near, 1, cmd({ swapWeapon: true })).world.player.weapon).toBe('couperet')
    const far = scene([{ family: 'souriant', pos: vec(14, 14), state: 'hostile' }])
    expect(run(far, 1, cmd({ swapWeapon: true })).world.player.weapon).toBe('masse')
  })
})
