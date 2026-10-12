// B2 §6 : B2-immobile, négligent, B2-script(cible, mode). Une situation construite par branche du pseudo-code,
// puis les scènes S1b, S1c et S1d jouées sur la fixture S1 du §5 avec le registre réel des familles.
import { describe, expect, it } from 'vitest'
import {
  FAMILIES,
  type PlayerCommands,
  type SimEvent,
  type SpawnDef,
  step,
  type Vec2,
  type World,
} from '../../sim/index'
import { creature, scene, withPlayer } from '../../sim/testing'
import type { Policy } from '../policy'
import { decideNegligent, IDLE, immobile, negligent, SceneInvalide, type ScriptMemory, script } from './b2'

const v = (x: number, z: number): Vec2 => ({ x, z })
const S = (x: number, z: number, state: SpawnDef['state'], cicatrices: 0 | 1 | 2 | 3 = 0): SpawnDef => ({
  family: 'souriant',
  pos: v(x, z),
  state,
  cicatrices,
})
const W = (spawns: readonly SpawnDef[]): World => scene(spawns, { families: FAMILIES })
const close = (a: Vec2, b: Vec2): void => {
  expect(a.x).toBeCloseTo(b.x, 9)
  expect(a.z).toBeCloseTo(b.z, 9)
}
const NONE: Omit<PlayerCommands, 'move' | 'aim'> = {
  strike: false,
  dodge: false,
  sentence: false,
  rite: null,
  swapWeapon: false,
}

describe('B2-immobile', () => {
  it('renvoie IDLE(w) : aucun mouvement, vise la position du joueur', () => {
    const w = withPlayer(W([S(1, 0, 'hostile')]), { pos: v(2, 3) })
    expect(immobile.decide(w, null)[0]).toEqual({ move: v(0, 0), aim: v(2, 3), ...NONE })
    expect(IDLE(w)).toEqual({ move: v(0, 0), aim: v(2, 3), ...NONE })
  })
})

describe('négligent', () => {
  it('aucune créature debout (Abattus, morts) : IDLE', () => {
    const w = W([S(1, 0, 'abattu'), S(0, 1, 'mort'), S(1, 1, 'abattu', 3)])
    expect(decideNegligent(w)).toEqual(IDLE(w))
  })
  it('cible la créature debout la plus proche, Rituel ou Hostile, et ignore les corps', () => {
    const w = W([S(0.5, 0, 'abattu'), S(4, 0, 'rituel'), S(0, 3, 'hostile')])
    const out = decideNegligent(w)
    expect(out.aim).toEqual(v(0, 3))
    close(out.move, v(0, 1))
    expect(out.strike).toBe(false)
  })
  it('égalité de distance : plus petit id', () => {
    expect(decideNegligent(W([S(0, 3, 'hostile'), S(3, 0, 'hostile')])).aim).toEqual(v(0, 3))
  })
  it('marche tant que d > 1,8 ; frappe dès que d ≤ 2,2', () => {
    const at = (d: number) => decideNegligent(W([S(d, 0, 'hostile')]))
    expect(at(2.3)).toEqual({ move: v(1, 0), aim: v(2.3, 0), ...NONE })
    expect(at(2.2)).toEqual({ move: v(1, 0), aim: v(2.2, 0), ...NONE, strike: true })
    expect(at(1.8)).toEqual({ move: v(0, 0), aim: v(1.8, 0), ...NONE, strike: true })
  })
  it('ne pare rien et ne touche jamais aux corps : ni Esquive, ni Sentence, ni Rite', () => {
    const w = withPlayer(W([S(1, 0, 'hostile'), S(0, 1, 'abattu', 3), S(-1, 0, 'abattu')]), {
      vie: 5,
      ferveur: 100,
    })
    const out = negligent.decide(w, null)[0]
    expect([out.dodge, out.sentence, out.rite, out.swapWeapon]).toEqual([false, false, null, false])
  })
})

