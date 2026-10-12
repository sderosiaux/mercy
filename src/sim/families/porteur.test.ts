// C1 : Porteur (GAME_SPEC §8.10, §9, L5, §26 ; D4, D7, D8). Le cœur réel tourne : rien n'est simulé.
import { describe, expect, it } from 'vitest'
import { inPorteurRearArc, PORTEUR_STAGE_KEY } from '../predicates'
import { cmd, creature, mannequin, ofType, run, scene, withCreature, withPlayer } from '../testing'
import { TICK_HZ, TUNING } from '../tuning'
import type { Creature, Effect, FamilyModule, SimEvent, World } from '../types'
import { add, angleDiff, angleOf, dist, fromAngle, norm, scale, sub, vec } from '../vec'
import { porteur } from './porteur'

const P = TUNING.porteur
const MAX_TURN = (P.turnRateDegPerSecond * Math.PI) / 180 / TICK_HZ
const FAR = vec(-14, -14)
const families = { porteur }

const stageOf = (w: World, id = 1): number => creature(w, id).familyData[PORTEUR_STAGE_KEY] ?? 0

// Chirurgie d'état (testing.ts) : place des corps dans le sac du Porteur sans passer par l'absorption.
const loaded = (w: World, porteurId: number, ids: readonly number[]): World =>
  ids.reduce(
    (acc, id) =>
      withCreature(acc, id, {
        state: { kind: 'absorbe', into: porteurId, cryAt: null },
        unionOf: porteurId,
        pos: creature(acc, porteurId).pos,
      }),
    w,
  )

// Un Hostile dont le pivot de tête (L7) est fini depuis longtemps : il décide dès le premier tick.
const settled = (w: World, id: number): World =>
  withCreature(w, id, { state: { kind: 'hostile', alertedAt: -100 } })

// Avance tick par tick en gardant chaque monde, pour lire l'état d'avant chaque pas.
const trace = (w: World, n: number, commands: (w: World) => ReturnType<typeof cmd> = () => cmd()) => {
  const worlds: World[] = [w]
  const events: SimEvent[] = []
  let cur = w
  for (let i = 0; i < n; i++) {
    const r = run(cur, 1, commands(cur))
    cur = r.world
    worlds.push(cur)
    events.push(...r.events)
  }
  return { worlds, events, world: cur }
}

const byPlayerOn = (events: readonly SimEvent[], id: number) =>
  ofType(events, 'hit').filter((h) => h.target === id && h.by === 'player')

const atPolar = (center: { x: number; z: number }, angle: number, r: number) =>
  add(center, scale(fromAngle(angle), r))

