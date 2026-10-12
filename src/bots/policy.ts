// Interface commune des politiques de bot (brief C6a). Une politique est pure et déterministe : même monde,
// même mémoire, mêmes commandes. La mémoire est rendue à chaque tick, le banc la repasse au tick suivant.
// Une commande `dodge`, `sentence`, `rite` ou `swapWeapon` à vrai compte comme une pression au tick où elle
// est émise (B3 I10) : le banc la transmet telle quelle.
import type { PlayerCommands, World } from '../sim/index'

export interface Policy<M = unknown> {
  readonly name: string
  init(world: World): M
  decide(world: World, memory: M): readonly [PlayerCommands, M] // pur, déterministe
}

// Paramètres lus dans le nom donné au banc : `b5:D=60`, `s1:k=120:verbe=frappe` (voir parsePolicySpec).
export type PolicyFactory = (params: Readonly<Record<string, string>>) => Policy