describe('B2-script(cible, mode)', () => {
  const mem = (patch: Partial<ScriptMemory> = {}): ScriptMemory => ({
    clangVu: false,
    debutAction: null,
    O: v(0, 0),
    ...patch,
  })
  it('init : { clangVu : faux, debutAction : null }, O = position initiale du joueur', () => {
    const w = withPlayer(W([S(3, 0, 'abattu')]), { pos: v(1, 2) })
    expect(script(1, 'acheve').init(w)).toEqual({ clangVu: false, debutAction: null, O: v(1, 2) })
  })
  it('avant la décision, clangVu passe à vrai sur un évènement clang de la cible, et y reste', () => {
    const w = W([S(1, 0, 'abattu', 3), S(0, 1, 'abattu', 3)])
    const clang = (id: number): SimEvent => ({ type: 'clang', tick: 0, id })
    const p = script(1, 'clang-puis-sentence')
    expect(p.decide({ ...w, events: [clang(2)] }, mem())[1].clangVu).toBe(false)
    expect(p.decide({ ...w, events: [clang(1)] }, mem())[1].clangVu).toBe(true)
    expect(p.decide({ ...w, events: [] }, mem({ clangVu: true }))[1].clangVu).toBe(true)
  })
  it('cible morte, joueur à plus de 0,2 m de O : retrait vers O, sans viser ni frapper', () => {
    const w = withPlayer(W([S(1, 0, 'mort')]), { pos: v(3, 4) })
    const [out] = script(1, 'acheve').decide(w, mem())
    expect(out.aim).toEqual(v(3, 4))
    close(out.move, v(-0.6, -0.8))
    expect(out.strike || out.sentence).toBe(false)
  })
  it('cible morte, joueur à 0,2 m de O ou moins : IDLE', () => {
    const w = withPlayer(W([S(1, 0, 'mort')]), { pos: v(0.2, 0) })
    expect(script(1, 'acheve').decide(w, mem())[0]).toEqual(IDLE(w))
  })
  it('d > 1,5 : marche vers la cible en la visant, debutAction reste null', () => {
    const w = W([S(0, 1.6, 'abattu')])
    const [out, m] = script(1, 'acheve').decide(w, mem())
    expect(out).toEqual({ move: v(0, 1), aim: v(0, 1.6), ...NONE })
    expect(m.debutAction).toBeNull()
  })
  it('d ≤ 1,5 : debutAction fixé au premier tick, puis gardé', () => {
    const w = { ...W([S(1.5, 0, 'abattu')]), tick: 40 }
    const p = script(1, 'acheve')
    expect(p.decide(w, mem())[1].debutAction).toBe(40)
    expect(p.decide(w, mem({ debutAction: 12 }))[1].debutAction).toBe(12)
  })
  it('plus de 120 ticks après debutAction : scène invalide, arrêt (erreur), pas un verdict', () => {
    const w = { ...W([S(1, 0, 'abattu')]), tick: 141 }
    const p = script(1, 'acheve')
    expect(() => p.decide({ ...w, tick: 140 }, mem({ debutAction: 20 }))).not.toThrow()
    expect(() => p.decide(w, mem({ debutAction: 20 }))).toThrow(SceneInvalide)
  })
  it('cible absente du monde : scène invalide', () => {
    expect(() => script(9, 'acheve').decide(W([S(1, 0, 'abattu')]), mem())).toThrow(SceneInvalide)
  })
  it('mode acheve : frappe la cible', () => {
    const w = W([S(1, 0, 'abattu')])
    expect(script(1, 'acheve').decide(w, mem())[0]).toEqual({
      move: v(0, 0),
      aim: v(1, 0),
      ...NONE,
      strike: true,
    })
  })
  it('mode sentence : F seulement quand le joueur n’a pas d’action en cours', () => {
    const w = W([S(1, 0, 'abattu')])
    const p = script(1, 'sentence')
    expect(p.decide(w, mem())[0]).toEqual({ move: v(0, 0), aim: v(1, 0), ...NONE, sentence: true })
    const busy = withPlayer(w, { action: { kind: 'frappe', start: 0, end: 21 } })
    expect(p.decide(busy, mem())[0]).toEqual({ move: v(0, 0), aim: v(1, 0), ...NONE })
  })
  it('mode clang-puis-sentence : frappe tant qu’aucun clang n’est vu, puis F', () => {
    const w = W([S(1, 0, 'abattu', 3)])
    const p = script(1, 'clang-puis-sentence')
    expect(p.decide(w, mem())[0].strike).toBe(true)
    expect(p.decide(w, mem())[0].sentence).toBe(false)
    expect(p.decide(w, mem({ clangVu: true }))[0]).toEqual({
      move: v(0, 0),
      aim: v(1, 0),
      ...NONE,
      sentence: true,
    })
  })
})

