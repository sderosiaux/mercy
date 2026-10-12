// Extensions de l'API avant la phase C : réservation des corps par une canalisation, projection du joueur, ruée.
import { describe, expect, it } from 'vitest'
import { cmd, creature, ofType, run, scene } from './testing'
import type { FamilyModule } from './types'
import { vec } from './vec'

// Opérateur : canalise 180 ticks sur le corps le plus proche (comme un Chirurgien).
const operateur: FamilyModule = {
  kind: 'chirurgien',
  size: 'small',
  isSupport: true,
  base: { chair: 50, speed: 0, limbs: [] },
  actions: {
    recoudre: { kind: 'canalisation', telegraphTicks: 0, recoverTicks: 0, channelTicks: 180, reach: 2 },
  },
  decide: (w, self) => {
    const body = w.creatures.find(
      (c) => c.state.kind === 'abattu' && c.state.claimedBy === null && c.id !== self.id,
    )
    return body ? { kind: 'act', action: 'recoudre', target: body.id } : { kind: 'idle' }
  },
  resolve: (_w, _self, a) => (typeof a.target === 'number' ? [{ kind: 'repair', id: a.target }] : []),
}

// Lutteur : attaque qui projette le joueur, puis ruée de 5 m.
const lutteur: FamilyModule = {
  kind: 'recousu',
  size: 'large',
  isSupport: false,
  base: { chair: 160, speed: 0, limbs: [] },
  actions: {
    saisie: { kind: 'attaque', telegraphTicks: 10, recoverTicks: 10, reach: 2 },
    ruee: { kind: 'attaque', telegraphTicks: 10, recoverTicks: 10, reach: 5 },
  },
  decide: (_w, self) => ({ kind: 'act', action: self.familyData.done ? 'ruee' : 'saisie' }),
  resolve: (_w, self, a) =>
    a.name === 'saisie'
      ? [
          { kind: 'setData', key: 'done', value: 1 },
          {
            kind: 'damage',
            area: { kind: 'circle', center: self.pos, radius: 2 },
            amount: 15,
            source: 'creature',
            abatSmall: false,
            staggerLarge: 0,
            hitsCreatures: false,
            knockback: 4,
          },
        ]
      : [{ kind: 'dashSelf', to: vec(self.pos.x + 5, self.pos.z) }],
}

describe('réservation par une canalisation', () => {
  it('le corps opéré ne se relève pas seul et ne peut pas être pris par un autre ; la réservation tombe à la fin', () => {
    const w = scene(
      [
        { family: 'chirurgien', pos: vec(0, 0), state: 'hostile' },
        { family: 'souriant', pos: vec(1, 0), state: 'abattu' },
      ],
      { families: { chirurgien: operateur }, playerStart: vec(-12, -12) },
    )
    const during = run(w, 100)
    const s = creature(during.world, 2).state
    expect(s.kind === 'abattu' && s.claimedBy).toBe(1)
    const done = run(w, 24 + 180)
    expect(ofType(done.events, 'rise').map((r) => r.cause)).toEqual(['chirurgien'])
  })

  it('la réservation tombe si la canalisation est interrompue', () => {
    const w = scene(
      [
        { family: 'chirurgien', pos: vec(1.5, 0), state: 'hostile' },
        { family: 'souriant', pos: vec(1.5, 1), state: 'abattu' },
      ],
      { families: { chirurgien: operateur } },
    )
    const r = run(w, 40, (wo) => cmd({ strike: wo.tick === 30, aim: vec(1.5, 0) }))
    expect(ofType(r.events, 'action-interrupted')).toHaveLength(1)
    const s = creature(r.world, 2).state
    expect(s.kind === 'abattu' && s.claimedBy).not.toBe(1)
  })
})

describe('effets de mouvement', () => {
  it('une attaque peut projeter le joueur, une créature peut se ruer', () => {
    const w = scene([{ family: 'recousu', pos: vec(1.5, 0), state: 'hostile' }], {
      families: { recousu: lutteur },
    })
    const r = run(w, 24 + 10)
    expect(r.world.player.pos.x).toBeCloseTo(-4, 5)
    const dash = run(r.world, 30)
    expect(creature(dash.world, 1).pos.x).toBeCloseTo(6.5, 5)
  })
})
