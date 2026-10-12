// B6 : L6 Seule la mort est permanente, L7 Indifférence, règle d'interruption (§7).
import { describe, expect, it } from 'vitest'
import { cmd, creature, mannequin, ofType, run, scene, withCreature, withPlayer } from './testing'
import type { FamilyModule } from './types'
import { vec } from './vec'

const FAR = vec(-12, -12)

// Crieur : petite créature hostile qui lance une alerte de bruit une seule fois.
const crieur = (cause: 'burst' | 'bark', radius: number): FamilyModule => ({
  kind: 'porteur',
  size: 'small',
  isSupport: false,
  base: { chair: 60, speed: 0, limbs: [] },
  actions: { cri: { kind: 'attaque', telegraphTicks: 1, recoverTicks: 1, reach: 0 } },
  decide: (_w, self) => (self.familyData.done ? { kind: 'idle' } : { kind: 'act', action: 'cri' }),
  resolve: (_w, self) => [
    { kind: 'setData', key: 'done', value: 1 },
    { kind: 'alert', center: self.pos, radius, cause },
  ],
})

describe('L6 Seule la mort est permanente', () => {
  const setup = () => {
    const w0 = scene(
      [
        { family: 'souriant', pos: vec(5, 5), state: 'rituel' },
        { family: 'souriant', pos: vec(-5, 5), state: 'rituel' },
        { family: 'recousu', pos: vec(2, 0), state: 'hostile', facing: Math.PI },
      ],
      { families: { recousu: mannequin() } },
    )
    const a = withCreature(w0, 1, { state: { kind: 'mort', at: 0 }, chair: 0 })
    const b = withCreature(a, 2, {
      pos: vec(-3, 2),
      chair: 0,
      cicatrices: 1,
      chairMax: 30,
      state: { kind: 'abattu', since: 0, riseAt: 900, cryAt: 30, claimedBy: null },
    })
    return withPlayer(b, { vie: 1, ferveur: 60, lastFerveurGain: 1_000_000 })
  }

  it('à la mort du joueur : les morts restent morts, le reste revient à son état de départ', () => {
    const { world, events } = run(setup(), 80, cmd({ aim: vec(2, 0) }))
    expect(ofType(events, 'player-death')).toHaveLength(1)
    expect(ofType(events, 'reset')).toHaveLength(1)
    expect(creature(world, 1).state.kind).toBe('mort')
    const b = creature(world, 2)
    expect(b.state.kind).toBe('rituel')
    expect(b.pos).toEqual(vec(-5, 5))
    expect(b.chair).toBe(20)
    expect(b.cicatrices).toBe(0)
    const m = creature(world, 3)
    expect(m.chair).toBe(160)
    expect(world.player.vie).toBe(100)
    expect(world.player.ferveur).toBe(0)
    expect(world.player.pos).toEqual(vec(0, 0))
    expect(world.player.deaths).toBe(1)
  })

  it('les créatures nées en combat disparaissent, les mortes restent', () => {
    const w = setup()
    const born = {
      ...w,
      nextId: 5,
      creatures: [
        ...w.creatures,
        { ...creature(w, 2), id: 4, spawn: null, state: { kind: 'hostile' as const, alertedAt: 0 } },
      ],
    }
    const { world } = run(born, 80, cmd({ aim: vec(2, 0) }))
    expect(world.creatures.find((c) => c.id === 4)).toBeUndefined()
  })

  it('la mort pendant une Sentence ne laisse aucune action orpheline', () => {
    // Le mannequin frappe au tick 78. La Sentence part au tick 73 et durerait 36 ticks.
    const near = withCreature(setup(), 2, { pos: vec(0, 1.5) })
    const before = run(near, 72, cmd({ aim: vec(0, 1.5) }))
    const during = run(before.world, 1, cmd({ sentence: true, aim: vec(0, 1.5) }))
    expect(ofType(during.events, 'sentence-start')).toHaveLength(1)
    // La Sentence rend invulnérable : on retire l'invulnérabilité pour que le coup tue.
    const exposed = withPlayer(during.world, { invulnerableUntil: 0 })
    const after = run(exposed, 10, cmd({ aim: vec(2, 0) }))
    expect(ofType(after.events, 'reset')).toHaveLength(1)
    expect(after.world.player.action).toBeNull()
    expect(creature(after.world, 2).state.kind).toBe('rituel')
    expect(() => run(after.world, 30, cmd())).not.toThrow()
  })
})

