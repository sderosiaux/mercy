// Registre du lot C6c : noms des contrats, paramètres lus dans le nom donné au banc, refus de tout le reste.
import { describe, expect, it } from 'vitest'
import { POLICIES } from '../harness'
import { policies } from './index'

const make = (name: string, params: Record<string, string> = {}) => {
  const f = policies[name]
  if (!f) throw new Error(`absente : ${name}`)
  return f(params)
}

describe('registre B2, B4, B5', () => {
  it('porte les noms des contrats et rejoint le registre du banc', () => {
    const names = [
      'faucheur-couperet',
      'faucheur-masse',
      'B2-immobile',
      'négligent',
      'B2-script',
      'b5',
      's1',
      's-nappe',
      's-sat',
    ]
    expect(Object.keys(policies).sort()).toEqual([...names].sort())
    expect(Object.keys(POLICIES)).toEqual(expect.arrayContaining(names))
  })
  it('politiques sans paramètre : tout paramètre est refusé', () => {
    for (const n of ['faucheur-couperet', 'faucheur-masse', 'B2-immobile', 'négligent', 's-nappe', 's-sat']) {
      expect(make(n).name).toBe(n)
      expect(() => make(n, { x: '1' })).toThrow(/paramètre inconnu/)
    }
  })
  it('b5 : D ∈ { 0, 60, inf }', () => {
    expect(make('b5', { D: '0' }).name).toBe('b5:D=0')
    expect(make('b5', { D: '60' }).name).toBe('b5:D=60')
    for (const inf of ['inf', '∞', 'Infinity']) expect(make('b5', { D: inf }).name).toBe('b5:D=inf')
    for (const bad of ['30', '', '-1']) expect(() => make('b5', { D: bad })).toThrow(/D ∈/)
    expect(() => make('b5')).toThrow(/D ∈/)
    expect(() => make('b5', { D: '60', k: '1' })).toThrow(/paramètre inconnu/)
  })
  it('s1 : k et verbe, ou une variante de la table du §6', () => {
    expect(make('s1', { k: '120', verbe: 'sentence' }).name).toBe('s1:k=120:verbe=sentence')
    expect(make('s1', { variante: 'S1-hal' }).name).toBe('s1:k=0:verbe=frappe')
    expect(make('s1', { variante: 'S1-cri' }).name).toBe('s1:k=120:verbe=frappe')
    expect(make('s1', { variante: 'S1-sent' }).name).toBe('s1:k=120:verbe=sentence')
    expect(make('s1', { variante: 'S1-insp' }).name).toBe('s1:k=300:verbe=frappe')
    expect(make('s1', { variante: 'S1-rel' }).name).toBe('s1:k=0:verbe=aucun')
    expect(make('s1', { verbe: 'aucun' }).name).toBe('s1:k=0:verbe=aucun')
    expect(() => make('s1', { verbe: 'frappe' })).toThrow(/k obligatoire/)
    expect(() => make('s1', { k: '-3', verbe: 'frappe' })).toThrow(/entier positif/)
    expect(() => make('s1', { k: '1', verbe: 'esquive' })).toThrow(/verbe ∈/)
    expect(() => make('s1', { variante: 'S1-x' })).toThrow(/variante inconnue/)
    expect(() => make('s1', { variante: 'S1-hal', k: '3' })).toThrow(/exclut/)
  })
  it('B2-script : cible (id) et mode', () => {
    expect(make('B2-script', { cible: '12', mode: 'acheve' }).name).toBe('B2-script:cible=12:mode=acheve')
    expect(make('B2-script', { cible: '4', mode: 'clang-puis-sentence' }).name).toBe(
      'B2-script:cible=4:mode=clang-puis-sentence',
    )
    expect(() => make('B2-script', { mode: 'acheve' })).toThrow(/cible obligatoire/)
    expect(() => make('B2-script', { cible: '4', mode: 'frappe' })).toThrow(/mode ∈/)
  })
})
