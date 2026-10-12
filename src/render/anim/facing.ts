// Orientation affichée du Bourreau (E6) : la simulation peut changer `player.facing` d'un tick à l'autre d'un angle
// quelconque (demi-tour vers le curseur au début d'un geste, nouvelle direction de marche au clavier). Affiché tel
// quel, le modèle saute d'une image à l'autre. Le rendu tourne donc le modèle vite et sans à-coup vers l'orientation
// de la simulation, sans jamais retarder un coup : au tick où un coup porte, le modèle regarde exactement dans la
// direction du coup.
//
// Règle : chaque changement d'orientation de la simulation lance un virage, courbe d'Hermite cubique qui part de
// l'orientation et de la vitesse affichées (sans à-coup) et arrive sur la nouvelle orientation à vitesse nulle, en au
// plus TURN_TICKS ticks. TURN_TICKS est l'anticipation la plus courte des armes (TUNING.weapons.*.windup) : un
// demi-tour lancé avec une Frappe est fini à son tick d'impact. Tout geste en cours impose en plus son échéance : le
// tick d'impact d'une Frappe ou d'un Balayage (`activeAt`), la fin d'une Sentence (la mort tombe alors), et le tick
// même où un coup du joueur porte (Charge). La vitesse initiale est bornée pour que le virage ne dépasse jamais sa
// cible (Hermite monotone).
//
// Pur et déterministe : l'orientation affichée est une fonction de la suite des mondes observés (une fois par tick,
// renderer.observe) et de l'horloge de rendu t (ticks) ; rendre deux fois la même paire de mondes donne la même image.
import { TUNING } from '../../sim/index'

export const TURN_TICKS = Math.max(1, Math.min(...Object.values(TUNING.weapons).map((w) => w.windup)))

const EPS = 1e-9

export const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a))

// Virage : de p0 (tangente m0, en radians sur toute la durée) à p1 (tangente nulle), du tick `from` au tick from + d.
export interface Turn {
  readonly from: number
  readonly d: number
  readonly p0: number
  readonly m0: number
  readonly p1: number
}

export const turnAt = (turn: Turn, t: number): number => {
  const u = Math.min(1, Math.max(0, (t - turn.from) / turn.d))
  const u2 = u * u
  const u3 = u2 * u
  return turn.p0 * (2 * u3 - 3 * u2 + 1) + turn.m0 * (u3 - 2 * u2 + u) + turn.p1 * (-2 * u3 + 3 * u2)
}

// Vitesse (rad/tick) du virage à l'instant t.
export const turnRate = (turn: Turn, t: number): number => {
  const raw = (t - turn.from) / turn.d
  if (raw <= 0 && turn.d > 0) return turn.m0 / turn.d
  if (raw >= 1) return 0
  const u = raw
  const u2 = u * u
  return (turn.p0 * (6 * u2 - 6 * u) + turn.m0 * (3 * u2 - 4 * u + 1) + turn.p1 * (-6 * u2 + 6 * u)) / turn.d
}

// Échéance d'un geste observé au tick T : tick où le modèle doit regarder dans la direction du coup.
export interface FacingInput {
  readonly tick: number
  readonly facing: number // orientation de la simulation
  readonly deadline: number | null // tick du coup du geste en cours (≥ tick), sinon null
  readonly snap: boolean // nouvelle vie (L6) : pas de virage
}

const HISTORY = 4

export class FacingSmoother {
  private turn: Turn | null = null
  private lastTick = Number.NEGATIVE_INFINITY
  // Virage valable sur [T − 1 ; T], décidé au tick T, pour les derniers ticks observés.
  private readonly history: { tick: number; turn: Turn }[] = []

  clear(): void {
    this.turn = null
    this.lastTick = Number.NEGATIVE_INFINITY
    this.history.length = 0
  }

  observe(o: FacingInput): void {
    const T = o.tick
    if (T <= this.lastTick) this.clear()
    const prev = this.turn
    let turn: Turn
    if (!prev || o.snap || T - this.lastTick > 1) {
      turn = { from: T - 1, d: 1, p0: o.facing, m0: 0, p1: o.facing }
    } else {
      const deadline = o.deadline === null ? null : Math.max(T, o.deadline)
      const sameTarget = Math.abs(wrapAngle(o.facing - prev.p1)) <= EPS
      const late = deadline !== null && prev.from + prev.d > deadline
      if (sameTarget && !late) turn = prev
      else {
        const from = T - 1
        const p0 = turnAt(prev, from)
        const p1 = p0 + wrapAngle(o.facing - p0)
        const delta = p1 - p0
        const d = Math.max(1, Math.min(TURN_TICKS, deadline === null ? TURN_TICKS : deadline - from))
        // Vitesse affichée conservée (aucun à-coup), bornée à 3 × l'écart (courbe monotone, pas de dépassement) et
        // annulée si elle va à l'opposé du nouveau virage.
        const v = turnRate(prev, from) * d
        const m0 =
          Math.abs(delta) <= EPS || Math.sign(v) !== Math.sign(delta)
            ? 0
            : Math.sign(delta) * Math.min(Math.abs(v), 3 * Math.abs(delta))
        turn = { from, d, p0, m0, p1 }
      }
    }
    this.turn = turn
    this.lastTick = T
    this.history.push({ tick: T, turn })
    if (this.history.length > HISTORY) this.history.shift()
  }

  // Orientation affichée à l'horloge de rendu t (ticks) ; null si t sort des ticks observés (le rendu interpole alors
  // les orientations de la simulation).
  at(t: number): number | null {
    const T = Math.ceil(t - 1e-9)
    const h = this.history.find((x) => x.tick === T)
    return h ? wrapAngle(turnAt(h.turn, t)) : null
  }
}
