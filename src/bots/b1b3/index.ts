// Registre des politiques de B1 et B3 (lot C6b). Le banc (src/bots/harness.ts) le réunit aux autres.
// Fonctions pures du monde : la mémoire est toujours null (B1.md §6, B3.md §6). Politiques gelées : aucun
// paramètre accepté par le banc (`trieur:x=1` est refusé), seul l'humain amende une politique.
import type { World } from '../../sim/index'
import type { Policy, PolicyFactory } from '../policy'
import { DEBOUT, NETTOYEUR, TRIEUR } from './b1'
import { RET_D, RET_U } from './b3'
import { type Doctrine, decide } from './skeleton'

const politique = (name: string, doctrine: Doctrine): Policy<null> => ({
  name,
  init: () => null,
  decide: (w: World) => [decide(doctrine, w).commands, null],
})

export const trieur = politique('trieur', TRIEUR)
export const debout = politique('debout', DEBOUT)
export const nettoyeur = politique('nettoyeur', NETTOYEUR)
export const retD = politique('RET-D', RET_D)
export const retU = politique('RET-U', RET_U)

const gelee =
  (p: Policy<null>): PolicyFactory =>
  (params) => {
    const extra = Object.keys(params)
    if (extra.length > 0)
      throw new Error(`politique gelée ${p.name} : paramètre refusé (${extra.join(', ')})`)
    return p as Policy
  }

export const policies: Readonly<Record<string, PolicyFactory>> = {
  // B1.md §6
  trieur: gelee(trieur),
  debout: gelee(debout),
  nettoyeur: gelee(nettoyeur),
  // B3.md §6 : IND est le trieur lui-même ; RET-D et RET-U aussi sous les noms du §6.
  IND: gelee(trieur),
  'RET-D': gelee(retD),
  'RET-U': gelee(retU),
  'b3-ret-desamorce': gelee(retD),
  'b3-ret-utilise': gelee(retU),
}