describe('Porteur : absorption', () => {
  it('absorbe un Abattu ordinaire à moins de 3 m toutes les 90 ticks, jusqu’au stade 3', () => {
    const w = scene(
      [
        { family: 'porteur', pos: vec(0, 0), state: 'rituel' },
        { family: 'souriant', pos: vec(-1, 0.5), state: 'abattu' },
        { family: 'souriant', pos: vec(-1, -0.5), state: 'abattu' },
        { family: 'souriant', pos: vec(-1.5, 0), state: 'abattu' },
        { family: 'souriant', pos: vec(-2, 0), state: 'abattu' },
      ],
      { families, playerStart: vec(14, 14) },
    )
    const { world, events } = run(w, 300)
    const absorbs = ofType(events, 'absorb')
    expect(absorbs.map((a) => [a.tick, a.id, a.others.length])).toEqual([
      [1, 1, 1],
      [1 + P.absorbEvery, 1, 1],
      [1 + 2 * P.absorbEvery, 1, 1],
    ])
    expect(stageOf(world)).toBe(3)
    const inside = absorbs.flatMap((a) => a.others)
    for (const id of inside) {
      const c = creature(world, id)
      expect(c.state.kind === 'absorbe' && c.state.into).toBe(1)
      expect(c.unionOf).toBe(1)
    }
    const left = [2, 3, 4, 5].filter((id) => !inside.includes(id))
    expect(left).toHaveLength(1)
    expect(creature(world, left[0] as number).state.kind).toBe('abattu')
  })

  it('n’absorbe qu’à moins de 3 m : un corps à 3,1 m est pris au premier tick où il passe sous 3 m', () => {
    const w = scene(
      [
        { family: 'porteur', pos: vec(0, 0), state: 'rituel' },
        { family: 'souriant', pos: vec(3.1, 0), state: 'abattu' },
      ],
      { families, playerStart: FAR },
    )
    const { worlds, events } = trace(w, 20)
    const [absorb] = ofType(events, 'absorb')
    expect(absorb).toBeDefined()
    const before = worlds[(absorb?.tick ?? 0) - 1] as World
    const beforeThat = worlds[(absorb?.tick ?? 0) - 2] as World
    const gap = (x: World) => dist(creature(x, 1).pos, creature(x, 2).pos)
    expect(gap(before)).toBeLessThanOrEqual(P.absorbRadius)
    expect(gap(beforeThat)).toBeGreaterThan(P.absorbRadius)
  })

  it('il absorbe aussi en Rituel (« mange des corps »), sans bouger ni se tourner', () => {
    const w = scene(
      [
        { family: 'porteur', pos: vec(0, 0), facing: 0.7, state: 'rituel' },
        { family: 'souriant', pos: vec(2, 0), state: 'abattu' },
      ],
      { families, playerStart: FAR },
    )
    const { world, events } = run(w, 20)
    expect(ofType(events, 'absorb').map((a) => [a.tick, a.others])).toEqual([[1, [2]]])
    const self = creature(world, 1)
    expect(self.state.kind).toBe('rituel')
    expect(self.pos).toEqual(vec(0, 0))
    expect(self.facing).toBe(0.7)
    expect(stageOf(world)).toBe(1)
  })

  it('le stade est toujours lisible dans familyData, même sac vide', () => {
    const w = scene([{ family: 'porteur', pos: vec(0, 0), state: 'rituel' }], { families, playerStart: FAR })
    expect(creature(run(w, 1).world, 1).familyData[PORTEUR_STAGE_KEY]).toBe(0)
  })

  it('n’absorbe jamais un Résistant, un corps réservé (opération en cours) ni un Membre errant', () => {
    // Opérateur factice qui canalise sur le corps 4 (comme un Chirurgien) : la canalisation le réserve.
    const operateur: FamilyModule = {
      kind: 'chirurgien',
      size: 'small',
      isSupport: true,
      base: { chair: 50, speed: 0, limbs: [] },
      actions: {
        recoudre: { kind: 'canalisation', telegraphTicks: 0, recoverTicks: 0, channelTicks: 180, reach: 2 },
      },
      decide: () => ({ kind: 'idle' }),
      resolve: () => [],
    }
    const spawns = [
      { family: 'porteur' as const, pos: vec(0, 0), state: 'rituel' as const },
      { family: 'souriant' as const, pos: vec(1, 0), state: 'abattu' as const, cicatrices: 3 as const },
      { family: 'membre' as const, pos: vec(0, 1), state: 'abattu' as const },
      { family: 'souriant' as const, pos: vec(-1, 0), state: 'abattu' as const },
      { family: 'chirurgien' as const, pos: vec(-1.5, 1.5), state: 'hostile' as const },
      { family: 'recousu' as const, pos: vec(8, 8), state: 'rituel' as const },
    ]
    const build = (extra: boolean): World => {
      const all = extra
        ? [...spawns, { family: 'souriant' as const, pos: vec(0, -1), state: 'abattu' as const }]
        : spawns
      let w = scene(all, {
        families: { porteur, chirurgien: operateur, recousu: mannequin() },
        playerStart: FAR,
      })
      // Membre errant : sans voix, sans Relèvement, partie du Recousu 6 (comme anatomy.ts le crée).
      w = withCreature(w, 3, {
        state: { kind: 'abattu', since: 0, riseAt: null, cryAt: null, claimedBy: null },
        unionOf: 6,
      })
      w = withCreature(w, 5, {
        action: {
          name: 'recoudre',
          kind: 'canalisation',
          start: 0,
          activeAt: 180,
          end: 180,
          target: 4,
          limb: null,
        },
      })
      const body = creature(w, 4)
      if (body.state.kind !== 'abattu') throw new Error('corps 4 non abattu')
      return withCreature(w, 4, { state: { ...body.state, claimedBy: 5 } })
    }
    const none = run(build(false), 170)
    expect(ofType(none.events, 'absorb')).toHaveLength(0)
    expect(creature(none.world, 2).resistant).toBe(true)
    const s4 = creature(none.world, 4).state
    expect(s4.kind === 'abattu' && s4.claimedBy).toBe(5)
    // Témoin : le même Porteur, dans la même scène, prend aussitôt un corps ordinaire libre.
    const control = run(build(true), 2)
    expect(ofType(control.events, 'absorb').map((a) => [a.tick, a.others])).toEqual([[1, [7]]])
  })

  it('n’absorbe jamais un corps réservé par une Sentence', () => {
    const w = scene(
      [
        { family: 'porteur', pos: vec(2.5, 0), state: 'rituel' },
        { family: 'souriant', pos: vec(1, 0), state: 'abattu' },
      ],
      { families },
    )
    const { world, events } = run(w, TUNING.sentence.durationOrdinaire + 2, (x) =>
      cmd({ sentence: x.tick === 0, aim: vec(1, 0) }),
    )
    expect(ofType(events, 'sentence-start').map((e) => [e.tick, e.target])).toEqual([[1, 2]])
    expect(ofType(events, 'absorb')).toHaveLength(0)
    expect(ofType(events, 'death').map((d) => [d.id, d.by])).toEqual([[2, 'sentence']])
    expect(stageOf(world)).toBe(0)
  })

  it('à terre, il n’absorbe pas ; relevé, il reprend', () => {
    let w = scene(
      [
        { family: 'porteur', pos: vec(0, 0), state: 'abattu' },
        { family: 'souriant', pos: vec(1, 0), state: 'abattu' },
      ],
      { families, playerStart: FAR },
    )
    w = withCreature(w, 2, {
      state: { kind: 'abattu', since: 0, riseAt: 1000, cryAt: 30, claimedBy: null },
    })
    const { events } = run(w, TUNING.relevementOrdinaire + 5)
    const riseTick = ofType(events, 'rise').find((r) => r.id === 1)?.tick
    expect(riseTick).toBe(TUNING.relevementOrdinaire)
    expect(ofType(events, 'absorb').map((a) => [a.tick, a.id, a.others])).toEqual([
      [TUNING.relevementOrdinaire + 1, 1, [2]],
    ])
  })

  it('Attention 4 : deux Porteurs, même corps, même tick → le plus petit id l’absorbe', () => {
    // Le corps est plus près du Porteur 2 : seul l'id départage.
    const w = scene(
      [
        { family: 'porteur', pos: vec(-1, 0), state: 'rituel' },
        { family: 'porteur', pos: vec(2, 0), state: 'rituel' },
        { family: 'souriant', pos: vec(1.2, 0), state: 'abattu' },
      ],
      { families, playerStart: FAR },
    )
    const { world, events } = run(w, 1)
    expect(ofType(events, 'absorb').map((a) => [a.id, a.others])).toEqual([[1, [3]]])
    expect(stageOf(world, 1)).toBe(1)
    expect(stageOf(world, 2)).toBe(0)
    // Tirage répété : même résultat (déterministe).
    expect(ofType(run(w, 1).events, 'absorb').map((a) => a.id)).toEqual([1])
  })
})

