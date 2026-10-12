// B4 : L1 Chair et Abattu, L2 Cri, L4 La Mort, variante B (GAME_SPEC §7).
import { describe, expect, it } from 'vitest'
import { cmd, creature, ofType, poteau, run, scene, withCreature, withPlayer } from './testing'
import { TUNING } from './tuning'
import type { FamilyModule } from './types'
import { vec } from './vec'

// Pétard : petite créature hostile qui éclate une fois, comme un Porteur (source « burst »).
const petard: FamilyModule = {
  kind: 'porteur',
  size: 'small',
  isSupport: false,
  base: { chair: 60, speed: 0, limbs: [] },
  actions: { boum: { kind: 'attaque', telegraphTicks: 1, recoverTicks: 1, reach: 3 } },
  decide: (_w, self) => (self.familyData.done ? { kind: 'idle' } : { kind: 'act', action: 'boum' }),
  resolve: (_w, self) => [
    { kind: 'setData', key: 'done', value: 1 },
    {
      kind: 'damage',
      area: { kind: 'circle', center: self.pos, radius: 3 },
      amount: 100,
      source: 'burst',
      abatSmall: true,
      staggerLarge: 90,
      hitsCreatures: true,
    },
    { kind: 'alert', center: self.pos, radius: 15, cause: 'burst' },
  ],
}

const strike = (x: number, z = 0) => cmd({ strike: true, aim: vec(x, z) })
// Anticipation (décision du 2026-10-12) : un coup commandé au tick 1 touche au tick 1 + WINDUP.
const WINDUP = TUNING.weapons.couperet.windup
const FAR = vec(-12, -12)

describe('L1 Chair et Abattu', () => {
  it('à 0 de Chair, la créature tombe Abattue, sans mourir', () => {
    const w = scene([{ family: 'souriant', pos: vec(1.5, 0), state: 'rituel' }])
    const { world, events } = run(w, 22 + WINDUP, strike(5))
    const s = creature(world, 1)
    expect(s.state.kind).toBe('abattu')
    expect(s.chair).toBe(0)
    expect(ofType(events, 'fell')).toHaveLength(1)
    expect(ofType(events, 'death')).toHaveLength(0)
  })

  it('un éclatement (source non joueur) abat, il ne tue jamais', () => {
    const w = scene(
      [
        { family: 'porteur', pos: vec(5, 0), state: 'hostile' },
        { family: 'souriant', pos: vec(6, 0), state: 'rituel' },
      ],
      { families: { porteur: petard }, playerStart: FAR },
    )
    const { world, events } = run(w, 30)
    expect(creature(world, 2).state.kind).toBe('abattu')
    expect(ofType(events, 'death')).toHaveLength(0)
  })

  it('le joueur traverse un Abattu, pas une créature debout', () => {
    const down = scene([{ family: 'souriant', pos: vec(1.5, 0), state: 'abattu' }])
    expect(run(down, 40, cmd({ move: vec(1, 0) })).world.player.pos.x).toBeGreaterThan(3)
    const up = scene([{ family: 'souriant', pos: vec(1.5, 0), state: 'rituel' }])
    expect(run(up, 40, cmd({ move: vec(1, 0) })).world.player.pos.x).toBeLessThan(1.5)
  })

  it('rampe à 0,8 m/s vers un support à moins de 12 m, pas au-delà', () => {
    const near = scene(
      [
        { family: 'souriant', pos: vec(0, 0), state: 'abattu' },
        { family: 'confesseur', pos: vec(10, 0), state: 'rituel' },
      ],
      { families: { confesseur: poteau }, playerStart: FAR },
    )
    expect(creature(run(near, 60).world, 1).pos.x).toBeCloseTo(0.8, 6)
    const far = scene(
      [
        { family: 'souriant', pos: vec(0, 0), state: 'abattu' },
        { family: 'confesseur', pos: vec(13, 0), state: 'rituel' },
      ],
      { families: { confesseur: poteau }, playerStart: FAR },
    )
    expect(creature(run(far, 60).world, 1).pos.x).toBe(0)
  })
})

