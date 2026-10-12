// C2 : le Recousu (§8.10), brute qu'on désarme membre par membre (§8.4).
import { describe, expect, it } from 'vitest'
import { cmd, creature, ofType, run, scene, withCreature, withPlayer } from '../testing'
import type { Limb, SimEvent, Vec2, World } from '../types'
import { add, dist, fromAngle, scale, vec } from '../vec'
import { recousu } from './recousu'

const FAMILIES = { recousu }
const FIRST_DECISION = 24 // créature placée Hostile au tick 0 : pivot de tête de 0,4 s (L7)

// Recousu Hostile en (x, 0), tourné vers le joueur à l'origine.
const facing = (x: number): World =>
  scene([{ family: 'recousu', pos: vec(x, 0), state: 'hostile', facing: Math.PI }], { families: FAMILIES })

const starts = (events: readonly SimEvent[], id = 1): string[] =>
  ofType(events, 'action-start')
    .filter((e) => e.id === id)
    .map((e) => e.action)

const limbs = (droit: Limb['state'], gauche: Limb['state']): Limb[] => [
  { id: 'brasDroit', hp: droit === 'ok' ? 40 : 0, hpMax: 40, state: droit },
  { id: 'brasGauche', hp: gauche === 'ok' ? 40 : 0, hpMax: 40, state: gauche },
]

const hitsOnPlayer = (events: readonly SimEvent[]) =>
  ofType(events, 'hit').filter((h) => h.target === 'player')

describe('Recousu : caractéristiques', () => {
  it('grande créature non support, 160 de Chair, 2,5 m/s, deux bras de 40 PV', () => {
    expect(recousu.kind).toBe('recousu')
    expect(recousu.size).toBe('large')
    expect(recousu.isSupport).toBe(false)
    expect(recousu.base).toEqual({
      chair: 160,
      speed: 2.5,
      limbs: [
        { id: 'brasDroit', hp: 40 },
        { id: 'brasGauche', hp: 40 },
      ],
    })
    expect(recousu.actions.marteau).toMatchObject({
      kind: 'attaque',
      limb: 'brasDroit',
      telegraphTicks: 54,
      reach: 2.5,
    })
    expect(recousu.actions.empoignade).toMatchObject({
      kind: 'attaque',
      limb: 'brasGauche',
      telegraphTicks: 60,
    })
    expect(recousu.actions.coupDeTete).toMatchObject({ kind: 'attaque', reach: 5 })
    expect(recousu.actions.coupDeTete?.limb).toBeUndefined()
  })
})

describe('Recousu : Marteau (bras droit)', () => {
  it('à 2,6 m : Marteau, télégraphe de 54 ticks, 22 dégâts au tick actif', () => {
    const { events, world } = run(facing(2.6), FIRST_DECISION + 54)
    const start = ofType(events, 'action-start')[0]
    expect(start).toMatchObject({ id: 1, action: 'marteau', tick: FIRST_DECISION })
    const hit = hitsOnPlayer(events)
    expect(hit).toHaveLength(1)
    expect(hit[0]).toMatchObject({ tick: FIRST_DECISION + 54, amount: 22, by: 1 })
    expect(world.player.vie).toBe(78)
  })

  it("cône de 2,5 m sur 70° : touché à 2,9 m dans l'axe, épargné à 3,0 m ou à 45° de l'axe", () => {
    const telegraph = run(facing(2.6), FIRST_DECISION + 6).world
    const place = (p: Vec2) => hitsOnPlayer(run(withPlayer(telegraph, { pos: p }), 54).events).length
    const recousuPos = creature(telegraph, 1).pos
    // Rayon du joueur 0,45 m compris : la portée utile dans l'axe est 2,95 m.
    expect(place(add(recousuPos, vec(-2.9, 0)))).toBe(1)
    expect(place(add(recousuPos, vec(-3.0, 0)))).toBe(0)
    expect(place(add(recousuPos, scale(fromAngle(Math.PI + Math.PI / 4), 2)))).toBe(0)
  })
})

describe('Recousu : Empoignade (bras gauche)', () => {
  it('joueur collé : télégraphe de 60 ticks, 15 dégâts et projection à 4 m', () => {
    const before = run(facing(2), FIRST_DECISION + 59)
    expect(ofType(before.events, 'action-start')[0]).toMatchObject({
      action: 'empoignade',
      tick: FIRST_DECISION,
    })
    expect(hitsOnPlayer(before.events)).toHaveLength(0)
    const r = run(before.world, 1)
    expect(hitsOnPlayer(r.events)[0]).toMatchObject({ tick: FIRST_DECISION + 60, amount: 15, by: 1 })
    expect(r.world.player.pos.x).toBeCloseTo(-4, 9)
    expect(r.world.player.pos.z).toBeCloseTo(0, 9)
  })
})