describe('Porteur : déplacement et orientation', () => {
  it('sac pas plein : il marche vers l’Abattu le plus proche à moins de 12 m, en pivotant vers le joueur à 90°/s au plus', () => {
    const playerStart = vec(-8, 4)
    let w = scene(
      [
        { family: 'porteur', pos: vec(0, 0), facing: 0, state: 'hostile' },
        { family: 'souriant', pos: vec(9, 0), state: 'abattu' },
        { family: 'souriant', pos: vec(0, -11), state: 'abattu' },
      ],
      { families, playerStart },
    )
    w = settled(w, 1)
    const n = 60
    const { worlds, events } = trace(w, n)
    expect(ofType(events, 'absorb')).toHaveLength(0)
    for (let i = 1; i <= n; i++) {
      const prev = creature(worlds[i - 1] as World, 1)
      const cur = creature(worlds[i] as World, 1)
      const body = creature(worlds[i - 1] as World, 2)
      // Pas de 2 m/s, dirigé vers le corps le plus proche.
      expect(dist(prev.pos, cur.pos)).toBeCloseTo(P.speed / TICK_HZ, 9)
      expect(angleDiff(angleOf(prev.pos, cur.pos), angleOf(prev.pos, body.pos))).toBeLessThan(1e-9)
      // Rotation bornée, toujours vers le joueur.
      const toPlayer = angleOf(prev.pos, playerStart)
      expect(angleDiff(prev.facing, cur.facing)).toBeLessThanOrEqual(MAX_TURN + 1e-12)
      expect(angleDiff(cur.facing, toPlayer)).toBeLessThan(angleDiff(prev.facing, toPlayer))
    }
    // Après 60 ticks : 90° de rotation exactement (le joueur est à plus de 90° de l'axe de départ).
    expect(angleDiff(creature(worlds[n] as World, 1).facing, 0)).toBeCloseTo(Math.PI / 2, 9)
    // Il finit par regarder le joueur : le sac est loin de lui.
    const later = run(worlds[n] as World, 60).world
    expect(inPorteurRearArc(creature(later, 1), later.player.pos)).toBe(false)
    expect(
      angleDiff(creature(later, 1).facing, angleOf(creature(later, 1).pos, later.player.pos)),
    ).toBeLessThan(MAX_TURN)
  })

  it('un Abattu à plus de 12 m ne l’attire pas', () => {
    let w = scene(
      [
        { family: 'porteur', pos: vec(0, 0), facing: Math.PI, state: 'hostile' },
        { family: 'souriant', pos: vec(12.5, 0), state: 'abattu' },
      ],
      { families, playerStart: vec(-10, 0) },
    )
    w = settled(w, 1)
    const { world, events } = run(w, 60)
    expect(creature(world, 1).pos.x).toBeLessThan(0)
    expect(creature(world, 2).pos).toEqual(vec(12.5, 0))
    expect(ofType(events, 'absorb')).toHaveLength(0)
  })

  it('sans corps à prendre, il attaque : Bousculade de 5 dans l’axe où il regarde', () => {
    let w = scene([{ family: 'porteur', pos: vec(3, 0), facing: Math.PI, state: 'hostile' }], {
      families,
    })
    w = settled(w, 1)
    const { events } = run(w, 90)
    const starts = ofType(events, 'action-start').filter((a) => a.id === 1)
    expect(starts[0]?.action).toBe('bousculade')
    const hits = ofType(events, 'hit').filter((h) => h.target === 'player')
    expect(hits[0]).toMatchObject({ amount: P.bousculade.damage, damageType: 'creature', by: 1 })
    expect(hits[0]?.tick).toBe((starts[0]?.tick ?? 0) + P.bousculade.telegraph)
  })
})

