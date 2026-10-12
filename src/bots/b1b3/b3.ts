// Politiques RET de B3 (B3.md §6) : le choisir() du trieur de B1, dans lequel s'insèrent R1 à R4.
// IND n'est pas ici : c'est le trieur de b1.ts, sans copie.
import type { Creature, World } from '../../sim/index'
import { dist } from '../../sim/vec'
import { interetTrieur, T1, T2, T3, T4, T5, T6, T7 } from './b1'
import {
  COUT_CHARGE,
  FOULE_MIN,
  R_ABSORPTION,
  R_ASSEMBLAGE,
  R_PRIERE,
  R2_STADE_MIN,
  R4_STADE_MAX,
  U_MAX,
  U_MIN,
} from './params'
import { canalise, d, dos, foule, ordinaire, present, proche, stade, support, vivant } from './predicates'
import { type Doctrine, premiere, type Regle } from './skeleton'

export type Mode = 'RET-D' | 'RET-U'

// R1 : interrompre une prière ou une opération en cours depuis au moins LATENCE ticks.
export const R1: Regle = (w) => {
  const E1 = w.creatures.filter(
    (c) => (c.family === 'confesseur' || c.family === 'chirurgien') && vivant(c) && canalise(w, c),
  )
  const c = proche(w, E1)
  return c === null ? null : { cible: c, geste: 'frapper', regle: 'R1' }
}

// R2 : Porteur chargé. RET-U l'utilise si toutes les conditions tiennent, sinon le désamorce.
export const R2 =
  (mode: Mode): Regle =>
  (w) => {
    const E2 = w.creatures.filter((c) => c.family === 'porteur' && present(c) && stade(c) >= R2_STADE_MIN)
    const q = proche(w, E2)
    if (q === null) return null
    const dq = d(w, q)
    if (
      mode === 'RET-U' &&
      !dos(w, q) &&
      U_MIN <= dq &&
      dq <= U_MAX &&
      w.player.ferveur >= COUT_CHARGE &&
      foule(w, q) >= FOULE_MIN
    ) {
      return { cible: q, geste: 'utiliser', regle: 'R2' }
    }
    return { cible: q, geste: 'desamorcer', regle: 'R2' }
  }

// R3 : supports à terre.
export const R3: Regle = (w) => {
  const c = proche(
    w,
    w.creatures.filter((x) => support(x) && ordinaire(x)),
  )
  return c === null ? null : { cible: c, geste: 'frapper', regle: 'R3' }
}

// R4 : munitions des supports et Confesseurs debout.
export const munitions = (w: World, mode: Mode): Creature[] => {
  const K = w.creatures.filter((k) => k.family === 'confesseur' && vivant(k))
  const H = w.creatures.filter((h) => h.family === 'chirurgien' && present(h))
  const Q = w.creatures.filter((q) => q.family === 'porteur' && present(q) && stade(q) < R4_STADE_MAX)
  const L = w.creatures.filter((c) => ordinaire(c) && !support(c))
  return L.filter(
    (c) =>
      K.some((k) => dist(c.pos, k.pos) <= R_PRIERE) ||
      (H.length > 0 && L.some((o) => o.id !== c.id && dist(c.pos, o.pos) <= R_ASSEMBLAGE)) ||
      (H.length > 0 && (c.family === 'membre' || c.family === 'recousu')) ||
      (mode === 'RET-D' && Q.some((q) => dist(c.pos, q.pos) <= R_ABSORPTION)),
  )
}

export const R4 =
  (mode: Mode): Regle =>
  (w) => {
    const M = munitions(w, mode)
    const C = w.creatures.filter((k) => k.family === 'confesseur' && present(k))
    const c = proche(w, [...M, ...C])
    return c === null ? null : { cible: c, geste: 'frapper', regle: 'R4' }
  }

// T1, T2 ; R1 à R3 ; T3, T4 ; R4 ; T5 à T8. interet() : celle du trieur.
export const ret = (mode: Mode): Doctrine => ({
  choisir: premiere([T1, T2, R1, R2(mode), R3, T3, T4, R4(mode), T5, T6, T7]),
  interet: interetTrieur,
})

export const RET_D: Doctrine = ret('RET-D')
export const RET_U: Doctrine = ret('RET-U')
