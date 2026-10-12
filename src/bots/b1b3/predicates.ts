// Prédicats de B1.md §6 et B3.md §6, à la lettre. t = world.tick, P = world.player.pos.
// Information lue (B1.md §6, B3.md §6) : famille, taille, état, `resistant` (liseré or), action en cours et ses
// ticks, `riseAt` seulement dans les IMMINENT derniers ticks, `unionOf` d'un Membre errant, stade du sac et
// orientation du Porteur. Jamais la Chair, les Cicatrices, ni la réservation d'un corps (`claimedBy`).
// Aucune mémoire, aucun tirage : chaque prédicat est une fonction du monde passé.
import {
  type Action,
  CHANNEL_ACTIONS,
  type Creature,
  inPorteurRearArc,
  PORTEUR_STAGE_KEY,
  type World,
} from '../../sim/index'
import { dist } from '../../sim/vec'
import { FOULE_RAYON_BASE, IMMINENT, LATENCE, MEMBRE_PROCHE } from './params'

// ----- B1.md §6, « Prédicats » ---------------------------------------------------------------------------------

export const debout = (c: Creature): boolean => c.state.kind === 'hostile'
export const rituel = (c: Creature): boolean => c.state.kind === 'rituel'
export const abattu = (c: Creature): boolean => c.state.kind === 'abattu'
export const ordinaire = (c: Creature): boolean => abattu(c) && !c.resistant
export const dore = (c: Creature): boolean => abattu(c) && c.resistant

// « la définition de c.action est une canalisation » : le nom de l'action est dans CHANNEL_ACTIONS, l'ensemble
// des canalisations partagé avec la simulation (B3 I5). params.test.ts vérifie qu'il coïncide avec les ActionDef
// de kind 'canalisation' du registre des familles.
export const canalisation = (a: Action): boolean => CHANNEL_ACTIONS.has(a.name)

export const attaque = (c: Creature): boolean => c.action !== null && !canalisation(c.action)

// riseAt null (le corps ne se relève jamais seul) : pas de télégraphe, donc pas imminent. Le contrat ne traite
// que le Membre errant, qui a sa propre branche ; lecture consignée dans .mercy/requests/C6b.md.
export const imminent = (w: World, c: Creature): boolean => {
  if (!ordinaire(c) || c.state.kind !== 'abattu') return false
  if (c.family !== 'membre') return c.state.riseAt !== null && c.state.riseAt - w.tick <= IMMINENT
  const owner = c.unionOf === null ? undefined : w.creatures.find((o) => o.id === c.unionOf)
  return owner !== undefined && dist(c.pos, owner.pos) <= MEMBRE_PROCHE
}

export const d = (w: World, c: Creature): number => dist(w.player.pos, c.pos)

// « Les créatures à l'état mort ou absorbe ne sont jamais candidates. »
const candidate = (c: Creature): boolean => c.state.kind !== 'mort' && c.state.kind !== 'absorbe'

// proche(E) : plus petit d, égalité → plus petit id ; null pour ∅.
export const proche = (w: World, E: readonly Creature[]): Creature | null => {
  let best: Creature | null = null
  let bestD = Number.POSITIVE_INFINITY
  for (const c of E) {
    if (!candidate(c)) continue
    const dc = d(w, c)
    if (dc < bestD || (dc === bestD && best !== null && c.id < best.id)) {
      best = c
      bestD = dc
    }
  }
  return best
}

// ----- B3.md §6, « Prédicats ajoutés » ------------------------------------------------------------------------

export const present = (c: Creature): boolean => debout(c) || rituel(c)
export const vivant = (c: Creature): boolean => c.state.kind !== 'mort' && c.state.kind !== 'absorbe'
export const support = (c: Creature): boolean =>
  c.family === 'confesseur' || c.family === 'porteur' || c.family === 'chirurgien'

export const canalise = (w: World, c: Creature): boolean =>
  c.action !== null && canalisation(c.action) && w.tick - c.action.start >= LATENCE

// Clé absente : sac vide, stade 0. C'est la convention de la simulation (porteur.ts lit `?? 0`, la clé manque
// seulement au tick 0 et après L6, avant le premier tick du Porteur).
export const stade = (c: Creature): number => c.familyData[PORTEUR_STAGE_KEY] ?? 0

export const dos = (w: World, q: Creature): boolean => inPorteurRearArc(q, w.player.pos)

export const foule = (w: World, q: Creature): number =>
  w.creatures.filter(
    (c) =>
      present(c) &&
      c.size === 'small' &&
      !c.resistant &&
      c.id !== q.id &&
      dist(c.pos, q.pos) <= FOULE_RAYON_BASE + stade(q),
  ).length