describe('Porteur : stade 3', () => {
  const threeBodies = (porteurPos: { x: number; z: number }, playerStart: { x: number; z: number }) =>
    scene(
      [
        { family: 'porteur', pos: porteurPos, facing: 0, state: 'rituel' },
        { family: 'souriant', pos: add(porteurPos, vec(-1, 0.5)), state: 'abattu' },
        { family: 'souriant', pos: add(porteurPos, vec(-1, -0.5)), state: 'abattu' },
        { family: 'souriant', pos: add(porteurPos, vec(-1.5, 0)), state: 'abattu' },
      ],
      { families, playerStart },
    )
  const stage3Tick = 1 + 2 * P.absorbEvery

  it('il marche sur le joueur à 3 m/s et éclate à son contact (cause contact)', () => {
    const w = threeBodies(vec(0, 0), vec(6, 0))
    const { worlds, events } = trace(w, stage3Tick + P.burstAfter)
    expect(ofType(events, 'absorb').at(-1)?.tick).toBe(stage3Tick)
    const [burst] = ofType(events, 'burst')
    expect(burst).toMatchObject({ id: 1, cause: 'contact', stage: 3 })
    const t = burst?.tick ?? 0
    expect(t).toBeLessThan(stage3Tick + P.burstAfter)
    // Avant l'éclatement : 3 m/s vers le joueur, et le contact au tick qui précède.
    for (let i = stage3Tick + 2; i < t - 1; i++) {
      const prev = worlds[i - 1] as World
      const a = creature(prev, 1).pos
      const b = creature(worlds[i] as World, 1).pos
      expect(dist(a, b)).toBeCloseTo(P.speedStage3 / TICK_HZ, 9)
      expect(angleDiff(angleOf(a, b), angleOf(a, prev.player.pos))).toBeLessThan(1e-9)
    }
    const before = worlds[t - 1] as World
    expect(dist(creature(before, 1).pos, before.player.pos)).toBeCloseTo(
      TUNING.radiusSmall + TUNING.playerRadius,
      6,
    )
    expect(ofType(events, 'burst')).toHaveLength(1)
    // Dès le tick de l'éclatement, le sac est vide et le Porteur à terre.
    const at = worlds[t] as World
    expect(stageOf(at)).toBe(0)
    expect(creature(at, 1).state.kind).toBe('abattu')
  })

  it('sans contact, il éclate 240 ticks après avoir atteint le stade 3 (cause delai)', () => {
    const w = threeBodies(vec(-6, 0), vec(8, 0))
    const { world, events } = run(w, stage3Tick + P.burstAfter + 5)
    expect(ofType(events, 'absorb').at(-1)?.tick).toBe(stage3Tick)
    expect(ofType(events, 'burst').map((b) => [b.tick, b.cause, b.stage])).toEqual([
      [stage3Tick + P.burstAfter, 'delai', 3],
    ])
    expect(creature(world, 1).state.kind).toBe('abattu')
  })

  // Revue P0 M2 : les 4 s du stade 3 ne courent que debout. Abattu, le délai est suspendu ; relevé, il repart de zéro.
  it('abattu au stade 3 puis relevé : il n’éclate pas au premier tick debout, mais 240 ticks plus tard', () => {
    const w = threeBodies(vec(-6, 0), vec(12, 0))
    const at3 = run(w, stage3Tick + 20)
    expect(stageOf(at3.world)).toBe(3)
    // Abattu 20 ticks après le stade 3 (chirurgie d'état : seul compte ici le minuteur du Porteur).
    const t = at3.world.tick
    const down = withCreature(at3.world, 1, {
      chair: 0,
      state: {
        kind: 'abattu',
        since: t,
        riseAt: t + TUNING.relevementOrdinaire,
        cryAt: null,
        claimedBy: null,
      },
    })
    const r = run(down, TUNING.relevementOrdinaire + P.burstAfter + 5)
    const [rise] = ofType(r.events, 'rise').filter((e) => e.id === 1)
    expect(rise).toMatchObject({ tick: t + TUNING.relevementOrdinaire, cause: 'delai' })
    const riseTick = rise?.tick ?? 0
    // Premier tick debout : riseTick + 1 (le Relèvement a lieu après le tour des créatures).
    expect(ofType(r.events, 'burst').map((b) => [b.tick, b.cause, b.stage])).toEqual([
      [riseTick + 1 + P.burstAfter, 'delai', 3],
    ])
  })
})

