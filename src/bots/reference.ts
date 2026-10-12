// Politiques de référence du banc. Elles servent à éprouver le banc (fin de vague, plafond, mémoire,
// latence), pas à mesurer un contrat : les politiques des contrats vivent dans b1b3/ et b2b4b5/.
import { dhypot, IDLE_COMMANDS, type PlayerCommands, TUNING, type Vec2, type World } from '../sim/index'
import type { Policy, PolicyFactory } from './policy'

type Creature = World['creatures'][number]

const dist = (a: Vec2, b: Vec2): number => dhypot(a.x - b.x, a.z - b.z)
const unit = (from: Vec2, to: Vec2): Vec2 => {
  const d = dist(from, to)
  return d === 0 ? { x: 0, z: 0 } : { x: (to.x - from.x) / d, z: (to.z - from.z) / d }
}

// ref-inerte : ne fait rien. La vague ne finit jamais : sert à vérifier le plafond et l'activité des supports
// quand personne ne les dérange.
export const inerte: Policy<null> = {
  name: 'ref-inerte',
  init: () => null,
  decide: () => [IDLE_COMMANDS, null],
}

// ref-frappeur : garde une cible tant qu'elle est vivante (mémoire), sinon prend la créature non morte la plus
// proche (égalité : plus petit id). Frappe à portée de l'arme, donne la Sentence aux Résistants à terre.
// Marge d'arrêt : 0,5 m sous la portée, pour frapper sans buter contre la cible.
interface FrappeurMemory {
  readonly target: number | null
}
const STOP_MARGIN = 0.5

const targetable = (c: Creature): boolean =>
  c.state.kind === 'rituel' || c.state.kind === 'hostile' || c.state.kind === 'abattu'

const nearest = (w: World): Creature | undefined => {
  let best: Creature | undefined
  let bestD = Number.POSITIVE_INFINITY
  for (const c of w.creatures) {
    if (!targetable(c)) continue
    const d = dist(c.pos, w.player.pos)
    if (d < bestD) {
      best = c
      bestD = d
    }
  }
  return best
}

export const frappeur: Policy<FrappeurMemory> = {
  name: 'ref-frappeur',
  init: () => ({ target: null }),
  decide: (w, memory) => {
    const p = w.player
    const keep: PlayerCommands = { ...IDLE_COMMANDS, aim: p.pos }
    if (p.action !== null && p.action.kind !== 'frappe') return [keep, memory]
    const kept = memory.target === null ? undefined : w.creatures.find((c) => c.id === memory.target)
    const t = kept && targetable(kept) ? kept : nearest(w)
    if (!t) return [keep, { target: null }]
    const d = dist(p.pos, t.pos)
    const next = { target: t.id }
    const toward = unit(p.pos, t.pos)
    if (t.state.kind === 'abattu' && t.resistant) {
      const range = TUNING.sentence.range - STOP_MARGIN
      return d <= range
        ? [{ ...IDLE_COMMANDS, aim: t.pos, sentence: true }, next]
        : [{ ...IDLE_COMMANDS, aim: t.pos, move: toward }, next]
    }
    const reach = TUNING.weapons[p.weapon].reach
    return [
      {
        ...IDLE_COMMANDS,
        aim: t.pos,
        move: d > reach - STOP_MARGIN ? toward : { x: 0, z: 0 },
        strike: d <= reach,
      },
      next,
    ]
  },
}

export const policies: Readonly<Record<string, PolicyFactory>> = {
  'ref-inerte': () => inerte as Policy,
  'ref-frappeur': () => frappeur as Policy,
}
