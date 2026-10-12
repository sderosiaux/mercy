// Politiques de B1 (B1.md §6) : debout, trieur, nettoyeur. Le trieur est aussi IND de B3, à la lettre.
// Aucune priorité propre aux supports : un support debout est une créature debout, un support à terre un corps.
import type { Creature, World } from '../../sim/index'
import { PORTEE, R_DORE, R_TRI, VIE_SOIN } from './params'
import { abattu, d, debout, dore, imminent, ordinaire, proche, rituel } from './predicates'
import { type Choix, type Doctrine, type Geste, premiere, type Regle } from './skeleton'

const choix = (cible: Creature | null, geste: Geste, regle: string): Choix | null =>
  cible === null ? null : { cible, geste, regle }

const parmi = (w: World, keep: (c: Creature) => boolean): Creature | null =>
  proche(w, w.creatures.filter(keep))

// (c, dore(c) ? sentencier : frapper), commun à D2 et T6.
const corps = (w: World, regle: string): Choix | null => {
  const c = parmi(w, abattu)
  return c === null ? null : { cible: c, geste: dore(c) ? 'sentencier' : 'frapper', regle }
}

// ----- debout --------------------------------------------------------------------------------------------------

export const D1: Regle = (w) => choix(parmi(w, debout), 'frapper', 'D1')
export const D2: Regle = (w) => corps(w, 'D2')
export const D3: Regle = (w) => choix(parmi(w, rituel), 'frapper', 'D3')
// D4 : ∅ (fin de premiere()).

export const DEBOUT: Doctrine = {
  choisir: premiere([D1, D2, D3]),
  interet: (w) => w.creatures.filter(debout),
}

// ----- trieur --------------------------------------------------------------------------------------------------

export const T1: Regle = (w) =>
  choix(
    parmi(w, (c) => dore(c) && d(w, c) <= R_DORE),
    'sentencier',
    'T1',
  )
export const T2: Regle = (w) =>
  w.player.vie < VIE_SOIN
    ? choix(
        parmi(w, (c) => ordinaire(c) && d(w, c) <= R_TRI),
        'sentencier',
        'T2',
      )
    : null
export const T3: Regle = (w) =>
  choix(
    parmi(w, (c) => imminent(w, c) && d(w, c) <= R_TRI),
    'frapper',
    'T3',
  )
export const T4: Regle = (w) =>
  choix(
    parmi(w, (c) => ordinaire(c) && d(w, c) <= PORTEE),
    'frapper',
    'T4',
  )
export const T5: Regle = (w) => choix(parmi(w, debout), 'frapper', 'T5')
export const T6: Regle = (w) => corps(w, 'T6')
export const T7: Regle = (w) => choix(parmi(w, rituel), 'frapper', 'T7')
// T8 : ∅ (fin de premiere()).

export const interetTrieur = (w: World): readonly Creature[] =>
  w.creatures.filter((c) => debout(c) || ordinaire(c))

export const TRIEUR: Doctrine = {
  choisir: premiere([T1, T2, T3, T4, T5, T6, T7]),
  interet: interetTrieur,
}

// ----- nettoyeur : le trieur dont T3 et T4 sont remplacées, au même endroit, par N3 -----------------------------

export const N3: Regle = (w) => choix(parmi(w, ordinaire), 'frapper', 'N3')

export const NETTOYEUR: Doctrine = {
  choisir: premiere([T1, T2, N3, T5, T6, T7]),
  interet: interetTrieur,
}