describe('Porteur : coups et arc arrière', () => {
  const lone = (playerStart: { x: number; z: number }) =>
    scene([{ family: 'porteur', pos: vec(0, 0), facing: 0, state: 'rituel' }], { families, playerStart })
  const strikeAt = (x: { x: number; z: number }) => cmd({ strike: true, aim: x })
  // Au-delà de 2,5 m (pas d'alerte de proximité), à portée de Couperet (2,2 m + rayon de la cible).
  const R = 2.55

  it('un coup dans le dos (arc arrière de 120°) le fait éclater sur-le-champ, même vide (cause dos)', () => {
    const { world, events } = run(lone(vec(-R, 0)), 1, strikeAt(vec(0, 0)))
    expect(byPlayerOn(events, 1).map((h) => h.tick)).toEqual([1])
    expect(ofType(events, 'burst').map((b) => [b.tick, b.cause, b.stage, b.others])).toEqual([
      [1, 'dos', 0, []],
    ])
    expect(creature(world, 1).state.kind).toBe('abattu')
    // Sac vide : rayon 2 m, le joueur à 2,55 m n'est pas touché.
    expect(ofType(events, 'hit').filter((h) => h.target === 'player')).toHaveLength(0)
  })

  it('l’arc arrière fait 120° : à 59° de l’axe du dos il éclate, à 61° non', () => {
    for (const side of [1, -1]) {
      const inside = atPolar(vec(0, 0), Math.PI + side * ((59 * Math.PI) / 180), R)
      const outside = atPolar(vec(0, 0), Math.PI + side * ((61 * Math.PI) / 180), R)
      expect(ofType(run(lone(inside), 1, strikeAt(vec(0, 0))).events, 'burst')).toHaveLength(1)
      const front = run(lone(outside), 1, strikeAt(vec(0, 0)))
      expect(byPlayerOn(front.events, 1)).toHaveLength(1)
      expect(ofType(front.events, 'burst')).toHaveLength(0)
    }
  })

  it('de face, le coup touche son corps : Chair entamée, pas d’éclatement', () => {
    const { world, events } = run(lone(vec(R, 0)), 1, strikeAt(vec(0, 0)))
    const hits = byPlayerOn(events, 1)
    expect(hits.map((h) => h.amount)).toEqual([TUNING.weapons.couperet.damage])
    expect(ofType(events, 'burst')).toHaveLength(0)
    expect(creature(world, 1).chair).toBe(P.chair - TUNING.weapons.couperet.damage)
    expect(creature(world, 1).state.kind).toBe('hostile')
  })
})