describe('Recousu : Coup de tête (plus aucun bras valide)', () => {
  const armless = (x: number, droit: Limb['state'], gauche: Limb['state']) =>
    withCreature(facing(x), 1, { limbs: limbs(droit, gauche) })

  it('ruée de 5 m vers le joueur, 18 dégâts', () => {
    const w = armless(7, 'severed', 'broken')
    const r = run(w, 200)
    const start = ofType(r.events, 'action-start').find((e) => e.action === 'coupDeTete')
    expect(start).toBeDefined()
    const startTick = start?.tick ?? -1
    const before = run(w, startTick + 35).world
    const after = run(before, 1)
    expect(dist(creature(before, 1).pos, creature(after.world, 1).pos)).toBeCloseTo(5, 9)
    expect(hitsOnPlayer(after.events)[0]).toMatchObject({ tick: startTick + 36, amount: 18, by: 1 })
    expect(starts(r.events)).not.toContain('marteau')
    expect(starts(r.events)).not.toContain('empoignade')
  })

  it("la direction est prise au télégraphe : le joueur qui s'écarte l'esquive", () => {
    const w = armless(4, 'broken', 'broken')
    const r = run(w, FIRST_DECISION + 36, (wo) =>
      cmd({ move: wo.tick > FIRST_DECISION ? vec(0, 1) : vec(0, 0) }),
    )
    expect(ofType(r.events, 'action-hit')[0]).toMatchObject({
      action: 'coupDeTete',
      tick: FIRST_DECISION + 36,
    })
    expect(creature(r.world, 1).pos.x).toBeCloseTo(0, 9)
    expect(hitsOnPlayer(r.events)).toHaveLength(0)
  })

  it('un seul bras valide suffit à ne pas donner de la tête', () => {
    const right = run(armless(4, 'ok', 'severed'), 300)
    expect(starts(right.events)).toContain('marteau')
    expect(starts(right.events)).not.toContain('coupDeTete')
    const left = run(armless(4, 'broken', 'ok'), 300)
    expect(starts(left.events)).toContain('empoignade')
    expect(starts(left.events)).not.toContain('coupDeTete')
  })
})

describe('Recousu : chaque attaque dépend de son bras', () => {
  it('trois coups de Couperet pendant le Marteau sectionnent le bras droit (40 PV) : plus de Marteau', () => {
    // Le Marteau part au tick 24 ; le joueur frappe aux ticks 25, 46 et 67 (12 + 12 + 18 = 42).
    const r = run(facing(2.6), 66, (wo) => cmd({ strike: wo.tick >= 24, aim: vec(2.6, 0) }))
    expect(ofType(r.events, 'sever')).toHaveLength(0)
    expect(creature(r.world, 1).limbs[0]).toMatchObject({ id: 'brasDroit', hp: 16, state: 'ok' })
    const cut = run(r.world, 1, cmd({ strike: true, aim: vec(2.6, 0) }))
    expect(ofType(cut.events, 'sever')[0]).toMatchObject({ owner: 1, limb: 'brasDroit', tick: 67 })
    expect(ofType(cut.events, 'action-interrupted')[0]).toMatchObject({ id: 1, action: 'marteau' })
    // Joueur à 2,6 m du Recousu, hors de portée d'Empoignade : avec son bras droit il frapperait du Marteau.
    const self = creature(cut.world, 1)
    const away = withPlayer(cut.world, { pos: add(self.pos, vec(-2.6, 0)), action: null })
    const after = run(away, 100)
    expect(starts(after.events)).not.toContain('marteau')
    expect(starts(after.events)[0]).toBe('empoignade')
  })

  it("deux coups de Masse pendant l'Empoignade brisent le bras gauche : plus d'Empoignade, pas de Membre errant", () => {
    const w = withPlayer(facing(2), { weapon: 'masse' })
    const r = run(w, 60, (wo) => cmd({ strike: wo.tick >= 24 && wo.tick < 59, aim: vec(2, 0) }))
    expect(ofType(r.events, 'break')[0]).toMatchObject({ owner: 1, limb: 'brasGauche' })
    expect(ofType(r.events, 'action-interrupted')[0]).toMatchObject({ id: 1, action: 'empoignade' })
    expect(r.world.creatures.filter((c) => c.family === 'membre')).toHaveLength(0)
    expect(creature(r.world, 1).limbs[1]?.state).toBe('broken')
    const breakTick = ofType(r.events, 'break')[0]?.tick ?? -1
    const after = [...r.events.filter((e) => e.tick >= breakTick), ...run(r.world, 200).events]
    expect(starts(after)).not.toContain('empoignade')
    expect(starts(after)[0]).toBe('marteau')
  })

  it("le Relèvement rend les bras et les attaques qu'ils portent", () => {
    const w0 = withCreature(facing(2.6), 1, {
      limbs: limbs('broken', 'broken'),
      chair: 0,
      state: { kind: 'abattu', since: 0, riseAt: 10, cryAt: null, claimedBy: null },
    })
    const r = run(w0, 10 + 1)
    expect(ofType(r.events, 'rise')).toHaveLength(1)
    expect(creature(r.world, 1).limbs.map((l) => l.state)).toEqual(['ok', 'ok'])
    expect(starts(r.events)).toEqual(['marteau'])
  })
})