describe('L7 Indifférence', () => {
  it('les dégâts réveillent', () => {
    const w = scene([{ family: 'souriant', pos: vec(1.5, 0), state: 'rituel' }])
    const { events } = run(w, 1, cmd({ strike: true, aim: vec(5, 0) }))
    expect(ofType(events, 'alert').map((a) => a.cause)).toEqual(['damage'])
  })

  it('la proximité réveille à 2,4 m, pas à 2,6 m', () => {
    const at = (d: number) => run(scene([{ family: 'souriant', pos: vec(d, 0), state: 'rituel' }]), 5).events
    expect(ofType(at(2.4), 'alert').map((a) => a.cause)).toEqual(['proximity'])
    expect(ofType(at(2.6), 'alert')).toHaveLength(0)
  })

  it('un éclatement réveille à 15 m, une invective à 10 m', () => {
    const burst = (d: number) =>
      run(
        scene(
          [
            { family: 'porteur', pos: vec(-7, 0), state: 'hostile' },
            { family: 'souriant', pos: vec(-7 + d, 0), state: 'rituel' },
          ],
          { families: { porteur: crieur('burst', 15) }, playerStart: FAR },
        ),
        30,
      ).events
    expect(ofType(burst(14.9), 'alert').map((a) => a.cause)).toEqual(['burst'])
    expect(ofType(burst(15.1), 'alert')).toHaveLength(0)
    const bark = (d: number) =>
      run(
        scene(
          [
            { family: 'porteur', pos: vec(-7, 0), state: 'hostile' },
            { family: 'souriant', pos: vec(-7 + d, 0), state: 'rituel' },
          ],
          { families: { porteur: crieur('bark', 10) }, playerStart: FAR },
        ),
        30,
      ).events
    expect(ofType(bark(9.9), 'alert').map((a) => a.cause)).toEqual(['bark'])
    expect(ofType(bark(10.1), 'alert')).toHaveLength(0)
  })

  it("pivot de tête : la première décision Hostile arrive 24 ticks après l'alerte", () => {
    const w = scene([{ family: 'souriant', pos: vec(1.5, 0), state: 'rituel', cicatrices: 3 }])
    const { events } = run(w, 40, (wo) => cmd({ strike: wo.tick === 0, aim: vec(5, 0) }))
    const alert = ofType(events, 'alert')[0]
    const start = ofType(events, 'action-start').find((e) => e.id === 1)
    expect((start?.tick ?? 0) - (alert?.tick ?? 0)).toBe(24)
  })

  it("une créature en Rituel ne réagit pas à ce qu'elle voit", () => {
    const w = scene([
      { family: 'souriant', pos: vec(1.8, 0), state: 'abattu' },
      { family: 'souriant', pos: vec(1.8, 4), state: 'rituel' },
    ])
    const { world } = run(w, 60, (wo) => cmd({ sentence: wo.tick === 0, aim: vec(1.8, 0) }))
    expect(creature(world, 2).state.kind).toBe('rituel')
  })
})

describe("Règle d'interruption", () => {
  it("une petite créature est interrompue par n'importe quel coup", () => {
    const w = scene([
      { family: 'souriant', pos: vec(1.2, 0), state: 'hostile', facing: Math.PI, cicatrices: 3 },
    ])
    // Le Souriant décide au tick 24 (morsure, télégraphe 24) ; on frappe au tick 30.
    const { events } = run(w, 31, (wo) => cmd({ strike: wo.tick === 29, aim: vec(5, 0) }))
    expect(ofType(events, 'action-interrupted').map((e) => [e.id, e.by])).toEqual([[1, 'player']])
  })

  const big = (channel = false) =>
    scene([{ family: 'recousu', pos: vec(2, 0), state: 'hostile', facing: Math.PI }], {
      families: { recousu: mannequin({ channel }) },
    })
  const interruptedBy = (w: ReturnType<typeof big>, patch: object, c: ReturnType<typeof cmd>, at = 29) =>
    ofType(
      run(withPlayer(w, patch), 45, (wo) => (wo.tick === at ? c : cmd({ aim: vec(2, 0) }))).events,
      'action-interrupted',
    )

  it("une grande créature n'est pas interrompue par un coup ordinaire", () => {
    expect(interruptedBy(big(), {}, cmd({ strike: true, aim: vec(2, 0) }))).toHaveLength(0)
  })

  it('le 3e coup contondant interrompt une grande créature', () => {
    const w = withPlayer(big(), { weapon: 'masse', comboStep: 2 })
    expect(interruptedBy(w, {}, cmd({ strike: true, aim: vec(2, 0) }))).toHaveLength(1)
  })

  it('la Charge interrompt une grande créature', () => {
    expect(interruptedBy(big(), { ferveur: 40 }, cmd({ rite: 'charge', aim: vec(9, 0) }))).toHaveLength(1)
  })

  it("n'importe quel coup interrompt une canalisation, même chez une grande créature", () => {
    expect(interruptedBy(big(true), {}, cmd({ strike: true, aim: vec(2, 0) }))).toHaveLength(1)
  })
})