describe('Porteur : éclatement', () => {
  it('forme de l’éclatement à chaque stade : rayon 2 + stade, dégâts 10 + 10 × stade, alerte à 15 m', () => {
    for (const stage of [0, 1, 2, 3]) {
      const bodies = Array.from({ length: stage }, () => ({
        family: 'souriant' as const,
        pos: vec(0, 0),
        state: 'abattu' as const,
      }))
      const w0 = scene([{ family: 'porteur', pos: vec(0, 0), facing: 0, state: 'rituel' }, ...bodies], {
        families,
        playerStart: FAR,
      })
      const w = loaded(
        w0,
        1,
        bodies.map((_, i) => i + 2),
      )
      const self = creature(w, 1)
      const effects = porteur.onPlayerHit?.(w, self, vec(-2, 0)) ?? []
      const damage = effects.find((e) => e.kind === 'damage') as Extract<Effect, { kind: 'damage' }>
      expect(damage).toEqual({
        kind: 'damage',
        area: { kind: 'circle', center: self.pos, radius: P.burstBaseRadius + stage },
        amount: P.burstDamageBase + P.burstDamagePerStage * stage,
        source: 'burst',
        abatSmall: true,
        staggerLarge: P.burstStaggerLarge,
        hitsCreatures: true,
      })
      expect(P.burstBaseRadius + stage).toBe(2 + stage)
      expect(P.burstDamageBase + P.burstDamagePerStage * stage).toBe(10 + 10 * stage)
      expect(effects).toContainEqual({ kind: 'alert', center: self.pos, radius: 15, cause: 'burst' })
      expect(effects).toContainEqual({ kind: 'expelAll', cause: 'dos' })
      expect(effects).toContainEqual({ kind: 'selfAbattu' })
      // Coup de face : aucun effet propre au Porteur.
      expect(porteur.onPlayerHit?.(w, self, vec(2, 0))).toEqual([])
    }
  })

  it('abat les petits ordinaires, fait vaciller grands et Résistants 90 ticks, expulse les corps, abat le Porteur, alerte à 15 m, stade remis à 0', () => {
    const playerStart = vec(-2.55, 0)
    // Les corps du sac ont des id plus petits que le Porteur : la Frappe qui déclenche l'éclatement les a
    // déjà dépassés quand ils sont expulsés. Avec l'ordre inverse, le cœur les achève dans la même Frappe
    // (boucle de Frappe sur les créatures vivantes, crochet appliqué en plein coup) : défaut du cœur signalé
    // dans .mercy/requests/C1-porteur.md, hors du périmètre de ce module.
    const w0 = scene(
      [
        { family: 'souriant', pos: vec(0, 0), state: 'abattu' }, // 1, dans le sac
        { family: 'souriant', pos: vec(0, 0), state: 'abattu' }, // 2, dans le sac
        { family: 'porteur', pos: vec(0, 0), facing: 0, state: 'rituel' }, // 3
        { family: 'souriant', pos: vec(4.3, 0), state: 'rituel' }, // 4, dans le rayon (4 m + 0,4)
        { family: 'souriant', pos: vec(0, 4.5), state: 'rituel' }, // 5, juste hors du rayon
        { family: 'souriant', pos: vec(0, -3), state: 'rituel', cicatrices: 3 }, // 6, Résistant
        { family: 'recousu', pos: vec(2.5, 2.5), state: 'rituel' }, // 7, grande créature
        { family: 'souriant', pos: vec(14, 0), state: 'rituel' }, // 8, à 14 m : alertée
        { family: 'souriant', pos: vec(-14, 8), state: 'rituel' }, // 9, à 16,1 m : rien
      ],
      { families: { porteur, recousu: mannequin() }, playerStart },
    )
    const w = loaded(w0, 3, [1, 2])
    const resistantChair = creature(w, 6).chair
    const { world, events } = run(w, 1, cmd({ strike: true, aim: vec(0, 0) }))
    const t = 1
    const dmg = P.burstDamageBase + 2 * P.burstDamagePerStage

    expect(ofType(events, 'burst')).toEqual([
      { type: 'burst', tick: t, id: 3, others: [1, 2], cause: 'dos', stage: 2 },
    ])
    expect(ofType(events, 'expel')).toEqual([{ type: 'expel', tick: t, id: 3, others: [1, 2] }])
    for (const id of [1, 2]) {
      const c = creature(world, id)
      expect(c.state.kind).toBe('abattu')
      expect(c.unionOf).toBeNull()
      expect(ofType(events, 'fell').some((f) => f.id === id)).toBe(true)
    }
    // Le Porteur vide tombe Abattu, stade remis à 0.
    expect(creature(world, 3).state.kind).toBe('abattu')
    expect(stageOf(world, 3)).toBe(0)
    // Joueur dans le rayon : 10 + 10 × 2.
    expect(ofType(events, 'hit').filter((h) => h.target === 'player')).toEqual([
      { type: 'hit', tick: t, target: 'player', amount: dmg, damageType: 'burst', by: 3 },
    ])
    expect(world.player.vie).toBe(TUNING.vieMax - dmg)
    // Petit ordinaire dans le rayon : abattu quelle que soit sa Chair. Juste au-delà : intact.
    expect(creature(world, 4).state.kind).toBe('abattu')
    expect(creature(world, 5).chair).toBe(TUNING.souriant.chair)
    expect(ofType(events, 'hit').some((h) => h.target === 5)).toBe(false)
    // Résistant et grande créature : dégâts, vacillement de 90 ticks, toujours debout.
    for (const [id, chair0] of [
      [6, resistantChair],
      [7, 160],
    ] as const) {
      const c = creature(world, id)
      expect(c.chair).toBeCloseTo(chair0 - dmg, 9)
      expect(c.stunnedUntil).toBe(t + P.burstStaggerLarge)
      expect(c.state.kind).toBe('hostile')
    }
    expect(P.burstStaggerLarge).toBe(90)
    // Alerte de bruit à 15 m.
    const alerts = ofType(events, 'alert')
    expect(alerts.find((a) => a.id === 5)?.cause).toBe('burst')
    expect(alerts.find((a) => a.id === 8)?.cause).toBe('burst')
    expect(creature(world, 9).state.kind).toBe('rituel')
    // L'éclatement n'achève personne (L4).
    expect(ofType(events, 'death')).toHaveLength(0)
  })
})

