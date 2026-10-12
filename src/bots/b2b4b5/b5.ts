// B5 « Entendre la mort », §6 du contrat gelé (.mercy/contracts/_frozen/B5.md) : politique `b5(D)` pour
// D ∈ { 0, 60, ∞ } (ensemble de parties R), et les politiques des scènes S1 (`s1(k, verbe)`), S-nappe et S-sat.
// Les scènes elles-mêmes sont dans src/sim/waves.ts (C6a). Arme : Couperet pour toutes les scènes et parties.
// Jamais d'Esquive, jamais de Charge. Fin de partie (N = 0, t = 10 800, « mort + 180 », t = 265) : paramètres du
// lanceur (--timeout-ticks, --tail-ticks), pas de la politique.
import { type Creature, dhypot, type PlayerCommands, type Vec2, type World } from '../../sim/index'
import type { Policy } from '../policy'

// Communes à toutes les politiques.
// dist(c) = distance (x, z) entre p.pos et c.pos
const dist = (w: World, c: Creature): number => dhypot(c.pos.x - w.player.pos.x, c.pos.z - w.player.pos.z)
// tri(E) = E trié par (dist(c), c.id) croissants
const tri = (w: World, E: readonly Creature[]): Creature[] =>
  [...E].sort((a, b) => dist(w, a) - dist(w, b) || a.id - b.id)
const ab = (c: Creature): boolean => c.state.kind === 'abattu'
const debout = (c: Creature): boolean => c.state.kind === 'rituel' || c.state.kind === 'hostile'
// unitaire(v) = v / |v| (0 si |v| = 0)
const unitaire = (v: Vec2): Vec2 => {
  const l = dhypot(v.x, v.z)
  return l === 0 ? { x: 0, z: 0 } : { x: v.x / l, z: v.z / l }
}
const minus = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, z: a.z - b.z })
export const base = (w: World): PlayerCommands => ({
  move: { x: 0, z: 0 },
  aim: { x: w.player.pos.x + 1, z: w.player.pos.z },
  strike: false,
  dodge: false,
  sentence: false,
  rite: null,
  swapWeapon: false,
})
const pair = (t: number): boolean => t % 2 === 0 // (t mod 2 = 0)

// ---------------------------------------------------------------------------------------------------------------
// Politique b5(D), D ∈ { 0, 60, ∞ } ticks

export const B5_D: readonly number[] = [0, 60, Number.POSITIVE_INFINITY]

const B5_SENTENCE = 2.3 // m
const B5_FRAPPE = 2.0 // m
const B5_BALAYAGE_FERVEUR = 25
const B5_BALAYAGE_R = 3.8 // m
const B5_BALAYAGE_N = 3

export const decideB5 = (D: number, w: World): PlayerCommands => {
  const p = w.player
  const t = w.tick
  // prêt(c) = ab(c) et non c.resistant et (t − c.state.since) ≥ D ; D = ∞ : jamais prêt
  const pret = (c: Creature): boolean =>
    c.state.kind === 'abattu' && !c.resistant && D !== Number.POSITIVE_INFINITY && t - c.state.since >= D
  const Res = tri(
    w,
    w.creatures.filter((c) => ab(c) && c.resistant),
  )
  const Ord = tri(w, w.creatures.filter(pret))
  const Deb = tri(w, w.creatures.filter(debout))
  const res0 = Res[0]
  const ord0 = Ord[0]
  const deb0 = Deb[0]

  if (p.action !== null) return base(w)
  if (res0 && dist(w, res0) <= B5_SENTENCE) return { ...base(w), aim: res0.pos, sentence: pair(t) }
  if (ord0 && dist(w, ord0) <= B5_FRAPPE) return { ...base(w), aim: ord0.pos, strike: true }
  if (
    p.ferveur >= B5_BALAYAGE_FERVEUR &&
    Deb.filter((c) => dist(w, c) <= B5_BALAYAGE_R).length >= B5_BALAYAGE_N
  )
    return { ...base(w), rite: 'balayage' }
  if (deb0 && dist(w, deb0) <= B5_FRAPPE) return { ...base(w), aim: deb0.pos, strike: true }
  // C = tri(Ord ∪ Rés ∪ Deb) : les trois ensembles sont disjoints.
  const C = tri(w, [...Ord, ...Res, ...Deb])
  const c0 = C[0]
  if (!c0) return base(w)
  return { ...base(w), move: unitaire(minus(c0.pos, p.pos)), aim: c0.pos }
}

