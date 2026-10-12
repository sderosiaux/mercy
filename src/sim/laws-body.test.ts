// B5 : L3 Relèvement et Cicatrices, L5 Union, anatomie des membres (§7, §8.4).
import { describe, expect, it } from 'vitest'
import { cmd, creature, mannequin, ofType, run, scene, withCreature, withPlayer } from './testing'
import type { World } from './types'
import { vec } from './vec'

const FAR = vec(-12, -12)

describe('L3 Relèvement et Cicatrices', () => {
  it('ordinaire : télégraphe à t+270, relèvement à t+360, +1 Cicatrice, Chair ×1,5 et pleine', () => {
    const w = scene([{ family: 'souriant', pos: vec(0, 0), state: 'abattu' }], { playerStart: FAR })
    const { events, world } = run(w, 360)
    expect(ofType(events, 'rise-telegraph')[0]?.tick).toBe(270)
    const rise = ofType(events, 'rise')[0]
    expect(rise?.tick).toBe(360)
    expect(rise?.cause).toBe('delai')
    const s = creature(world, 1)
    expect(s.cicatrices).toBe(1)
    expect(s.chairMax).toBe(30)
    expect(s.chair).toBe(30)
    expect(s.state.kind).toBe('hostile')
  })

  it('Résistant : se relève au bout de 480 ticks', () => {
    const w = scene([{ family: 'souriant', pos: vec(0, 0), state: 'abattu', cicatrices: 3 }], {
      playerStart: FAR,
    })
    expect(ofType(run(w, 480).events, 'rise')[0]?.tick).toBe(480)
  })

  it('la 3e Cicatrice rend Résistant ; au-delà, plus de croissance', () => {
    const two = scene([{ family: 'souriant', pos: vec(0, 0), state: 'abattu', cicatrices: 2 }], {
      playerStart: FAR,
    })
    const third = creature(run(two, 360).world, 1)
    expect(third.cicatrices).toBe(3)
    expect(third.resistant).toBe(true)
    const three = scene([{ family: 'souriant', pos: vec(0, 0), state: 'abattu', cicatrices: 3 }], {
      playerStart: FAR,
    })
    const before = creature(three, 1)
    const after = creature(run(three, 480).world, 1)
    expect(after.cicatrices).toBe(3)
    expect(after.chairMax).toBe(before.chairMax)
  })
})

// Mannequin hostile face au joueur ; son bras droit porte l'attaque « coup ».
const armed = (weapon: 'couperet' | 'masse', armHp: number): World => {
  const w = scene([{ family: 'recousu', pos: vec(2, 0), state: 'hostile', facing: Math.PI }], {
    families: { recousu: mannequin() },
  })
  const withArm = withCreature(w, 1, { limbs: [{ id: 'brasDroit', hp: armHp, hpMax: 40, state: 'ok' }] })
  return withPlayer(withArm, { weapon })
}
// Le mannequin commence son coup au tick 24 ; on frappe au tick 30, pendant le télégraphe.
const hitDuringAttack = (w: World) => run(w, 31, (wo) => cmd({ strike: wo.tick === 29, aim: vec(2, 0) }))