describe('Porteur : Union (L5)', () => {
  it('chargé, abattu de face puis achevé : tout ce qu’il contient meurt au même tick', () => {
    const w = scene(
      [
        { family: 'porteur', pos: vec(0, 0), facing: Math.PI, state: 'rituel' },
        { family: 'souriant', pos: vec(1, 0.5), state: 'abattu' },
        { family: 'souriant', pos: vec(1, -0.5), state: 'abattu' },
      ],
      { families, playerStart: vec(-10, 0) },
    )
    const loadedUp = run(w, 100)
    expect(ofType(loadedUp.events, 'absorb').flatMap((a) => a.others)).toEqual([2, 3])
    // Le joueur vient de face, vise le Porteur et frappe dès qu'il est à portée.
    const reach = TUNING.weapons.couperet.reach + TUNING.radiusSmall
    const face = (x: World) => {
      const p = creature(x, 1)
      const d = dist(x.player.pos, p.pos)
      return d <= reach - 0.1
        ? cmd({ strike: true, aim: p.pos })
        : cmd({ move: norm(sub(p.pos, x.player.pos)), aim: p.pos })
    }
    const { world, events } = run(loadedUp.world, 600, (x) =>
      creature(x, 1).state.kind === 'mort' ? cmd() : face(x),
    )
    expect(ofType(events, 'burst')).toHaveLength(0)
    const fell = ofType(events, 'fell').find((f) => f.id === 1)
    const deaths = ofType(events, 'death')
    expect(fell).toBeDefined()
    expect(deaths.map((d) => [d.id, d.by])).toEqual([
      [1, 'achevement'],
      [2, 'union'],
      [3, 'union'],
    ])
    const t = deaths[0]?.tick
    expect(deaths.every((d) => d.tick === t)).toBe(true)
    expect(t).toBeGreaterThan(fell?.tick ?? Number.POSITIVE_INFINITY)
    // Leurs voix étouffées se coupent au même tick (D8, L5).
    expect(
      ofType(events, 'cry-stop')
        .filter((c) => c.id === 2 || c.id === 3)
        .map((c) => [c.id, c.tick, c.cause]),
    ).toEqual([
      [2, t, 'death'],
      [3, t, 'death'],
    ])
    for (const id of [1, 2, 3]) expect(creature(world, id).state.kind).toBe('mort')
  })
})