// Fixture S1 de B2 §5 (table des slots). (u, v) → (x, z) : rotation de 45° du §20, la même que uvToGround de
// src/render/camera.ts (yaw 45°), recopiée ici parce que src/bots ne peut pas dépendre de src/render.
const uv = (u: number, vv: number): Vec2 => ({ x: Math.SQRT1_2 * (u - vv), z: -Math.SQRT1_2 * (u + vv) })
type Slot = readonly [number, number, SpawnDef['family'], 'abattu' | 'mort', 0 | 1 | 2 | 3]
const S1_SLOTS: readonly Slot[] = [
  [-6, 4, 'souriant', 'mort', 0],
  [-2, 4, 'confesseur', 'mort', 0],
  [2, 4, 'souriant', 'abattu', 3],
  [6, 4, 'souriant', 'abattu', 3],
  [0, 5, 'souriant', 'abattu', 0],
  [-6, 0, 'souriant', 'abattu', 1],
  [-5.4, 0.4, 'souriant', 'mort', 0],
  [-3, -1.5, 'recousu', 'abattu', 2],
  [5, 0, 'souriant', 'abattu', 2],
  [5.8, 0.6, 'recousu', 'abattu', 3],
  [5.8, -0.6, 'recousu', 'mort', 0],
  [-6, -4, 'souriant', 'abattu', 0],
  [-2, -4, 'porteur', 'mort', 0],
  [2, -4, 'recousu', 'abattu', 0],
  [6, -4, 'souriant', 'mort', 3],
]
const fixtureS1 = (): World =>
  W(
    S1_SLOTS.map(([u, vv, family, state, cicatrices], i) => ({
      family,
      pos: uv(u, vv),
      facing: ((i + 1) * 0.82) % (2 * Math.PI),
      state,
      cicatrices,
    })),
  )

// Joue une politique sur la fixture jusqu'à `ticks`, en gardant tous les évènements.
const play = (policy: Policy<ScriptMemory>, ticks: number) => {
  let w = fixtureS1()
  let m = policy.init(w)
  const events: SimEvent[] = []
  for (let i = 0; i < ticks; i++) {
    const [cmd, next] = policy.decide(w, m)
    m = next
    w = step(w, cmd)
    events.push(...w.events)
  }
  return { w, events, m }
}

describe('scènes S1b, S1c, S1d sur la fixture S1 (registre réel des familles)', () => {
  const cases = [
    { scene: 'S1b', cible: 12, mode: 'acheve', by: 'achevement' },
    { scene: 'S1c', cible: 14, mode: 'sentence', by: 'sentence' },
    { scene: 'S1d', cible: 4, mode: 'clang-puis-sentence', by: 'sentence' },
  ] as const
  it.each(cases)(
    '$scene : $cible meurt par $by dans les 120 ticks, rien d’autre ne meurt, retour en O',
    (c) => {
      const { w, events, m } = play(script(c.cible, c.mode), 300)
      const deaths = events.filter((e) => e.type === 'death')
      expect(deaths).toEqual([expect.objectContaining({ id: c.cible, by: c.by })])
      const death = deaths[0] as SimEvent
      expect(m.debutAction).not.toBeNull()
      expect(death.tick - (m.debutAction as number)).toBeLessThanOrEqual(121)
      expect(Math.hypot(w.player.pos.x, w.player.pos.z)).toBeLessThanOrEqual(0.2)
      const clangs = events.filter((e) => e.type === 'clang')
      if (c.mode === 'clang-puis-sentence') {
        const start = events.find((e) => e.type === 'sentence-start')
        expect(clangs.length).toBeGreaterThanOrEqual(1)
        expect(clangs.every((e) => e.type === 'clang' && e.id === c.cible)).toBe(true)
        expect(start && (clangs[0] as SimEvent).tick < start.tick).toBe(true)
      } else expect(clangs).toEqual([])
      expect(creature(w, c.cible).state.kind).toBe('mort')
    },
  )
  it('la fixture place bien 6 Abattus ordinaires, 3 Résistants Abattus, 6 morts', () => {
    const w = fixtureS1()
    const kinds = w.creatures.map((c) =>
      c.state.kind === 'abattu' ? (c.resistant ? 'R' : 'A') : c.state.kind,
    )
    expect(kinds.filter((k) => k === 'A')).toHaveLength(6)
    expect(kinds.filter((k) => k === 'R')).toHaveLength(3)
    expect(kinds.filter((k) => k === 'mort')).toHaveLength(6)
    // Sans support debout, les corps restent sur place jusqu'au premier Relèvement (360).
    const later = play({ ...script(12, 'acheve'), decide: (x, mm) => [IDLE(x), mm] }, 300).w
    for (const c of w.creatures) expect(creature(later, c.id).pos).toEqual(c.pos)
  })
})
