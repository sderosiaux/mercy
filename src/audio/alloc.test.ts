import { describe, expect, it } from 'vitest'
import { allocate, emptySlots, isFree, rankBodies, type Slot } from './alloc'

const ranked = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1, rank: i + 1 }))
const withVoices = (ids: readonly number[]): Slot[] => {
  const s: Slot[] = [...emptySlots()]
  ids.forEach((id, i) => {
    s[i] = { kind: 'voice', id }
  })
  return s
}

describe('attribution des 24 emplacements (§19, B5.O8)', () => {
  it('24 corps ou moins : chacun reçoit un emplacement, dans l’ordre des rangs', () => {
    const a = allocate(ranked(24), emptySlots(), 0)
    expect(a.assign.map((x) => x.id)).toEqual(ranked(24).map((r) => r.id))
    expect(new Set(a.assign.map((x) => x.slot)).size).toBe(24)
    expect(a.steal).toEqual([])
  })

  it('plus de 24 corps : les 24 plus proches seulement', () => {
    const a = allocate(ranked(30), emptySlots(), 0)
    expect(a.assign.map((x) => x.id)).toEqual(ranked(24).map((r) => r.id))
  })

  it('un corps en attente d’un emplacement en fondu ne déclenche pas d’autre vol au tick suivant', () => {
    // Tick t : le corps 24 réclame, la voix du rang 27 est volée (fondu en cours jusqu’au tick 15).
    const holders = [...Array.from({ length: 23 }, (_, i) => i + 1), 27]
    const t0 = allocate(ranked(30), withVoices(holders), 0)
    expect(t0.steal).toEqual([{ id: 27, slot: 23 }])
    const slots: Slot[] = withVoices(holders.slice(0, 23))
    slots[23] = { kind: 'ending', id: 27, freeAt: 15 }
    // Tick t + 1 : rien de nouveau à voler, le corps 24 attend l’emplacement promis.
    const t1 = allocate(ranked(30), slots, 1)
    expect(t1.steal).toEqual([])
    expect(t1.assign).toEqual([])
    // Tick 15 : il le reçoit.
    expect(allocate(ranked(30), slots, 15).assign).toEqual([{ id: 24, slot: 23 }])
  })

  it('au-delà du rang 28 la voix est volée, même sans demande', () => {
    const slots = withVoices([29])
    const a = allocate(ranked(30), slots, 0)
    expect(a.steal).toEqual([{ id: 29, slot: 0 }])
  })

  it('emplacements pleins : un corps des 24 premiers vole la voix tenue du plus mauvais rang hors des 24 et attend', () => {
    // 24 voix sur les corps 1..22, 26 et 27 ; les corps 23 et 24 n'ont pas de voix : deux vols, pires rangs d'abord.
    const holders = [...Array.from({ length: 22 }, (_, i) => i + 1), 26, 27]
    const a = allocate(ranked(30), withVoices(holders), 0)
    expect(a.steal).toEqual([
      { id: 27, slot: 23 },
      { id: 26, slot: 22 },
    ])
    expect(a.assign).toEqual([]) // l'emplacement est en fondu : il n'est pas libre ce tick
  })

  it('un emplacement en fin douce reste occupé jusqu’à la fin du fondu', () => {
    const end: Slot = { kind: 'ending', id: 9, freeAt: 15 }
    expect(isFree(end, 14)).toBe(false)
    expect(isFree(end, 15)).toBe(true)
    const slots: Slot[] = withVoices(Array.from({ length: 23 }, (_, i) => i + 1))
    slots[23] = end
    expect(allocate(ranked(24), slots, 14).assign).toEqual([])
    expect(allocate(ranked(24), slots, 15).assign).toEqual([{ id: 24, slot: 23 }])
  })

  it('rang : distance à l’auditeur, puis id croissant', () => {
    const r = rankBodies([
      { id: 5, dist: 2 },
      { id: 3, dist: 2 },
      { id: 9, dist: 1 },
    ])
    expect(r.map((x) => [x.id, x.rank])).toEqual([
      [9, 1],
      [3, 2],
      [5, 3],
    ])
  })
})