describe('Porteur : Charge (§9)', () => {
  it('une Charge qui le traverse finit dans son dos, et la Frappe suivante fait éclater le sac', () => {
    let w = scene(
      [
        { family: 'porteur', pos: vec(4, 0), facing: Math.PI, state: 'hostile' },
        { family: 'souriant', pos: vec(4, 0), state: 'abattu' },
        { family: 'souriant', pos: vec(4, 0), state: 'abattu' },
      ],
      { families },
    )
    w = settled(loaded(w, 1, [2, 3]), 1)
    w = withPlayer(w, { ferveur: TUNING.charge.cost })
    const charge = run(w, 1, cmd({ rite: 'charge', aim: vec(5, 0) }))
    expect(ofType(charge.events, 'player-rite').map((r) => r.rite)).toEqual(['charge'])
    // Fin de la ruée.
    const dash = run(charge.world, TUNING.charge.dashTicks - 1)
    const p = creature(dash.world, 1)
    expect(byPlayerOn(dash.events, 1).map((h) => h.amount)).toEqual([TUNING.charge.damage])
    expect(ofType(dash.events, 'burst')).toHaveLength(0) // touché de face pendant la ruée
    expect(inPorteurRearArc(p, dash.world.player.pos)).toBe(true) // la ruée finit dans son dos
    // Après la Charge, le joueur se replace derrière le sac et ne frappe que de dos, à portée.
    const reach = TUNING.weapons.couperet.reach + TUNING.radiusSmall
    const flank = (x: World) => {
      if (x.player.action) return cmd()
      const q: Creature = creature(x, 1)
      const behind = add(q.pos, scale(fromAngle(q.facing + Math.PI), 1.2))
      const ok = inPorteurRearArc(q, x.player.pos) && dist(x.player.pos, q.pos) <= reach
      return cmd({ move: norm(sub(behind, x.player.pos)), aim: q.pos, strike: ok })
    }
    const after = run(dash.world, 120 - TUNING.charge.dashTicks, flank)
    const strikes = byPlayerOn(after.events, 1)
    const bursts = ofType(after.events, 'burst')
    expect(bursts.map((b) => [b.cause, b.stage, b.others])).toEqual([['dos', 2, [2, 3]]])
    expect(strikes[0]?.tick).toBe(bursts[0]?.tick)
    expect((bursts[0]?.tick ?? 999) - 1).toBeLessThanOrEqual(120)
  })

  // Revue P0 M1 et audit §30.2 (V-2) : une Charge est un seul geste (L4, « Écarts », phase C). Scénario de
  // l'audit : la Charge frappe le Porteur dans le dos, l'éclatement abat un Souriant au tick 7 ; la même Charge
  // passe sur lui au tick 12 et ne doit pas l'achever. Un corps déjà à terre avant la Charge, lui, est achevé.
  it('n’achève jamais ce que l’éclatement qu’elle a déclenché vient d’abattre, même aux ticks suivants de la ruée', () => {
    let w = scene(
      [
        { family: 'porteur', pos: vec(3, 0), facing: 0 }, // regarde +x : le joueur, en (0, 0), est dans son dos
        { family: 'souriant', pos: vec(4.6, 0) }, // sur la ligne, à 1,6 m du Porteur
        { family: 'souriant', pos: vec(6.5, 0), state: 'abattu' }, // à terre avant la Charge, hors du rayon
      ],
      { families },
    )
    w = withPlayer(w, { ferveur: 100 })
    const r = run(w, TUNING.charge.duration, (x) =>
      cmd({ rite: x.tick === 0 ? 'charge' : null, aim: vec(10, 0) }),
    )
    expect(ofType(r.events, 'burst').map((b) => [b.tick, b.id, b.cause])).toEqual([[7, 1, 'dos']])
    expect(ofType(r.events, 'fell').map((e) => [e.tick, e.id])).toEqual([
      [7, 2],
      [7, 1],
    ])
    expect(ofType(r.events, 'death').map((e) => [e.id, e.by])).toEqual([[3, 'achevement']])
    expect(creature(r.world, 2).state.kind).toBe('abattu')
    // La ligne de la Charge est bien passée sur lui après l'éclatement.
    const end = r.world.player.pos
    expect(end.x).toBeGreaterThan(creature(r.world, 2).pos.x)
    expect(Math.abs(creature(r.world, 2).pos.z)).toBeLessThan(TUNING.charge.hitHalfWidth)
  })
})
