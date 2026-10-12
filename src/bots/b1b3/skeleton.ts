// Squelette commun S0 à S6 (B1.md §6), étendu par B3 (B3.md §6 : gestes desamorcer et utiliser, S3b, S5
// réservée au geste frapper). Écrit une seule fois pour les cinq politiques ; seules changent choisir() et
// interet(). La première règle qui s'applique renvoie les commandes ; tout champ non cité vaut IDLE_COMMANDS.
import {
  type Creature,
  IDLE_COMMANDS,
  type PlayerCommands,
  TUNING,
  type Vec2,
  type World,
} from '../../sim/index'
import { add, len, norm, scale, sub, vec, ZERO } from '../../sim/vec'
import {
  ARRET,
  ARRET_F,
  AVANCE_ESQ,
  ESQ_SORTIE,
  LATENCE,
  PORTEE,
  RAYON_ESQ,
  S3B_AU_DELA,
  S4_FERVEUR,
  S4_NOMBRE,
  S4_RAYON,
  S5_DMAX,
  S5_DMIN,
  S5_FERVEUR,
} from './params'
import { attaque, d, debout, proche } from './predicates'

// B1 ne renvoie que frapper et sentencier ; B3 ajoute desamorcer et utiliser.
export type Geste = 'frapper' | 'sentencier' | 'desamorcer' | 'utiliser'

export interface Choix {
  readonly cible: Creature
  readonly geste: Geste
  readonly regle: string // identifiant de la règle de choisir() qui a tranché (D1, T3, R2…)
}

export type Regle = (w: World) => Choix | null

export interface Doctrine {
  readonly choisir: (w: World) => Choix | null
  readonly interet: (w: World) => readonly Creature[]
}

export type RegleSquelette = 'S0' | 'S1' | 'S2' | 'S3' | 'S3b' | 'S4' | 'S5' | 'S6'

export interface Decision {
  readonly commands: PlayerCommands
  readonly regle: RegleSquelette
  readonly choix: Choix | null
}

// choisir() : la première règle qui désigne une cible l'emporte ; aucune → ∅ (D4, T8).
export const premiere =
  (regles: readonly Regle[]) =>
  (w: World): Choix | null => {
    for (const r of regles) {
      const c = r(w)
      if (c !== null) return c
    }
    return null
  }

const unitaire = (v: Vec2): Vec2 => (len(v) === 0 ? ZERO : norm(v))

// « sort de l'arène » : l'arène de 30 × 30 m (§28), bornes de la simulation (TUNING.arenaHalf).
const horsArene = (p: Vec2): boolean => Math.abs(p.x) > TUNING.arenaHalf || Math.abs(p.z) > TUNING.arenaHalf

// Rotation dans le plan du sol, sens trigonométrique de la simulation (0 = +x, +90° = +z).
const tourne = (v: Vec2, sens: 1 | -1): Vec2 => vec(-sens * v.z, sens * v.x)

// S1 : menaces = { c : debout(c), attaque(c), t − début ≥ LATENCE, 0 < impact − t ≤ AVANCE_ESQ, d ≤ RAYON_ESQ }
export const menaces = (w: World): Creature[] =>
  w.creatures.filter((c) => {
    if (!debout(c) || !attaque(c) || c.action === null) return false
    const avant = c.action.activeAt - w.tick
    return (
      w.tick - c.action.start >= LATENCE && avant > 0 && avant <= AVANCE_ESQ && d(w, c) <= RAYON_ESQ[c.size]
    )
  })

// S1 : direction d'esquive, loin de l'attaquant, tournée si elle sort de l'arène.
export const directionEsquive = (P: Vec2, a: Vec2): Vec2 => {
  const ecart = sub(P, a)
  const dir = len(ecart) === 0 ? vec(1, 0) : norm(ecart)
  const sort = (v: Vec2): boolean => horsArene(add(P, scale(v, ESQ_SORTIE)))
  if (!sort(dir)) return dir
  const plus = tourne(dir, 1)
  if (!sort(plus)) return plus
  const moins = tourne(dir, -1)
  if (!sort(moins)) return moins
  return dir
}

const commandes = (patch: Partial<PlayerCommands>): PlayerCommands => ({ ...IDLE_COMMANDS, ...patch })

export const decide = (doctrine: Doctrine, w: World): Decision => {
  const p = w.player
  const P = p.pos

  // S0 : une action autre que la Frappe est en cours.
  if (p.action !== null && p.action.kind !== 'frappe')
    return { commands: IDLE_COMMANDS, regle: 'S0', choix: null }

  // S1 : esquive d'une attaque imminente.
  if (p.dodgeCharges >= 1) {
    const a = proche(w, menaces(w))
    if (a !== null) {
      const dir = directionEsquive(P, a.pos)
      return { commands: commandes({ move: dir, aim: add(P, dir), dodge: true }), regle: 'S1', choix: null }
    }
  }

  // S2 : choix de la cible, propre à la politique.
  const choix = doctrine.choisir(w)
  if (choix === null) return { commands: IDLE_COMMANDS, regle: 'S2', choix: null }
  const { cible, geste } = choix
  const dc = d(w, cible)
  const versCible = unitaire(sub(cible.pos, P))

  // S3 : Sentence.
  if (geste === 'sentencier') {
    const commands =
      dc <= ARRET_F
        ? commandes({ aim: cible.pos, sentence: true })
        : commandes({ move: versCible, aim: cible.pos })
    return { commands, regle: 'S3', choix }
  }

  // S3b (B3) : utiliser le Porteur, Charge qui vise 1 m derrière lui.
  if (geste === 'utiliser') {
    const commands = commandes({
      move: versCible,
      aim: add(cible.pos, scale(versCible, S3B_AU_DELA)),
      rite: 'charge',
    })
    return { commands, regle: 'S3b', choix }
  }

  // S4 : Balayage (gestes frapper et desamorcer).
  if (p.ferveur >= S4_FERVEUR && doctrine.interet(w).filter((c) => d(w, c) <= S4_RAYON).length >= S4_NOMBRE) {
    return { commands: commandes({ aim: cible.pos, rite: 'balayage' }), regle: 'S4', choix }
  }

  // S5 : Charge, seulement pour le geste frapper (B3.md §6).
  if (geste === 'frapper' && p.ferveur >= S5_FERVEUR && S5_DMIN < dc && dc <= S5_DMAX) {
    return { commands: commandes({ aim: cible.pos, rite: 'charge' }), regle: 'S5', choix }
  }

  // S6 : approche et Frappe.
  const commands = commandes({
    move: dc > ARRET ? versCible : ZERO,
    aim: cible.pos,
    strike: dc <= PORTEE,
  })
  return { commands, regle: 'S6', choix }
}
