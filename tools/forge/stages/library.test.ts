import { describe, expect, it } from 'vitest'
import { libraryMismatches } from './meshy'

// Entrées réelles de la bibliothèque Meshy (GET /openapi/v1/animations/library, 2026-10-12).
const live = [
  { action_id: 178, name: 'Hit Reaction', key: 'Hit_Reaction' },
  { action_id: 622, name: 'Crawl Backward', key: 'Crawl_Backward_inplace' },
]

describe('vérification de la bibliothèque Meshy avant de payer', () => {
  it("accepte une fiche qui nomme l'action par sa clé ou par son nom", () => {
    expect(libraryMismatches([{ actionId: 178, nom: 'Hit_Reaction' }], live)).toEqual([])
    expect(libraryMismatches([{ actionId: 178, nom: 'Hit Reaction' }], live)).toEqual([])
    expect(libraryMismatches([{ actionId: 622, nom: 'Crawl_Backward_inplace' }], live)).toEqual([])
  })

  it('refuse un id dont la clé et le nom ne correspondent pas, ou un id absent', () => {
    expect(libraryMismatches([{ actionId: 178, nom: 'Crawl_Backward_inplace' }], live)).toHaveLength(1)
    expect(libraryMismatches([{ actionId: 999, nom: 'Hit_Reaction' }], live)).toHaveLength(1)
  })
})
