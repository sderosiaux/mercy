import { describe, expect, it } from 'vitest'
import { captureOrder, drawProbes, markerCenter, type Record_, tally } from './session'

describe('ordre des captures (B2 §11 : sfc32, graine 2929)', () => {
  it('est une permutation stable, et l’observateur impair la voit à l’envers', () => {
    const a = captureOrder(12, 0)
    expect([...a].sort((x, y) => x - y)).toEqual(Array.from({ length: 12 }, (_, i) => i))
    expect(captureOrder(12, 2)).toEqual(a)
    expect(captureOrder(12, 1)).toEqual([...a].reverse())
    expect(a).not.toEqual(Array.from({ length: 12 }, (_, i) => i))
  })
})

describe('tirage des sondes (B2 §11)', () => {
  const cand = (entity: number, truth: 'Abattu' | 'Mort' | 'Résistant', visible = 500) => ({
    entity,
    truth,
    x: entity * 10,
    y: 300,
    visible,
  })
  const s1 = [
    cand(1, 'Mort'),
    cand(3, 'Résistant'),
    cand(4, 'Résistant'),
    cand(5, 'Abattu'),
    cand(9, 'Abattu', 40),
    cand(10, 'Résistant'),
    cand(12, 'Abattu'),
    cand(15, 'Mort'),
  ]
  it('tire 2 Résistants et 2 autres corps en S1 et S2, sans les corps trop peu visibles', () => {
    const p = drawProbes(s1, 1, 'S1S2')
    expect(p.map((x) => x.n)).toEqual([1, 2, 3, 4])
    expect(p.filter((x) => x.truth === 'Résistant')).toHaveLength(2)
    expect(p.some((x) => x.entity === 9)).toBe(false)
    expect(drawProbes(s1, 1, 'S1S2')).toEqual(p)
  })
  it('tire 2 vivants et 2 morts en S3, et complète une classe trop petite par l’autre', () => {
    const p = drawProbes(s1, 4, 'S3')
    expect(p.filter((x) => x.truth === 'Mort')).toHaveLength(2)
    const fewDead = drawProbes(
      [cand(1, 'Mort'), cand(2, 'Abattu'), cand(3, 'Abattu'), cand(4, 'Abattu')],
      5,
      'S3',
    )
    expect(fewDead).toHaveLength(4)
    expect(fewDead.filter((x) => x.truth === 'Mort')).toHaveLength(1)
  })
})

describe('marqueur des sondes', () => {
  it('se place 28 px au-dessus du barycentre, ou 28 px en dessous près du bord haut', () => {
    expect(markerCenter({ n: 1, x: 300, y: 200, truth: 'Mort' }, 1024, 768)).toEqual({ x: 300, y: 172 })
    expect(markerCenter({ n: 1, x: 300, y: 20, truth: 'Mort' }, 1024, 768)).toEqual({ x: 300, y: 48 })
  })
})

describe('décompte', () => {
  const r = (truth: Record_['truth'], answer: Record_['answer'], training = false): Record_ => ({
    capture: 'c',
    training,
    probe: 1,
    entity: null,
    truth,
    answer,
    shownMs: 3000,
    shownFrames: 180,
  })
  it('compte la confusion vivant/mort, les « je ne sais pas » et les Résistants reconnus, hors entraînement', () => {
    const t = tally([
      r('Abattu', 'Mort'),
      r('Mort', 'Résistant'),
      r('Mort', 'Mort'),
      r('Résistant', 'Résistant'),
      r('Résistant', 'Abattu'),
      r('Abattu', 'Je ne sais pas'),
      r('Mort', 'Abattu', true),
    ])
    expect(t.sondes).toBe(6)
    expect(t.confusionVivantMort).toBeCloseTo(2 / 6, 12)
    expect(t.jeNeSaisPas).toBeCloseTo(1 / 6, 12)
    expect(t.resistantsReconnus).toBeCloseTo(0.5, 12)
    expect(t.exactitude).toBeCloseTo(2 / 6, 12)
    expect(t.matrice.Abattu.Mort).toBe(1)
  })
})
