import { describe, expect, it } from 'vitest'
import {
  BLIND_TIMEOUT_TICKS,
  blindSteps,
  blockOrder,
  correspondence,
  correspondenceFileName,
  LABEL_1,
  LABEL_2,
  parseCorrespondence,
  stepVariant,
} from './blind'

describe('mode aveugle (B4 §11, I7)', () => {
  it('contrebalancement : impair A B B A, pair B A A B', () => {
    expect(blockOrder(1)).toEqual(['A', 'B', 'B', 'A'])
    expect(blockOrder(2)).toEqual(['B', 'A', 'A', 'B'])
    expect(blockOrder(3)).toEqual(['A', 'B', 'B', 'A'])
    expect(blockOrder(4)).toEqual(['B', 'A', 'A', 'B'])
    expect(blockOrder(5)).toEqual(['A', 'B', 'B', 'A'])
    expect(() => blockOrder(0)).toThrow()
    expect(() => blockOrder(1.5)).toThrow()
  })

  it('échauffement V1 graine 1 dans la variante du bloc 1, puis V2 et V6 par bloc, graine = numéro de bloc', () => {
    for (const t of [1, 2]) {
      const steps = blindSteps(t)
      expect(steps.map((s) => [s.etape, s.bloc, s.vague, s.graine])).toEqual([
        ['echauffement', null, 'V1', 1],
        ['bloc', 1, 'V2', 1],
        ['bloc', 1, 'V6', 1],
        ['bloc', 2, 'V2', 2],
        ['bloc', 2, 'V6', 2],
        ['bloc', 3, 'V2', 3],
        ['bloc', 3, 'V6', 3],
        ['bloc', 4, 'V2', 4],
        ['bloc', 4, 'V6', 4],
      ])
      const order = blockOrder(t)
      // Variante jouée à chaque étape : celle du bloc ; échauffement dans celle du bloc 1.
      expect(steps.map((s) => stepVariant(t, s))).toEqual([
        order[0],
        order[0],
        order[0],
        order[1],
        order[1],
        order[2],
        order[2],
        order[3],
        order[3],
      ])
    }
  })

  it('le réglage 1 est celui du premier bloc ; seules les étiquettes apparaissent dans les étapes', () => {
    const s1 = blindSteps(1)
    const s2 = blindSteps(2)
    // Testeur 1 (A B B A) et testeur 2 (B A A B) voient la même suite d'étiquettes : 1, 1, 1, 2, 2, 2, 2, 1, 1.
    const labels = [LABEL_1, LABEL_1, LABEL_1, LABEL_2, LABEL_2, LABEL_2, LABEL_2, LABEL_1, LABEL_1]
    expect(s1.map((s) => s.etiquette)).toEqual(labels)
    expect(s2.map((s) => s.etiquette)).toEqual(labels)
    // Aucune étape ne porte la variante.
    for (const s of [...s1, ...s2]) expect(JSON.stringify(s)).not.toMatch(/"(A|B)"/)
  })

  it('le fichier de correspondance porte l’ordre et la clé, et lui seul', () => {
    expect(correspondence(1).reglages).toEqual({ [LABEL_1]: 'A', [LABEL_2]: 'B' })
    expect(correspondence(2).reglages).toEqual({ [LABEL_1]: 'B', [LABEL_2]: 'A' })
    expect(correspondence(2).ordre).toEqual(['B', 'A', 'A', 'B'])
    expect(correspondenceFileName(3)).toBe('mercy-correspondance-testeur-3.json')
    const back = parseCorrespondence(JSON.parse(JSON.stringify(correspondence(4))))
    expect(back.reglages[LABEL_1]).toBe('B')
    expect(() => parseCorrespondence({ format: 'x' })).toThrow()
    expect(() =>
      parseCorrespondence({
        ...correspondence(1),
        reglages: { [LABEL_1]: 'A', [LABEL_2]: 'A' },
      }),
    ).toThrow()
  })

  it('limite de 300 s : 18 000 ticks', () => {
    expect(BLIND_TIMEOUT_TICKS).toBe(18_000)
  })
})