describe('Anatomie (§8.4)', () => {
  it('tranchant : le bras qui attaque tombe à 0, il est sectionné et devient un Membre errant', () => {
    const { world, events } = hitDuringAttack(armed('couperet', 10))
    const sever = ofType(events, 'sever')[0]
    expect(sever?.owner).toBe(1)
    expect(sever?.limb).toBe('brasDroit')
    const member = creature(world, sever?.member ?? -1)
    expect(member.family).toBe('membre')
    expect(member.unionOf).toBe(1)
    expect(member.state.kind).toBe('abattu')
    expect(creature(world, 1).limbs[0]?.state).toBe('severed')
    expect(ofType(events, 'action-interrupted')[0]?.id).toBe(1)
  })

  it('le Membre errant rampe à 1,2 m/s vers son propriétaire et se recoud en 60 ticks au contact', () => {
    const cut = hitDuringAttack(armed('couperet', 10))
    const memberId = ofType(cut.events, 'sever')[0]?.member ?? -1
    const d0 = Math.hypot(creature(cut.world, memberId).pos.x - 2, creature(cut.world, memberId).pos.z)
    const after10 = run(cut.world, 10, cmd({ move: vec(-1, 0) }))
    const d1 = Math.hypot(
      creature(after10.world, memberId).pos.x - 2,
      creature(after10.world, memberId).pos.z,
    )
    expect(d0 - d1).toBeCloseTo((1.2 * 10) / 60, 5)
    const later = run(cut.world, 200, cmd({ move: vec(-1, 0) }))
    const reattach = ofType(later.events, 'reattach')[0]
    expect(reattach?.by).toBe('contact')
    expect(creature(later.world, 1).limbs[0]).toEqual({ id: 'brasDroit', hp: 40, hpMax: 40, state: 'ok' })
    expect(later.world.creatures.find((c) => c.id === memberId)).toBeUndefined()
  })

  it("contondant : le bras qui attaque tombe à 0, il est brisé, pas d'entité créée", () => {
    const { world, events } = hitDuringAttack(armed('masse', 10))
    expect(ofType(events, 'break')[0]?.limb).toBe('brasDroit')
    expect(ofType(events, 'sever')).toHaveLength(0)
    expect(world.creatures).toHaveLength(1)
    expect(creature(world, 1).limbs[0]?.state).toBe('broken')
  })

  it("les dégâts hors de l'attaque d'un membre ne touchent pas ce membre", () => {
    const w = armed('couperet', 40)
    const { world } = run(w, 1, cmd({ strike: true, aim: vec(2, 0) }))
    expect(creature(world, 1).limbs[0]?.hp).toBe(40)
    expect(creature(world, 1).chair).toBe(160 - 12)
  })

  it('le Relèvement restaure les membres brisés', () => {
    const broken = hitDuringAttack(armed('masse', 10)).world
    const down = withCreature(broken, 1, {
      chair: 0,
      action: null,
      state: { kind: 'abattu', since: broken.tick, riseAt: broken.tick + 5, cryAt: null, claimedBy: null },
    })
    const risen = run(withPlayer(down, { pos: FAR }), 5)
    expect(creature(risen.world, 1).limbs[0]?.state).toBe('ok')
  })
})

describe('L5 Union', () => {
  it('la mort du tout tue ses parties au même tick', () => {
    const cut = hitDuringAttack(armed('couperet', 10))
    const memberId = ofType(cut.events, 'sever')[0]?.member ?? -1
    const down = withCreature(cut.world, 1, {
      chair: 0,
      action: null,
      state: {
        kind: 'abattu',
        since: cut.world.tick,
        riseAt: cut.world.tick + 300,
        cryAt: null,
        claimedBy: null,
      },
    })
    const close = withPlayer(down, { pos: vec(0.5, 0), action: null })
    const { events } = run(close, 1, cmd({ sentence: true, aim: vec(2, 0) }))
    const sentenced = run(close, 70, (wo) => cmd({ sentence: wo.tick === close.tick, aim: vec(2, 0) }))
    const deaths = ofType(sentenced.events, 'death')
    const owner = deaths.find((d) => d.id === 1)
    const member = deaths.find((d) => d.id === memberId)
    expect(ofType(events, 'sentence-start')[0]?.target).toBe(1)
    expect(owner?.by).toBe('sentence')
    expect(member?.by).toBe('union')
    expect(member?.tick).toBe(owner?.tick)
  })

  it("la mort d'une partie ne tue pas le tout", () => {
    const cut = hitDuringAttack(armed('couperet', 10))
    const memberId = ofType(cut.events, 'sever')[0]?.member ?? -1
    const m = creature(cut.world, memberId)
    const atMember = withPlayer(cut.world, { pos: vec(m.pos.x - 1, m.pos.z), action: null, comboStep: 0 })
    const { world } = run(atMember, 1, cmd({ strike: true, aim: m.pos }))
    expect(creature(world, memberId).state.kind).toBe('mort')
    expect(creature(world, 1).state.kind).not.toBe('mort')
  })

  it('les corps absorbés meurent avec le tout', () => {
    const w0 = scene(
      [
        { family: 'souriant', pos: vec(1.5, 0), state: 'abattu' },
        { family: 'souriant', pos: vec(1.5, 0), state: 'abattu' },
      ],
      {},
    )
    const w = withCreature(w0, 2, { state: { kind: 'absorbe', into: 1, cryAt: 30 }, unionOf: 1 })
    const { events } = run(w, 1, cmd({ strike: true, aim: vec(5, 0) }))
    expect(ofType(events, 'death').map((d) => [d.id, d.by])).toEqual([
      [1, 'achevement'],
      [2, 'union'],
    ])
  })
})
