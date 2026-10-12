import { describe, expect, it } from 'vitest'
import { type FamilyModule, type SimEvent, step } from '../sim/index'
import { cmd, creature, poteau, run, scene, withCreature } from '../sim/testing'
import { type EndCause, endModeFor, sourceEndCause, vocalising, voiceEndCause } from './ends'

const ALL: readonly EndCause[] = [
  'mort',
  'relevement',
  'priere',
  'assemblage',
  'vol',
  'fin-action',
  'reinitialisation',
  'disparition',
]

// Familles de scène, sans comportement : seul leur `kind` compte pour savoir dans quel sac est un corps.
const fakePorteur: FamilyModule = { ...poteau, kind: 'porteur' }
const fakeRecousu: FamilyModule = { ...poteau, kind: 'recousu', isSupport: false }

describe('agonie contre fondu (§19, L4, principe 3)', () => {
  it('seule la mort ouvre une agonie (râle) ; toute autre cause finit en fondu', () => {
    expect(ALL.filter((c) => endModeFor(c) === 'agonie')).toEqual(['mort'])
    expect(ALL.filter((c) => endModeFor(c) === 'fade')).toHaveLength(ALL.length - 1)
  })

  it('Achèvement d’un Abattu : cause « mort », lue dans les évènements du tick', () => {
    // Souriant Abattu à 1,5 m devant le joueur ; une frappe l'achève.
    let w = scene([{ family: 'souriant', pos: { x: 1.5, z: 0 }, state: 'abattu' }])
    w = step(w, cmd({ aim: { x: 1.5, z: 0 }, strike: true }))
    for (let i = 0; i < 30 && !w.events.some((e) => e.type === 'death'); i++)
      w = step(w, cmd({ aim: { x: 1.5, z: 0 }, strike: true }))
    const byId = new Map(w.creatures.map((c) => [c.id, c]))
    expect(w.events.some((e) => e.type === 'death' && e.id === 1)).toBe(true)
    expect(voiceEndCause(1, creature(w, 1), w.events, byId)).toBe('mort')
    expect(sourceEndCause(1, creature(w, 1), w.events)).toBe('mort')
  })

  it('Relèvement au bout de 6 s : cause « relèvement », jamais « mort »', () => {
    const w0 = scene([{ family: 'souriant', pos: { x: 6, z: 0 }, state: 'abattu' }])
    const r = run(w0, 360)
    expect(r.events.some((e) => e.type === 'rise' && e.id === 1)).toBe(true)
    const w = r.world
    const byId = new Map(w.creatures.map((c) => [c.id, c]))
    expect(voiceEndCause(1, creature(w, 1), w.events, byId)).toBe('relevement')
  })

  it('un corps absorbé dans un Porteur vocalise encore (D8) ; assemblé dans un Recousu, il ne vocalise plus', () => {
    const w0 = scene(
      [
        { family: 'souriant', pos: { x: 6, z: 0 }, state: 'abattu' },
        { family: 'porteur', pos: { x: 7, z: 0 } },
        { family: 'recousu', pos: { x: 8, z: 0 } },
      ],
      { families: { porteur: fakePorteur, recousu: fakeRecousu } },
    )
    const inSack = withCreature(w0, 1, { state: { kind: 'absorbe', into: 2, cryAt: 30 } })
    const byId1 = new Map(inSack.creatures.map((c) => [c.id, c]))
    expect(vocalising(creature(inSack, 1), byId1)).toBe(true)
    expect(voiceEndCause(1, creature(inSack, 1), [], byId1)).toBeUndefined()
    const assembled = withCreature(w0, 1, { state: { kind: 'absorbe', into: 3, cryAt: 30 } })
    const byId2 = new Map(assembled.creatures.map((c) => [c.id, c]))
    expect(vocalising(creature(assembled, 1), byId2)).toBe(false)
    const ev: SimEvent[] = [{ type: 'assemble', tick: 1, id: 9, others: [1], created: 3 }]
    expect(voiceEndCause(1, creature(assembled, 1), ev, byId2)).toBe('assemblage')
  })

  it('réinitialisation : fondu, même pour un corps encore Abattu après le retour à l’origine', () => {
    const w0 = scene([{ family: 'souriant', pos: { x: 6, z: 0 }, state: 'abattu' }])
    const byId = new Map(w0.creatures.map((c) => [c.id, c]))
    const ev: SimEvent[] = [{ type: 'reset', tick: 5 }]
    const asNotVocal = withCreature(w0, 1, { state: { kind: 'hostile', alertedAt: 0 } })
    expect(voiceEndCause(1, creature(asNotVocal, 1), ev, byId)).toBe('reinitialisation')
  })

  it('un Membre errant n’a pas de voix', () => {
    const w0 = scene([{ family: 'membre', pos: { x: 6, z: 0 }, state: 'abattu' }])
    const byId = new Map(w0.creatures.map((c) => [c.id, c]))
    expect(vocalising(creature(w0, 1), byId)).toBe(false)
  })
})