describe('L2 Cri', () => {
  it('halète 0,5 s puis crie', () => {
    const w = scene([{ family: 'souriant', pos: vec(1.5, 0), state: 'rituel' }])
    const { events } = run(w, 60, (wo) => (wo.tick < 22 ? strike(5) : cmd({ aim: vec(5, 0) })))
    const fell = ofType(events, 'fell')[0]
    const cry = ofType(events, 'cry-start')[0]
    expect(fell).toBeDefined()
    expect((cry?.tick ?? 0) - (fell?.tick ?? 0)).toBe(30)
  })

  it('achevé avant 0,5 s : aucun cri, aucune alerte', () => {
    const w = scene([
      { family: 'souriant', pos: vec(1.5, 0), state: 'abattu' },
      { family: 'souriant', pos: vec(1.5, 5), state: 'rituel' },
    ])
    const { events } = run(w, 60, (wo) => (wo.tick < 1 ? strike(5) : cmd()))
    expect(ofType(events, 'cry-start')).toHaveLength(0)
    expect(ofType(events, 'alert')).toHaveLength(0)
  })

  it('le cri alerte une créature en Rituel à 7,9 m, pas à 8,1 m', () => {
    const at = (d: number) =>
      run(
        scene(
          [
            { family: 'souriant', pos: vec(0, 0), state: 'abattu' },
            { family: 'souriant', pos: vec(d, 0), state: 'rituel' },
          ],
          { playerStart: FAR },
        ),
        100,
      ).events
    expect(ofType(at(7.9), 'alert').map((a) => [a.id, a.cause])).toEqual([[2, 'cry']])
    expect(ofType(at(8.1), 'alert')).toHaveLength(0)
  })
})

describe('L4 La Mort', () => {
  it('Achèvement : un coup tue un Abattu ordinaire, coupe son cri au même tick, +4 Ferveur', () => {
    const w = scene([{ family: 'souriant', pos: vec(1.5, 0), state: 'abattu' }])
    const crying = run(w, 40)
    const { world, events } = run(crying.world, 1 + WINDUP, strike(5))
    const death = ofType(events, 'death')[0]
    const stop = ofType(events, 'cry-stop')[0]
    expect(death?.by).toBe('achevement')
    expect(stop?.tick).toBe(death?.tick)
    expect(stop?.cause).toBe('death')
    expect(world.player.ferveur).toBe(4)
    expect(creature(world, 1).state.kind).toBe('mort')
  })

  it('un coup sur un Résistant à terre : bruit métallique, pas de mort', () => {
    const w = scene([{ family: 'souriant', pos: vec(1.5, 0), state: 'abattu', cicatrices: 3 }])
    const { events, world } = run(w, 1 + WINDUP, strike(5))
    expect(ofType(events, 'clang')).toHaveLength(1)
    expect(creature(world, 1).state.kind).toBe('abattu')
  })

  it('Sentence ordinaire : 36 ticks, invulnérable, mort au dernier tick, +8 % Vie, +10 Ferveur', () => {
    const w = withPlayer(scene([{ family: 'souriant', pos: vec(1.8, 0), state: 'abattu' }]), { vie: 50 })
    const started = run(w, 1, cmd({ sentence: true, aim: vec(1.8, 0) }))
    const start = ofType(started.events, 'sentence-start')[0]
    expect(start?.target).toBe(1)
    expect(started.world.player.invulnerableUntil).toBeGreaterThanOrEqual((start?.tick ?? 0) + 36)
    const before = run(started.world, 35)
    expect(creature(before.world, 1).state.kind).toBe('abattu')
    const done = run(before.world, 1)
    const death = ofType(done.events, 'death')[0]
    expect(death?.by).toBe('sentence')
    expect((death?.tick ?? 0) - (start?.tick ?? 0)).toBe(36)
    expect(done.world.player.vie).toBe(58)
    expect(done.world.player.ferveur).toBe(10)
    expect(ofType(done.events, 'heal')[0]?.amount).toBe(8)
  })

  it('Sentence Résistant : 60 ticks, +30 % Vie, +40 Ferveur', () => {
    const w = withPlayer(scene([{ family: 'souriant', pos: vec(1.8, 0), state: 'abattu', cicatrices: 3 }]), {
      vie: 50,
    })
    const { events, world } = run(w, 61, (wo) => cmd({ sentence: wo.tick === 0, aim: vec(1.8, 0) }))
    const start = ofType(events, 'sentence-start')[0]
    const death = ofType(events, 'death')[0]
    expect((death?.tick ?? 0) - (start?.tick ?? 0)).toBe(60)
    expect(world.player.vie).toBe(80)
    expect(world.player.ferveur).toBe(40)
  })

  it('la cible est la plus proche du curseur ; à égalité, la plus proche du joueur', () => {
    const w = scene([
      { family: 'souriant', pos: vec(2, 0), state: 'abattu' },
      { family: 'souriant', pos: vec(0, 2), state: 'abattu' },
    ])
    const a = run(w, 1, cmd({ sentence: true, aim: vec(2.5, 0.2) }))
    expect(ofType(a.events, 'sentence-start')[0]?.target).toBe(1)
    const w2 = scene([
      { family: 'souriant', pos: vec(2, 0), state: 'abattu' },
      { family: 'souriant', pos: vec(1, 0), state: 'abattu' },
    ])
    const b = run(w2, 1, cmd({ sentence: true, aim: vec(1.5, 0) }))
    expect(ofType(b.events, 'sentence-start')[0]?.target).toBe(2)
  })

  it('sans cible à portée : sentence-none, aucun effet', () => {
    const w = scene([{ family: 'souriant', pos: vec(4, 0), state: 'abattu' }])
    const { events, world } = run(w, 1, cmd({ sentence: true, aim: vec(4, 0) }))
    expect(ofType(events, 'sentence-none')).toHaveLength(1)
    expect(world.player.action).toBeNull()
  })

  it('la cible est réservée : elle ne se relève pas pendant la Sentence et meurt à la fin', () => {
    const w0 = scene([{ family: 'souriant', pos: vec(1.8, 0), state: 'abattu' }])
    const w = withCreature(w0, 1, {
      state: { kind: 'abattu', since: 0, riseAt: 2, cryAt: 30, claimedBy: null },
    })
    const { events, world } = run(w, 40, (wo) => cmd({ sentence: wo.tick === 0, aim: vec(1.8, 0) }))
    expect(ofType(events, 'rise')).toHaveLength(0)
    expect(creature(world, 1).state.kind).toBe('mort')
  })

  it("une Sentence sur un corps encore muet le garde muet : l'exécution est silencieuse", () => {
    const w = scene([
      { family: 'souriant', pos: vec(1.8, 0), state: 'abattu' },
      { family: 'souriant', pos: vec(1.8, 5), state: 'rituel' },
    ])
    const { events, world } = run(w, 60, (wo) => cmd({ sentence: wo.tick === 0, aim: vec(1.8, 0) }))
    expect(ofType(events, 'cry-start')).toHaveLength(0)
    expect(creature(world, 2).state.kind).toBe('rituel')
  })

  it('rien ne relève un mort', () => {
    const w = scene([{ family: 'souriant', pos: vec(1.5, 0), state: 'mort' }])
    const { events, world } = run(w, 600)
    expect(ofType(events, 'rise')).toHaveLength(0)
    expect(creature(world, 1).state.kind).toBe('mort')
  })
})