export const b5 = (D: number): Policy<null> => ({
  name: `b5:D=${D === Number.POSITIVE_INFINITY ? 'inf' : D}`,
  init: () => null,
  decide: (w) => [decideB5(D, w), null],
})

// ---------------------------------------------------------------------------------------------------------------
// Politique s1(k, verbe), scène S1

export type Verbe = 'frappe' | 'sentence' | 'aucun'
export const VERBES: readonly Verbe[] = ['frappe', 'sentence', 'aucun']

// Variantes de la scène S1 (table du §6) : k et verbe.
export const S1_VARIANTES: Readonly<Record<string, { readonly k: number; readonly verbe: Verbe }>> = {
  'S1-hal': { k: 0, verbe: 'frappe' },
  'S1-cri': { k: 120, verbe: 'frappe' },
  'S1-sent': { k: 120, verbe: 'sentence' },
  'S1-insp': { k: 300, verbe: 'frappe' },
  'S1-rel': { k: 0, verbe: 'aucun' }, // k absent de la table : sans effet quand verbe = aucun
}

export const decideS1 = (k: number, verbe: Verbe, w: World): PlayerCommands => {
  const t = w.tick
  // c = la créature d'id minimal ; base.aim = c.pos
  const c = w.creatures.reduce<Creature | undefined>((m, x) => (!m || x.id < m.id ? x : m), undefined)
  if (!c) return base(w)
  const b = { ...base(w), aim: c.pos }
  if (debout(c)) return { ...b, strike: true } // combo maintenu, deux coups l'abattent
  if (c.state.kind === 'abattu' && verbe !== 'aucun' && t >= c.state.since + k) {
    if (verbe === 'frappe') return { ...b, strike: true } // maintenu jusqu'à la mort
    if (verbe === 'sentence') return w.player.action === null ? { ...b, sentence: pair(t) } : b
  }
  return b
}

export const s1 = (k: number, verbe: Verbe): Policy<null> => ({
  name: `s1:k=${k}:verbe=${verbe}`,
  init: () => null,
  decide: (w) => [decideS1(k, verbe, w), null],
})

// ---------------------------------------------------------------------------------------------------------------
// Politique s-nappe, scène S-nappe

const NAPPE_PALIER = 180 // ticks
const NAPPE_APPROCHE = 2.0 // m

export const decideSNappe = (w: World): PlayerCommands => {
  const t = w.tick
  // dernier = max(c.state.at pour les c morts), 0 s'il n'y en a aucun
  const dernier = w.creatures.reduce((m, c) => (c.state.kind === 'mort' ? Math.max(m, c.state.at) : m), 0)
  if (t < dernier + NAPPE_PALIER) return base(w)
  // c = créature non morte d'id minimal ; si aucune : renvoyer base
  const c = w.creatures
    .filter((x) => x.state.kind !== 'mort')
    .reduce<Creature | undefined>((m, x) => (!m || x.id < m.id ? x : m), undefined)
  if (!c) return base(w)
  if (dist(w, c) > NAPPE_APPROCHE && debout(c))
    return { ...base(w), move: unitaire(minus(c.pos, w.player.pos)), aim: c.pos }
  return { ...base(w), aim: c.pos, strike: true } // combo maintenu : abattu au 2e coup, achevé au 3e
}

export const sNappe: Policy<null> = {
  name: 's-nappe',
  init: () => null,
  decide: (w) => [decideSNappe(w), null],
}

// ---------------------------------------------------------------------------------------------------------------
// Politique s-sat, scène S-sat

export const S_SAT_FIN = 265 // fin à t = 265, avant les inspirations de t = 270

export const decideSSat = (w: World): PlayerCommands => {
  const t = w.tick
  if (t < 90) return base(w)
  if (t < 150) return { ...base(w), move: { x: 0, z: 1 } }
  if (t < 210) return { ...base(w), move: { x: 0, z: -1 } }
  if (t < S_SAT_FIN) return { ...base(w), move: { x: 0, z: -1 } }
  return base(w) // au-delà de la fin de la scène (le lanceur s'arrête à 265)
}

export const sSat: Policy<null> = {
  name: 's-sat',
  init: () => null,
  decide: (w) => [decideSSat(w), null],
}
