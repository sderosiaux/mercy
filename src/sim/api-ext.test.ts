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

// Prêtre factice : prie 150 ticks, même à terre, et relève tout ce qui est à moins de 8 m (lui compris).
const pretre: FamilyModule = {
  kind: 'confesseur',
  size: 'small',
  isSupport: true,
  canActWhileDown: true,
  base: { chair: 40, speed: 0, limbs: [] },
  actions: {
    priere: { kind: 'canalisation', telegraphTicks: 0, recoverTicks: 0, channelTicks: 150, reach: 8 },
  },
  decide: (_w, self) => (self.familyData.done ? { kind: 'idle' } : { kind: 'act', action: 'priere' }),
  resolve: (w, self) => [
    { kind: 'setData', key: 'done', value: 1 },
    {
      kind: 'raise',
      ids: w.creatures
        .filter(
          (c) => c.state.kind === 'abattu' && Math.hypot(c.pos.x - self.pos.x, c.pos.z - self.pos.z) <= 8,
        )
        .map((c) => c.id),
    },
  ],
}

describe('prière (requêtes C3)', () => {
  it('une prière achevée émet prayer-complete avec les corps relevés, même si elle ne relève personne', () => {
    const w = scene(
      [
        { family: 'confesseur', pos: vec(0, 0), state: 'hostile' },
        { family: 'souriant', pos: vec(2, 0), state: 'abattu' },
      ],
      { families: { confesseur: pretre }, playerStart: vec(-12, -12) },
    )
    const r = run(w, 24 + 150)
    const done = ofType(r.events, 'prayer-complete')
    expect(done.map((e) => [e.id, e.others])).toEqual([[1, [2]]])
    const empty = scene([{ family: 'confesseur', pos: vec(0, 0), state: 'hostile' }], {
      families: { confesseur: pretre },
      playerStart: vec(-12, -12),
    })
    expect(ofType(run(empty, 24 + 150).events, 'prayer-complete').map((e) => e.others)).toEqual([[]])
  })

  it('une prière ne relève jamais un Membre errant', () => {
    const w0 = scene(
      [
        { family: 'confesseur', pos: vec(0, 0), state: 'hostile' },
        { family: 'souriant', pos: vec(2, 0), state: 'abattu' },
      ],
      { families: { confesseur: pretre }, playerStart: vec(-12, -12) },
    )
    const w = {
      ...w0,
      creatures: w0.creatures.map((c) => (c.id === 2 ? { ...c, family: 'membre' as const, unionOf: 1 } : c)),
    }
    const r = run(w, 24 + 150)
    expect(ofType(r.events, 'rise')).toHaveLength(0)
    expect(ofType(r.events, 'prayer-complete')[0]?.others).toEqual([])
  })

  it('un Relèvement ne coupe pas la prière en cours : elle continue debout et finit par action-end', () => {
    const w = scene([{ family: 'confesseur', pos: vec(0, 0), state: 'abattu' }], {
      families: { confesseur: pretre },
      playerStart: vec(-12, -12),
    })
    // Abattu au tick 0, il prie du tick 1 au tick 151 ; on avance son Relèvement au tick 50, en pleine prière.
    const early = {
      ...w,
      creatures: w.creatures.map((c) =>
        c.state.kind === 'abattu' ? { ...c, state: { ...c.state, riseAt: 50 } } : c,
      ),
    }
    const r = run(early, 160)
    expect(ofType(r.events, 'rise').map((e) => e.tick)).toEqual([50])
    expect(ofType(r.events, 'action-interrupted')).toHaveLength(0)
    expect(ofType(r.events, 'action-end').map((e) => e.action)).toEqual(['priere'])
    expect(ofType(r.events, 'prayer-complete')).toHaveLength(1)
  })
})