describe('Variante B (§27, D10, D11)', () => {
  const lowChair = (variant: 'A' | 'B', chair: number) =>
    withCreature(scene([{ family: 'souriant', pos: vec(1.5, 0), state: 'rituel' }], { variant }), 1, {
      chair,
    })

  it('excédent ≥ 50 % de la Chair max : mort directe en B, +4 Ferveur ; Abattu en A', () => {
    const b = run(lowChair('B', 2), 1 + WINDUP, strike(5))
    expect(ofType(b.events, 'death')[0]?.by).toBe('variant-b')
    expect(b.world.player.ferveur).toBe(2 + 4)
    const a = run(lowChair('A', 2), 1 + WINDUP, strike(5))
    expect(creature(a.world, 1).state.kind).toBe('abattu')
  })

  it('excédent sous 50 % : Abattu, même en B', () => {
    const b = run(lowChair('B', 5), 1 + WINDUP, strike(5))
    expect(creature(b.world, 1).state.kind).toBe('abattu')
  })

  it("s'applique au Balayage et à la Charge", () => {
    const sweep = withPlayer(lowChair('B', 2), { ferveur: 30 })
    const swept = run(sweep, 1 + WINDUP, (x) => cmd({ rite: x.tick === 0 ? 'balayage' : null }))
    expect(ofType(swept.events, 'death')[0]?.by).toBe('variant-b')
    const charge = withPlayer(lowChair('B', 2), { ferveur: 40 })
    expect(ofType(run(charge, 10, cmd({ rite: 'charge', aim: vec(9, 0) })).events, 'death')[0]?.by).toBe(
      'variant-b',
    )
  })

  it('ne tue jamais directement un Résistant', () => {
    const w = withCreature(
      scene([{ family: 'souriant', pos: vec(1.5, 0), state: 'rituel', cicatrices: 3 }], { variant: 'B' }),
      1,
      { chair: 1 },
    )
    expect(creature(run(w, 1 + WINDUP, strike(5)).world, 1).state.kind).toBe('abattu')
  })
})
